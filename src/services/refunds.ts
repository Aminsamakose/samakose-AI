/**
 * Refunds and Chargebacks (Master Directive §45, rollout step 6). Replaces the implicit
 * `payment.status = refunded` flip with first-class, approvable records, each posting a ledger
 * entry on processing. Built against the ledger (step 2) and revenue share/payouts (step 4)
 * proven in earlier rollout steps, and against the generalized Approval Matrix/four-eyes service
 * (step 5) for large refunds and payout clawbacks.
 *
 * Scoping note on the refund/payout clawback link: a refund on an invoice whose revenue share has
 * already been calculated and PAID triggers a payout_adjustments CLAWBACK row referencing the
 * refund, routed through the Approval Matrix exactly like a large payout - never netted
 * automatically, because clawing back money from a professional needs a human in the loop. The
 * clawback amount is the refund's own proportional share of that payout: amountGhs * (refund /
 * invoice amount). This is the simplest defensible split consistent with the design doc, which
 * does not fully specify clawback apportionment across multiple payouts on the same invoice;
 * revisit if a cleaner signal is added later.
 *
 * refunds.ledgerEntryId and payoutAdjustments.ledgerEntryId were originally typed `uuid` in
 * migration 0051, which could never actually reference financial_ledger_entries.id (a bigserial).
 * Migration 0052 fixed the column type to bigint; this service now records the id of the ledger
 * entry each refund/clawback posted.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, need } from './common';
import { conflict, fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { postLedgerEntries } from './ledger';
import { createApprovalRequest, requiredApproverRole } from './approvals';

const rf = schema.refunds, cb = schema.chargebacks, pay = schema.payments, inv = schema.invoices;
const rsc = schema.revenueShareCalculations, pyo = schema.professionalPayouts, pa = schema.payoutAdjustments;
const dec = (n: number) => n.toFixed(2);

export const REFUND_STATUSES = ['Requested', 'Approved', 'Processed', 'Rejected'] as const;

/* --------------------------------- refunds --------------------------------- */

export async function listRefunds(ctx: Ctx, filters: { status?: string; invoiceId?: string } = {}) {
  allow(ctx, 'refunds', 'read');
  const rows = await ctx.db.select().from(rf);
  return rows.filter((r) => (!filters.status || r.status === filters.status) && (!filters.invoiceId || r.invoiceId === filters.invoiceId));
}

export async function requestRefund(ctx: Ctx, b: { paymentId: string; amountGhs: number; reason: string }) {
  allow(ctx, 'refunds', 'create');
  const u = need(ctx).user;
  if (!(b.amountGhs > 0)) throw fieldError({ amountGhs: 'Must be a positive amount' });
  if (!b.reason.trim()) throw fieldError({ reason: 'Required' });
  const [p] = await ctx.db.select().from(pay).where(eq(pay.id, b.paymentId)).limit(1);
  if (!p) throw notFound('Payment not found');
  if (p.status !== 'Succeeded') throw unprocessable('Only a succeeded payment can be refunded');
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, p.invoiceId)).limit(1);
  if (!i) throw notFound('Invoice not found');
  if (b.amountGhs > Number(p.amountGhs) + 0.005) throw fieldError({ amountGhs: `Cannot exceed the payment amount of GHS ${p.amountGhs}` });
  const [row] = await ctx.db.insert(rf).values({ paymentId: p.id, invoiceId: i.id, amountGhs: dec(b.amountGhs), reason: b.reason.trim(), status: 'Requested', requestedBy: u.id }).returning();
  await audit(ctx, 'refund.requested', 'refunds', row.id, undefined, row);
  // Open a matching approval request so the Approval Matrix threshold (refund as % of invoice) is
  // visible and routed before anyone can approve this refund - decideApproval() on /approvals is
  // informational here; approveRefund() below does its own four-eyes/threshold check so a refund
  // can never be approved just because its approval_requests row was decided by someone else.
  const pctOfInvoice = Number(i.amountGhs) > 0 ? (b.amountGhs / Number(i.amountGhs)) * 100 : 100;
  await createApprovalRequest(ctx, { actionType: 'REFUND', referenceId: row.id, amountGhs: b.amountGhs, metric: pctOfInvoice });
  return row;
}

/**
 * Four-eyes (approver != requester, backstopped at the DB layer by refund_approver_not_requester_ck)
 * plus the Approval Matrix: a refund above the configured percentage-of-invoice threshold needs the
 * matching tier (Senior/FINANCE, or Executive for an exceptional refund), not just any staff member.
 */
export async function approveRefund(ctx: Ctx, refundId: string) {
  allow(ctx, 'refunds', 'approve');
  const u = need(ctx).user;
  const [r] = await ctx.db.select().from(rf).where(eq(rf.id, refundId)).limit(1);
  if (!r) throw notFound('Refund not found');
  if (r.status !== 'Requested') throw unprocessable(`A ${r.status.toLowerCase()} refund cannot be approved`);
  if (r.requestedBy && r.requestedBy === u.id) throw forbidden('The person who requested a refund cannot approve it');
  const [i] = await ctx.db.select({ amountGhs: inv.amountGhs }).from(inv).where(eq(inv.id, r.invoiceId)).limit(1);
  const pctOfInvoice = i && Number(i.amountGhs) > 0 ? (Number(r.amountGhs) / Number(i.amountGhs)) * 100 : 100;
  const requiredRole = await requiredApproverRole(ctx, 'REFUND', pctOfInvoice);
  if (requiredRole !== 'Standard' && u.role !== requiredRole && u.role !== 'ADMIN') throw forbidden(`This refund requires ${requiredRole} approval`);
  const [updated] = await ctx.db.update(rf).set({ status: 'Approved', approvedBy: u.id }).where(eq(rf.id, refundId)).returning();
  await audit(ctx, 'refund.approved', 'refunds', refundId, r, updated);
  return updated;
}

export async function rejectRefund(ctx: Ctx, refundId: string, reason?: string) {
  allow(ctx, 'refunds', 'approve');
  const u = need(ctx).user;
  const [r] = await ctx.db.select().from(rf).where(eq(rf.id, refundId)).limit(1);
  if (!r) throw notFound('Refund not found');
  if (r.status !== 'Requested') throw unprocessable(`A ${r.status.toLowerCase()} refund cannot be rejected`);
  if (r.requestedBy && r.requestedBy === u.id) throw forbidden('The person who requested a refund cannot decide it');
  const [updated] = await ctx.db.update(rf).set({ status: 'Rejected', approvedBy: u.id }).where(eq(rf.id, refundId)).returning();
  await audit(ctx, 'refund.rejected', 'refunds', refundId, r, { ...updated, reason: reason ?? null });
  return updated;
}

/**
 * Posts the refund's ledger entry (debit Samakose Revenue, credit Cash/Paystack Clearing) and, if
 * this invoice's revenue share was already calculated and at least one payout on it has already
 * reached Paid or Reconciled, opens a payout_adjustments CLAWBACK row + approval request per
 * affected payout rather than silently reversing money already sent to a professional.
 */
export async function processRefund(ctx: Ctx, refundId: string) {
  allow(ctx, 'refunds', 'approve');
  const [r] = await ctx.db.select().from(rf).where(eq(rf.id, refundId)).limit(1);
  if (!r) throw notFound('Refund not found');
  if (r.status !== 'Approved') throw unprocessable('Only an approved refund can be processed');
  const [p] = await ctx.db.select().from(pay).where(eq(pay.id, r.paymentId)).limit(1);
  if (!p) throw notFound('Payment not found');
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, r.invoiceId)).limit(1);
  const posted = await postLedgerEntries(ctx, {
    referenceType: 'REFUND', referenceId: r.id, description: `Refund ${r.code} on invoice ${i?.code ?? r.invoiceId}`,
    lines: [{ accountCode: 'REVENUE', debitGhs: Number(r.amountGhs) }, { accountCode: p.provider === 'manual' ? 'CASH' : 'PAYSTACK_CLEARING', creditGhs: Number(r.amountGhs) }]
  });
  const [updated] = await ctx.db.update(rf).set({ status: 'Processed', processedAt: new Date(), ledgerEntryId: posted[0]?.id ?? null }).where(eq(rf.id, refundId)).returning();
  await audit(ctx, 'refund.processed', 'refunds', refundId, r, updated);

  const clawbacks = await clawBackPaidPayouts(ctx, r);
  return { refund: updated, clawbacks };
}

async function clawBackPaidPayouts(ctx: Ctx, refund: typeof rf.$inferSelect) {
  const u = need(ctx).user;
  const [i] = await ctx.db.select({ amountGhs: inv.amountGhs }).from(inv).where(eq(inv.id, refund.invoiceId)).limit(1);
  if (!i || !(Number(i.amountGhs) > 0)) return [];
  const calcs = await ctx.db.select({ id: rsc.id }).from(rsc).where(eq(rsc.invoiceId, refund.invoiceId));
  if (!calcs.length) return [];
  const paidPayouts = await ctx.db.select().from(pyo).where(and(inArray(pyo.calculationId, calcs.map((c) => c.id)), inArray(pyo.status, ['Paid', 'Reconciled'])));
  const refundFraction = Number(refund.amountGhs) / Number(i.amountGhs);
  const created: (typeof pa.$inferSelect)[] = [];
  for (const payout of paidPayouts) {
    const clawbackAmount = Math.round(Number(payout.amountGhs) * refundFraction * 100) / 100;
    if (clawbackAmount <= 0) continue;
    const [adj] = await ctx.db.insert(pa).values({ payoutId: payout.id, type: 'REFUND_CLAWBACK', amountGhs: dec(clawbackAmount), reason: `Refund ${refund.code} on the underlying invoice`, createdBy: u.id }).returning();
    await audit(ctx, 'payout_adjustment.clawback_opened', 'payout_adjustments', adj.id, undefined, adj);
    await createApprovalRequest(ctx, { actionType: 'PAYOUT', referenceId: adj.id, amountGhs: clawbackAmount });
    created.push(adj);
  }
  return created;
}

/**
 * A human approver (never the person who opened the clawback) signs off, which posts the reversing
 * ledger entry (debit Professional Payable, credit Samakose Revenue - reinstating the revenue the
 * original revenue-share calculation moved out, since the professional's payable is reduced by the
 * clawback) and records approvedBy on the adjustment. Does not move cash back from the professional;
 * that recovery mechanism (netting against a future payout, or an invoice to the professional) is
 * explicitly out of scope for this MVP, matching the design doc's own refusal to over-specify it.
 */
export async function approveClawback(ctx: Ctx, adjustmentId: string) {
  allow(ctx, 'payouts', 'approve');
  const u = need(ctx).user;
  const [adj] = await ctx.db.select().from(pa).where(eq(pa.id, adjustmentId)).limit(1);
  if (!adj) throw notFound('Payout adjustment not found');
  if (adj.type !== 'REFUND_CLAWBACK') throw unprocessable('Only a refund clawback is approved through this endpoint');
  if (adj.approvedBy) throw conflict('This clawback has already been approved');
  if (adj.createdBy && adj.createdBy === u.id) throw forbidden('The person who opened a clawback cannot approve it');
  const [payout] = await ctx.db.select({ professionalId: pyo.professionalId }).from(pyo).where(eq(pyo.id, adj.payoutId)).limit(1);
  if (payout?.professionalId === u.id) throw forbidden('A professional cannot approve their own clawback');
  const posted = await postLedgerEntries(ctx, {
    referenceType: 'ADJUSTMENT', referenceId: adj.id, description: `Payout clawback: ${adj.reason}`,
    lines: [{ accountCode: 'PROFESSIONAL_PAYABLE', debitGhs: Number(adj.amountGhs) }, { accountCode: 'REVENUE', creditGhs: Number(adj.amountGhs) }]
  });
  const [updated] = await ctx.db.update(pa).set({ approvedBy: u.id, ledgerEntryId: posted[0]?.id ?? null }).where(eq(pa.id, adjustmentId)).returning();
  await audit(ctx, 'payout_adjustment.clawback_approved', 'payout_adjustments', adjustmentId, adj, updated);
  return updated;
}

/* ------------------------------- chargebacks -------------------------------- */

export async function listChargebacks(ctx: Ctx, filters: { status?: string } = {}) {
  allow(ctx, 'refunds', 'read');
  const rows = await ctx.db.select().from(cb);
  return rows.filter((r) => !filters.status || r.status === filters.status);
}

/**
 * Records a chargeback notification from the payment provider and posts its ledger entry immediately
 * on receipt (debit Samakose Revenue, credit Cash/Paystack Clearing) - unlike a refund, a chargeback
 * is money the provider has already pulled back, not something Samakose decides to grant, so there
 * is no separate Approved step before the money moves. Staff resolve the dispute afterwards via
 * resolveChargeback().
 */
export async function recordChargeback(ctx: Ctx, b: { paymentId: string; amountGhs: number; provider: string; providerReference?: string }) {
  allow(ctx, 'refunds', 'create');
  if (!(b.amountGhs > 0)) throw fieldError({ amountGhs: 'Must be a positive amount' });
  const [p] = await ctx.db.select().from(pay).where(eq(pay.id, b.paymentId)).limit(1);
  if (!p) throw notFound('Payment not found');
  const [row] = await ctx.db.insert(cb).values({ paymentId: p.id, amountGhs: dec(b.amountGhs), provider: b.provider, providerReference: b.providerReference ?? null, status: 'Received' }).returning();
  await postLedgerEntries(ctx, {
    referenceType: 'ADJUSTMENT', referenceId: row.id, description: `Chargeback ${b.providerReference ?? row.id} on payment ${p.reference}`,
    lines: [{ accountCode: 'REVENUE', debitGhs: b.amountGhs }, { accountCode: p.provider === 'manual' ? 'CASH' : 'PAYSTACK_CLEARING', creditGhs: b.amountGhs }]
  });
  await audit(ctx, 'chargeback.received', 'chargebacks', row.id, undefined, row);
  return row;
}

/**
 * Closes out a chargeback once the dispute is settled. 'Won' means the funds were recovered from the
 * provider and posts a reversing entry putting the revenue and cash back; 'Lost' leaves the original
 * posting as the final word (Samakose absorbs it) and only records the outcome.
 */
export async function resolveChargeback(ctx: Ctx, chargebackId: string, outcome: 'Won' | 'Lost') {
  allow(ctx, 'refunds', 'approve');
  const [row] = await ctx.db.select().from(cb).where(eq(cb.id, chargebackId)).limit(1);
  if (!row) throw notFound('Chargeback not found');
  if (row.status !== 'Received') throw unprocessable(`A ${row.status.toLowerCase()} chargeback cannot be resolved again`);
  const [p] = await ctx.db.select().from(pay).where(eq(pay.id, row.paymentId)).limit(1);
  if (outcome === 'Won' && p) {
    await postLedgerEntries(ctx, {
      referenceType: 'ADJUSTMENT', referenceId: row.id, description: `Chargeback ${row.id} won - funds recovered`,
      lines: [{ accountCode: p.provider === 'manual' ? 'CASH' : 'PAYSTACK_CLEARING', debitGhs: Number(row.amountGhs) }, { accountCode: 'REVENUE', creditGhs: Number(row.amountGhs) }]
    });
  }
  const [updated] = await ctx.db.update(cb).set({ status: outcome === 'Won' ? 'Recovered' : 'Lost', resolvedAt: new Date() }).where(eq(cb.id, chargebackId)).returning();
  await audit(ctx, 'chargeback.resolved', 'chargebacks', chargebackId, row, updated);
  return updated;
}
