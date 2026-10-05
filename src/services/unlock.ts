/**
 * UNLOCK: opportunities for enterprises that are ready, and the referral workflow around them.
 * Rules, in order of importance:
 *  1. The matcher suggests; people decide. Nothing is sent to a partner by this service.
 *  2. The owner consents, per opportunity, to named kinds of data. The database refuses a referral past Approved without consent and approval.
 *  3. A match always carries its reasons, and a score with Low confidence is labelled, never hidden.
 *  4. Every change is audited and every status change is kept as history.
 */
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertOrg, caseScope, isInternal, orgScope } from '@/domain/scope';
import { effectiveStatus } from '@/domain/certification';
import { CERT_ORDER, CONSENT_SCOPES, acceptingReferrals, canAdvance, evaluate, isOpenReferral, needsReadiness, type Criteria, type Evaluation, type Facts } from '@/domain/unlock';
import { notifyUsers } from '@/domain/notify';
import { OPPORTUNITY_TYPES } from '@/db/schema';
import { allow, need } from './common';
import { AgentBlocked, NonRetryable, runAgent } from './ai';
import { READER_MAX_CHARS, mockMatch, mockReading, validateMatch, validateReading, type MatcherContext, type MatcherOutput, type ReaderOutput } from '@/domain/opportunity-agents';

const o = schema.opportunities, r = schema.opportunityReferrals, ev = schema.opportunityReferralEvents;
const list = z.array(z.string().trim().min(1).max(80)).max(30);
export const criteriaSchema = z.object({
  minOverall: z.number().min(0).max(100).optional(),
  minConfidence: z.enum(['Medium', 'High']).optional(),
  certification: z.enum(CERT_ORDER).optional(),
  readiness: z.array(z.object({ code: z.string().trim().min(1).max(16), min: z.enum(['Conditionally ready', 'Ready']) })).max(12).optional(),
  dimensionMin: z.record(z.string().max(80), z.number().min(0).max(100)).optional(),
  sectors: list.optional(), regions: list.optional(), sizes: list.optional(), orgTypes: list.optional(), countries: list.optional(),
  minYearsOperating: z.number().int().min(0).max(100).optional()
}).strict();

const isStaff = (ctx: Ctx) => ctx.user!.role !== 'OWNER';
const money = (v: string | null) => (v === null ? null : Number(v));
const view = (x: typeof o.$inferSelect) => ({
  id: x.id, title: x.title, type: x.type, provider: x.provider, summary: x.summary, url: x.url, valueMin: money(x.valueMin), valueMax: money(x.valueMax), currency: x.currency,
  deadline: x.deadline, status: x.status, criteria: x.criteria as Criteria, source: x.source, sourceRef: x.sourceRef, publishedAt: x.publishedAt, updatedAt: x.updatedAt,
  accepting: acceptingReferrals(x)
});

/* ------------------------------- catalogue ------------------------------ */
export type OpportunityInput = { title: string; type: string; provider: string; summary: string; url?: string | null; valueMin?: number | null; valueMax?: number | null; currency?: string; deadline?: string | null; criteria?: Criteria };

function clean(b: Partial<OpportunityInput>) {
  if (b.type !== undefined && !(OPPORTUNITY_TYPES as readonly string[]).includes(b.type)) throw badRequest(`Type must be one of ${OPPORTUNITY_TYPES.join(', ')}`);
  if (b.valueMin != null && b.valueMax != null && b.valueMin > b.valueMax) throw unprocessable('The minimum value cannot be above the maximum');
  if (b.url) { try { const u = new URL(b.url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { throw unprocessable('The link must start with http or https'); } }
}

export async function listOpportunities(ctx: Ctx, q: { status?: string }) {
  allow(ctx, 'opportunities', 'read');
  const staff = isStaff(ctx);
  const rows = await ctx.db.select().from(o).where(staff ? (q.status ? eq(o.status, q.status) : sql`${o.status} <> 'Archived'`) : eq(o.status, 'Open')).orderBy(asc(o.deadline), desc(o.createdAt)).limit(300);
  return { items: rows.map(view) };
}

export async function createOpportunity(ctx: Ctx, body: OpportunityInput) {
  allow(ctx, 'opportunities', 'create');
  clean(body);
  const [row] = await ctx.db.insert(o).values({ title: body.title, type: body.type, provider: body.provider, summary: body.summary, url: body.url ?? null, valueMin: body.valueMin == null ? null : String(body.valueMin), valueMax: body.valueMax == null ? null : String(body.valueMax), currency: body.currency ?? 'GHS', deadline: body.deadline ?? null, criteria: (body.criteria ?? {}) as Record<string, unknown>, createdBy: need(ctx).user.id }).returning();
  await audit(ctx, 'opportunity.created', 'opportunity', row.id, undefined, { title: row.title, type: row.type });
  return view(row);
}

async function get(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(o).where(eq(o.id, id)).limit(1);
  if (!row) throw notFound('Opportunity not found');
  return row;
}

export async function updateOpportunity(ctx: Ctx, id: string, body: Partial<OpportunityInput>) {
  allow(ctx, 'opportunities', 'edit');
  const cur = await get(ctx, id);
  if (cur.status === 'Archived') throw unprocessable('Archived opportunities cannot be edited');
  clean(body);
  const set: Partial<typeof o.$inferInsert> = { updatedAt: new Date() };
  for (const k of ['title', 'type', 'provider', 'summary', 'url', 'currency', 'deadline'] as const) if (body[k] !== undefined) (set as any)[k] = body[k];
  if (body.valueMin !== undefined) set.valueMin = body.valueMin == null ? null : String(body.valueMin);
  if (body.valueMax !== undefined) set.valueMax = body.valueMax == null ? null : String(body.valueMax);
  if (body.criteria !== undefined) set.criteria = body.criteria as Record<string, unknown>;
  const [row] = await ctx.db.update(o).set(set).where(eq(o.id, id)).returning();
  await audit(ctx, 'opportunity.updated', 'opportunity', id, { status: cur.status }, { fields: Object.keys(body), status: row.status });
  return view(row);
}

export async function setOpportunityStatus(ctx: Ctx, id: string, to: 'Open' | 'Closed' | 'Archived') {
  allow(ctx, 'opportunities', to === 'Open' ? 'approve' : 'edit');
  const cur = await get(ctx, id);
  const ok = { Open: ['Draft', 'Closed'], Closed: ['Open'], Archived: ['Draft', 'Open', 'Closed'] }[to];
  if (!ok.includes(cur.status)) throw unprocessable(`A ${cur.status.toLowerCase()} opportunity cannot be ${to === 'Open' ? 'published' : to.toLowerCase()}`);
  if (to === 'Open') {
    if (cur.deadline && !acceptingReferrals({ status: 'Open', deadline: cur.deadline })) throw unprocessable('The deadline has passed. Change it before publishing');
    if (!cur.summary.trim() || !cur.provider.trim()) throw unprocessable('A published opportunity needs a provider and a summary');
  }
  const set: Partial<typeof o.$inferInsert> = { status: to, updatedAt: new Date() };
  if (to === 'Open') { set.publishedBy = need(ctx).user.id; set.publishedAt = new Date(); }
  const [row] = await ctx.db.update(o).set(set).where(eq(o.id, id)).returning();
  await audit(ctx, `opportunity.${to === 'Open' ? 'published' : to.toLowerCase()}`, 'opportunity', id, { status: cur.status }, { status: to });
  return view(row);
}

export type ImportItem = { sourceRef: string; title: string; type: string; provider: string; summary: string; url?: string | null; valueMin?: number | null; valueMax?: number | null; currency?: string; deadline?: string | null };
/** Bring in opportunities found elsewhere (for example SOPIS). They arrive as Draft with no criteria; a person adds criteria and publishes. Running it twice never duplicates. */
export async function importOpportunities(ctx: Ctx, source: string, items: ImportItem[]) {
  allow(ctx, 'opportunities', 'create');
  let created = 0, skipped = 0;
  const bad: { sourceRef: string; reason: string }[] = [];
  for (const it of items) {
    try { clean(it); } catch (e: any) { bad.push({ sourceRef: it.sourceRef, reason: e.message ?? 'Invalid' }); continue; }
    const res = await ctx.db.insert(o).values({ title: it.title, type: it.type, provider: it.provider, summary: it.summary, url: it.url ?? null, valueMin: it.valueMin == null ? null : String(it.valueMin), valueMax: it.valueMax == null ? null : String(it.valueMax), currency: it.currency ?? 'GHS', deadline: it.deadline ?? null, source, sourceRef: it.sourceRef, createdBy: need(ctx).user.id }).onConflictDoNothing().returning({ id: o.id });
    if (res.length) created++; else skipped++;
  }
  await audit(ctx, 'opportunity.imported', 'opportunity', null, undefined, { source, created, skipped, rejected: bad.length });
  return { created, skipped, rejected: bad };
}

/* ------------------------------- readiness ------------------------------ */
/** What the matcher knows about an enterprise, from the records the user is allowed to see. Same case scope as the Business Health Record. */
export async function factsFor(ctx: Ctx, orgId: string): Promise<{ facts: Facts; scoredAt: Date | null; caseId: string | null }> {
  const org = await assertOrg(ctx, orgId);
  const user = need(ctx).user;
  const cases = await ctx.db.select({ id: schema.cases.id }).from(schema.cases).where(and(eq(schema.cases.orgId, orgId), caseScope(user)));
  const ids = cases.map((c) => c.id);
  let score: Facts['score'] = null, scoredAt: Date | null = null, caseId: string | null = null, cert: Facts['certification'] = null;
  if (ids.length) {
    const [s] = await ctx.db.select().from(schema.healthScores).where(inArray(schema.healthScores.caseId, ids)).orderBy(desc(schema.healthScores.createdAt)).limit(1);
    if (s) {
      const extras = (s.extras ?? null) as { readiness?: { code: string; name: string; level: string }[] } | null;
      score = { overall: Number(s.overall), confidence: s.confidenceClass as 'Low' | 'Medium' | 'High', maturity: s.maturity, dimensions: s.dimensions, readiness: (extras?.readiness ?? []).map((x) => ({ code: x.code, name: x.name, level: x.level })) };
      scoredAt = s.createdAt; caseId = s.caseId;
    }
    const certs = await ctx.db.select().from(schema.certificates).where(and(inArray(schema.certificates.caseId, ids), eq(schema.certificates.status, 'Certified')));
    for (const c of certs) if (effectiveStatus(c.status, c.expiresAt) === 'Certified' && (cert === null || CERT_ORDER.indexOf(c.level as any) > CERT_ORDER.indexOf(cert))) cert = c.level as any;
  }
  return { facts: { org: { type: org.type, sector: org.sector, region: org.region, size: org.size, countryCode: org.countryCode, yearsOperating: org.yearsOperating }, score, certification: cert }, scoredAt, caseId };
}

const order = { Eligible: 0, Close: 1, 'Not yet': 2, Unknown: 3, 'Not a fit': 4 } as const;
const refView = (x: typeof r.$inferSelect) => ({ id: x.id, status: x.status, consentAt: x.consentAt, consentScope: x.consentScope, approvedAt: x.approvedAt, referredAt: x.referredAt, amountGhs: money(x.amountGhs), outcomeNote: x.outcomeNote, createdAt: x.createdAt, updatedAt: x.updatedAt, suggested: !!x.suggestedBy });

/** The enterprise's pathway: every open opportunity with a plain-language match, and any referral already under way. */
export async function pathway(ctx: Ctx, orgId: string) {
  allow(ctx, 'opportunities', 'read');
  const { facts, scoredAt } = await factsFor(ctx, orgId);
  const [opps, refs] = await Promise.all([
    ctx.db.select().from(o).where(eq(o.status, 'Open')).orderBy(asc(o.deadline)),
    ctx.db.select().from(r).where(eq(r.orgId, orgId)).orderBy(desc(r.createdAt))
  ]);
  const byOpp = new Map(refs.filter((x) => isOpenReferral(x.status) || x.status === 'Awarded').map((x) => [x.opportunityId, x]));
  const items = opps.filter((x) => acceptingReferrals(x)).map((x) => ({ opportunity: view(x), match: evaluate(x.criteria as Criteria, facts), referral: byOpp.has(x.id) ? refView(byOpp.get(x.id)!) : null }));
  const shown = items.filter((i) => i.match.status !== 'Not a fit' || i.referral);
  shown.sort((a, b) => order[a.match.status] - order[b.match.status]);
  const inCatalogue = new Set(opps.map((x) => x.id));
  const past = refs.filter((x) => !byOpp.has(x.opportunityId) || !inCatalogue.has(x.opportunityId));
  const names = new Map((await ctx.db.select({ id: o.id, title: o.title, provider: o.provider, type: o.type }).from(o).where(inArray(o.id, [...new Set(past.map((p) => p.opportunityId))].length ? [...new Set(past.map((p) => p.opportunityId))] : ['00000000-0000-0000-0000-000000000000']))).map((x) => [x.id, x]));
  return {
    readiness: { scored: !!facts.score, overall: facts.score?.overall ?? null, confidence: facts.score?.confidence ?? null, maturity: facts.score?.maturity ?? null, certification: facts.certification, scoredAt },
    items: shown, notAFit: items.length - shown.length,
    history: past.map((x) => ({ ...refView(x), opportunity: names.get(x.opportunityId) ?? null }))
  };
}

/* ------------------------------- referrals ------------------------------ */
async function peopleToTell(ctx: Ctx, orgId: string) {
  const owners = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.orgId, orgId), eq(schema.users.role, 'OWNER')));
  const staff = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.role, ['ADMIN', 'PROGRAMME_MANAGER']));
  return { owners: owners.map((x) => x.id), staff: staff.map((x) => x.id) };
}
async function event(ctx: Ctx, referralId: string, from: string | null, to: string, note?: string | null) {
  await ctx.db.insert(ev).values({ referralId, fromStatus: from, toStatus: to, actorId: need(ctx).user.id, note: note ?? null });
}
async function referral(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(r).where(eq(r.id, id)).limit(1);
  if (!row) throw notFound('Referral not found');
  await assertOrg(ctx, row.orgId); // out of scope reads as not found
  const [opp] = await ctx.db.select().from(o).where(eq(o.id, row.opportunityId)).limit(1);
  return { row, opp };
}
const scopeOk = (s: string[]) => {
  if (!s.length) throw unprocessable('Choose what may be shared. Without that, nothing can be referred');
  const bad = s.filter((x) => !(CONSENT_SCOPES as readonly string[]).includes(x));
  if (bad.length) throw badRequest(`Unknown items: ${bad.join(', ')}`);
  return [...new Set(s)];
};
async function eligibleToStart(ctx: Ctx, orgId: string, opportunityId: string) {
  const opp = await get(ctx, opportunityId);
  if (!acceptingReferrals(opp)) throw unprocessable('This opportunity is not open for referrals');
  const { facts } = await factsFor(ctx, orgId);
  const match = evaluate(opp.criteria as Criteria, facts);
  if (match.status === 'Not a fit') throw unprocessable(`This opportunity is not a fit: ${match.mismatches[0]}`);
  const [dup] = await ctx.db.select({ id: r.id }).from(r).where(and(eq(r.orgId, orgId), eq(r.opportunityId, opportunityId), sql`${r.status} not in ('Declined','Withdrawn')`)).limit(1);
  if (dup) throw conflict('There is already a referral for this opportunity');
  return { opp, match };
}

/** Staff propose an opportunity to an enterprise. The owner must consent before anything else happens. */
export async function suggest(ctx: Ctx, orgId: string, opportunityId: string) {
  allow(ctx, 'referrals', 'create');
  if (!isStaff(ctx)) throw forbidden('Owners ask for a referral; staff suggest one');
  await assertOrg(ctx, orgId);
  const { opp, match } = await eligibleToStart(ctx, orgId, opportunityId);
  const [row] = await ctx.db.insert(r).values({ orgId, opportunityId, status: 'Suggested', suggestedBy: need(ctx).user.id, matchSnapshot: match as unknown as Record<string, unknown> }).returning();
  await event(ctx, row.id, null, 'Suggested');
  await audit(ctx, 'referral.suggested', 'referral', row.id, undefined, { orgId, opportunity: opp.title, match: match.status });
  const who = await peopleToTell(ctx, orgId);
  await notifyUsers(ctx, who.owners, { kind: 'unlock', title: `An opportunity for your business: ${opp.title}`, body: 'Your adviser thinks this could suit you. Nothing is shared until you agree.', link: `/organisations/${orgId}/pathway`, email: true });
  return refView(row);
}

/** The owner asks to be considered, and consents to named data being shared. */
export async function requestReferral(ctx: Ctx, orgId: string, opportunityId: string, scope: string[]) {
  allow(ctx, 'referrals', 'create');
  if (isStaff(ctx)) throw forbidden('Only the business owner can ask to be referred. Staff suggest');
  await assertOrg(ctx, orgId);
  const sc = scopeOk(scope);
  const { opp, match } = await eligibleToStart(ctx, orgId, opportunityId);
  const [row] = await ctx.db.insert(r).values({ orgId, opportunityId, status: 'Consented', consentBy: need(ctx).user.id, consentAt: new Date(), consentScope: sc, matchSnapshot: match as unknown as Record<string, unknown> }).returning();
  await event(ctx, row.id, null, 'Consented');
  await audit(ctx, 'referral.requested', 'referral', row.id, undefined, { orgId, opportunity: opp.title, consent: sc, match: match.status });
  const who = await peopleToTell(ctx, orgId);
  await notifyUsers(ctx, who.staff, { kind: 'unlock', title: `Referral requested: ${opp.title}`, body: 'The owner has consented to sharing. Review the match and approve or decline.', link: `/organisations/${orgId}/pathway` });
  return refView(row);
}

/** The owner agrees to a suggestion. */
export async function consent(ctx: Ctx, id: string, scope: string[]) {
  allow(ctx, 'referrals', 'create');
  if (isStaff(ctx)) throw forbidden('Only the business owner can give consent');
  const { row, opp } = await referral(ctx, id);
  if (row.status !== 'Suggested') throw unprocessable(`Consent applies to a suggestion. This referral is ${row.status}`);
  const sc = scopeOk(scope);
  const [u] = await ctx.db.update(r).set({ status: 'Consented', consentBy: need(ctx).user.id, consentAt: new Date(), consentScope: sc, updatedAt: new Date() }).where(and(eq(r.id, id), eq(r.status, 'Suggested'))).returning();
  if (!u) throw conflict('This referral changed. Reload and try again');
  await event(ctx, id, 'Suggested', 'Consented');
  await audit(ctx, 'referral.consented', 'referral', id, { status: 'Suggested' }, { consent: sc, opportunity: opp.title });
  const who = await peopleToTell(ctx, row.orgId);
  await notifyUsers(ctx, who.staff, { kind: 'unlock', title: `Consent given: ${opp.title}`, body: 'Review the match and approve or decline.', link: `/organisations/${row.orgId}/pathway` });
  return refView(u);
}

/** A person confirms the match is sound. The match is checked again now, not trusted from earlier. */
export async function approve(ctx: Ctx, id: string, note?: string | null) {
  allow(ctx, 'referrals', 'approve');
  const { row, opp } = await referral(ctx, id);
  if (row.status !== 'Consented') throw unprocessable(row.status === 'Suggested' ? 'The owner has not consented yet' : `This referral is ${row.status}`);
  if (!acceptingReferrals(opp)) throw unprocessable('This opportunity is no longer open for referrals');
  const { facts } = await factsFor(ctx, row.orgId);
  const match = evaluate(opp.criteria as Criteria, facts);
  if (match.status === 'Not a fit') throw unprocessable(`No longer a fit: ${match.mismatches[0]}`);
  if (needsReadiness(opp.criteria as Criteria) && match.status !== 'Eligible') throw unprocessable(`The enterprise does not meet the requirements yet (${match.summary}). Decline it, or wait until it does`);
  const [u] = await ctx.db.update(r).set({ status: 'Approved', approvedBy: need(ctx).user.id, approvedAt: new Date(), matchSnapshot: match as unknown as Record<string, unknown>, updatedAt: new Date() }).where(and(eq(r.id, id), eq(r.status, 'Consented'))).returning();
  if (!u) throw conflict('This referral changed. Reload and try again');
  await event(ctx, id, 'Consented', 'Approved', note);
  await audit(ctx, 'referral.approved', 'referral', id, { status: 'Consented' }, { opportunity: opp.title, match: match.status });
  const who = await peopleToTell(ctx, row.orgId);
  await notifyUsers(ctx, who.owners, { kind: 'unlock', title: `Approved: ${opp.title}`, body: 'Your adviser will now make the introduction and keep you updated.', link: `/organisations/${row.orgId}/pathway`, email: true });
  return refView(u);
}

/** Staff move a referral along. Declining needs a reason. Awarded may record the amount. */
export async function advance(ctx: Ctx, id: string, to: string, note?: string | null, amountGhs?: number | null) {
  allow(ctx, 'referrals', 'edit');
  const { row, opp } = await referral(ctx, id);
  if (!canAdvance(row.status, to)) throw unprocessable(`A referral that is ${row.status} cannot move to ${to}`);
  if (to === 'Declined' && !(note && note.trim().length >= 5)) throw unprocessable('Say why it is declined, so the owner can be told');
  if (amountGhs != null && to !== 'Awarded') throw unprocessable('An amount can only be recorded when the referral is awarded');
  if (to === 'Awarded' && amountGhs != null && amountGhs < 0) throw unprocessable('The amount cannot be negative');
  const set: Partial<typeof r.$inferInsert> = { status: to, updatedAt: new Date() };
  if (to === 'Referred') set.referredAt = new Date();
  if (to === 'Awarded' || to === 'Declined') set.outcomeNote = note?.trim() ?? null;
  if (to === 'Awarded' && amountGhs != null) set.amountGhs = String(amountGhs);
  const [u] = await ctx.db.update(r).set(set).where(and(eq(r.id, id), eq(r.status, row.status))).returning();
  if (!u) throw conflict('This referral changed. Reload and try again');
  await event(ctx, id, row.status, to, note);
  await audit(ctx, `referral.${to.toLowerCase()}`, 'referral', id, { status: row.status }, { opportunity: opp.title, amountGhs: amountGhs ?? null });
  const who = await peopleToTell(ctx, row.orgId);
  await notifyUsers(ctx, who.owners, { kind: 'unlock', title: `${opp.title}: ${to}`, body: note?.trim() || undefined, link: `/organisations/${row.orgId}/pathway`, email: to === 'Awarded' || to === 'Declined' });
  return refView(u);
}

/** The owner (or staff for them) steps back at any open stage. Nothing more is shared after this. */
export async function withdraw(ctx: Ctx, id: string, note?: string | null) {
  allow(ctx, 'referrals', 'delete');
  const { row, opp } = await referral(ctx, id);
  if (!isOpenReferral(row.status)) throw unprocessable(`This referral is already ${row.status}`);
  const [u] = await ctx.db.update(r).set({ status: 'Withdrawn', updatedAt: new Date(), outcomeNote: note?.trim() ?? null }).where(and(eq(r.id, id), eq(r.status, row.status))).returning();
  if (!u) throw conflict('This referral changed. Reload and try again');
  await event(ctx, id, row.status, 'Withdrawn', note);
  await audit(ctx, 'referral.withdrawn', 'referral', id, { status: row.status }, { opportunity: opp.title, by: need(ctx).user.role });
  if (isStaff(ctx)) { const who = await peopleToTell(ctx, row.orgId); await notifyUsers(ctx, who.owners, { kind: 'unlock', title: `Withdrawn: ${opp.title}`, link: `/organisations/${row.orgId}/pathway` }); }
  return refView(u);
}

export async function referralHistory(ctx: Ctx, id: string) {
  allow(ctx, 'referrals', 'read');
  const { row } = await referral(ctx, id);
  const rows = await ctx.db.select({ from: ev.fromStatus, to: ev.toStatus, note: ev.note, at: ev.createdAt, actor: schema.users.name }).from(ev).leftJoin(schema.users, eq(schema.users.id, ev.actorId)).where(eq(ev.referralId, row.id)).orderBy(asc(ev.createdAt));
  return { items: rows };
}

/** Staff queue: referrals across the enterprises they can see. */
export async function queue(ctx: Ctx, q: { status?: string }) {
  allow(ctx, 'referrals', 'read');
  if (!isStaff(ctx)) throw forbidden('Owners see their own pathway');
  const u = need(ctx).user;
  const rows = await ctx.db.select({ r, org: schema.organisations.name, orgCode: schema.organisations.code, title: o.title, provider: o.provider, type: o.type }).from(r)
    .innerJoin(schema.organisations, eq(schema.organisations.id, r.orgId)).innerJoin(o, eq(o.id, r.opportunityId))
    .where(and(q.status ? eq(r.status, q.status) : sql`true`, orgScope(u))).orderBy(desc(r.updatedAt)).limit(300);
  return { items: rows.map((x) => ({ ...refView(x.r), orgId: x.r.orgId, org: x.org, orgCode: x.orgCode, opportunity: { id: x.r.opportunityId, title: x.title, provider: x.provider, type: x.type } })) };
}

/** Totals for leadership. Counts and amounts only. */
export async function summary(ctx: Ctx) {
  allow(ctx, 'referrals', 'read');
  if (!isInternal(need(ctx).user)) throw forbidden('Summary is for staff');
  const rows = await ctx.db.select({ status: r.status, n: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${r.amountGhs}),0)` }).from(r).groupBy(r.status);
  const counts = Object.fromEntries(rows.map((x) => [x.status, x.n]));
  const open = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(o).where(eq(o.status, 'Open'));
  return { opportunitiesOpen: open[0]?.n ?? 0, referrals: counts, awardedCount: counts.Awarded ?? 0, fundingMobilisedGhs: Number(rows.find((x) => x.status === 'Awarded')?.amount ?? 0) };
}


/* --------------------------- agents that help --------------------------- */
const agentFailure = (e: unknown) => (e instanceof AgentBlocked ? unprocessable(`${e.message}. Do this by hand, or ask an administrator.`) : e instanceof NonRetryable ? unprocessable('The assistant could not produce a usable answer. Do this by hand.') : e);

/** Opportunity Reader (Luna): turn pasted call text into a draft for staff to check. Nothing is saved here. */
export async function readOpportunityText(ctx: Ctx, b: { text: string }) {
  allow(ctx, 'opportunities', 'create');
  const text = b.text.trim();
  if (text.length < 40) throw unprocessable('Paste more of the call. At least a few sentences are needed');
  if (text.length > READER_MAX_CHARS) throw unprocessable(`The text is too long. Paste up to ${READER_MAX_CHARS.toLocaleString('en-GB')} characters`);
  let res;
  try { res = await runAgent({ agent: 'opportunity_reader', caseId: null, requestedBy: need(ctx).user.id, context: { text }, validate: (o) => validateReading(o, text), mock: () => mockReading(text) }); } catch (e) { throw agentFailure(e); }
  const out = res.output as ReaderOutput;
  const parsed = criteriaSchema.safeParse(out.criteria);
  const uncertain = [...out.uncertain.map(String).slice(0, 12), ...(parsed.success ? [] : ['The requirements could not be read cleanly, so none were filled in'])];
  await audit(ctx, 'opportunity.read_by_agent', 'opportunity', null, undefined, { requestId: res.requestId, characters: text.length, fields: Object.keys(out).length });
  return {
    requestId: res.requestId,
    draft: { title: out.title.trim().slice(0, 200), type: out.type, provider: out.provider.trim().slice(0, 200), summary: out.summary.trim().slice(0, 1200), url: out.url && /^https?:\/\//.test(out.url) ? out.url : null, valueMin: out.valueMin, valueMax: out.valueMax, currency: (out.currency || 'GHS').slice(0, 8), deadline: out.deadline, criteria: parsed.success ? parsed.data : {} },
    uncertain, note: 'This is a draft. Check every field against the original call before saving. Nothing has been saved or published.'
  };
}

/** Opportunity Matcher (Sol): explain a rules-engine result in plain words. The verdict is never changed here. */
export async function explainMatch(ctx: Ctx, orgId: string, opportunityId: string) {
  allow(ctx, 'opportunities', 'read');
  const { facts } = await factsFor(ctx, orgId);
  const opp = await get(ctx, opportunityId);
  const match = evaluate(opp.criteria as Criteria, facts);
  const context: MatcherContext = {
    opportunity: { title: opp.title, type: opp.type, provider: opp.provider, summary: opp.summary, valueMin: money(opp.valueMin), valueMax: money(opp.valueMax), currency: opp.currency, deadline: opp.deadline },
    match, readiness: facts.score ? { overall: facts.score.overall, maturity: facts.score.maturity, confidence: facts.score.confidence } : null
  };
  let res;
  try { res = await runAgent({ agent: 'opportunity_matcher', caseId: null, requestedBy: need(ctx).user.id, context: context as unknown as Record<string, unknown>, validate: (o) => validateMatch(o, context), mock: () => mockMatch(context) }); } catch (e) { throw agentFailure(e); }
  const out = res.output as MatcherOutput;
  await audit(ctx, 'opportunity.match_explained', 'organisation', orgId, undefined, { opportunity: opp.title, status: match.status, requestId: res.requestId });
  return { status: match.status, explanation: out.explanation, nextSteps: out.next_steps, caveat: out.caveat ?? match.caution, requestId: res.requestId, note: 'This explains the rules check. It does not decide anything, and a referral still needs the owner\'s consent and a person\'s approval.' };
}
