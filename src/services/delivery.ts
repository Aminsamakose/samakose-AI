import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertCase, caseScope, isInternal } from '@/domain/scope';
import { ACTION_TRANSITIONS } from '@/domain/logic';
import { emitEvent } from '@/domain/events';
import { enqueue } from '@/domain/jobs';
import { status } from '@/api/framework';
import { orderBy, search, countOf, type ListQuery } from '@/api/list';
import { advanceCase, allow, need, respondList, today } from './common';
import type { EvidenceClass } from '@/db/schema';

const a = schema.actions, c = schema.cases, o = schema.organisations;

/* ------------------------------- actions ------------------------------- */
const actionCols = {
  id: a.id, code: a.code, caseId: a.caseId, caseCode: c.code, org: o.name, text: a.text, ownerRole: a.ownerRole, assigneeId: a.assigneeId,
  assignee: sql<string | null>`(select name from users where id = ${a.assigneeId})`, dueDate: a.dueDate, status: a.status, evidenceNote: a.evidenceNote,
  completedAt: a.completedAt, overdue: sql<boolean>`(${a.status} <> 'Done' and ${a.dueDate} < current_date)`,
  horizon: sql<number>`(case when (${a.dueDate} - ${a.createdAt}::date) <= 30 then 30 when (${a.dueDate} - ${a.createdAt}::date) <= 90 then 90 when (${a.dueDate} - ${a.createdAt}::date) <= 180 then 180 else 360 end)`
};
/** Plan horizon in days, from when the action was created to its due date: 30, 90, 180 or 360. */
const horizonWhere = (h?: string) => (h === '30' ? sql`(${a.dueDate} - ${a.createdAt}::date) <= 30` : h === '90' ? sql`(${a.dueDate} - ${a.createdAt}::date) between 31 and 90` : h === '180' ? sql`(${a.dueDate} - ${a.createdAt}::date) between 91 and 180` : h === '360' ? sql`(${a.dueDate} - ${a.createdAt}::date) > 180` : undefined);

export async function listActions(ctx: Ctx, q: ListQuery & { caseId?: string; status?: string; assigneeId?: string; overdue?: string; mine?: string; horizon?: string }) {
  allow(ctx, 'actions', 'read');
  const u = need(ctx).user;
  const where = and(caseScope(u), search(q.q, [a.text, a.code, c.code, o.name]),
    q.caseId ? eq(a.caseId, q.caseId) : undefined, q.status ? eq(a.status, q.status) : undefined,
    q.mine === 'true' ? eq(a.assigneeId, u.id) : q.assigneeId ? eq(a.assigneeId, q.assigneeId) : undefined,
    q.overdue === 'true' ? sql`${a.status} <> 'Done' and ${a.dueDate} < current_date` : undefined, horizonWhere(q.horizon));
  const from = (b: any) => b.from(a).innerJoin(c, eq(c.id, a.caseId)).innerJoin(o, eq(o.id, c.orgId));
  return respondList(ctx, 'actions', q,
    (limit, off) => from(ctx.db.select(actionCols)).where(where).orderBy(orderBy(q, { due: a.dueDate, status: a.status, code: a.code, org: o.name }, a.dueDate)).limit(limit).offset(off),
    async () => Number((await from(ctx.db.select({ n: countOf })).where(where))[0].n),
    { filename: 'actions.csv', columns: [['code', 'Action'], ['caseCode', 'Case'], ['org', 'Organisation'], ['text', 'Action'], ['ownerRole', 'Owner role'], ['assignee', 'Assignee'], ['horizon', 'Plan horizon (days)'], ['dueDate', 'Due'], ['status', 'Status'], ['overdue', 'Overdue'], ['evidenceNote', 'Evidence note']].map(([key, label]) => ({ key, label })) });
}

export async function createAction(ctx: Ctx, caseId: string, b: { text: string; ownerRole: 'OWNER' | 'COACH' | 'CONSULTANT'; dueDate: string; assigneeId?: string | null }) {
  allow(ctx, 'actions', 'create');
  const cs = await assertCase(ctx, caseId);
  if (b.dueDate < today()) throw fieldError({ dueDate: 'The due date cannot be in the past' });
  let assignee = b.assigneeId ?? null;
  if (!assignee) assignee = b.ownerRole === 'COACH' ? cs.coachId : b.ownerRole === 'CONSULTANT' ? cs.consultantId
    : (await ctx.db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.orgId, cs.orgId), eq(schema.users.role, 'OWNER'), eq(schema.users.active, true))).limit(1))[0]?.id ?? null;
  const [row] = await ctx.db.insert(a).values({ caseId, text: b.text.trim(), ownerRole: b.ownerRole, dueDate: b.dueDate, assigneeId: assignee }).returning({ id: a.id, code: a.code });
  await audit(ctx, 'action.created', 'action', row.id, undefined, { text: b.text, dueDate: b.dueDate, ownerRole: b.ownerRole }, caseId);
  await emitEvent(ctx, 'ActionCreated', { caseId, payload: { text: b.text } });
  return row;
}

export async function updateAction(ctx: Ctx, id: string, b: { status?: 'Open' | 'In progress' | 'Done'; evidenceNote?: string; assigneeId?: string | null; dueDate?: string }) {
  allow(ctx, 'actions', 'edit');
  const u = need(ctx).user;
  const [before] = await ctx.db.select().from(a).where(eq(a.id, id)).for('update').limit(1);
  if (!before) throw notFound('Action not found');
  await assertCase(ctx, before.caseId);
  if (u.role === 'OWNER' && before.ownerRole !== 'OWNER') throw forbidden('This action belongs to your advisers');
  if (u.role === 'OWNER' && (b.assigneeId !== undefined || b.dueDate !== undefined)) throw forbidden('Ask your adviser to change assignees or dates');
  const patch: Partial<typeof a.$inferInsert> = { updatedAt: new Date() };
  if (b.evidenceNote !== undefined) patch.evidenceNote = b.evidenceNote.trim();
  if (b.dueDate !== undefined) { if (b.dueDate < today()) throw fieldError({ dueDate: 'The due date cannot be in the past' }); patch.dueDate = b.dueDate; patch.overdueNotifiedAt = null; }
  if (b.assigneeId !== undefined) {
    if (b.assigneeId) { const [x] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, b.assigneeId)).limit(1); if (!x?.active) throw fieldError({ assigneeId: 'Choose an active user' }); }
    patch.assigneeId = b.assigneeId;
  }
  if (b.status && b.status !== before.status) {
    if (!ACTION_TRANSITIONS[before.status]?.includes(b.status)) throw unprocessable(`A ${before.status} action cannot become ${b.status}`);
    if (b.status === 'Done') {
      const note = (b.evidenceNote ?? before.evidenceNote ?? '').trim();
      if (note.length < 3) throw fieldError({ evidenceNote: 'Say what was done or attach proof before marking this complete' });
      patch.completedAt = new Date();
    }
    patch.status = b.status;
  }
  await ctx.db.update(a).set(patch).where(eq(a.id, id));
  await audit(ctx, 'action.updated', 'action', id, { status: before.status, assigneeId: before.assigneeId, dueDate: before.dueDate }, { status: patch.status ?? before.status, assigneeId: patch.assigneeId ?? before.assigneeId, dueDate: patch.dueDate ?? before.dueDate }, before.caseId);
  if (patch.status === 'Done') await emitEvent(ctx, 'ActionCompleted', { caseId: before.caseId, payload: { text: before.text } });
  if (patch.status) await advanceCase(ctx, before.caseId);
  return { ok: true, status: patch.status ?? before.status };
}

/* -------------------------------- risks -------------------------------- */
const RISK_STATUS = ['Open', 'Mitigating', 'Accepted', 'Closed'];
export async function listRisks(ctx: Ctx, caseId: string) {
  allow(ctx, 'risks', 'read');
  await assertCase(ctx, caseId);
  if (!isInternal(need(ctx).user)) throw forbidden();
  return ctx.db.select().from(schema.risks).where(eq(schema.risks.caseId, caseId)).orderBy(asc(schema.risks.status), desc(schema.risks.createdAt));
}
export async function updateRisk(ctx: Ctx, id: string, b: { status?: string; severity?: string; text?: string }) {
  allow(ctx, 'risks', 'edit');
  const [before] = await ctx.db.select().from(schema.risks).where(eq(schema.risks.id, id)).limit(1);
  if (!before) throw notFound('Risk not found');
  await assertCase(ctx, before.caseId);
  if (b.status && !RISK_STATUS.includes(b.status)) throw fieldError({ status: 'Unknown status' });
  await ctx.db.update(schema.risks).set({ ...b, updatedAt: new Date() }).where(eq(schema.risks.id, id));
  await audit(ctx, 'risk.updated', 'risk', id, { status: before.status, severity: before.severity }, b, before.caseId);
  return { ok: true };
}
export async function createRisk(ctx: Ctx, caseId: string, b: { text: string; severity: 'High' | 'Medium' | 'Low' }) {
  allow(ctx, 'risks', 'edit');
  await assertCase(ctx, caseId);
  const [row] = await ctx.db.insert(schema.risks).values({ caseId, text: b.text.trim(), severity: b.severity }).returning({ id: schema.risks.id, code: schema.risks.code });
  await audit(ctx, 'risk.created', 'risk', row.id, undefined, b, caseId);
  await emitEvent(ctx, 'RiskDetected', { caseId, payload: { count: 1 } });
  return row;
}

/* --------------------------------- KPIs -------------------------------- */
export async function listKpis(ctx: Ctx, caseId: string) {
  allow(ctx, 'kpis', 'read');
  await assertCase(ctx, caseId);
  const ks = await ctx.db.select().from(schema.kpis).where(eq(schema.kpis.caseId, caseId)).orderBy(schema.kpis.createdAt);
  const rs = ks.length ? await ctx.db.select().from(schema.kpiReadings).where(inArray(schema.kpiReadings.kpiId, ks.map((k) => k.id))).orderBy(asc(schema.kpiReadings.readingDate), asc(schema.kpiReadings.createdAt)) : [];
  return ks.map((k) => {
    const mine = rs.filter((r) => r.kpiId === k.id).map((r) => ({ id: r.id, value: Number(r.value), date: r.readingDate, sourceClass: r.sourceClass }));
    const last = mine[mine.length - 1];
    const base = k.baseline === null ? null : Number(k.baseline), tgt = k.target === null ? null : Number(k.target);
    const progress = last && base !== null && tgt !== null && tgt !== base ? Math.max(0, Math.min(1, (last.value - base) / (tgt - base))) : null;
    return { id: k.id, code: k.code, name: k.name, unit: k.unit, baseline: base, target: tgt, readings: mine, latest: last ?? null, progress };
  });
}
export async function createKpi(ctx: Ctx, caseId: string, b: { name: string; unit?: string | null; baseline?: number | null; target?: number | null }) {
  allow(ctx, 'kpis', 'create');
  await assertCase(ctx, caseId);
  if (need(ctx).user.role === 'OWNER') throw forbidden('Your adviser sets the indicators. You can report readings.');
  const [row] = await ctx.db.insert(schema.kpis).values({ caseId, name: b.name.trim(), unit: b.unit ?? null, baseline: b.baseline?.toFixed(2) ?? null, target: b.target?.toFixed(2) ?? null }).returning({ id: schema.kpis.id, code: schema.kpis.code });
  await audit(ctx, 'kpi.created', 'kpi', row.id, undefined, b, caseId);
  return row;
}
export async function updateKpi(ctx: Ctx, id: string, b: { name?: string; unit?: string | null; baseline?: number | null; target?: number | null }) {
  allow(ctx, 'kpis', 'edit');
  const [before] = await ctx.db.select().from(schema.kpis).where(eq(schema.kpis.id, id)).limit(1);
  if (!before) throw notFound('Indicator not found');
  await assertCase(ctx, before.caseId);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (b.name !== undefined) patch.name = b.name.trim();
  if (b.unit !== undefined) patch.unit = b.unit;
  if (b.baseline !== undefined) patch.baseline = b.baseline === null ? null : b.baseline.toFixed(2);
  if (b.target !== undefined) patch.target = b.target === null ? null : b.target.toFixed(2);
  await ctx.db.update(schema.kpis).set(patch).where(eq(schema.kpis.id, id));
  await audit(ctx, 'kpi.updated', 'kpi', id, before, patch, before.caseId);
  return { ok: true };
}
export async function addReading(ctx: Ctx, kpiId: string, b: { value: number; readingDate: string; sourceClass?: EvidenceClass }) {
  allow(ctx, 'kpis', 'create');
  const [k] = await ctx.db.select().from(schema.kpis).where(eq(schema.kpis.id, kpiId)).limit(1);
  if (!k) throw notFound('Indicator not found');
  await assertCase(ctx, k.caseId);
  if (b.readingDate > today()) throw fieldError({ readingDate: 'A reading cannot be dated in the future' });
  const u = need(ctx).user;
  // Owners report their own numbers. Only staff can record a checked reading.
  const cls: EvidenceClass = u.role === 'OWNER' ? 'Self-reported' : b.sourceClass ?? 'Self-reported';
  const [row] = await ctx.db.insert(schema.kpiReadings).values({ kpiId, value: b.value.toFixed(2), readingDate: b.readingDate, sourceClass: cls, recordedBy: u.id }).returning({ id: schema.kpiReadings.id });
  await audit(ctx, 'kpi.reading', 'kpi', kpiId, undefined, { value: b.value, date: b.readingDate, class: cls }, k.caseId);
  await emitEvent(ctx, 'KPIUpdated', { caseId: k.caseId, payload: { kpi: k.code, value: b.value } });
  return row;
}

/* ------------------------------ coaching ------------------------------- */
const s = schema.coachingSessions;
const SESSION_MOVES: Record<string, string[]> = { Scheduled: ['Held', 'Missed', 'Cancelled'], Held: [], Missed: [], Cancelled: [] };
export async function listSessions(ctx: Ctx, q: { caseId?: string; upcoming?: string }) {
  allow(ctx, 'sessions', 'read');
  const u = need(ctx).user;
  if (q.caseId) await assertCase(ctx, q.caseId);
  const rows = await ctx.db.select({ id: s.id, code: s.code, caseId: s.caseId, caseCode: c.code, org: o.name, scheduledAt: s.scheduledAt, status: s.status, notes: s.notes, brief: s.brief, coachId: s.coachId })
    .from(s).innerJoin(c, eq(c.id, s.caseId)).innerJoin(o, eq(o.id, c.orgId))
    .where(and(caseScope(u), q.caseId ? eq(s.caseId, q.caseId) : undefined, q.upcoming === 'true' ? and(eq(s.status, 'Scheduled'), sql`${s.scheduledAt} >= now()`) : undefined))
    .orderBy(q.upcoming === 'true' ? asc(s.scheduledAt) : desc(s.scheduledAt)).limit(200);
  return rows.map((r) => ({ ...r, brief: isInternal(u) ? r.brief : null, notes: isInternal(u) ? r.notes : r.status === 'Held' ? r.notes : null }));
}
export async function createSession(ctx: Ctx, caseId: string, b: { scheduledAt: string }) {
  allow(ctx, 'sessions', 'create');
  const cs = await assertCase(ctx, caseId);
  const when = new Date(b.scheduledAt);
  if (when.getTime() < Date.now() - 60_000) throw fieldError({ scheduledAt: 'Choose a time in the future' });
  const [row] = await ctx.db.insert(s).values({ caseId, coachId: cs.coachId ?? (ctx.user!.role === 'EXPERT' ? ctx.user!.id : null), scheduledAt: when }).returning({ id: s.id, code: s.code });
  await audit(ctx, 'session.scheduled', 'session', row.id, undefined, { at: when.toISOString() }, caseId);
  return row;
}
export async function updateSession(ctx: Ctx, id: string, b: { status?: 'Held' | 'Missed' | 'Cancelled'; notes?: string; scheduledAt?: string }) {
  allow(ctx, 'sessions', 'edit');
  const [before] = await ctx.db.select().from(s).where(eq(s.id, id)).for('update').limit(1);
  if (!before) throw notFound('Session not found');
  await assertCase(ctx, before.caseId);
  const patch: Partial<typeof s.$inferInsert> = { updatedAt: new Date() };
  if (b.scheduledAt) { if (before.status !== 'Scheduled') throw unprocessable('Only a scheduled session can be moved'); patch.scheduledAt = new Date(b.scheduledAt); patch.reminderSentAt = null; }
  if (b.notes !== undefined) patch.notes = b.notes.trim();
  if (b.status) {
    if (!SESSION_MOVES[before.status]?.includes(b.status)) throw unprocessable(`A ${before.status} session cannot become ${b.status}`);
    if (b.status === 'Held' && (b.notes ?? before.notes ?? '').trim().length < 5) throw fieldError({ notes: 'Record what was discussed and agreed' });
    patch.status = b.status;
  }
  await ctx.db.update(s).set(patch).where(eq(s.id, id));
  await audit(ctx, 'session.updated', 'session', id, { status: before.status }, { status: patch.status ?? before.status }, before.caseId);
  if (patch.status === 'Held') { await emitEvent(ctx, 'CoachingCompleted', { caseId: before.caseId }); await advanceCase(ctx, before.caseId); }
  if (patch.status === 'Missed') await emitEvent(ctx, 'CoachingMissed', { caseId: before.caseId });
  return { ok: true };
}
export async function requestBrief(ctx: Ctx, id: string) {
  allow(ctx, 'sessions', 'edit');
  const [x] = await ctx.db.select().from(s).where(eq(s.id, id)).limit(1);
  if (!x) throw notFound('Session not found');
  await assertCase(ctx, x.caseId);
  if (x.status !== 'Scheduled') throw unprocessable('A brief is prepared for a scheduled session');
  const r = await ctx.db.execute(sql`select 1 from jobs where kind='ai_brief' and status in ('queued','running') and payload->>'sessionId' = ${id} limit 1`);
  if (r.rows.length) throw conflict('The brief is already being prepared');
  const jobId = await enqueue(ctx, 'ai_brief', { sessionId: id, caseId: x.caseId }, { maxAttempts: 2 });
  return status(202, { jobId });
}
export { lt };
