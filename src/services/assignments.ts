/**
 * Who works on a case. Every placement is a row in case_assignments, so history, reasons and responses are kept.
 * cases.consultantId, coachId and reviewerId remain as a read-through pointer to the active lead, coach and reviewer,
 * and are written only here. Specialists are held in assignments alone.
 * A person decides every assignment. Matching only recommends.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { notifyUsers } from '@/domain/notify';
import { assertCase, caseScope } from '@/domain/scope';
import { assignability } from '@/domain/practitioners';
import { rankMatches, scoreMatch, type Match, type MatchNeed, type MatchProfile } from '@/domain/matching';
import { platformForOrgType } from '@/domain/routing';
import { allow, loadRules, need } from './common';
import { approvedPractitioners, loadFor } from './practitioners';
import { photoUrl } from './auth';

const a = schema.caseAssignments;
const c = schema.cases;
const u = schema.users;
export type Fn = 'lead' | 'specialist' | 'coach' | 'reviewer';
const POINTER: Record<Exclude<Fn, 'specialist'>, 'consultantId' | 'coachId' | 'reviewerId'> = { lead: 'consultantId', coach: 'coachId', reviewer: 'reviewerId' };
const FN_LABEL: Record<Fn, string> = { lead: 'lead expert', specialist: 'specialist expert', coach: 'coach', reviewer: 'reviewer' };

/** Independence rules. They hold whoever does the assigning. */
async function independence(ctx: Ctx, caseId: string, fn: Fn, userId: string) {
  const rows = await ctx.db.select({ fn: a.fn, userId: a.userId }).from(a).where(and(eq(a.caseId, caseId), eq(a.status, 'Active')));
  const mine = rows.filter((r) => r.userId === userId && r.fn !== fn);
  if (fn === 'reviewer' && mine.length) throw fieldError({ reviewerId: 'The reviewer must be a different person from everyone who works on the case' });
  if (fn !== 'reviewer' && mine.some((r) => r.fn === 'reviewer')) throw fieldError({ [fn === 'coach' ? 'coachId' : 'consultantId']: 'This person is the reviewer on this case' });
  if (fn === 'coach' && mine.some((r) => r.fn === 'specialist')) throw fieldError({ coachId: 'A specialist on this case cannot also coach it. Remove one role first.' });
  if (fn === 'specialist' && mine.some((r) => r.fn === 'coach')) throw fieldError({ userId: 'The coach on this case cannot also be a specialist. Remove one role first.' });
}

export type Placement = { fn: Fn; userId: string | null; reason?: string | null; specialisation?: string | null; match?: Match | null };

/** Places, replaces or removes one person in one capacity. Returns the new assignment id, if any. */
export async function place(ctx: Ctx, caseId: string, p: Placement): Promise<{ id: string | null; warnings: string[] }> {
  const actor = ctx.user;
  const [cs] = await ctx.db.select().from(c).where(eq(c.id, caseId)).limit(1);
  if (!cs) throw notFound('Case not found');
  const field = p.fn === 'lead' ? 'consultantId' : p.fn === 'coach' ? 'coachId' : p.fn === 'reviewer' ? 'reviewerId' : 'userId';
  const [cur] = p.fn === 'specialist' ? [undefined] : await ctx.db.select().from(a).where(and(eq(a.caseId, caseId), eq(a.fn, p.fn), eq(a.status, 'Active'))).limit(1);
  if (cur && p.userId === cur.userId) return { id: cur.id, warnings: [] };
  const reason = p.reason?.trim() || null;
  if (cur && p.userId && (reason?.length ?? 0) < 5 && actor) throw fieldError({ reason: `Say why you are replacing the ${FN_LABEL[p.fn]}` });
  const warnings: string[] = [];
  let newId: string | null = null;
  if (p.userId) {
    const [person] = await ctx.db.select().from(u).where(eq(u.id, p.userId)).limit(1);
    const need = p.fn === 'reviewer' ? 'REVIEWER' : 'EXPERT';
    if (!person || !person.active || person.role !== need) throw fieldError({ [field]: `Choose an active ${need.toLowerCase()}` });
    if (p.fn !== 'reviewer') {
      const [prof] = await ctx.db.select().from(schema.practitionerProfiles).where(eq(schema.practitionerProfiles.userId, p.userId)).limit(1);
      const ok = assignability(prof ?? null, p.fn);
      if (!ok.ok) throw fieldError({ [field]: ok.reason ?? 'This person cannot take this work' });
      const [conf] = await ctx.db.select().from(schema.practitionerConflicts).where(and(eq(schema.practitionerConflicts.userId, p.userId), eq(schema.practitionerConflicts.orgId, cs.orgId))).limit(1);
      if (conf) throw fieldError({ [field]: 'This person has declared a conflict with this business' });
      const load = (await loadFor(ctx, [p.userId]))[p.userId] ?? 0;
      if (prof.availability === 'Unavailable') warnings.push('This person is marked unavailable');
      if (load >= prof.maxActive) warnings.push(`This person is at capacity (${load} of ${prof.maxActive} active cases)`);
    }
    await independence(ctx, caseId, p.fn, p.userId);
    if (p.fn === 'specialist') {
      const dup = await ctx.db.select({ id: a.id }).from(a).where(and(eq(a.caseId, caseId), eq(a.userId, p.userId), eq(a.status, 'Active'), eq(a.fn, 'specialist'))).limit(1);
      if (dup.length) return { id: dup[0].id, warnings };
      if (cs.consultantId === p.userId) throw fieldError({ userId: 'This person is already the lead expert' });
    }
  }
  const now = new Date();
  if (cur) await ctx.db.update(a).set({ status: 'Replaced', endedAt: now, updatedAt: now }).where(eq(a.id, cur.id));
  if (p.userId) {
    const rules = await loadRules(ctx.db);
    const hours = Number((rules as any)['assignment_ack_hours'] ?? 72);
    const [row] = await ctx.db.insert(a).values({
      caseId, userId: p.userId, fn: p.fn, specialisation: p.specialisation?.trim() || null, assignedBy: actor?.id ?? null, reason, replacesId: cur?.id ?? null,
      matchScore: p.match?.score ?? null, matchBreakdown: p.match ? { factors: p.match.factors, warnings } : warnings.length ? { warnings } : null,
      // The assigner coordinates first, so the work starts at once. The person can still decline, and a reminder goes out if they do not respond.
      acknowledgeBy: p.fn === 'reviewer' ? null : new Date(now.getTime() + hours * 3600_000)
    }).returning({ id: a.id });
    newId = row.id;
  }
  if (p.fn !== 'specialist') await ctx.db.update(c).set({ [POINTER[p.fn]]: p.userId, updatedAt: now }).where(eq(c.id, caseId));
  await audit(ctx, 'assignment.changed', 'case', caseId, { fn: p.fn, userId: cur?.userId ?? null }, { fn: p.fn, userId: p.userId, reason, matchScore: p.match?.score ?? null, warnings }, caseId);
  const notify = p.userId && p.userId !== cur?.userId ? [p.userId] : [];
  if (notify.length) await notifyUsers(ctx, notify, { kind: 'CaseAssigned', title: `You were assigned to ${cs.code} as ${FN_LABEL[p.fn]}`, body: p.fn === 'reviewer' ? undefined : 'Open the case, then accept the assignment or decline it with a reason.', link: `/cases/${caseId}`, email: true });
  if (cur && cur.userId !== p.userId) await notifyUsers(ctx, [cur.userId], { kind: 'CaseAssigned', title: `You are no longer the ${FN_LABEL[p.fn]} on ${cs.code}`, body: reason ?? undefined, link: `/cases/${caseId}`, email: false });
  return { id: newId, warnings };
}

export async function assignCase(ctx: Ctx, id: string, b: { consultantId?: string | null; coachId?: string | null; reviewerId?: string | null; reason?: string | null }) {
  allow(ctx, 'cases', 'assign');
  const user = need(ctx).user;
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(user.role)) throw forbidden('Only administrators and programme managers assign people to cases');
  const before = await assertCase(ctx, id);
  const warnings: string[] = [];
  for (const [fn, key] of [['lead', 'consultantId'], ['coach', 'coachId'], ['reviewer', 'reviewerId']] as const) {
    if (b[key] === undefined) continue;
    const r = await place(ctx, id, { fn, userId: b[key] ?? null, reason: b.reason });
    warnings.push(...r.warnings);
  }
  await audit(ctx, 'case.assigned', 'case', id, { consultantId: before.consultantId, coachId: before.coachId, reviewerId: before.reviewerId }, { consultantId: b.consultantId ?? before.consultantId, coachId: b.coachId === undefined ? before.coachId : b.coachId, reviewerId: b.reviewerId === undefined ? before.reviewerId : b.reviewerId, reason: b.reason ?? null }, id);
  return { ok: true, warnings };
}

export async function addSpecialist(ctx: Ctx, caseId: string, b: { userId: string; specialisation?: string | null; reason?: string | null; matchScore?: number }) {
  allow(ctx, 'cases', 'assign');
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(need(ctx).user.role)) throw forbidden('Only administrators and programme managers assign people to cases');
  await assertCase(ctx, caseId);
  return place(ctx, caseId, { fn: 'specialist', userId: b.userId, specialisation: b.specialisation, reason: b.reason });
}
export async function removeSpecialist(ctx: Ctx, caseId: string, userId: string, reason?: string | null) {
  allow(ctx, 'cases', 'assign');
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(need(ctx).user.role)) throw forbidden();
  await assertCase(ctx, caseId);
  const [row] = await ctx.db.select().from(a).where(and(eq(a.caseId, caseId), eq(a.userId, userId), eq(a.fn, 'specialist'), eq(a.status, 'Active'))).limit(1);
  if (!row) throw notFound('Specialist not found on this case');
  if ((reason ?? '').trim().length < 5) throw fieldError({ reason: 'Say why you are removing this specialist' });
  await ctx.db.update(a).set({ status: 'Replaced', endedAt: new Date(), reason: [row.reason, `Removed: ${reason!.trim()}`].filter(Boolean).join(' | '), updatedAt: new Date() }).where(eq(a.id, row.id));
  await audit(ctx, 'assignment.changed', 'case', caseId, { fn: 'specialist', userId }, { fn: 'specialist', userId: null, reason }, caseId);
  return { ok: true };
}

/** The person accepts the work or declines it with a reason. A decline frees the place and tells the programme manager. */
export async function respond(ctx: Ctx, assignmentId: string, b: { decision: 'accept' | 'decline'; reason?: string | null }) {
  const user = need(ctx).user;
  const [row] = await ctx.db.select().from(a).where(eq(a.id, assignmentId)).limit(1);
  if (!row || row.userId !== user.id || row.status !== 'Active' || row.fn === 'reviewer') throw notFound('Assignment not found');
  const now = new Date();
  if (b.decision === 'accept') {
    await ctx.db.update(a).set({ acknowledgedAt: now, updatedAt: now }).where(eq(a.id, row.id));
    await audit(ctx, 'assignment.accepted', 'case', row.caseId, undefined, { fn: row.fn }, row.caseId);
    return { ok: true, status: 'Active' };
  }
  if ((b.reason ?? '').trim().length < 5) throw fieldError({ reason: 'Say why you are declining, so the programme manager can reassign' });
  await ctx.db.update(a).set({ status: 'Declined', declineReason: b.reason!.trim(), endedAt: now, updatedAt: now }).where(eq(a.id, row.id));
  if (row.fn !== 'specialist') await ctx.db.update(c).set({ [POINTER[row.fn as Exclude<Fn, 'specialist'>]]: null, updatedAt: now }).where(eq(c.id, row.caseId));
  await audit(ctx, 'assignment.declined', 'case', row.caseId, { fn: row.fn, userId: user.id }, { reason: b.reason!.trim() }, row.caseId);
  const [cs] = await ctx.db.select().from(c).where(eq(c.id, row.caseId)).limit(1);
  const managers = await managersFor(ctx, cs.programmeId);
  await notifyUsers(ctx, managers, { kind: 'AssignmentDeclined', title: `${user.name} declined ${cs.code} as ${FN_LABEL[row.fn as Fn]}`, body: b.reason!.trim(), link: `/cases/${row.caseId}`, email: true });
  return { ok: true, status: 'Declined' };
}

/** Administrators, plus the programme managers of the case's programme. */
export async function managersFor(ctx: Ctx, programmeId: string | null): Promise<string[]> {
  const admins = await ctx.db.select({ id: u.id }).from(u).where(and(eq(u.role, 'ADMIN'), eq(u.active, true)));
  const pms = programmeId ? await ctx.db.select({ id: u.id }).from(u).innerJoin(schema.userProgrammes, eq(schema.userProgrammes.userId, u.id)).where(and(eq(schema.userProgrammes.programmeId, programmeId), eq(u.active, true))) : [];
  return [...new Set([...admins, ...pms].map((x) => x.id))];
}

/** Assignments waiting for a response past their time. One reminder, to the people who can reassign. */
export async function scanUnacknowledged(ctx: Ctx) {
  const rows = await ctx.db.select().from(a).where(and(eq(a.status, 'Active'), sql`${a.acknowledgedAt} is null`, sql`${a.acknowledgeBy} < now()`, sql`${a.overdueNotifiedAt} is null`));
  for (const r of rows) {
    await ctx.db.update(a).set({ overdueNotifiedAt: new Date() }).where(eq(a.id, r.id));
    const [cs] = await ctx.db.select().from(c).where(eq(c.id, r.caseId)).limit(1);
    const [who] = await ctx.db.select({ name: u.name }).from(u).where(eq(u.id, r.userId)).limit(1);
    await notifyUsers(ctx, await managersFor(ctx, cs?.programmeId ?? null), { kind: 'AssignmentOverdue', title: `${who?.name ?? 'A practitioner'} has not responded on ${cs?.code ?? 'a case'}`, body: `The ${FN_LABEL[r.fn as Fn]} assignment has been waiting past its response time.`, link: `/cases/${r.caseId}` });
    await audit(ctx, 'assignment.unacknowledged', 'case', r.caseId, undefined, { fn: r.fn, userId: r.userId }, r.caseId);
  }
  return { flagged: rows.length };
}

/** The finished case closes its specialist, lead and coach engagements so they can be rated and counted. */
export async function completeForCase(ctx: Ctx, caseId: string) {
  const now = new Date();
  await ctx.db.update(a).set({ status: 'Completed', endedAt: now, updatedAt: now }).where(and(eq(a.caseId, caseId), eq(a.status, 'Active'), inArray(a.fn, ['lead', 'specialist', 'coach'])));
}

/** The team on a case. Staff see history and match detail. A business sees only the current team and what a practitioner chose to show. */
export async function caseTeam(ctx: Ctx, caseId: string) {
  const user = need(ctx).user;
  await assertCase(ctx, caseId);
  const owner = ['OWNER', 'RESPONDENT', 'FUNDER'].includes(user.role);
  const rows = await ctx.db.select({ a, name: u.name, photoKey: u.photoKey, photoUpdatedAt: u.photoUpdatedAt, uid: u.id, headline: schema.practitionerProfiles.headline, bio: schema.practitionerProfiles.bio, specialisations: schema.practitionerProfiles.specialisations, languages: schema.practitionerProfiles.languages, credentials: schema.practitionerProfiles.credentials })
    .from(a).innerJoin(u, eq(u.id, a.userId)).leftJoin(schema.practitionerProfiles, eq(schema.practitionerProfiles.userId, a.userId))
    .where(and(eq(a.caseId, caseId), owner ? eq(a.status, 'Active') : sql`true`)).orderBy(desc(a.createdAt));
  const ids = rows.map((r) => r.a.id);
  const rated = ids.length ? await ctx.db.select({ assignmentId: schema.engagementRatings.assignmentId, source: schema.engagementRatings.source, raterId: schema.engagementRatings.raterId }).from(schema.engagementRatings).where(inArray(schema.engagementRatings.assignmentId, ids)) : [];
  return {
    items: rows.map((r) => ({
      id: r.a.id, fn: r.a.fn, label: FN_LABEL[r.a.fn as Fn], specialisation: r.a.specialisation, status: r.a.status, userId: r.uid, name: r.name, photoUrl: photoUrl({ id: r.uid, photoKey: r.photoKey, photoUpdatedAt: r.photoUpdatedAt }),
      headline: r.headline, bio: owner ? r.bio : undefined, specialisations: r.specialisations ?? [], languages: r.languages ?? [], credentials: owner ? r.credentials : undefined,
      startedAt: r.a.createdAt, endedAt: r.a.endedAt, acknowledgedAt: r.a.acknowledgedAt, acknowledgeBy: owner ? undefined : r.a.acknowledgeBy,
      mine: r.uid === user.id, rated: rated.some((x) => x.assignmentId === r.a.id && x.raterId === user.id),
      ...(owner ? {} : { reason: r.a.reason, declineReason: r.a.declineReason, matchScore: r.a.matchScore, matchBreakdown: r.a.matchBreakdown, replacesId: r.a.replacesId })
    }))
  };
}

/** Recommended people for one kind of work on one case. Ranked and explained; the programme manager decides. */
export async function matches(ctx: Ctx, caseId: string, q: { fn: 'lead' | 'specialist' | 'coach'; specialisation?: string }) {
  allow(ctx, 'cases', 'assign');
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(need(ctx).user.role)) throw forbidden();
  const cs = await assertCase(ctx, caseId);
  const [org] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, cs.orgId)).limit(1);
  const [score] = await ctx.db.select().from(schema.healthScores).where(eq(schema.healthScores.caseId, caseId)).orderBy(desc(schema.healthScores.createdAt)).limit(1);
  const weak = score ? [...(score.dimensions as { dimension: string; value: number }[])].sort((x, y) => x.value - y.value).slice(0, 3).map((d) => d.dimension) : [];
  const needs: MatchNeed = { fn: q.fn, platform: platformForOrgType(org?.type), sector: org?.sector, size: org?.size, region: org?.region, weakDimensions: weak, specialisation: q.specialisation ?? null };
  const [people, conflicts, onCase] = await Promise.all([
    approvedPractitioners(ctx),
    ctx.db.select({ userId: schema.practitionerConflicts.userId }).from(schema.practitionerConflicts).where(eq(schema.practitionerConflicts.orgId, cs.orgId)),
    ctx.db.select({ userId: a.userId }).from(a).where(and(eq(a.caseId, caseId), eq(a.status, 'Active')))
  ]);
  const load = await loadFor(ctx, people.map((x) => x.user.id));
  const out = people.map((x) => {
    const p: MatchProfile = { userId: x.user.id, name: x.user.name, functions: x.p.functions, specialisations: x.p.specialisations, strengths: x.p.strengths, sectors: x.p.sectors, platforms: x.p.platforms, businessSizes: x.p.businessSizes, regions: x.p.regions, languages: x.p.languages, yearsExperience: x.p.yearsExperience, availability: x.p.availability, maxActive: x.p.maxActive, vettingStatus: x.p.vettingStatus };
    const m = scoreMatch(p, needs, { active: load[x.user.id] ?? 0, conflict: conflicts.some((k) => k.userId === x.user.id), onCase: onCase.some((k) => k.userId === x.user.id) });
    return { ...m, photoUrl: photoUrl(x.user), headline: x.p.headline };
  });
  return { need: { ...needs, weakDimensions: weak }, items: rankMatches(out), note: 'A recommendation only. Performance is not scored until practitioners have rated engagements.' };
}

/** Cases a person is working on now. Used before a suspension, a departure or a long absence. */
export async function caseloadOf(ctx: Ctx, userId: string) {
  allow(ctx, 'cases', 'assign');
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(need(ctx).user.role)) throw forbidden();
  const rows = await ctx.db.select({ id: a.id, fn: a.fn, caseId: a.caseId, code: c.code, status: c.status, org: schema.organisations.name })
    .from(a).innerJoin(c, eq(c.id, a.caseId)).innerJoin(schema.organisations, eq(schema.organisations.id, c.orgId))
    .where(and(eq(a.userId, userId), eq(a.status, 'Active'), inArray(a.fn, ['lead', 'coach', 'specialist']), sql`${c.status} <> 'GRADUATED'`, caseScope(need(ctx).user))).orderBy(c.code);
  return { items: rows };
}

/**
 * Hands every active case of one expert to another in one step. Each case follows the normal placement rules
 * (approved, no conflict, independence from the reviewer), so a case that cannot move is reported, never forced.
 */
export async function transferCaseload(ctx: Ctx, fromId: string, b: { toUserId: string; reason: string }) {
  allow(ctx, 'cases', 'assign');
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(need(ctx).user.role)) throw forbidden('Only administrators and programme managers move cases');
  if (fromId === b.toUserId) throw fieldError({ toUserId: 'Choose a different person' });
  if ((b.reason ?? '').trim().length < 5) throw fieldError({ reason: 'Say why the cases are moving' });
  const { items } = await caseloadOf(ctx, fromId);
  const moved: string[] = []; const skipped: { code: string; why: string }[] = []; const warnings = new Set<string>();
  for (const it of items) {
    try {
      // PMs see only their programmes' cases; assertCase enforces that for each one.
      await assertCase(ctx, it.caseId);
      const r = await place(ctx, it.caseId, { fn: it.fn as Fn, userId: b.toUserId, reason: `Caseload transfer: ${b.reason.trim()}` });
      r.warnings.forEach((w) => warnings.add(w));
      if (it.fn === 'specialist') await ctx.db.update(a).set({ status: 'Replaced', endedAt: new Date(), reason: `Caseload transfer: ${b.reason.trim()}`, updatedAt: new Date() }).where(eq(a.id, it.id));
      moved.push(it.code);
    } catch (e) { skipped.push({ code: it.code, why: (() => { const d = (e as { details?: Record<string, string> }).details; return d ? Object.values(d)[0]! : String((e as Error).message); })() }); }
  }
  await audit(ctx, 'assignment.caseload_transferred', 'user', fromId, { cases: items.length }, { toUserId: b.toUserId, moved, skipped, reason: b.reason }, fromId);
  return { moved, skipped, warnings: [...warnings] };
}
