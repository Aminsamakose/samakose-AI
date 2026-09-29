import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, conflict, fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertCase, caseScope, isInternal } from '@/domain/scope';
import { addDays, canTransitionPrescription, isoDate, validateDiagnosis, validatePrescription, type RxStatus } from '@/domain/logic';
import { emitEvent } from '@/domain/events';
import { notifyUsers } from '@/domain/notify';
import { enqueue } from '@/domain/jobs';
import { advanceCase, allow, latestDiagnosis, latestScore, loadRules, need } from './common';
import { status } from '@/api/framework';
import type { PrescriptionItem } from '@/db/schema';

const dg = schema.diagnoses, rx = schema.prescriptions;

async function assertNoRunningJob(ctx: Ctx, kind: string, caseId: string) {
  const r = await ctx.db.execute(sql`select 1 from jobs where kind=${kind} and status in ('queued','running') and payload->>'caseId' = ${caseId} limit 1`);
  if (r.rows.length) throw conflict('This is already being prepared. Check back in a moment.');
}

/* ------------------------------ diagnoses ------------------------------ */
export async function requestDiagnosis(ctx: Ctx, caseId: string) {
  allow(ctx, 'diagnoses', 'create');
  await assertCase(ctx, caseId);
  if (!(await latestScore(ctx, caseId))) throw unprocessable('Score the diagnostic first');
  await assertNoRunningJob(ctx, 'ai_diagnosis', caseId);
  const jobId = await enqueue(ctx, 'ai_diagnosis', { caseId }, { maxAttempts: 2 });
  await audit(ctx, 'diagnosis.requested', 'case', caseId, undefined, { jobId }, caseId);
  return status(202, { jobId });
}

const evidenceCodes = async (ctx: Ctx, caseId: string) => (await ctx.db.select({ code: schema.evidence.code }).from(schema.evidence).where(eq(schema.evidence.caseId, caseId))).map((e) => e.code);

export async function createDiagnosis(ctx: Ctx, caseId: string, b: { summary: string; rootCauses: { cause: string; evidence_ids: string[] }[]; priority: string; risks: { text: string; severity: string }[] }) {
  allow(ctx, 'diagnoses', 'create');
  const cs = await assertCase(ctx, caseId);
  const d = await latestScore(ctx, caseId);
  if (!d) throw unprocessable('Score the diagnostic first');
  const problems = validateDiagnosis({ summary: b.summary, root_causes: b.rootCauses, priority: b.priority, risks: b.risks }, await evidenceCodes(ctx, caseId));
  if (problems.length) throw new ApiError(400, 'validation_failed', 'The diagnosis is not valid', { diagnosis: problems.join('. ') });
  const prev = await latestDiagnosis(ctx, caseId);
  const [row] = await ctx.db.insert(dg).values({ caseId, diagnosticId: d.diagnosticId, status: 'Draft', summary: b.summary, rootCauses: b.rootCauses, priority: b.priority, risks: b.risks, version: (prev?.version ?? 0) + 1, supersedesId: prev?.id ?? null, createdBy: need(ctx).user.id }).returning({ id: dg.id, code: dg.code, version: dg.version });
  await audit(ctx, 'diagnosis.created', 'diagnosis', row.id, undefined, { version: row.version, manual: true }, cs.id);
  return row;
}

export async function reviseDiagnosis(ctx: Ctx, id: string, b: { summary: string; rootCauses: { cause: string; evidence_ids: string[] }[]; priority: string; risks: { text: string; severity: string }[] }) {
  allow(ctx, 'diagnoses', 'edit');
  const [old] = await ctx.db.select().from(dg).where(eq(dg.id, id)).limit(1);
  if (!old) throw notFound('Diagnosis not found');
  await assertCase(ctx, old.caseId);
  const latest = await latestDiagnosis(ctx, old.caseId);
  if (latest!.id !== old.id) throw conflict('A newer version exists. Edit the latest version.');
  if (old.status === 'Reviewed') throw unprocessable('A reviewed diagnosis is replaced by creating a new one');
  return createDiagnosis(ctx, old.caseId, b);
}

export async function listDiagnoses(ctx: Ctx, caseId: string) {
  allow(ctx, 'diagnoses', 'read');
  await assertCase(ctx, caseId);
  const rows = await ctx.db.select().from(dg).where(eq(dg.caseId, caseId)).orderBy(desc(dg.version), desc(dg.createdAt));
  const latest = rows[0]?.id;
  return rows.map((r) => ({ ...r, current: r.id === latest, aiDrafted: !!r.aiRequestId }));
}

export async function reviewDiagnosis(ctx: Ctx, id: string, b: { decision: 'Reviewed' | 'Rejected'; note?: string }) {
  allow(ctx, 'diagnoses', 'edit');
  const [d] = await ctx.db.select().from(dg).where(eq(dg.id, id)).for('update').limit(1);
  if (!d) throw notFound('Diagnosis not found');
  await assertCase(ctx, d.caseId);
  const latest = await latestDiagnosis(ctx, d.caseId);
  if (latest!.id !== d.id) throw conflict('A newer version exists');
  if (d.status !== 'Draft') throw unprocessable(`This diagnosis is already ${d.status.toLowerCase()}`);
  if (b.decision === 'Rejected' && (b.note ?? '').trim().length < 5) throw fieldError({ note: 'Say why the diagnosis is rejected' });
  await ctx.db.update(dg).set({ status: b.decision }).where(eq(dg.id, id));
  await ctx.db.insert(schema.approvals).values({ recordType: 'diagnosis', recordId: id, caseId: d.caseId, userId: ctx.user!.id, decision: b.decision, reason: b.note ?? null });
  await audit(ctx, 'diagnosis.reviewed', 'diagnosis', id, { status: d.status }, { status: b.decision, note: b.note ?? null }, d.caseId);
  const state = await advanceCase(ctx, d.caseId);
  return { status: b.decision, caseStatus: state };
}

/* ---------------------------- prescriptions ---------------------------- */
export async function requestPrescription(ctx: Ctx, caseId: string) {
  allow(ctx, 'prescriptions', 'create');
  await assertCase(ctx, caseId);
  const d = await latestDiagnosis(ctx, caseId);
  if (!d || d.status !== 'Reviewed') throw unprocessable('Review the diagnosis before drafting a prescription');
  await assertNoRunningJob(ctx, 'ai_prescription', caseId);
  const jobId = await enqueue(ctx, 'ai_prescription', { caseId }, { maxAttempts: 2 });
  await audit(ctx, 'prescription.requested', 'case', caseId, undefined, { jobId }, caseId);
  return status(202, { jobId });
}

export async function latestRx(ctx: Ctx, caseId: string) {
  const [r] = await ctx.db.select().from(rx).where(eq(rx.caseId, caseId)).orderBy(desc(rx.version), desc(rx.createdAt)).limit(1);
  return r ?? null;
}
async function checkItems(ctx: Ctx, items: PrescriptionItem[]) {
  const lib = (await ctx.db.select({ code: schema.libraryItems.code }).from(schema.libraryItems).where(eq(schema.libraryItems.active, true))).map((l) => l.code);
  const problems = validatePrescription({ items }, lib, await loadRules(ctx.db));
  if (problems.length) throw new ApiError(400, 'validation_failed', 'The prescription is not valid', { items: problems.join('. ') });
}

export async function createPrescription(ctx: Ctx, caseId: string, items: PrescriptionItem[]) {
  allow(ctx, 'prescriptions', 'create');
  await assertCase(ctx, caseId);
  const d = await latestDiagnosis(ctx, caseId);
  if (!d || d.status !== 'Reviewed') throw unprocessable('Review the diagnosis before drafting a prescription');
  await checkItems(ctx, items);
  const prev = await latestRx(ctx, caseId);
  if (prev && ['DRAFT', 'IN REVIEW', 'RETURNED'].includes(prev.status)) throw conflict('There is already an open prescription for this case. Revise it instead.');
  const [row] = await ctx.db.insert(rx).values({ caseId, diagnosisId: d.id, status: 'DRAFT', items, version: (prev?.version ?? 0) + 1, supersedesId: prev?.id ?? null, createdBy: need(ctx).user.id }).returning({ id: rx.id, code: rx.code, version: rx.version });
  await audit(ctx, 'prescription.created', 'prescription', row.id, undefined, { version: row.version, items: items.length }, caseId);
  return row;
}

export async function revisePrescription(ctx: Ctx, id: string, items: PrescriptionItem[]) {
  allow(ctx, 'prescriptions', 'edit');
  const [old] = await ctx.db.select().from(rx).where(eq(rx.id, id)).limit(1);
  if (!old) throw notFound('Prescription not found');
  await assertCase(ctx, old.caseId);
  if (!['DRAFT', 'RETURNED'].includes(old.status)) throw unprocessable('Only a draft or returned prescription can be revised');
  const latest = await latestRx(ctx, old.caseId);
  if (latest!.id !== old.id) throw conflict('A newer version exists');
  await checkItems(ctx, items);
  const [row] = await ctx.db.insert(rx).values({ caseId: old.caseId, diagnosisId: old.diagnosisId, status: 'DRAFT', items, version: old.version + 1, supersedesId: old.id, createdBy: ctx.user!.id }).returning({ id: rx.id, code: rx.code, version: rx.version });
  await audit(ctx, 'prescription.revised', 'prescription', row.id, { version: old.version }, { version: row.version }, old.caseId);
  return row;
}

export async function submitPrescription(ctx: Ctx, id: string) {
  allow(ctx, 'prescriptions', 'edit');
  const [p] = await ctx.db.select().from(rx).where(eq(rx.id, id)).for('update').limit(1);
  if (!p) throw notFound('Prescription not found');
  const cs = await assertCase(ctx, p.caseId);
  const r = canTransitionPrescription(p.status as RxStatus, 'IN REVIEW', need(ctx).user.role);
  if (!r.ok) throw unprocessable(r.reason);
  const latest = await latestRx(ctx, p.caseId);
  if (latest!.id !== p.id) throw conflict('A newer version exists');
  if (!cs.reviewerId) throw unprocessable('Assign a reviewer to this case first');
  await ctx.db.update(rx).set({ status: 'IN REVIEW' }).where(eq(rx.id, id));
  await audit(ctx, 'prescription.submitted', 'prescription', id, { status: p.status }, { status: 'IN REVIEW' }, p.caseId);
  await emitEvent(ctx, 'PrescriptionGenerated', { caseId: p.caseId, payload: { prescription: p.code } });
  await advanceCase(ctx, p.caseId);
  return { status: 'IN REVIEW' };
}

export async function reviewPrescription(ctx: Ctx, id: string, b: { decision: 'APPROVED' | 'RETURNED'; reason?: string }) {
  allow(ctx, 'prescriptions', 'approve');
  const u = need(ctx).user;
  const [p] = await ctx.db.select().from(rx).where(eq(rx.id, id)).for('update').limit(1);
  if (!p) throw notFound('Prescription not found');
  const cs = await assertCase(ctx, p.caseId);
  const r = canTransitionPrescription(p.status as RxStatus, b.decision, u.role);
  if (!r.ok) throw unprocessable(r.reason);
  if (cs.reviewerId !== u.id) throw forbidden('You are not the reviewer of this case');
  if (p.createdBy === u.id || cs.consultantId === u.id) throw forbidden('You cannot review work you wrote or are responsible for');
  if (b.decision === 'RETURNED' && (b.reason ?? '').trim().length < 5) throw fieldError({ reason: 'Say what must change' });
  await ctx.db.update(rx).set({ status: b.decision, reviewerNote: b.reason ?? null }).where(eq(rx.id, id));
  await ctx.db.insert(schema.approvals).values({ recordType: 'prescription', recordId: id, caseId: p.caseId, userId: u.id, decision: b.decision, reason: b.reason ?? null });
  await audit(ctx, b.decision === 'APPROVED' ? 'prescription.approved' : 'prescription.returned', 'prescription', id, { status: p.status }, { status: b.decision, reason: b.reason ?? null }, p.caseId);
  if (b.decision === 'RETURNED') {
    await notifyUsers(ctx, [cs.consultantId].filter(Boolean) as string[], { kind: 'PrescriptionReturned', title: 'Prescription returned by the reviewer', body: b.reason, link: `/cases/${p.caseId}`, email: true });
    return { status: 'RETURNED', caseStatus: cs.status };
  }
  // Older approved versions stop being current.
  await ctx.db.update(rx).set({ status: 'SUPERSEDED' }).where(and(eq(rx.caseId, p.caseId), eq(rx.status, 'APPROVED'), sql`${rx.id} <> ${id}`));
  await materialise(ctx, p, cs);
  await emitEvent(ctx, 'PrescriptionApproved', { caseId: p.caseId, payload: { prescription: p.code } });
  const state = await advanceCase(ctx, p.caseId);
  return { status: 'APPROVED', caseStatus: state };
}

/** An approved prescription becomes interventions, actions with owners and dates, and KPIs to watch. */
async function materialise(ctx: Ctx, p: typeof rx.$inferSelect, cs: typeof schema.cases.$inferSelect) {
  const lib = await ctx.db.select().from(schema.libraryItems);
  const owner = (await ctx.db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.orgId, cs.orgId), eq(schema.users.role, 'OWNER'), eq(schema.users.active, true))).orderBy(schema.users.createdAt).limit(1))[0]?.id ?? null;
  const assignee = (role: string) => (role === 'OWNER' ? owner : role === 'COACH' ? cs.coachId : cs.consultantId);
  const now = new Date();
  for (const item of p.items) {
    const [iv] = await ctx.db.insert(schema.interventions).values({ caseId: p.caseId, prescriptionId: p.id, libraryCode: item.library_id }).returning({ id: schema.interventions.id });
    await emitEvent(ctx, 'InterventionAssigned', { caseId: p.caseId, payload: { library: item.library_id } });
    for (const a of item.actions) {
      await ctx.db.insert(schema.actions).values({ caseId: p.caseId, interventionId: iv.id, text: a.text, ownerRole: a.owner_role, assigneeId: assignee(a.owner_role), dueDate: isoDate(addDays(now, a.deadline_days)) });
      await emitEvent(ctx, 'ActionCreated', { caseId: p.caseId, payload: { text: a.text } });
    }
    const hint = lib.find((l) => l.code === item.library_id)?.kpiHint;
    if (hint) {
      const have = await ctx.db.select({ id: schema.kpis.id }).from(schema.kpis).where(and(eq(schema.kpis.caseId, p.caseId), eq(schema.kpis.name, hint))).limit(1);
      if (!have.length) await ctx.db.insert(schema.kpis).values({ caseId: p.caseId, name: hint });
    }
  }
}

export async function listPrescriptions(ctx: Ctx, caseId: string) {
  allow(ctx, 'prescriptions', 'read');
  await assertCase(ctx, caseId);
  const u = need(ctx).user;
  const rows = await ctx.db.select().from(rx).where(and(eq(rx.caseId, caseId), u.role === 'OWNER' ? eq(rx.status, 'APPROVED') : undefined)).orderBy(desc(rx.version), desc(rx.createdAt));
  const lib = new Map((await ctx.db.select().from(schema.libraryItems)).map((l) => [l.code, l]));
  const latest = rows[0]?.id;
  return rows.map((r) => ({
    ...r, current: r.id === latest, aiDrafted: !!r.aiRequestId, reviewerNote: isInternal(u) ? r.reviewerNote : null,
    items: r.items.map((i) => ({ ...i, title: lib.get(i.library_id)?.title ?? i.library_id, dimension: lib.get(i.library_id)?.dimension }))
  }));
}

export async function reviewQueue(ctx: Ctx) {
  allow(ctx, 'prescriptions', 'read');
  const u = need(ctx).user;
  const scope = caseScope(u);
  const c = schema.cases, o = schema.organisations;
  const prescriptions = await ctx.db.select({ id: rx.id, code: rx.code, caseId: rx.caseId, caseCode: c.code, org: o.name, version: rx.version, createdAt: rx.createdAt, items: sql<number>`jsonb_array_length(${rx.items})` })
    .from(rx).innerJoin(c, eq(c.id, rx.caseId)).innerJoin(o, eq(o.id, c.orgId))
    .where(and(scope, eq(rx.status, 'IN REVIEW'), sql`not exists (select 1 from prescriptions x where x.supersedes_id = ${rx.id})`)).orderBy(rx.createdAt);
  const rp = schema.reports;
  const reports = await ctx.db.select({ id: rp.id, code: rp.code, caseId: rp.caseId, caseCode: c.code, org: o.name, title: rp.title, createdAt: rp.createdAt })
    .from(rp).innerJoin(c, eq(c.id, rp.caseId)).innerJoin(o, eq(o.id, c.orgId)).where(and(scope, eq(rp.status, 'Draft'))).orderBy(rp.createdAt);
  const returned = u.role === 'CONSULTANT'
    ? await ctx.db.select({ id: rx.id, code: rx.code, caseId: rx.caseId, caseCode: c.code, org: o.name, reason: rx.reviewerNote }).from(rx).innerJoin(c, eq(c.id, rx.caseId)).innerJoin(o, eq(o.id, c.orgId))
      .where(and(scope, eq(rx.status, 'RETURNED'), sql`not exists (select 1 from prescriptions x where x.supersedes_id = ${rx.id})`))
    : [];
  return { prescriptions, reports, returned };
}
export { inArray, ApiError };
