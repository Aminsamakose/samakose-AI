/**
 * Evidence-based payout reconciliation (10/10 Blueprint §6; Developer Spec §6.2).
 *
 * A payout cannot become Reconciled just by a status edit. This service is the only writer of
 * `professional_payouts.status = 'Reconciled'`: it requires a separately-recorded external
 * transaction (evidence received from a payment provider, bank statement or authorised import,
 * never created from the payout side) and compares it against the payout before deciding an
 * outcome. Every decision, matched or not, is kept as an append-only `payout_reconciliations` row
 * naming who decided it and why - a "Reconciled" payout is always traceable to the evidence that
 * justified it.
 */
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, need } from './common';
import { conflict, fieldError, notFound, unprocessable } from '@/lib/errors';

const pyo = schema.professionalPayouts, pet = schema.payoutExternalTransactions, prec = schema.payoutReconciliations;
const dec = (n: number) => n.toFixed(2);
const CENT = 0.01;

/**
 * Record one piece of external evidence. Never created by, or on behalf of, the payout itself -
 * this is deliberately the only way a transaction enters the system, mirroring where real evidence
 * actually comes from (a provider webhook/export, a bank statement import, or a finance officer
 * keying in a statement line).
 */
export async function recordExternalTransaction(ctx: Ctx, b: {
  provider: string; providerReference: string; amountGhs: number; currency?: string; transactionDate: string;
  feeGhs?: number; settlementStatus?: string; payeeUserId?: string | null; rawPayload?: unknown;
}) {
  allow(ctx, 'reconciliation', 'create');
  const u = need(ctx).user;
  if (!b.provider.trim()) throw fieldError({ provider: 'Required' });
  if (!b.providerReference.trim()) throw fieldError({ providerReference: 'Required' });
  if (!(b.amountGhs > 0)) throw fieldError({ amountGhs: 'Must be a positive amount' });
  const status = b.settlementStatus ?? 'Settled';
  if (!schema.EXTERNAL_TRANSACTION_SETTLEMENT_STATUSES.includes(status as any)) throw fieldError({ settlementStatus: 'Invalid settlement status' });
  const dupe = await ctx.db.select({ id: pet.id }).from(pet).where(and(eq(pet.provider, b.provider), eq(pet.providerReference, b.providerReference))).limit(1);
  if (dupe.length) throw conflict('This provider transaction has already been imported');
  const [row] = await ctx.db.insert(pet).values({
    provider: b.provider, providerReference: b.providerReference, amountGhs: dec(b.amountGhs), currency: b.currency ?? 'GHS',
    transactionDate: b.transactionDate, feeGhs: dec(b.feeGhs ?? 0), settlementStatus: status,
    payeeUserId: b.payeeUserId ?? null, rawPayload: b.rawPayload ?? null, importedBy: u.id
  }).returning();
  await audit(ctx, 'external_transaction.recorded', 'payout_external_transaction', row.id, undefined, { provider: b.provider, providerReference: b.providerReference, amountGhs: dec(b.amountGhs) });
  return row;
}

export async function listExternalTransactions(ctx: Ctx, filters: { unmatched?: boolean } = {}) {
  allow(ctx, 'reconciliation', 'read');
  const rows = await ctx.db.select().from(pet).orderBy(desc(pet.transactionDate));
  if (!filters.unmatched) return rows;
  const matched = await ctx.db.select({ id: prec.externalTransactionId }).from(prec).where(eq(prec.outcome, 'Matched'));
  const matchedIds = new Set(matched.map((m) => m.id).filter(Boolean));
  return rows.filter((r) => !matchedIds.has(r.id));
}

export async function listPayoutReconciliations(ctx: Ctx, payoutId: string) {
  allow(ctx, 'reconciliation', 'read');
  return ctx.db.select().from(prec).where(eq(prec.payoutId, payoutId)).orderBy(desc(prec.createdAt));
}

/** The exception queue (10/10 Blueprint §6): every decision that is not a clean Matched outcome. */
export async function listReconciliationExceptions(ctx: Ctx) {
  allow(ctx, 'reconciliation', 'read');
  const rows = await ctx.db.select().from(prec).orderBy(desc(prec.createdAt));
  return rows.filter((r) => r.outcome !== 'Matched');
}

/**
 * Compare a payout against one piece of external evidence and decide the outcome. Only a `Matched`
 * (or `Partially matched`, once the shortfall is itself resolved some other way - left to a human,
 * not auto-escalated here) outcome moves the payout to Reconciled. Everything else is recorded and
 * left for a human to investigate; the payout stays exactly where it was.
 */
export async function matchPayout(ctx: Ctx, payoutId: string, externalTransactionId: string, note?: string) {
  allow(ctx, 'reconciliation', 'edit');
  const u = need(ctx).user;
  const [p] = await ctx.db.select().from(pyo).where(eq(pyo.id, payoutId)).limit(1);
  if (!p) throw notFound('Payout not found');
  if (p.status !== 'Paid') throw unprocessable(`A ${p.status} payout cannot be reconciled. It must be Paid first, and a payout already Reconciled is never re-matched`);
  const [tx] = await ctx.db.select().from(pet).where(eq(pet.id, externalTransactionId)).limit(1);
  if (!tx) throw notFound('External transaction not found');

  // Matched against what markPaid() actually disbursed. On main today that is the gross amountGhs;
  // once #207 (netAmountGhs after withholding) merges, this should read netAmountGhs instead - left
  // as a one-line follow-up for whichever of #207 or this PR merges second.
  const expected = Number(p.amountGhs);
  const actual = Number(tx.amountGhs);
  const discrepancy = Math.round((actual - expected) * 100) / 100;

  // A beneficiary is only checked when the evidence actually names one - absence is not itself a mismatch,
  // but a *named and wrong* beneficiary always is, regardless of amount.
  const beneficiaryMismatch = tx.payeeUserId != null && tx.payeeUserId !== p.professionalId;

  // An external transaction already carrying a Matched reconciliation can never be matched again -
  // that is a duplicate on the evidence side, not a new legitimate payment.
  const existingMatch = await ctx.db.select({ id: prec.id }).from(prec).where(and(eq(prec.externalTransactionId, externalTransactionId), eq(prec.outcome, 'Matched'))).limit(1);

  let outcome: typeof schema.PAYOUT_RECONCILIATION_OUTCOMES[number];
  if (existingMatch.length) outcome = 'Duplicate';
  else if (tx.settlementStatus === 'Reversed') outcome = 'Reversed';
  else if (beneficiaryMismatch) outcome = 'Amount mismatch'; // wrong party is treated as a mismatch exception, never auto-matched
  else if (Math.abs(discrepancy) <= CENT) outcome = 'Matched';
  else if (discrepancy < 0) outcome = 'Partially matched'; // less arrived than expected
  else outcome = 'Amount mismatch'; // more arrived than expected - also needs investigation, never silently accepted

  const [row] = await ctx.db.insert(prec).values({
    payoutId, externalTransactionId, outcome,
    expectedAmountGhs: dec(expected),
    matchedAmountGhs: outcome === 'Duplicate' ? null : dec(actual),
    discrepancyGhs: outcome === 'Duplicate' ? null : dec(discrepancy),
    note: note ?? (beneficiaryMismatch ? 'Evidence names a different beneficiary than the payout professional' : null),
    decidedBy: u.id
  }).returning();

  if (outcome === 'Matched') {
    await ctx.db.update(pyo).set({ status: 'Reconciled', reconciledAt: new Date(), updatedAt: new Date() }).where(eq(pyo.id, payoutId));
    await audit(ctx, 'payout.reconciled', 'professional_payout', payoutId, { status: 'Paid' }, { status: 'Reconciled', externalTransactionId, reconciliationId: row.id });
  } else {
    await audit(ctx, 'payout.reconciliation_exception', 'professional_payout', payoutId, { status: p.status }, { status: p.status, outcome, externalTransactionId, reconciliationId: row.id });
  }
  return row;
}
