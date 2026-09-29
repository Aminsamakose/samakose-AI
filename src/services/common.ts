/** Helpers shared by every service: rules, facts, automatic case moves, listing and export. */
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { AuthedCtx, Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { can, type Resource } from '@/lib/rbac';
import { forbidden, unauthorized } from '@/lib/errors';
import { DEFAULT_RULES, canTransitionCase, CASE_TRANSITIONS, type Facts, type Rules } from '@/domain/logic';
import { toCsv } from '@/lib/csv';
import { csvResponse } from '@/api/framework';
import type { ListQuery } from '@/api/list';
import { page } from '@/api/list';
import type { CaseState } from '@/db/schema';

export function need(ctx: Ctx): AuthedCtx {
  if (!ctx.user) throw unauthorized();
  return ctx as AuthedCtx;
}
export function allow(ctx: Ctx, resource: Resource, action: Parameters<typeof can>[2]) {
  if (!ctx.user || !can(ctx.user.role, resource, action)) throw forbidden();
}

/** Rules in force: defaults overlaid with the values administrators saved. */
export async function loadRules(db: Ctx['db']): Promise<Rules> {
  const rows = await db.select().from(schema.rules);
  const r: Rules = { ...DEFAULT_RULES };
  for (const row of rows) { const n = Number(row.value); r[row.key] = row.value.trim() !== '' && !Number.isNaN(n) ? n : row.value; }
  return r;
}

/** What is true about a case right now. Drives the automatic state moves. */
export async function caseFacts(ctx: Ctx, caseId: string, confirmed = false): Promise<Facts> {
  const q = async (text: ReturnType<typeof sql>) => Number(((await ctx.db.execute(text)).rows[0] as { n: number }).n) > 0;
  const rules = await loadRules(ctx.db);
  const [validation, scored, dgnApproved, rxReview, rxApproved, actStarted, sessions] = await Promise.all([
    q(sql`select count(*)::int n from diagnostics d where d.case_id=${caseId} and d.status='Validated' and not exists (select 1 from diagnostics x where x.supersedes_id=d.id)`),
    q(sql`select count(*)::int n from health_scores where case_id=${caseId}`),
    q(sql`select count(*)::int n from diagnoses d where d.case_id=${caseId} and d.status='Reviewed' and not exists (select 1 from diagnoses x where x.supersedes_id=d.id)`),
    q(sql`select count(*)::int n from prescriptions p where p.case_id=${caseId} and p.status in ('IN REVIEW','APPROVED') and not exists (select 1 from prescriptions x where x.supersedes_id=p.id)`),
    q(sql`select count(*)::int n from prescriptions p where p.case_id=${caseId} and p.status='APPROVED'`),
    q(sql`select count(*)::int n from actions where case_id=${caseId} and status in ('In progress','Done')`),
    ctx.db.execute(sql`select count(*)::int n from coaching_sessions where case_id=${caseId} and status='Held'`)
  ]);
  return {
    validation_ok: validation, scored, diagnosis_approved: dgnApproved, prescription_in_review: rxReview, prescription_approved: rxApproved,
    action_started: actStarted, three_sessions: Number((sessions.rows[0] as { n: number }).n) >= Number(rules['session.min_for_monitoring']), confirmed
  };
}

/** Move a case forward through every automatic step whose conditions are met. Manual steps never fire here. */
export async function advanceCase(ctx: Ctx, caseId: string): Promise<CaseState> {
  for (let i = 0; i < 12; i++) {
    const [c] = await ctx.db.select().from(schema.cases).where(eq(schema.cases.id, caseId)).for('update').limit(1);
    if (!c) throw new Error('case vanished');
    const facts = await caseFacts(ctx, caseId);
    const next = CASE_TRANSITIONS.find((t) => t.from === c.status && !t.manual && canTransitionCase(t.from, t.to, facts).ok);
    if (!next) return c.status;
    await ctx.db.update(schema.cases).set({ status: next.to, updatedAt: new Date() }).where(eq(schema.cases.id, caseId));
    await audit(ctx, 'case.state', 'case', caseId, { status: c.status }, { status: next.to, trigger: next.trigger, automatic: true }, caseId);
  }
  return (await ctx.db.select().from(schema.cases).where(eq(schema.cases.id, caseId)))[0].status;
}

/** Latest, not-superseded row of a versioned table for a case. */
export const notSuperseded = (table: 'diagnostics' | 'diagnoses' | 'prescriptions', alias: string) =>
  sql.raw(`not exists (select 1 from ${table} x where x.supersedes_id = ${alias}.id)`);

export async function latestDiagnostic(ctx: Ctx, caseId: string) {
  const [d] = await ctx.db.select().from(schema.diagnostics)
    .where(and(eq(schema.diagnostics.caseId, caseId), eq(schema.diagnostics.status, 'Validated')))
    .orderBy(desc(schema.diagnostics.version), desc(schema.diagnostics.createdAt)).limit(1);
  return d ?? null;
}
export async function latestScore(ctx: Ctx, caseId: string) {
  const [s] = await ctx.db.select().from(schema.healthScores).where(eq(schema.healthScores.caseId, caseId)).orderBy(desc(schema.healthScores.createdAt)).limit(1);
  return s ?? null;
}
export async function latestDiagnosis(ctx: Ctx, caseId: string) {
  const [d] = await ctx.db.select().from(schema.diagnoses).where(eq(schema.diagnoses.caseId, caseId)).orderBy(desc(schema.diagnoses.version), desc(schema.diagnoses.createdAt)).limit(1);
  return d ?? null;
}
export async function latestPrescription(ctx: Ctx, caseId: string) {
  const [d] = await ctx.db.select().from(schema.prescriptions).where(eq(schema.prescriptions.caseId, caseId)).orderBy(desc(schema.prescriptions.version), desc(schema.prescriptions.createdAt)).limit(1);
  return d ?? null;
}

/** A system context for jobs and scans: no signed-in user, writes still audited and evented. */
export function systemCtx(db: Ctx['db'], label = 'system'): Ctx {
  const afters: (() => void | Promise<void>)[] = [];
  return { user: null, ip: label, requestId: `${label}-${Date.now().toString(36)}`, db, after: (fn) => { afters.push(fn); void afters; } };
}

/** Return a page of rows, or a CSV when the caller asked for one and may export. */
export async function respondList<T extends Record<string, unknown>>(
  ctx: Ctx, resource: Resource, q: ListQuery,
  run: (limit: number, off: number) => Promise<T[]>, count: () => Promise<number>,
  csv: { filename: string; columns: { key: string; label: string }[]; map?: (r: T) => Record<string, unknown> }
) {
  if (q.format === 'csv') {
    allow(ctx, resource, 'export');
    const rows = await run(5000, 0);
    await audit(ctx, 'export.csv', resource, null, undefined, { rows: rows.length, filter: q.q ?? null });
    return csvResponse(csv.filename, toCsv(csv.columns, rows.map((r) => (csv.map ? csv.map(r) : r))));
  }
  const [items, total] = await Promise.all([run(q.pageSize, (q.page - 1) * q.pageSize), count()]);
  return page(items, total, q);
}

export const money = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
export const today = () => new Date().toISOString().slice(0, 10);
