import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, notFound } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { checkParent, type Level } from '@/domain/logframe';
import { basisOf, METRICS, progress, valueOf, type Facts, type Metric } from '@/domain/indicators';
import { allow, loadRules, need } from './common';

const t = schema.programmeIndicators;
type Input = { name: string; metric: Metric; target: number; dueDate?: string | null; note?: string | null; level?: Level; parentId?: string | null };

/** Counts and averages for one programme, computed from scores. No personal data. */
export async function programmeFacts(ctx: Ctx, programmeId: string): Promise<Facts> {
  const r = (await ctx.db.execute(sql`
    with latest as (select distinct on (h.case_id) h.case_id, h.overall::float o from health_scores h join cases c on c.id = h.case_id where c.programme_id = ${programmeId} order by h.case_id, h.created_at desc),
    chg as (select h.case_id, (array_agg(h.overall order by h.created_at desc))[1]::float - (array_agg(h.overall order by h.created_at))[1]::float d from health_scores h join cases c on c.id = h.case_id where c.programme_id = ${programmeId} group by h.case_id having count(*) >= 2)
    select (select count(*)::int from cases where programme_id = ${programmeId}) enrolled, (select count(*)::int from latest) scored, (select round(avg(o)::numeric, 1)::float from latest) avg_score,
      (select count(*)::int from chg) rescored, (select round(avg(d)::numeric, 1)::float from chg) avg_change, (select count(*) filter (where d > 0)::int from chg) improved`)).rows[0] as any;
  return { enrolled: r.enrolled, scored: r.scored, rescored: r.rescored, avgScore: r.avg_score, avgChange: r.avg_change, improved: r.improved };
}

/** Indicators with live progress. A funder sees the target always, and the value only when it rests on enough businesses. */
export async function indicatorsWithProgress(ctx: Ctx, programmeId: string, facts?: Facts) {
  const rows = await ctx.db.select().from(t).where(eq(t.programmeId, programmeId)).orderBy(asc(t.createdAt));
  const f = facts ?? await programmeFacts(ctx, programmeId);
  const min = Number((await loadRules(ctx.db))['privacy.min_cell_size']);
  const hide = need(ctx).user.role === 'FUNDER';
  return rows.map((r) => {
    const metric = r.metric as Metric; const target = Number(r.target);
    const hidden = hide && basisOf(metric, f) < min;
    const value = hidden ? null : valueOf(metric, f);
    const p = progress(value, target, r.dueDate, new Date());
    return { id: r.id, name: r.name, metric, metricLabel: METRICS[metric].label, unit: METRICS[metric].unit, target, dueDate: r.dueDate, note: r.note, level: r.level as Level, parentId: r.parentId, value, pct: p.pct, status: hidden ? 'Hidden' : p.status, hidden, minGroupSize: min };
  });
}

export async function listIndicators(ctx: Ctx, programmeId: string) {
  allow(ctx, 'dashboard', 'read');
  await assertProgramme(ctx, programmeId);
  return indicatorsWithProgress(ctx, programmeId);
}
async function validParent(ctx: Ctx, programmeId: string, level: Level, parentId: string | null | undefined, selfId?: string) {
  if (!parentId) { const m = checkParent(level, null, programmeId); if (m) throw fieldError({ level: m }); return; }
  if (parentId === selfId) throw fieldError({ parentId: 'A target cannot sit under itself' });
  const [par] = await ctx.db.select({ level: t.level, programmeId: t.programmeId }).from(t).where(eq(t.id, parentId)).limit(1);
  if (!par) throw fieldError({ parentId: 'Parent not found' });
  const m = checkParent(level, par, programmeId); if (m) throw fieldError({ parentId: m });
}

export async function createIndicator(ctx: Ctx, programmeId: string, b: Input) {
  allow(ctx, 'programmes', 'edit');
  await assertProgramme(ctx, programmeId);
  if (['avg_score', 'pct_improved'].includes(b.metric) && b.target > 100) throw fieldError({ target: 'A target for this measure cannot be above 100' });
  const level = b.level ?? 'output'; await validParent(ctx, programmeId, level, b.parentId);
  try {
    const [row] = await ctx.db.insert(t).values({ programmeId, level, parentId: b.parentId ?? null, name: b.name.trim(), metric: b.metric, target: String(b.target), dueDate: b.dueDate ?? null, note: b.note?.trim() || null, createdBy: need(ctx).user.id }).returning({ id: t.id });
    await audit(ctx, 'indicator.created', 'programme', programmeId, undefined, { name: b.name, metric: b.metric, target: b.target });
    return { id: row.id };
  } catch (e: any) { if (String(e?.code ?? e?.cause?.code) === '23505') throw conflict('This programme already has an indicator with that name'); throw e; }
}
async function load(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!row) throw notFound('Indicator not found');
  await assertProgramme(ctx, row.programmeId);
  return row;
}
export async function updateIndicator(ctx: Ctx, id: string, b: Partial<Input>) {
  allow(ctx, 'programmes', 'edit');
  const row = await load(ctx, id);
  const level = (b.level ?? row.level) as Level; const parentId = b.parentId !== undefined ? b.parentId : row.parentId;
  if (b.level !== undefined || b.parentId !== undefined) {
    await validParent(ctx, row.programmeId, level, parentId, id);
    if (b.level !== undefined && b.level !== row.level) { const kids = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.parentId, id)); if (Number(kids[0].n) > 0) throw conflict('Move or remove the targets beneath this one before changing its level'); }
  }
  const metric = b.metric ?? (row.metric as Metric); const target = b.target ?? Number(row.target);
  if (['avg_score', 'pct_improved'].includes(metric) && target > 100) throw conflict('A target for this measure cannot be above 100');
  await ctx.db.update(t).set({ ...(b.name ? { name: b.name.trim() } : {}), ...(b.metric ? { metric: b.metric } : {}), ...(b.target !== undefined ? { target: String(b.target) } : {}), ...(b.dueDate !== undefined ? { dueDate: b.dueDate } : {}), ...(b.note !== undefined ? { note: b.note?.trim() || null } : {}), ...(b.level !== undefined ? { level: b.level } : {}), ...(b.parentId !== undefined ? { parentId: b.parentId } : {}), updatedAt: new Date() }).where(eq(t.id, id));
  await audit(ctx, 'indicator.updated', 'programme', row.programmeId, { name: row.name, metric: row.metric, target: row.target }, { name: b.name ?? row.name, metric, target });
  return { ok: true };
}
export async function deleteIndicator(ctx: Ctx, id: string) {
  allow(ctx, 'programmes', 'edit');
  const row = await load(ctx, id);
  const kids = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.parentId, id));
  if (Number(kids[0].n) > 0) throw conflict('This target has targets beneath it. Remove or move those first.');
  await ctx.db.delete(t).where(and(eq(t.id, id)));
  await audit(ctx, 'indicator.deleted', 'programme', row.programmeId, { name: row.name }, undefined);
  return { ok: true };
}
