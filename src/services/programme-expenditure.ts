import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, notFound } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { round2 } from '@/domain/logframe';
import { allow, need } from './common';

const E = schema.programmeExpenditures;
const num = (v: unknown) => Number(v);
const isUnique = (e: any) => (e?.code ?? e?.cause?.code) === '23505';

type Input = {
  budgetLineId?: string | null; cohortId?: string | null; payee: string; category: string; purpose?: string | null;
  amountGhs: number; date: string; reference?: string | null;
  evidenceClass?: typeof schema.EVIDENCE_CLASSES[number]; evidenceRef?: string | null;
};

async function validLine(ctx: Ctx, programmeId: string, budgetLineId: string | null | undefined) {
  if (!budgetLineId) return;
  const [line] = await ctx.db.select({ programmeId: schema.programmeBudgetLines.programmeId }).from(schema.programmeBudgetLines).where(eq(schema.programmeBudgetLines.id, budgetLineId)).limit(1);
  if (!line) throw fieldError({ budgetLineId: 'Budget line not found' });
  if (line.programmeId !== programmeId) throw fieldError({ budgetLineId: 'This budget line belongs to a different programme' });
}

/**
 * Approved budget, open commitments (not yet settled or reversed), actual expenditure (payments
 * not reversed) and what remains -- GAP 16 requirement 8 and the gap register's simplified rule:
 * available = approved budget - eligible commitments - actual expenditure not already represented
 * by those commitments. A settled commitment drops out of "committed" the moment its payment is
 * recorded, so nothing is ever double-counted.
 */
export async function overview(ctx: Ctx, programmeId: string) {
  allow(ctx, 'dashboard', 'read');
  const p = await assertProgramme(ctx, programmeId);
  const rows = await ctx.db.select({ type: E.type, status: E.status, amountGhs: E.amountGhs }).from(E).where(eq(E.programmeId, programmeId));
  const committed = round2(rows.filter((r) => r.type === 'COMMITMENT' && r.status === 'ACTIVE').reduce((a, r) => a + num(r.amountGhs), 0));
  const actual = round2(rows.filter((r) => r.type === 'PAYMENT' && r.status !== 'REVERSED').reduce((a, r) => a + num(r.amountGhs), 0));
  const budget = p.budgetGhs === null ? null : Number(p.budgetGhs);
  return { budget, committed, actual, available: budget === null ? null : round2(budget - committed - actual) };
}

export async function listTransactions(ctx: Ctx, programmeId: string) {
  allow(ctx, 'dashboard', 'read');
  await assertProgramme(ctx, programmeId);
  return ctx.db.select().from(E).where(eq(E.programmeId, programmeId)).orderBy(desc(E.date), desc(E.createdAt));
}

async function insert(ctx: Ctx, programmeId: string, type: 'COMMITMENT' | 'PAYMENT', b: Input, extra: Record<string, unknown> = {}) {
  await validLine(ctx, programmeId, b.budgetLineId);
  try {
    const [row] = await ctx.db.insert(E).values({
      programmeId, budgetLineId: b.budgetLineId ?? null, cohortId: b.cohortId ?? null, type,
      payee: b.payee.trim(), category: b.category.trim(), purpose: b.purpose?.trim() || null,
      amountGhs: String(b.amountGhs), date: b.date, reference: b.reference?.trim() || null,
      evidenceClass: b.evidenceClass ?? 'Document-supported', evidenceRef: b.evidenceRef?.trim() || null,
      createdBy: need(ctx).user.id, ...extra,
    }).returning({ id: E.id });
    return row;
  } catch (e) { if (isUnique(e)) throw conflict('This programme already has a transaction recorded under that reference'); throw e; }
}

/** Requirement 4 (record commitments and payments separately): an approved spend not yet paid. */
export async function recordCommitment(ctx: Ctx, programmeId: string, b: Input) {
  allow(ctx, 'programmes', 'edit');
  await assertProgramme(ctx, programmeId);
  const row = await insert(ctx, programmeId, 'COMMITMENT', b);
  await audit(ctx, 'expenditure.committed', 'programme', programmeId, undefined, { payee: b.payee, amountGhs: b.amountGhs });
  return { id: row.id };
}

/**
 * Records money actually paid out. If settlesCommitmentId is given, that commitment must still be
 * ACTIVE and belong to this programme -- the UPDATE...WHERE status='ACTIVE' is the race guard: a
 * second concurrent attempt to settle the same commitment blocks on the row lock and then finds
 * zero rows affected once the first commits, the same way a plain SQL predicate close a
 * check-then-act race without needing an advisory lock (the predicate and the write are one
 * statement here, unlike the budget-line ceiling check).
 */
export async function recordPayment(ctx: Ctx, programmeId: string, b: Input & { settlesCommitmentId?: string | null }) {
  allow(ctx, 'programmes', 'edit');
  await assertProgramme(ctx, programmeId);
  if (b.settlesCommitmentId) {
    const [commitment] = await ctx.db.select({ programmeId: E.programmeId, type: E.type }).from(E).where(eq(E.id, b.settlesCommitmentId)).limit(1);
    if (!commitment || commitment.programmeId !== programmeId || commitment.type !== 'COMMITMENT') throw fieldError({ settlesCommitmentId: 'Commitment not found on this programme' });
    const settled = await ctx.db.update(E).set({ status: 'SETTLED', updatedAt: new Date() }).where(and(eq(E.id, b.settlesCommitmentId), eq(E.status, 'ACTIVE'))).returning({ id: E.id });
    if (!settled.length) throw conflict('That commitment has already been settled or reversed');
  }
  const row = await insert(ctx, programmeId, 'PAYMENT', b, { settlesCommitmentId: b.settlesCommitmentId ?? null });
  await audit(ctx, 'expenditure.paid', 'programme', programmeId, undefined, { payee: b.payee, amountGhs: b.amountGhs, settlesCommitmentId: b.settlesCommitmentId ?? null });
  return { id: row.id };
}

async function loadTransaction(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(E).where(eq(E.id, id)).limit(1);
  if (!row) throw notFound('Transaction not found');
  await assertProgramme(ctx, row.programmeId);
  return row;
}

/**
 * Requirement 4/10: a reversal is a new row, never an edit or delete of the original -- the
 * original keeps its amount, date and evidence exactly as recorded, and is flipped to REVERSED by
 * the same race-free UPDATE...WHERE status='ACTIVE' pattern recordPayment uses.
 */
export async function reverseTransaction(ctx: Ctx, id: string, b: { reason: string }) {
  allow(ctx, 'programmes', 'edit');
  const row = await loadTransaction(ctx, id);
  if (row.type === 'REVERSAL') throw conflict('A reversal cannot itself be reversed; record a new transaction instead');
  const flipped = await ctx.db.update(E).set({ status: 'REVERSED', updatedAt: new Date() }).where(and(eq(E.id, id), eq(E.status, 'ACTIVE'))).returning({ id: E.id });
  if (!flipped.length) throw conflict('This transaction has already been settled or reversed');
  const [reversal] = await ctx.db.insert(E).values({
    programmeId: row.programmeId, budgetLineId: row.budgetLineId, cohortId: row.cohortId, type: 'REVERSAL',
    payee: row.payee, category: row.category, purpose: b.reason.trim(), amountGhs: row.amountGhs, date: new Date().toISOString().slice(0, 10),
    evidenceClass: row.evidenceClass, reversalOfId: row.id, createdBy: need(ctx).user.id,
  }).returning({ id: E.id });
  await audit(ctx, 'expenditure.reversed', 'programme', row.programmeId, { status: row.status }, { reversalId: reversal.id, reason: b.reason });
  return { id: reversal.id };
}
