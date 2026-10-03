import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { platformForOrgType } from '@/domain/routing';
import { assertCase } from '@/domain/scope';
import { CASE_STATES, EVIDENCE_CLASSES, type EvidenceClass } from '@/db/schema';
import { isConditional } from '@/domain/logic';
import { allow, need } from './common';
import { formQuestionsOf, questionsOf, resolveVersion, versionForRow } from './frameworks';
import { areaNames } from './team';
import { submitDiagnosticCore, type AnswerInput } from './diagnostics';

/** A team round: the owner collects answers from colleagues as drafts and submits once.
 *  Scoring still receives one full answer set at submission. Nothing here reads or changes a score. */
const OWNER_CLASSES: EvidenceClass[] = ['Self-reported', 'Unverified', 'Missing', 'Document-supported'];
const TEAM_CLASSES: EvidenceClass[] = ['Self-reported', 'Unverified', 'Missing', 'Document-supported'];
const stateIndex = (s: string) => CASE_STATES.indexOf(s as any);

export type DraftInput = null | { value?: number | null; notApplicable?: boolean; evidence?: string; ref?: string | null; note?: string | null };

async function ownerOrg(ctx: Ctx) {
  const c = need(ctx);
  if (c.user.role !== 'OWNER' || !c.user.orgId) throw unprocessable('Only the business owner manages an assessment round');
  const [o] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, c.user.orgId)).limit(1);
  return o;
}

/** The business a person answers for: the owner's own, or the one a team member belongs to. Null member means the owner. */
export async function myPlace(ctx: Ctx) {
  const c = need(ctx);
  if (c.user.role === 'OWNER' && c.user.orgId) return { orgId: c.user.orgId, memberId: null as string | null, isOwner: true };
  if (c.user.role === 'RESPONDENT') {
    const [m] = await ctx.db.select().from(schema.orgMembers).where(and(eq(schema.orgMembers.userId, c.user.id), eq(schema.orgMembers.status, 'active'))).limit(1);
    if (m) return { orgId: m.orgId, memberId: m.id as string | null, isOwner: false };
  }
  return null;
}

/** Who answers each area: a colleague, the owner (confirmed with no colleague), or, until confirmed, the owner by default. */
async function areaOwners(ctx: Ctx, orgId: string, platform: string) {
  const rows = await ctx.db.select().from(schema.areaAssignments).where(and(eq(schema.areaAssignments.orgId, orgId), eq(schema.areaAssignments.platform, platform)));
  const out = new Map<string, { memberId: string | null; confirmed: boolean }>();
  for (const r of rows) out.set(r.subDimension, { memberId: r.confirmedAt ? r.memberId : null, confirmed: !!r.confirmedAt });
  return out;
}
const whoOf = (owners: Map<string, { memberId: string | null; confirmed: boolean }>, sd?: string) => (sd && owners.get(sd)) || { memberId: null, confirmed: false };

export async function openRound(ctx: Ctx, orgId: string) {
  const [r] = await ctx.db.select().from(schema.assessmentRounds).where(and(eq(schema.assessmentRounds.orgId, orgId), eq(schema.assessmentRounds.status, 'Collecting'))).limit(1);
  return r ?? null;
}

export async function startRound(ctx: Ctx, caseId: string) {
  allow(ctx, 'team', 'edit');
  const o = await ownerOrg(ctx); const c = need(ctx);
  const cs = await assertCase(ctx, caseId);
  if (cs.orgId !== o.id) throw notFound('Case not found');
  if (stateIndex(cs.status) < stateIndex('PROFILED')) throw unprocessable('The business profile must be complete before a team assessment can start');
  if (await openRound(ctx, o.id)) throw unprocessable('A team assessment is already open. Submit it or cancel it first.');
  const v = await resolveVersion(ctx.db, o.type);
  const [r] = await ctx.db.insert(schema.assessmentRounds).values({ caseId, orgId: o.id, frameworkVersionId: v.id, ownerId: c.user.id }).returning();
  await audit(ctx, 'round.started', 'assessment_round', r.id, undefined, { framework: v.id }, caseId);
  return { id: r.id };
}

export async function cancelRound(ctx: Ctx, roundId: string) {
  allow(ctx, 'team', 'edit');
  const o = await ownerOrg(ctx);
  const [r] = await ctx.db.select().from(schema.assessmentRounds).where(and(eq(schema.assessmentRounds.id, roundId), eq(schema.assessmentRounds.orgId, o.id))).limit(1);
  if (!r) throw notFound('Round not found');
  if (r.status !== 'Collecting') throw unprocessable('Only an open round can be cancelled');
  await ctx.db.update(schema.assessmentRounds).set({ status: 'Cancelled' }).where(eq(schema.assessmentRounds.id, r.id));
  await audit(ctx, 'round.cancelled', 'assessment_round', r.id, undefined, undefined, r.caseId);
  return { ok: true };
}

type Blocker = { code: string; message: string };

/** The owner's view: who answers what, how far each area has got, and what still blocks submission. */
export async function roundView(ctx: Ctx, caseId: string) {
  allow(ctx, 'team', 'read');
  const o = await ownerOrg(ctx);
  const cs = await assertCase(ctx, caseId);
  if (cs.orgId !== o.id) throw notFound('Case not found');
  const r = await openRound(ctx, o.id);
  if (!r || r.caseId !== caseId) return { round: null as null };
  const v = await versionForRow(ctx.db, r.frameworkVersionId, o.type);
  const qs = questionsOf(v);
  const owners = await areaOwners(ctx, o.id, platformForOrgType(o.type as any));
  const names = await areaNames(ctx, o.type);
  const members = await ctx.db.select({ id: schema.orgMembers.id, name: schema.users.name }).from(schema.orgMembers).innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId)).where(eq(schema.orgMembers.orgId, o.id));
  const drafts = await ctx.db.select({ code: schema.responseDrafts.questionCode, value: schema.responseDrafts.value, na: schema.responseDrafts.notApplicable, cls: schema.responseDrafts.evidenceClass, ref: schema.responseDrafts.evidenceRef, by: schema.responseDrafts.answeredBy }).from(schema.responseDrafts).where(eq(schema.responseDrafts.roundId, r.id));
  const docRows = await ctx.db.select({ id: schema.documents.id, code: schema.documents.code, filename: schema.documents.filename, by: schema.users.name }).from(schema.documents).leftJoin(schema.users, eq(schema.users.id, schema.documents.uploadedBy)).where(and(eq(schema.documents.orgId, o.id), eq(schema.documents.caseId, caseId)));
  const uploads = drafts.filter((x) => x.cls === 'Document-supported' && x.ref).map((x) => ({ question: x.code, document: x.ref!, documentId: docRows.find((y) => y.code === x.ref)?.id ?? null, filename: docRows.find((y) => y.code === x.ref)?.filename ?? x.ref!, uploadedBy: docRows.find((y) => y.code === x.ref)?.by ?? 'Unknown' }));
  const answered = new Set(drafts.filter((d) => d.value !== null || d.na).map((d) => d.code));
  const byArea = new Map<string, typeof qs>();
  for (const q of qs) byArea.set(q.subDimension ?? '', [...(byArea.get(q.subDimension ?? '') ?? []), q]);
  const blockers: Blocker[] = [];
  const areas = [...byArea.entries()].map(([code, list]) => {
    const w = whoOf(owners, code || undefined);
    const gates = list.filter((q) => q.criticality === 'Gate');
    const gatesOpen = gates.filter((q) => !answered.has(q.code));
    const todo = [gates.length && !w.confirmed ? 'confirm who answers this area' : '', gatesOpen.length ? `${gatesOpen.length} key question${gatesOpen.length === 1 ? '' : 's'} still unanswered` : ''].filter(Boolean);
    if (todo.length) blockers.push({ code, message: `${names[code]?.name ?? code}: ${todo.join(', ')}` });
    return {
      code, name: code ? names[code]?.name ?? code : 'Other questions', confirmed: w.confirmed,
      who: w.memberId ? members.find((m) => m.id === w.memberId)?.name ?? 'A colleague' : 'You',
      total: list.length, answered: list.filter((q) => answered.has(q.code)).length, gates: gates.length
    };
  }).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return { round: { id: r.id, createdAt: r.createdAt, total: qs.length, answered: qs.filter((q) => answered.has(q.code)).length, areas, uploads, blockers, canSubmit: blockers.length === 0 } };
}

/** Only my own questions, with my saved answers. A colleague never sees another area, a score or anyone else's answers. */
export async function myRound(ctx: Ctx) {
  const place = await myPlace(ctx);
  if (!place) return { round: null as null };
  const [o] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, place.orgId)).limit(1);
  const r = await openRound(ctx, place.orgId);
  if (!r) return { round: null as null, business: o.name };
  const v = await versionForRow(ctx.db, r.frameworkVersionId, o.type);
  const owners = await areaOwners(ctx, o.id, platformForOrgType(o.type as any));
  const mine = formQuestionsOf(v).filter((q) => whoOf(owners, q.subDimension).memberId === place.memberId);
  const names = await areaNames(ctx, o.type);
  const drafts = await ctx.db.select().from(schema.responseDrafts).where(eq(schema.responseDrafts.roundId, r.id));
  const mineSet = new Set(mine.map((q) => q.code));
  return {
    business: o.name,
    round: {
      id: r.id,
      questions: mine.map((q) => ({ ...q, area: q.subDimension ? names[q.subDimension]?.name ?? q.subDimension : null })),
      answers: Object.fromEntries(drafts.filter((d) => mineSet.has(d.questionCode)).map((d) => [d.questionCode, { value: d.value, notApplicable: d.notApplicable, evidence: d.evidenceClass, ref: d.evidenceRef, note: d.note }]))
    }
  };
}

export async function saveDrafts(ctx: Ctx, roundId: string, answers: Record<string, DraftInput>) {
  const c = need(ctx);
  const place = await myPlace(ctx);
  if (!place) throw forbidden();
  const [r] = await ctx.db.select().from(schema.assessmentRounds).where(and(eq(schema.assessmentRounds.id, roundId), eq(schema.assessmentRounds.orgId, place.orgId))).limit(1);
  if (!r) throw notFound('Round not found');
  if (r.status !== 'Collecting') throw unprocessable('This assessment is no longer open for answers');
  const [o] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, place.orgId)).limit(1);
  const v = await versionForRow(ctx.db, r.frameworkVersionId, o.type);
  const owners = await areaOwners(ctx, o.id, platformForOrgType(o.type as any));
  const mine = new Map(formQuestionsOf(v).filter((q) => whoOf(owners, q.subDimension).memberId === place.memberId).map((q) => [q.code, q]));
  const classes = place.isOwner ? OWNER_CLASSES : TEAM_CLASSES;
  // A document can back an answer only if it belongs to this business, is not quarantined, and (for a colleague) was uploaded by them.
  const refs = [...new Set(Object.values(answers).map((a) => (a && a.evidence === 'Document-supported' ? a.ref : null)).filter((x): x is string => !!x))];
  const okDocs = new Set<string>();
  if (refs.length) (await ctx.db.select({ code: schema.documents.code, by: schema.documents.uploadedBy }).from(schema.documents).where(and(eq(schema.documents.orgId, place.orgId), eq(schema.documents.status, 'Stored'), inArray(schema.documents.code, refs)))).forEach((x) => { if (place.isOwner || x.by === c.user.id) okDocs.add(x.code); });
  const problems: Record<string, string> = {};
  const writes: { code: string; value: number | null; na: boolean; cls: string; ref: string | null; note: string | null }[] = [];
  const clears: string[] = [];
  for (const [code, a] of Object.entries(answers)) {
    const q = mine.get(code);
    if (!q) { problems[code] = 'This question is not assigned to you'; continue; }
    if (a === null) { clears.push(code); continue; }
    const na = a.notApplicable === true;
    if (na && !isConditional(q as any)) { problems[code] = 'This question always applies'; continue; }
    const value = na ? null : a.value;
    if (!na && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 4)) { problems[code] = 'The value must be a whole number from 0 to 4'; continue; }
    const cls = a.evidence ?? 'Self-reported';
    if (!EVIDENCE_CLASSES.includes(cls as EvidenceClass) || !classes.includes(cls as EvidenceClass)) { problems[code] = 'This evidence type is not available to you'; continue; }
    if (cls === 'Document-supported' && !(a.ref && okDocs.has(a.ref))) { problems[code] = 'Attach a document you uploaded for this answer'; continue; }
    const note = a.note?.trim() || null;
    if (note && note.length > 500) { problems[code] = 'Notes can be at most 500 characters'; continue; }
    writes.push({ code, value: value ?? null, na, cls, ref: cls === 'Document-supported' ? a.ref ?? null : null, note });
  }
  if (Object.keys(problems).length) throw fieldError(problems);
  await ctx.db.transaction(async (tx) => {
    for (const w of writes) {
      const [prev] = await tx.select().from(schema.responseDrafts).where(and(eq(schema.responseDrafts.roundId, r.id), eq(schema.responseDrafts.questionCode, w.code))).limit(1);
      // An earlier answer by someone else is kept in the audit trail before it is replaced (the area was reassigned).
      if (prev && prev.answeredBy !== c.user.id) await audit({ ...ctx, db: tx } as Ctx, 'round.draft_replaced', 'assessment_round', r.id, { question: w.code, answeredBy: prev.answeredBy, value: prev.value, notApplicable: prev.notApplicable }, { answeredBy: c.user.id }, r.caseId);
      await tx.insert(schema.responseDrafts).values({ roundId: r.id, questionCode: w.code, value: w.value, notApplicable: w.na, evidenceClass: w.cls, evidenceRef: w.ref, note: w.note, answeredBy: c.user.id })
        .onConflictDoUpdate({ target: [schema.responseDrafts.roundId, schema.responseDrafts.questionCode], set: { value: w.value, notApplicable: w.na, evidenceClass: w.cls, evidenceRef: w.ref, note: w.note, answeredBy: c.user.id, updatedAt: new Date() } });
    }
    for (const code of clears) await tx.delete(schema.responseDrafts).where(and(eq(schema.responseDrafts.roundId, r.id), eq(schema.responseDrafts.questionCode, code)));
  });
  await audit(ctx, 'round.answers_saved', 'assessment_round', r.id, undefined, { saved: writes.length, cleared: clears.length }, r.caseId);
  return { saved: writes.length, cleared: clears.length };
}

/** Owner submits the round. The gate rule runs first, then the existing submission does the data quality gate, scoring and audit exactly as before. */
export async function submitRound(ctx: Ctx, roundId: string) {
  allow(ctx, 'team', 'edit');
  const o = await ownerOrg(ctx);
  const [r] = await ctx.db.select().from(schema.assessmentRounds).where(and(eq(schema.assessmentRounds.id, roundId), eq(schema.assessmentRounds.orgId, o.id))).limit(1);
  if (!r) throw notFound('Round not found');
  if (r.status !== 'Collecting') throw unprocessable('This assessment has already been closed');
  const view = await roundView(ctx, r.caseId);
  if (view.round && view.round.blockers.length) throw unprocessable('The team assessment cannot be submitted yet', { blockers: view.round.blockers });
  const drafts = await ctx.db.select().from(schema.responseDrafts).where(eq(schema.responseDrafts.roundId, r.id));
  const answers: Record<string, AnswerInput> = {};
  const answeredBy: Record<string, string> = {};
  for (const d of drafts) {
    if (d.value === null && !d.notApplicable) continue;
    answers[d.questionCode] = d.notApplicable ? { notApplicable: true, note: d.note } : { value: d.value!, evidence: d.evidenceClass as EvidenceClass, ref: d.evidenceRef, note: d.note };
    answeredBy[d.questionCode] = d.answeredBy;
  }
  const cs = await assertCase(ctx, r.caseId);
  const res = await submitDiagnosticCore(ctx, cs, answers, { source: 'web', persistRejection: false, answeredBy, roundId: r.id, versionId: r.frameworkVersionId });
  if (res.accepted) {
    await ctx.db.update(schema.assessmentRounds).set({ status: 'Submitted', diagnosticId: res.id, submittedAt: new Date() }).where(eq(schema.assessmentRounds.id, r.id));
    await audit(ctx, 'round.submitted', 'assessment_round', r.id, undefined, { diagnostic: res.code, answers: Object.keys(answers).length, respondents: new Set(Object.values(answeredBy)).size }, r.caseId);
  }
  return res;
}
