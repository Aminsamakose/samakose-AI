import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, fieldError, notFound, unprocessable } from '@/lib/errors';
import { assertCase, isInternal, assertLeadCase } from '@/domain/scope';
import { confidenceClass, isConditional, NOT_APPLICABLE, scoreDiagnostic, validateSubmission, type ResponseLite } from '@/domain/logic';
import { analyseBank } from '@/domain/bank';
import { emitEvent } from '@/domain/events';
import { RECHECK_CASE_STATES } from '@/domain/health-transition';
import { notifyUsers } from '@/domain/notify';
import { advanceCase, allow, latestDiagnostic, loadRules, need } from './common';
import { formQuestionsOf, questionsOf, resolveVersion, rulesFor, versionForRow, type VersionRow } from './frameworks';
import { explainChange } from './record';
import { CASE_STATES, EVIDENCE_CLASSES, type EvidenceClass } from '@/db/schema';

/** A rating from 0 to 4, or notApplicable for a conditional question that does not apply to this enterprise. */
export type AnswerInput = number | { value?: number; notApplicable?: boolean; evidence?: EvidenceClass; ref?: string | null; note?: string | null };
const isNA = (a: unknown) => typeof a === 'object' && a !== null && (a as any).notApplicable === true;
const OWNER_CLASSES: EvidenceClass[] = ['Self-reported', 'Unverified', 'Missing', 'Document-supported'];
const stateIndex = (s: string) => CASE_STATES.indexOf(s as any);

/** The questions a form shows: the current published version for this kind of organisation (the default framework when none is given). */
export async function activeQuestions(ctx: Ctx, caseId?: string) {
  const v = await versionForCase(ctx, caseId);
  return formQuestionsOf(v);
}
async function versionForCase(ctx: Ctx, caseId?: string): Promise<VersionRow> {
  if (!caseId) return resolveVersion(ctx.db);
  const [row] = await ctx.db.select({ type: schema.organisations.type }).from(schema.cases).innerJoin(schema.organisations, eq(schema.organisations.id, schema.cases.orgId)).where(eq(schema.cases.id, caseId)).limit(1);
  return resolveVersion(ctx.db, row?.type);
}

function normalise(answers: Record<string, AnswerInput>) {
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) flat[k] = isNA(v) ? NOT_APPLICABLE : typeof v === 'object' && v !== null ? v.value : v;
  return flat;
}

/** Dry run of the data quality gate, so a form can warn before it submits. */
export async function preflight(ctx: Ctx, caseId: string, answers: Record<string, AnswerInput>) {
  allow(ctx, 'diagnostics', 'create');
  await assertLeadCase(ctx, caseId);
  const v = await versionForCase(ctx, caseId);
  return validateSubmission(normalise(answers), questionsOf(v), rulesFor(v, await loadRules(ctx.db)));
}

/** Score the responses of one diagnostic using the current evidence classes. Appends a health_scores row. */
export async function computeScore(ctx: Ctx, caseId: string, diagnosticId: string) {
  const [dg] = await ctx.db.select({ versionId: schema.diagnostics.frameworkVersionId }).from(schema.diagnostics).where(eq(schema.diagnostics.id, diagnosticId));
  const fv = dg?.versionId ? await versionForRow(ctx.db, dg.versionId) : await versionForCase(ctx, caseId);
  const rules = rulesFor(fv, await loadRules(ctx.db));
  const qs = questionsOf(fv);
  const rs = await ctx.db.select({ id: schema.responses.id, questionCode: schema.responses.questionCode, value: schema.responses.value, notApplicable: schema.responses.notApplicable, cls: schema.responses.evidenceClass }).from(schema.responses).where(eq(schema.responses.diagnosticId, diagnosticId));
  const ev = rs.length ? await ctx.db.select({ responseId: schema.evidence.responseId, cls: schema.evidence.class }).from(schema.evidence).where(and(eq(schema.evidence.caseId, caseId), inArray(schema.evidence.responseId, rs.map((r) => r.id)))) : [];
  const override = new Map(ev.map((e) => [e.responseId, e.cls]));
  const lite: ResponseLite[] = rs.map((r) => ({ questionCode: r.questionCode, value: r.value, evidenceClass: (override.get(r.id) ?? r.cls) as EvidenceClass, notApplicable: r.notApplicable }));
  const s = scoreDiagnostic(lite, qs, rules);
  const extras = analyseBank(lite, qs, fv.meta, rules);
  // Rule check: a strong claim (3 or 4) with no evidence at all is a contradiction.
  const ruleChecksPassed = !lite.some((r) => !r.notApplicable && r.value >= 3 && r.evidenceClass === 'Missing');
  const conf = confidenceClass(s.evidenceShare, ruleChecksPassed, true, rules);
  const [prev] = await ctx.db.select().from(schema.healthScores).where(eq(schema.healthScores.caseId, caseId)).orderBy(desc(schema.healthScores.createdAt)).limit(1);
  const [runRow] = await ctx.db.select({ n: sql<number>`coalesce(max(run),0)::int` }).from(schema.healthScores).where(eq(schema.healthScores.diagnosticId, diagnosticId));
  const [caseRow] = await ctx.db.select({ status: schema.cases.status, consultantId: schema.cases.consultantId, coachId: schema.cases.coachId }).from(schema.cases).where(eq(schema.cases.id, caseId)).limit(1);
  // The case's own lifecycle state at the moment of scoring decides the phase, not the run number --
  // a re-diagnostic mid-MONITORING should never be mistaken for a baseline or endline just because it
  // happens to be the first or latest run.
  const phase: typeof schema.healthScores.$inferInsert.phase = !prev ? 'BASELINE' : caseRow?.status === 'MIDLINE' ? 'MIDLINE' : caseRow?.status === 'ENDLINE' ? 'ENDLINE' : 'OTHER';
  const [row] = await ctx.db.insert(schema.healthScores).values({
    diagnosticId, caseId, run: Number(runRow.n) + 1, overall: s.overall.toFixed(1), maturity: s.maturity, confidenceClass: conf,
    dimensions: s.dimensions, evidenceShare: s.evidenceShare, rulesSnapshot: rules as any, frameworkVersionId: fv.id, extras: extras as any, phase
  }).returning();
  await audit(ctx, 'score.computed', 'health_score', row.id, undefined, { overall: s.overall, maturity: s.maturity, confidence: conf, run: row.run }, caseId);
  await emitEvent(ctx, 'HealthScoreChanged', { caseId, payload: { overall: s.overall, maturity: s.maturity, confidence_class: conf } });
  if (prev) {
    // #87's RE-CHECK loop: classify this score's move against the previous one the same
    // framework-comparability-aware way the Business Health Record already explains it
    // (services/record.ts explainChange), instead of a raw overall-score subtraction -- a score move
    // caused only by a framework version change must never be read as the business progressing or
    // regressing.
    const prevFv = prev.frameworkVersionId === fv.id ? fv : prev.frameworkVersionId ? await versionForRow(ctx.db, prev.frameworkVersionId) : null;
    const why = explainChange(
      { overall: Number(prev.overall), dimensions: prev.dimensions, versionId: prev.frameworkVersionId, versionLabel: '', questions: prevFv ? questionsOf(prevFv) : undefined },
      { overall: s.overall, dimensions: s.dimensions, versionId: fv.id, versionLabel: '', questions: qs }, rules
    );
    if (why.transition === 'Progressing') await emitEvent(ctx, 'HealthImproved', { caseId, payload: { from: Number(prev.overall), to: s.overall } });
    if (why.transition === 'Regressing') {
      await emitEvent(ctx, 'HealthDeclined', { caseId, payload: { from: Number(prev.overall), to: s.overall } });
      // Still being delivered to (a RE-CHECK, not the original baseline): a regression here is exactly
      // the moment #87 wants to lead to a new prescription, not a note nobody acts on.
      if (caseRow?.status && (RECHECK_CASE_STATES as readonly string[]).includes(caseRow.status)) {
        await notifyUsers(ctx, [caseRow.consultantId, caseRow.coachId].filter(Boolean) as string[], {
          kind: 'RecheckRegression', title: 'Business Health has regressed on RE-CHECK',
          body: `Score moved from ${prev.overall} to ${s.overall}. Consider a new prescription for what changed.`, link: `/cases/${caseId}`, email: true
        });
      }
    }
  }
  return row;
}

/** How the answers were actually given. Derived from who answered, never typed in. */
export function modeOf(source: string, role: string | undefined, submitter: string | undefined, answerers: (string | null)[]): 'self' | 'hybrid' | 'team' | 'consultant' | 'imported' {
  if (source === 'kobo') return 'imported';
  if (role === 'EXPERT') return 'consultant';
  const others = answerers.some((a) => a && a !== submitter); const mine = answerers.some((a) => !a || a === submitter);
  return !others ? 'self' : mine ? 'hybrid' : 'team';
}
type SubmitOpts = { uuid?: string; source: 'web' | 'kobo'; persistRejection: boolean; /** Team round: who gave each answer, and the round it came from. Scoring does not read either. */ answeredBy?: Record<string, string>; roundId?: string; /** The framework version a round was opened under. Later publications do not change what that round is checked against. */ versionId?: string | null };
export async function submitDiagnosticCore(ctx: Ctx, caseRow: typeof schema.cases.$inferSelect, answers: Record<string, AnswerInput>, o: SubmitOpts) {
  if (stateIndex(caseRow.status) < stateIndex('PROFILED')) throw unprocessable('The business profile must be complete before a diagnostic can be taken');
  const fv = o.versionId ? await versionForRow(ctx.db, o.versionId) : await versionForCase(ctx, caseRow.id);
  const rules = rulesFor(fv, await loadRules(ctx.db));
  const qs = questionsOf(fv);
  const seen = o.uuid ? (await ctx.db.select({ u: schema.diagnostics.submissionUuid }).from(schema.diagnostics).where(eq(schema.diagnostics.submissionUuid, o.uuid))).map((r) => r.u!) : [];
  const v = validateSubmission(normalise(answers), qs, rules, seen, o.uuid);
  const isOwner = ctx.user?.role === 'OWNER';

  // Evidence classes claimed by the person completing the form.
  const docCodes = new Set<string>();
  const refs = Object.values(answers).map((a) => (typeof a === 'object' && a?.ref) || null).filter(Boolean) as string[];
  if (refs.length) (await ctx.db.select({ code: schema.documents.code }).from(schema.documents).where(and(eq(schema.documents.orgId, caseRow.orgId), inArray(schema.documents.code, refs)))).forEach((d) => docCodes.add(d.code));
  const fieldProblems: Record<string, string> = {};
  const rows = qs.flatMap((q) => {
    const a = answers[q.code];
    if (a === undefined || a === null || (a as any) === '') return [];
    const na = isNA(a) && isConditional(q);
    const value = na ? 0 : Number(typeof a === 'object' ? a.value : a);
    if (!na && (!Number.isInteger(value) || value < 0 || value > 4)) return [];
    let cls: EvidenceClass = (typeof a === 'object' && a.evidence) || 'Self-reported';
    if (!EVIDENCE_CLASSES.includes(cls)) { fieldProblems[q.code] = 'Unknown evidence type'; cls = 'Self-reported'; }
    const ref = typeof a === 'object' ? a.ref ?? null : null;
    if (o.source === 'web' && isOwner && !OWNER_CLASSES.includes(cls)) fieldProblems[q.code] = 'Only your consultant can mark evidence as verified';
    if (cls === 'Document-supported' && (!ref || !docCodes.has(ref))) fieldProblems[q.code] = 'Attach an uploaded document of your organisation for this answer';
    return [{ q, value, na, cls, ref, note: typeof a === 'object' ? a.note ?? null : null }];
  });
  if (Object.keys(fieldProblems).length && o.source === 'web') throw fieldError(fieldProblems);
  // Kobo submissions cannot claim more than they can prove.
  if (o.source === 'kobo') rows.forEach((r) => { if (r.cls === 'Verified' || (r.cls === 'Document-supported' && !(r.ref && docCodes.has(r.ref)))) r.cls = 'Self-reported'; });

  const prev = await latestDiagnostic(ctx, caseRow.id);
  if (!v.ok) {
    if (!o.persistRejection) throw new ApiError(422, 'data_quality', 'The diagnostic did not pass the data quality gate', { problems: v.problems, completion: v.completion });
    const [d] = await ctx.db.insert(schema.diagnostics).values({ caseId: caseRow.id, status: 'Rejected', source: o.source, frameworkVersionId: fv.id, submissionUuid: o.uuid ?? null, completion: v.completion.toFixed(3), validationNotes: v.problems.join('; '), submittedBy: ctx.user?.id ?? null }).returning();
    await audit(ctx, 'diagnostic.rejected', 'diagnostic', d.id, undefined, { problems: v.problems, source: o.source }, caseRow.id);
    await emitEvent(ctx, 'SystemError', { caseId: caseRow.id, payload: { kind: 'data_quality', problems: v.problems } });
    return { accepted: false as const, id: d.id, code: d.code, problems: v.problems, completion: v.completion };
  }
  const [d] = await ctx.db.insert(schema.diagnostics).values({
    caseId: caseRow.id, status: 'Validated', source: o.source, frameworkVersionId: fv.id, submissionUuid: o.uuid ?? null, completion: v.completion.toFixed(3),
    submittedBy: ctx.user?.id ?? null, version: (prev?.version ?? 0) + 1, supersedesId: prev?.id ?? null, assessmentRoundId: o.roundId ?? null, assessmentMode: modeOf(o.source, ctx.user?.role, ctx.user?.id, rows.map((r) => o.answeredBy?.[r.q.code] ?? ctx.user?.id ?? null))
  }).returning();
  const resp = await ctx.db.insert(schema.responses).values(rows.map((r) => ({ diagnosticId: d.id, questionCode: r.q.code, value: r.value, notApplicable: r.na, evidenceClass: r.cls, evidenceRef: r.ref, answeredBy: o.answeredBy?.[r.q.code] ?? ctx.user?.id ?? null }))).returning();
  const byCode = new Map(resp.map((r) => [r.questionCode, r]));
  const docs = refs.length ? await ctx.db.select({ id: schema.documents.id, code: schema.documents.code }).from(schema.documents).where(inArray(schema.documents.code, refs)) : [];
  const docId = new Map(docs.map((x) => [x.code, x.id]));
  await ctx.db.insert(schema.evidence).values(rows.filter((r) => !r.na).map((r) => ({
    caseId: caseRow.id, responseId: byCode.get(r.q.code)!.id, class: r.cls, documentId: r.ref ? docId.get(r.ref) ?? null : null,
    description: r.note ? `${r.q.code}: ${r.note}` : `${r.q.code} answered ${r.value} of 4 (${r.cls.toLowerCase()})`
  })));
  await audit(ctx, 'diagnostic.submitted', 'diagnostic', d.id, undefined, { version: d.version, source: o.source, completion: v.completion, answered: rows.filter((r) => !r.na).length, notApplicable: rows.filter((r) => r.na).length, framework: `${fv.id}` }, caseRow.id);
  if (caseRow.status === 'PROFILED') {
    await ctx.db.update(schema.cases).set({ status: 'DIAGNOSTIC', updatedAt: new Date() }).where(eq(schema.cases.id, caseRow.id));
    await audit(ctx, 'case.state', 'case', caseRow.id, { status: 'PROFILED' }, { status: 'DIAGNOSTIC', trigger: 'Diagnostic opened', automatic: true }, caseRow.id);
  }
  await emitEvent(ctx, 'DiagnosticCompleted', { caseId: caseRow.id, payload: { diagnostic: d.code } });
  const score = await computeScore(ctx, caseRow.id, d.id);
  const status = await advanceCase(ctx, caseRow.id);
  // A real, accepted submission replaces whatever draft it came from -- clear it so a completed
  // diagnostic never keeps prompting "continue where you left off" or generating reminders.
  await clearDraft(ctx, caseRow.id);
  return { accepted: true as const, id: d.id, code: d.code, version: d.version, completion: v.completion, score: { overall: Number(score.overall), maturity: score.maturity, confidenceClass: score.confidenceClass }, caseStatus: status };
}

/**
 * Autosaved draft answers for the plain (non-team) diagnostic form -- one row per case, replaced wholesale
 * on every save. This is a different shape from the team-round drafts in `responseDrafts` (one row per
 * question, tied to an `assessmentRounds` collection with per-colleague area ownership): a solo diagnostic
 * has no area split and no round to collect into, so a flat per-case JSON blob mirroring the exact
 * `AnswerInput` shape `submitDiagnostic` takes is the simplest faithful representation, not a shortcut.
 * Never scored and never evidence on their own -- only submitDiagnosticCore() turns a draft into a real,
 * scored diagnostic.
 */
export async function getDraft(ctx: Ctx, caseId: string) {
  allow(ctx, 'diagnostics', 'create');
  await assertLeadCase(ctx, caseId);
  const [row] = await ctx.db.select().from(schema.diagnosticDrafts).where(eq(schema.diagnosticDrafts.caseId, caseId)).limit(1);
  return { answers: (row?.answers as Record<string, AnswerInput>) ?? {}, updatedAt: row?.updatedAt ?? null };
}

export async function saveDraft(ctx: Ctx, caseId: string, answers: Record<string, AnswerInput>) {
  allow(ctx, 'diagnostics', 'create');
  const cs = await assertLeadCase(ctx, caseId);
  if (stateIndex(cs.status) < stateIndex('PROFILED')) throw unprocessable('The business profile must be complete before a diagnostic can be taken');
  const u = need(ctx).user;
  // Working on the draft again cancels whatever reminder escalation it was due for -- it starts over
  // from the top the next time it goes quiet.
  const [row] = await ctx.db.insert(schema.diagnosticDrafts).values({ caseId, answers, updatedBy: u.id })
    .onConflictDoUpdate({ target: schema.diagnosticDrafts.caseId, set: { answers, updatedBy: u.id, updatedAt: new Date(), reminderTier: 0, lastReminderAt: null } })
    .returning({ updatedAt: schema.diagnosticDrafts.updatedAt });
  return { savedAt: row.updatedAt };
}

/** Called once a diagnostic has actually been submitted (accepted or rejected): the draft it came from, if
 *  any, is cleared so a completed diagnostic never keeps generating "continue where you left off" prompts. */
async function clearDraft(ctx: Ctx, caseId: string) {
  await ctx.db.delete(schema.diagnosticDrafts).where(eq(schema.diagnosticDrafts.caseId, caseId));
}

export async function submitDiagnostic(ctx: Ctx, caseId: string, b: { answers: Record<string, AnswerInput>; uuid?: string }) {
  allow(ctx, 'diagnostics', 'create');
  const cs = await assertLeadCase(ctx, caseId);
  return submitDiagnosticCore(ctx, cs, b.answers, { uuid: b.uuid, source: 'web', persistRejection: false });
}

export async function rescore(ctx: Ctx, caseId: string) {
  allow(ctx, 'evidence', 'edit');
  await assertLeadCase(ctx, caseId);
  const d = await latestDiagnostic(ctx, caseId);
  if (!d) throw unprocessable('There is no validated diagnostic to score');
  const s = await computeScore(ctx, caseId, d.id);
  await advanceCase(ctx, caseId);
  return { overall: Number(s.overall), maturity: s.maturity, confidenceClass: s.confidenceClass, run: s.run };
}

export async function listDiagnostics(ctx: Ctx, caseId: string) {
  allow(ctx, 'diagnostics', 'read');
  await assertCase(ctx, caseId);
  return ctx.db.select().from(schema.diagnostics).where(eq(schema.diagnostics.caseId, caseId)).orderBy(desc(schema.diagnostics.createdAt));
}

/** Scores over time for one case, and the latest breakdown with the answers behind it. */
export async function caseScores(ctx: Ctx, caseId: string) {
  allow(ctx, 'scores', 'read');
  await assertCase(ctx, caseId);
  const history = await ctx.db.select().from(schema.healthScores).where(eq(schema.healthScores.caseId, caseId)).orderBy(asc(schema.healthScores.createdAt));
  const last = history[history.length - 1];
  const u = need(ctx).user;
  let answers: unknown[] = [];
  if (last && isInternal(u)) {
    const qs = questionsOf(await versionForRow(ctx.db, last.frameworkVersionId));
    const rs = await ctx.db.select().from(schema.responses).where(eq(schema.responses.diagnosticId, last.diagnosticId));
    const ev = await ctx.db.select().from(schema.evidence).where(eq(schema.evidence.caseId, caseId));
    const evBy = new Map(ev.map((e) => [e.responseId, e]));
    answers = rs.map((r) => { const q = qs.find((x) => x.code === r.questionCode); const e = evBy.get(r.id); return { questionCode: r.questionCode, dimension: q?.dimension, text: q?.text, value: r.value, notApplicable: r.notApplicable, evidenceClass: e?.class ?? r.evidenceClass, evidenceId: e?.code ?? null }; });
  }
  return {
    history: history.map((h) => ({ id: h.id, run: h.run, phase: h.phase, frameworkVersionId: h.frameworkVersionId, overall: Number(h.overall), maturity: h.maturity, confidenceClass: h.confidenceClass, at: h.createdAt })),
    latest: last ? { phase: last.phase, overall: Number(last.overall), maturity: last.maturity, confidenceClass: last.confidenceClass, dimensions: last.dimensions, evidenceShare: last.evidenceShare, extras: last.extras ?? null, at: last.createdAt } : null,
    answers
  };
}
export { notFound };
