import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, notFound, unprocessable } from '@/lib/errors';
import { assertProgramme, programmeScope } from '@/domain/scope';
import { emitEvent } from '@/domain/events';
import { orderBy, search, countOf, type ListQuery } from '@/api/list';
import { allow, loadRules, need, respondList } from './common';

const p = schema.programmes, ch = schema.cohorts;
const PROG_MOVES: Record<string, string[]> = { Draft: ['Active', 'Cancelled'], Active: ['Completed', 'Cancelled'], Completed: [], Cancelled: [] };
const COHORT_MOVES: Record<string, string[]> = { Draft: ['Open', 'Closed'], Open: ['Closed'], Closed: [] };

const cols = {
  id: p.id, code: p.code, name: p.name, funder: p.funder, startDate: p.startDate, endDate: p.endDate, budgetGhs: p.budgetGhs, status: p.status, createdAt: p.createdAt,
  cohortCount: sql<number>`(select count(*)::int from cohorts x where x.programme_id = ${p.id})`,
  caseCount: sql<number>`(select count(*)::int from cases x where x.programme_id = ${p.id})`
};

/** Funders never see a count below the privacy threshold, so small groups cannot be picked out. */
async function hideSmall<T extends Record<string, any>>(ctx: Ctx, rows: T[], keys: string[]): Promise<T[]> {
  if (need(ctx).user.role !== 'FUNDER') return rows;
  const min = Number((await loadRules(ctx.db))['privacy.min_cell_size']);
  return rows.map((r) => { const o: any = { ...r }; for (const k of keys) if (Number(o[k]) < min) o[k] = null; return o; });
}

export async function listProgrammes(ctx: Ctx, q: ListQuery & { status?: string }) {
  allow(ctx, 'programmes', 'read');
  const where = and(programmeScope(need(ctx).user), search(q.q, [p.name, p.code, p.funder]), q.status ? eq(p.status, q.status) : undefined);
  return respondList(ctx, 'programmes', q,
    async (limit, off) => hideSmall(ctx, await ctx.db.select(cols).from(p).where(where).orderBy(orderBy(q, { name: p.name, code: p.code, start: p.startDate, status: p.status }, p.createdAt)).limit(limit).offset(off), ['caseCount']),
    async () => Number((await ctx.db.select({ n: countOf }).from(p).where(where))[0].n),
    { filename: 'programmes.csv', columns: [['code', 'Code'], ['name', 'Name'], ['funder', 'Funder'], ['startDate', 'Start'], ['endDate', 'End'], ['budgetGhs', 'Budget GHS'], ['status', 'Status'], ['caseCount', 'Cases']].map(([key, label]) => ({ key, label })) });
}

export async function getProgramme(ctx: Ctx, id: string) {
  allow(ctx, 'programmes', 'read');
  await assertProgramme(ctx, id);
  const [row] = await ctx.db.select(cols).from(p).where(eq(p.id, id)).limit(1);
  const cohorts = await ctx.db.select({ id: ch.id, code: ch.code, name: ch.name, startDate: ch.startDate, endDate: ch.endDate, capacity: ch.capacity, status: ch.status,
    enrolled: sql<number>`(select count(*)::int from cases x where x.cohort_id = ${ch.id})` }).from(ch).where(eq(ch.programmeId, id)).orderBy(ch.createdAt);
  const [r] = await hideSmall(ctx, [row], ['caseCount']);
  return { ...r, cohorts: await hideSmall(ctx, cohorts, ['enrolled']) };
}

type ProgInput = { name: string; funder?: string | null; startDate?: string | null; endDate?: string | null; budgetGhs?: number | null };
const datesOk = (s?: string | null, e?: string | null) => { if (s && e && e < s) throw fieldError({ endDate: 'End date must be after the start date' }); };

export async function createProgramme(ctx: Ctx, b: ProgInput) {
  allow(ctx, 'programmes', 'create');
  datesOk(b.startDate, b.endDate);
  const [row] = await ctx.db.insert(p).values({ name: b.name.trim(), funder: b.funder ?? null, startDate: b.startDate ?? null, endDate: b.endDate ?? null, budgetGhs: b.budgetGhs?.toFixed(2) ?? null }).returning({ id: p.id, code: p.code });
  await audit(ctx, 'programme.created', 'programme', row.id, undefined, b);
  return row;
}
export async function updateProgramme(ctx: Ctx, id: string, b: Partial<ProgInput> & { status?: string }) {
  allow(ctx, 'programmes', 'edit');
  const before = await assertProgramme(ctx, id);
  datesOk(b.startDate ?? before.startDate, b.endDate ?? before.endDate);
  if (b.status && b.status !== before.status && !PROG_MOVES[before.status]?.includes(b.status)) throw unprocessable(`A ${before.status} programme cannot become ${b.status}`);
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) if (v !== undefined) patch[k] = k === 'budgetGhs' && v !== null ? Number(v).toFixed(2) : v;
  await ctx.db.update(p).set({ ...patch, updatedAt: new Date() }).where(eq(p.id, id));
  await audit(ctx, 'programme.updated', 'programme', id, before, patch);
  if (b.status === 'Completed' && before.status !== 'Completed') await emitEvent(ctx, 'ProgrammeCompleted', { payload: { programme: before.code } });
  return { ok: true };
}

export async function createCohort(ctx: Ctx, programmeId: string, b: { name: string; startDate?: string | null; endDate?: string | null; capacity: number }) {
  allow(ctx, 'cohorts', 'create');
  const prog = await assertProgramme(ctx, programmeId);
  if (['Completed', 'Cancelled'].includes(prog.status)) throw unprocessable('This programme is closed');
  datesOk(b.startDate, b.endDate);
  const [row] = await ctx.db.insert(ch).values({ programmeId, name: b.name.trim(), startDate: b.startDate ?? null, endDate: b.endDate ?? null, capacity: b.capacity }).returning({ id: ch.id, code: ch.code });
  await audit(ctx, 'cohort.created', 'cohort', row.id, undefined, b);
  return row;
}
export async function updateCohort(ctx: Ctx, id: string, b: { name?: string; startDate?: string | null; endDate?: string | null; capacity?: number; status?: string }) {
  allow(ctx, 'cohorts', 'edit');
  const [before] = await ctx.db.select().from(ch).where(eq(ch.id, id)).limit(1);
  if (!before) throw notFound('Cohort not found');
  await assertProgramme(ctx, before.programmeId);
  datesOk(b.startDate ?? before.startDate, b.endDate ?? before.endDate);
  if (b.status && b.status !== before.status && !COHORT_MOVES[before.status]?.includes(b.status)) throw unprocessable(`A ${before.status} cohort cannot become ${b.status}`);
  if (b.capacity !== undefined) {
    const n = Number((await ctx.db.select({ n: countOf }).from(schema.cases).where(eq(schema.cases.cohortId, id)))[0].n);
    if (b.capacity < n) throw conflict(`${n} businesses are already enrolled, so capacity cannot go below ${n}`);
  }
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) if (v !== undefined) patch[k] = v;
  await ctx.db.update(ch).set({ ...patch, updatedAt: new Date() }).where(eq(ch.id, id));
  await audit(ctx, 'cohort.updated', 'cohort', id, before, patch);
  return { ok: true };
}
