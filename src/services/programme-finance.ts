import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, notFound } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { budgetPosition, round2 } from '@/domain/logframe';
import { allow, need } from './common';

const L = schema.programmeBudgetLines, T = schema.programmeTranches;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const today = () => new Date().toISOString().slice(0, 10);
const isUnique = (e: any) => (e?.code ?? e?.cause?.code) === '23505';

export async function overview(ctx: Ctx, programmeId: string) {
  allow(ctx, 'dashboard', 'read');
  const p = await assertProgramme(ctx, programmeId);
  const lines = await ctx.db.select().from(L).where(eq(L.programmeId, programmeId)).orderBy(asc(L.createdAt));
  const trs = await ctx.db.select().from(T).where(eq(T.programmeId, programmeId)).orderBy(asc(T.dueDate), asc(T.createdAt));
  const t = today();
  const position = budgetPosition(num(p.budgetGhs), lines.map((l) => Number(l.amountGhs)), trs.map((x) => ({ amount: Number(x.amountGhs), status: x.status, received: num(x.receivedGhs), due: x.dueDate })), t);
  return {
    position,
    lines: lines.map((l) => ({ id: l.id, category: l.category, description: l.description, amountGhs: Number(l.amountGhs), share: position.budget ? Math.round((Number(l.amountGhs) / position.budget) * 1000) / 10 : null })),
    tranches: trs.map((x) => ({ id: x.id, label: x.label, amountGhs: Number(x.amountGhs), dueDate: x.dueDate, status: x.status, receivedOn: x.receivedOn, receivedGhs: num(x.receivedGhs), note: x.note, overdue: x.status === 'Planned' && !!x.dueDate && x.dueDate < t }))
  };
}

async function sumOf(ctx: Ctx, table: 'l' | 't', programmeId: string, exceptId?: string) {
  const tbl = table === 'l' ? L : T;
  const r = await ctx.db.select({ s: sql<string>`coalesce(sum(${tbl.amountGhs}), 0)` }).from(tbl).where(and(eq(tbl.programmeId, programmeId), exceptId ? sql`${tbl.id} <> ${exceptId}` : sql`true`));
  return Number(r[0].s);
}
function ceiling(budget: number | null, others: number, amount: number, what: string) {
  if (budget === null) throw fieldError({ amountGhs: 'Set the programme budget first' });
  if (round2(others + amount) > budget) throw fieldError({ amountGhs: `${what} would exceed the programme budget by GHS ${round2(others + amount - budget).toLocaleString('en-GB')}` });
}

export async function addLine(ctx: Ctx, programmeId: string, b: { category: string; description?: string | null; amountGhs: number }) {
  allow(ctx, 'programmes', 'edit');
  const p = await assertProgramme(ctx, programmeId);
  ceiling(num(p.budgetGhs), await sumOf(ctx, 'l', programmeId), b.amountGhs, 'These budget lines');
  try {
    const [r] = await ctx.db.insert(L).values({ programmeId, category: b.category.trim(), description: b.description?.trim() || null, amountGhs: String(b.amountGhs), createdBy: need(ctx).user.id }).returning({ id: L.id });
    await audit(ctx, 'budget_line.created', 'programme', programmeId, undefined, { category: b.category, amountGhs: b.amountGhs });
    return { id: r.id };
  } catch (e) { if (isUnique(e)) throw conflict('This programme already has a budget line with that category'); throw e; }
}
async function loadLine(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(L).where(eq(L.id, id)).limit(1);
  if (!row) throw notFound('Budget line not found');
  return { row, p: await assertProgramme(ctx, row.programmeId) };
}
export async function updateLine(ctx: Ctx, id: string, b: Partial<{ category: string; description: string | null; amountGhs: number }>) {
  allow(ctx, 'programmes', 'edit');
  const { row, p } = await loadLine(ctx, id);
  if (b.amountGhs !== undefined) ceiling(num(p.budgetGhs), await sumOf(ctx, 'l', row.programmeId, id), b.amountGhs, 'These budget lines');
  try {
    await ctx.db.update(L).set({ ...(b.category ? { category: b.category.trim() } : {}), ...(b.description !== undefined ? { description: b.description?.trim() || null } : {}), ...(b.amountGhs !== undefined ? { amountGhs: String(b.amountGhs) } : {}), updatedAt: new Date() }).where(eq(L.id, id));
  } catch (e) { if (isUnique(e)) throw conflict('This programme already has a budget line with that category'); throw e; }
  await audit(ctx, 'budget_line.updated', 'programme', row.programmeId, { category: row.category, amountGhs: row.amountGhs }, b);
  return { ok: true };
}
export async function removeLine(ctx: Ctx, id: string) {
  allow(ctx, 'programmes', 'edit');
  const { row } = await loadLine(ctx, id);
  await ctx.db.delete(L).where(eq(L.id, id));
  await audit(ctx, 'budget_line.deleted', 'programme', row.programmeId, { category: row.category, amountGhs: row.amountGhs });
  return { ok: true };
}

export async function addTranche(ctx: Ctx, programmeId: string, b: { label: string; amountGhs: number; dueDate?: string | null; note?: string | null }) {
  allow(ctx, 'programmes', 'edit');
  const p = await assertProgramme(ctx, programmeId);
  ceiling(num(p.budgetGhs), await sumOf(ctx, 't', programmeId), b.amountGhs, 'This payment schedule');
  try {
    const [r] = await ctx.db.insert(T).values({ programmeId, label: b.label.trim(), amountGhs: String(b.amountGhs), dueDate: b.dueDate ?? null, note: b.note?.trim() || null, createdBy: need(ctx).user.id }).returning({ id: T.id });
    await audit(ctx, 'tranche.created', 'programme', programmeId, undefined, { label: b.label, amountGhs: b.amountGhs });
    return { id: r.id };
  } catch (e) { if (isUnique(e)) throw conflict('This programme already has a tranche with that label'); throw e; }
}
async function loadTranche(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(T).where(eq(T.id, id)).limit(1);
  if (!row) throw notFound('Tranche not found');
  return { row, p: await assertProgramme(ctx, row.programmeId) };
}
export async function updateTranche(ctx: Ctx, id: string, b: Partial<{ label: string; amountGhs: number; dueDate: string | null; note: string | null }>) {
  allow(ctx, 'programmes', 'edit');
  const { row, p } = await loadTranche(ctx, id);
  if (row.status === 'Received') throw conflict('A tranche that has been received is a record of money in and cannot be edited');
  if (b.amountGhs !== undefined) ceiling(num(p.budgetGhs), await sumOf(ctx, 't', row.programmeId, id), b.amountGhs, 'This payment schedule');
  try {
    await ctx.db.update(T).set({ ...(b.label ? { label: b.label.trim() } : {}), ...(b.amountGhs !== undefined ? { amountGhs: String(b.amountGhs) } : {}), ...(b.dueDate !== undefined ? { dueDate: b.dueDate } : {}), ...(b.note !== undefined ? { note: b.note?.trim() || null } : {}), updatedAt: new Date() }).where(eq(T.id, id));
  } catch (e) { if (isUnique(e)) throw conflict('This programme already has a tranche with that label'); throw e; }
  await audit(ctx, 'tranche.updated', 'programme', row.programmeId, { label: row.label, amountGhs: row.amountGhs }, b);
  return { ok: true };
}
/** Records that money landed. The amount received may differ from the planned amount (bank charges, exchange rate). */
export async function receiveTranche(ctx: Ctx, id: string, b: { receivedOn: string; receivedGhs: number }) {
  allow(ctx, 'programmes', 'edit');
  const { row } = await loadTranche(ctx, id);
  if (row.status === 'Received') throw conflict('This tranche is already recorded as received');
  if (b.receivedOn > today()) throw fieldError({ receivedOn: 'The date received cannot be in the future' });
  await ctx.db.update(T).set({ status: 'Received', receivedOn: b.receivedOn, receivedGhs: String(b.receivedGhs), updatedAt: new Date() }).where(eq(T.id, id));
  await audit(ctx, 'tranche.received', 'programme', row.programmeId, { label: row.label, planned: row.amountGhs }, { receivedOn: b.receivedOn, receivedGhs: b.receivedGhs });
  return { ok: true };
}
export async function removeTranche(ctx: Ctx, id: string) {
  allow(ctx, 'programmes', 'edit');
  const { row } = await loadTranche(ctx, id);
  if (row.status === 'Received') throw conflict('A tranche that has been received is a record of money in and cannot be removed');
  await ctx.db.delete(T).where(eq(T.id, id));
  await audit(ctx, 'tranche.deleted', 'programme', row.programmeId, { label: row.label, amountGhs: row.amountGhs });
  return { ok: true };
}
