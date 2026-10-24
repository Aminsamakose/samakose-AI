/**
 * Revenue share agreements and professional payouts (Master Directive §31-35, §47-50). Rollout step 4,
 * built against the ledger proven in step 2 (postLedgerEntries). New contracts can carry an agreement;
 * existing contracts stay on the current no-split behaviour until one is explicitly proposed for them -
 * there is no blanket retroactive assignment of a revenue-share rule to historical work.
 *
 * Scoping note on the "financial activation" trigger (Directive §34: "whichever comes later of the invoice
 * reaching Paid and the assignment's deliverables being marked complete"): this codebase has no separate
 * deliverables-complete flag on case_assignments, so "deliverables complete" is read here as the assignment
 * itself having ended via assignments.ts completeForCase() (status 'Completed' with endedAt set) - the closest existing signal. If a cleaner signal
 * is added later, only calculateRevenueShare()'s precondition check needs to change.
 *
 * Scoping note on allocations: percentOfShare on revenue_share_allocations splits the agreement's
 * professionalAmountGhs (not the full basis amount) across the delivery team. A SAMAKOSE allocation row
 * represents Samakose's own internal cut taken from that pool and intentionally gets no payout row - only
 * allocations with a professionalId are "paid allocatees" (Directive §35) and receive one.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, need } from './common';
import { conflict, fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { postLedgerEntries } from './ledger';
import { isPayoutEligible } from './tax-profiles';

const rsa = schema.revenueShareAgreements, rsal = schema.revenueShareAllocations, rsc = schema.revenueShareCalculations;
const rsx = schema.revenueShareAgreementConflicts;
const pyo = schema.professionalPayouts, ph = schema.payoutHolds, pa = schema.payoutAdjustments;
const con = schema.contracts, asn = schema.caseAssignments, inv = schema.invoices, pay = schema.payments, pred = schema.promoRedemptions, usr = schema.users;
const dec = (n: number) => n.toFixed(2);

export const AGREEMENT_STATUSES = ['Draft', 'Pending approval', 'Approved', 'Active', 'Suspended', 'Expired', 'Cancelled'] as const;
export const REVENUE_SHARE_MODELS = ['PERCENTAGE', 'FIXED', 'TIERED', 'HYBRID'] as const;
export const REVENUE_SHARE_BASES = ['SHARE_ON_LIST_PRICE', 'SHARE_ON_NET_PRICE', 'SHARE_ON_COLLECTED_AMOUNT'] as const;
export const ALLOCATEE_ROLES = ['SAMAKOSE', 'LEAD', 'SPECIALIST', 'COACH', 'REVIEWER'] as const;

/* --------------------------------- agreements --------------------------------- */
export async function proposeAgreement(ctx: Ctx, b: { contractId: string; assignmentId: string; professionalId: string; model: string; basis: string; percentage?: number | null; fixedAmountGhs?: number | null; tierRules?: { upToGhs: number | null; percentage: number }[] | null; effectiveFrom?: string | null; effectiveTo?: string | null }) {
  allow(ctx, 'revenue_share', 'create');
  const u = need(ctx).user;
  if (!REVENUE_SHARE_MODELS.includes(b.model as any)) throw fieldError({ model: 'Must be PERCENTAGE, FIXED, TIERED or HYBRID' });
  if (!REVENUE_SHARE_BASES.includes(b.basis as any)) throw fieldError({ basis: 'Must be a valid revenue-share basis' });
  if ((b.model === 'PERCENTAGE' || b.model === 'HYBRID') && !(Number(b.percentage) > 0 && Number(b.percentage) <= 100)) throw fieldError({ percentage: 'Must be between 0 and 100' });
  if ((b.model === 'FIXED' || b.model === 'HYBRID') && !(Number(b.fixedAmountGhs) > 0)) throw fieldError({ fixedAmountGhs: 'Must be a positive amount' });
  if (b.model === 'TIERED') {
    if (!b.tierRules?.length) throw fieldError({ tierRules: 'At least one tier is required' });
    let prev = -1;
    for (const t of b.tierRules) {
      if (t.upToGhs !== null && t.upToGhs <= prev) throw fieldError({ tierRules: 'Tiers must be in ascending order of upToGhs' });
      if (!(t.percentage > 0 && t.percentage <= 100)) throw fieldError({ tierRules: 'Each tier percentage must be between 0 and 100' });
      prev = t.upToGhs ?? Infinity;
    }
  }
  const [c] = await ctx.db.select().from(con).where(eq(con.id, b.contractId)).limit(1);
  if (!c) throw fieldError({ contractId: 'Contract not found' });
  const [a] = await ctx.db.select().from(asn).where(eq(asn.id, b.assignmentId)).limit(1);
  if (!a) throw fieldError({ assignmentId: 'Assignment not found' });
  const [p] = await ctx.db.select({ id: usr.id }).from(usr).where(eq(usr.id, b.professionalId)).limit(1);
  if (!p) throw fieldError({ professionalId: 'Professional not found' });
  const [row] = await ctx.db.insert(rsa).values({
    contractId: b.contractId, assignmentId: b.assignmentId, professionalId: b.professionalId, model: b.model, basis: b.basis,
    percentage: b.percentage != null ? dec(b.percentage) : null, fixedAmountGhs: b.fixedAmountGhs != null ? dec(b.fixedAmountGhs) : null,
    tierRules: b.tierRules ?? null, status: 'Draft', proposedBy: u.id,
    effectiveFrom: b.effectiveFrom ?? null, effectiveTo: b.effectiveTo ?? null
  }).returning();
  await audit(ctx, 'revenue_share_agreement.proposed', 'revenue_share_agreement', row.id, undefined, b);
  return row;
}

export async function listAgreements(ctx: Ctx, filters: { status?: string; professionalId?: string } = {}) {
  allow(ctx, 'revenue_share', 'read');
  const u = need(ctx).user;
  const rows = await ctx.db.select().from(rsa);
  // Row-scoped like payouts: a professional sees only agreements naming them (Directive §50).
  const scoped = u.role === 'EXPERT' ? rows.filter((r) => r.professionalId === u.id) : rows;
  return scoped.filter((r) => (!filters.status || r.status === filters.status) && (!filters.professionalId || r.professionalId === filters.professionalId));
}

export async function getAgreement(ctx: Ctx, agreementId: string) {
  allow(ctx, 'revenue_share', 'read');
  const u = need(ctx).user;
  const [agreement] = await ctx.db.select().from(rsa).where(eq(rsa.id, agreementId)).limit(1);
  if (!agreement) throw notFound('Revenue share agreement not found');
  if (u.role === 'EXPERT' && agreement.professionalId !== u.id) throw forbidden();
  const allocations = await ctx.db.select().from(rsal).where(eq(rsal.agreementId, agreementId));
  const calculations = await ctx.db.select().from(rsc).where(eq(rsc.agreementId, agreementId));
  return { agreement, allocations, calculations };
}

/**
 * Replaces an agreement's allocations wholesale, inside one transaction, so the (deferred) sum-to-100%
 * constraint trigger - checked at commit, not per row - sees the final set rather than a partial one.
 */
export async function setAllocations(ctx: Ctx, agreementId: string, rows: { allocateeRole: string; professionalId?: string | null; percentOfShare: number }[]) {
  allow(ctx, 'revenue_share', 'edit');
  const [agreement] = await ctx.db.select().from(rsa).where(eq(rsa.id, agreementId)).limit(1);
  if (!agreement) throw notFound('Revenue share agreement not found');
  if (!['Draft', 'Pending approval'].includes(agreement.status)) throw unprocessable('Allocations can only be changed while the agreement is Draft or Pending Approval');
  if (!rows.length) throw fieldError({ rows: 'At least one allocation is required' });
  for (const r of rows) {
    if (!ALLOCATEE_ROLES.includes(r.allocateeRole as any)) throw fieldError({ allocateeRole: 'Invalid allocatee role' });
    if (r.allocateeRole !== 'SAMAKOSE' && !r.professionalId) throw fieldError({ professionalId: 'Required for every allocatee role except SAMAKOSE' });
    if (!(r.percentOfShare > 0 && r.percentOfShare <= 100)) throw fieldError({ percentOfShare: 'Must be between 0 and 100' });
  }
  const sum = rows.reduce((s, r) => s + r.percentOfShare, 0);
  if (Math.abs(sum - 100) > 0.01) throw fieldError({ rows: `Allocations must sum to 100% of the professional share (currently ${sum.toFixed(2)}%)` });
  await ctx.db.transaction(async (tx) => {
    await tx.delete(rsal).where(eq(rsal.agreementId, agreementId));
    await tx.insert(rsal).values(rows.map((r) => ({ agreementId, allocateeRole: r.allocateeRole, professionalId: r.professionalId ?? null, percentOfShare: dec(r.percentOfShare) })));
  });
  await audit(ctx, 'revenue_share_agreement.allocations_set', 'revenue_share_agreement', agreementId, undefined, rows);
  return { ok: true };
}

export async function submitForApproval(ctx: Ctx, agreementId: string) {
  allow(ctx, 'revenue_share', 'edit');
  const [a] = await ctx.db.select().from(rsa).where(eq(rsa.id, agreementId)).limit(1);
  if (!a) throw notFound('Revenue share agreement not found');
  if (a.status !== 'Draft') throw unprocessable(`A ${a.status} agreement cannot be submitted for approval`);
  const allocs = await ctx.db.select({ id: rsal.id }).from(rsal).where(eq(rsal.agreementId, agreementId)).limit(1);
  if (!allocs.length) throw unprocessable('Add the revenue-share allocations before submitting for approval');
  await ctx.db.update(rsa).set({ status: 'Pending approval', updatedAt: new Date() }).where(eq(rsa.id, agreementId));
  await audit(ctx, 'revenue_share_agreement.submitted', 'revenue_share_agreement', agreementId, { status: 'Draft' }, { status: 'Pending approval' });
  return { ok: true };
}

/**
 * Four-eyes and conflict-of-interest (Directive §33, §53): the approver may not be the proposer, the
 * agreement's own professional, or any professional named in its allocations - a person never signs off
 * on their own share, whatever role they hold.
 */
export async function approveAgreement(ctx: Ctx, agreementId: string) {
  allow(ctx, 'revenue_share', 'approve');
  const u = need(ctx).user;
  const [a] = await ctx.db.select().from(rsa).where(eq(rsa.id, agreementId)).limit(1);
  if (!a) throw notFound('Revenue share agreement not found');
  if (a.status !== 'Pending approval') throw unprocessable(`A ${a.status} agreement is not awaiting approval`);
  if (a.proposedBy === u.id) throw forbidden('The person who proposed a revenue-share agreement cannot approve it');
  if (a.professionalId === u.id) throw forbidden('A professional cannot approve their own revenue-share agreement');
  const allocs = await ctx.db.select({ professionalId: rsal.professionalId }).from(rsal).where(eq(rsal.agreementId, agreementId));
  if (allocs.some((r) => r.professionalId === u.id)) throw forbidden('A professional named in the allocation cannot approve this agreement');
  await ctx.db.update(rsa).set({ status: 'Approved', approvedBy: u.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(rsa.id, agreementId));
  await audit(ctx, 'revenue_share_agreement.approved', 'revenue_share_agreement', agreementId, { status: 'Pending approval' }, { status: 'Approved', approvedBy: u.id });
  return { ok: true };
}

export async function activateAgreement(ctx: Ctx, agreementId: string) {
  allow(ctx, 'revenue_share', 'edit');
  const [a] = await ctx.db.select().from(rsa).where(eq(rsa.id, agreementId)).limit(1);
  if (!a) throw notFound('Revenue share agreement not found');
  if (a.status !== 'Approved') throw unprocessable(`A ${a.status} agreement must be approved before it can be activated`);
  await ctx.db.update(rsa).set({ status: 'Active', updatedAt: new Date() }).where(eq(rsa.id, agreementId));
  await audit(ctx, 'revenue_share_agreement.activated', 'revenue_share_agreement', agreementId, { status: 'Approved' }, { status: 'Active' });
  // Detected here, as early as possible, so the review queue is populated at activation rather than
  // waiting for someone to first attempt a calculation (Developer Spec §5.3). Never resolved here.
  const conflicts = await detectAgreementConflicts(ctx, { ...a, status: 'Active' });
  return { ok: true, conflicts: conflicts.length };
}

/**
 * Overlap test on effective dates, open-ended on either side. Deliberately a plain comparison, not a
 * database range type, to keep the "null means open-ended" rule visible at the call site.
 */
function datesOverlap(aFrom: string | null, aTo: string | null, bFrom: string | null, bTo: string | null): boolean {
  const aStart = aFrom ? new Date(aFrom).getTime() : -Infinity;
  const aEnd = aTo ? new Date(aTo).getTime() : Infinity;
  const bStart = bFrom ? new Date(bFrom).getTime() : -Infinity;
  const bEnd = bTo ? new Date(bTo).getTime() : Infinity;
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Find every other Active agreement on the same assignment whose effective dates overlap this one's,
 * and record each pair found (idempotent - an existing Open row for the same pair is never duplicated).
 * Never silently selects a "winning" agreement; that is always a human decision via resolveAgreementConflict().
 */
async function detectAgreementConflicts(ctx: Ctx, agreement: Pick<typeof rsa.$inferSelect, 'id' | 'code' | 'status' | 'assignmentId' | 'effectiveFrom' | 'effectiveTo'>) {
  if (agreement.status !== 'Active') return [];
  const others = await ctx.db.select().from(rsa).where(and(eq(rsa.assignmentId, agreement.assignmentId), eq(rsa.status, 'Active')));
  const found: (typeof rsx.$inferSelect)[] = [];
  for (const other of others) {
    if (other.id === agreement.id) continue;
    if (!datesOverlap(agreement.effectiveFrom, agreement.effectiveTo, other.effectiveFrom, other.effectiveTo)) continue;
    // Keyed by the unordered pair (lower id first) so detecting from either agreement's side finds the same row.
    const [lo, hi] = agreement.id < other.id ? [agreement, other] : [other, agreement];
    const existing = await ctx.db.select().from(rsx).where(and(eq(rsx.assignmentId, agreement.assignmentId), eq(rsx.agreementId, lo.id), eq(rsx.conflictingAgreementId, hi.id))).limit(1);
    if (existing.length) { found.push(existing[0]); continue; }
    const [row] = await ctx.db.insert(rsx).values({
      assignmentId: agreement.assignmentId, agreementId: lo.id, conflictingAgreementId: hi.id,
      reason: `Agreements ${lo.code} and ${hi.code} are both Active on the same assignment with overlapping effective dates`
    }).returning();
    found.push(row);
    await audit(ctx, 'revenue_share_agreement.conflict_detected', 'revenue_share_agreement_conflict', row.id, undefined, { assignmentId: agreement.assignmentId, agreementId: lo.id, conflictingAgreementId: hi.id });
  }
  return found;
}

/**
 * Blocks calculation while any conflict naming this agreement is unresolved, and - once a conflict is
 * resolved - permanently blocks the agreement that lost it. "Permanently" because a resolution is a
 * considered human decision about which agreement governs the assignment, not a snapshot that expires.
 */
async function assertNoBlockingConflicts(ctx: Ctx, agreement: typeof rsa.$inferSelect) {
  await detectAgreementConflicts(ctx, agreement); // catches a conflict created by a second agreement activated after this one
  const rows = await ctx.db.select().from(rsx).where(or(eq(rsx.agreementId, agreement.id), eq(rsx.conflictingAgreementId, agreement.id)));
  for (const row of rows) {
    if (row.status === 'Open') throw conflict(`This agreement conflicts with another active agreement on the same assignment (${row.code}). An authorised reviewer must resolve the conflict before revenue share can be calculated`);
    if (row.status === 'Resolved' && row.prevailingAgreementId !== agreement.id) throw conflict(`A resolved conflict (${row.code}) determined that a different agreement governs this assignment. Calculate under that agreement instead`);
  }
}

export async function listAgreementConflicts(ctx: Ctx, filters: { status?: string; assignmentId?: string } = {}) {
  allow(ctx, 'revenue_share', 'read');
  const u = need(ctx).user;
  const rows = await ctx.db.select().from(rsx);
  const filtered = rows.filter((r) => (!filters.status || r.status === filters.status) && (!filters.assignmentId || r.assignmentId === filters.assignmentId));
  if (u.role !== 'EXPERT') return filtered;
  // Row-scoped like every other revenue-share record a professional can see: only a conflict touching
  // their own assignment (Directive §50), never a raw cross-professional query.
  const own = await ctx.db.select({ id: asn.id }).from(asn).where(eq(asn.userId, u.id));
  const ownAssignmentIds = new Set(own.map((a) => a.id));
  return filtered.filter((r) => ownAssignmentIds.has(r.assignmentId));
}

/**
 * Resolution is a human decision, never automatic: a reviewer with no stake in either agreement says
 * which one governs. Four-eyes, extended to both sides of the conflict: whoever proposed or approved
 * either agreement cannot be the one who decides between them.
 */
export async function resolveAgreementConflict(ctx: Ctx, conflictId: string, prevailingAgreementId: string, resolutionNote: string) {
  allow(ctx, 'revenue_share', 'approve');
  const u = need(ctx).user;
  const [row] = await ctx.db.select().from(rsx).where(eq(rsx.id, conflictId)).limit(1);
  if (!row) throw notFound('Conflict not found');
  if (row.status !== 'Open') throw unprocessable(`A ${row.status} conflict cannot be resolved again`);
  if (!resolutionNote?.trim()) throw fieldError({ resolutionNote: 'Required' });
  if (![row.agreementId, row.conflictingAgreementId].includes(prevailingAgreementId)) throw fieldError({ prevailingAgreementId: 'Must be one of the two conflicting agreements' });
  const [a1] = await ctx.db.select({ proposedBy: rsa.proposedBy, approvedBy: rsa.approvedBy }).from(rsa).where(eq(rsa.id, row.agreementId)).limit(1);
  const [a2] = await ctx.db.select({ proposedBy: rsa.proposedBy, approvedBy: rsa.approvedBy }).from(rsa).where(eq(rsa.id, row.conflictingAgreementId)).limit(1);
  if ([a1?.proposedBy, a1?.approvedBy, a2?.proposedBy, a2?.approvedBy].includes(u.id)) throw forbidden('Someone who proposed or approved either conflicting agreement cannot resolve the conflict between them');
  await ctx.db.update(rsx).set({ status: 'Resolved', resolvedBy: u.id, resolvedAt: new Date(), resolutionNote, prevailingAgreementId }).where(eq(rsx.id, conflictId));
  await audit(ctx, 'revenue_share_agreement.conflict_resolved', 'revenue_share_agreement_conflict', conflictId, { status: 'Open' }, { status: 'Resolved', prevailingAgreementId, resolutionNote });
  return { ok: true };
}

/* ------------------------------- calculation ------------------------------- */
function professionalShare(model: string, basisAmount: number, percentage: string | null, fixedAmountGhs: string | null, tierRules: { upToGhs: number | null; percentage: number }[] | null): number {
  let amount: number;
  if (model === 'PERCENTAGE') amount = (basisAmount * Number(percentage)) / 100;
  else if (model === 'FIXED') amount = Number(fixedAmountGhs);
  else if (model === 'HYBRID') amount = Number(fixedAmountGhs) + (basisAmount * Number(percentage)) / 100;
  else {
    // TIERED: cumulative bands, each tier's percentage applying only to the slice within that band.
    amount = 0; let lower = 0;
    for (const t of tierRules ?? []) {
      const upper = t.upToGhs ?? Infinity;
      const slice = Math.max(0, Math.min(basisAmount, upper) - lower);
      amount += (slice * t.percentage) / 100;
      lower = upper;
      if (lower >= basisAmount) break;
    }
  }
  return Math.max(0, Math.min(amount, basisAmount));
}

/**
 * Financial activation (Directive §34): creates the immutable calculation snapshot, posts the Samakose
 * Revenue -> Professional Payable ledger entry for the whole professional pool, and creates one Earned
 * payout per paid allocatee (every allocation row that has a professionalId). One calculation per
 * (agreementId, invoiceId) - this does not yet implement the supersedesId correction path.
 */
export async function calculateRevenueShare(ctx: Ctx, agreementId: string, invoiceId: string) {
  allow(ctx, 'revenue_share', 'edit');
  const [a] = await ctx.db.select().from(rsa).where(eq(rsa.id, agreementId)).limit(1);
  if (!a) throw notFound('Revenue share agreement not found');
  if (a.status !== 'Active') throw unprocessable('Only an Active agreement can generate a calculation');
  await assertNoBlockingConflicts(ctx, a);
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, invoiceId)).limit(1);
  if (!i) throw notFound('Invoice not found');
  if (i.status !== 'Paid') throw unprocessable('The invoice must be fully paid before revenue share can be calculated');
  if (i.contractId !== a.contractId) throw fieldError({ invoiceId: "This invoice is not on the agreement's contract" });
  const [assignment] = await ctx.db.select().from(asn).where(eq(asn.id, a.assignmentId)).limit(1);
  if (!assignment || assignment.status !== 'Completed' || !assignment.endedAt) throw unprocessable('The assignment must have ended (deliverables complete) before revenue share can be calculated');

  const existing = await ctx.db.select({ id: rsc.id }).from(rsc).where(and(eq(rsc.agreementId, agreementId), eq(rsc.invoiceId, invoiceId), isNull(rsc.supersedesId))).limit(1);
  if (existing.length) throw conflict('Revenue share has already been calculated for this agreement and invoice');

  const [payment] = await ctx.db.select().from(pay).where(and(eq(pay.invoiceId, invoiceId), eq(pay.status, 'Succeeded'))).limit(1);
  if (!payment) throw unprocessable('No succeeded payment was found for this invoice');
  const discountRows = await ctx.db.select({ d: pred.discountAppliedGhs }).from(pred).where(eq(pred.invoiceId, invoiceId));
  const discountAmountGhs = discountRows.reduce((s, r) => s + Number(r.d), 0);
  const netAmountGhs = Number(i.amountGhs);
  const grossAmountGhs = netAmountGhs + discountAmountGhs;
  const collectedAmountGhs = Number(payment.amountGhs);
  const basisAmount = a.basis === 'SHARE_ON_LIST_PRICE' ? grossAmountGhs : a.basis === 'SHARE_ON_NET_PRICE' ? netAmountGhs : collectedAmountGhs;

  const professionalAmountGhs = professionalShare(a.model, basisAmount, a.percentage, a.fixedAmountGhs, a.tierRules as any);
  const samakoseAmountGhs = Math.max(0, basisAmount - professionalAmountGhs);
  const u = ctx.user;
  const [calc] = await ctx.db.insert(rsc).values({
    agreementId, invoiceId, paymentId: payment.id,
    grossAmountGhs: dec(grossAmountGhs), discountAmountGhs: dec(discountAmountGhs), netAmountGhs: dec(netAmountGhs),
    basisUsed: a.basis, calculationVersion: 1,
    professionalAmountGhs: dec(professionalAmountGhs), samakoseAmountGhs: dec(samakoseAmountGhs),
    computedBy: u?.id ?? null
  }).returning();

  if (professionalAmountGhs > 0) {
    await postLedgerEntries(ctx, { referenceType: 'REVENUE_SHARE', referenceId: calc.id, description: `Revenue share calculated on invoice ${i.code}`,
      lines: [{ accountCode: 'REVENUE', debitGhs: professionalAmountGhs }, { accountCode: 'PROFESSIONAL_PAYABLE', creditGhs: professionalAmountGhs }] });
  }

  const allocations = await ctx.db.select().from(rsal).where(eq(rsal.agreementId, agreementId));
  const paidAllocations = allocations.filter((r) => r.professionalId);
  const payouts: (typeof pyo.$inferSelect)[] = [];
  let distributed = 0;
  for (const [idx, alloc] of paidAllocations.entries()) {
    const isLast = idx === paidAllocations.length - 1;
    const amount = isLast ? Math.max(0, professionalAmountGhs - distributed) : Math.round(((professionalAmountGhs * Number(alloc.percentOfShare)) / 100) * 100) / 100;
    distributed += amount;
    if (amount <= 0) continue;
    const [row] = await ctx.db.insert(pyo).values({
      professionalId: alloc.professionalId!, calculationId: calc.id, assignmentId: a.assignmentId, contractId: a.contractId,
      amountGhs: dec(amount), status: 'Earned'
    }).returning();
    payouts.push(row);
  }
  await audit(ctx, 'revenue_share.calculated', 'revenue_share_calculation', calc.id, undefined, { professionalAmountGhs: dec(professionalAmountGhs), samakoseAmountGhs: dec(samakoseAmountGhs), payouts: payouts.length });
  return { calculation: calc, payouts };
}

/* ---------------------------------- payouts ---------------------------------- */
async function loadPayout(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(pyo).where(eq(pyo.id, id)).limit(1);
  if (!row) throw notFound('Payout not found');
  return row;
}
export async function listMyPayouts(ctx: Ctx) {
  allow(ctx, 'payouts', 'read');
  const u = need(ctx).user;
  // Row-scoped: a professional sees only their own statement, never a raw cross-professional query (Directive §50).
  const where = u.role === 'EXPERT' ? eq(pyo.professionalId, u.id) : undefined;
  return ctx.db.select().from(pyo).where(where);
}

/** A staff member other than the professional themselves confirms deliverables and amount. */
export async function reviewPayout(ctx: Ctx, id: string) {
  allow(ctx, 'payouts', 'edit');
  const u = need(ctx).user;
  const p = await loadPayout(ctx, id);
  if (p.status !== 'Earned') throw unprocessable(`A ${p.status} payout cannot be reviewed`);
  if (p.professionalId === u.id) throw forbidden('The professional cannot review their own payout');
  await ctx.db.update(pyo).set({ status: 'Reviewed', reviewedBy: u.id, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(pyo.id, id));
  await audit(ctx, 'payout.reviewed', 'professional_payout', id, { status: 'Earned' }, { status: 'Reviewed', reviewedBy: u.id });
  return { ok: true };
}

/** Four-eyes: a second person, distinct from both the professional and the reviewer, approves. */
export async function approvePayout(ctx: Ctx, id: string) {
  allow(ctx, 'payouts', 'approve');
  const u = need(ctx).user;
  const p = await loadPayout(ctx, id);
  if (p.status !== 'Reviewed') throw unprocessable(`A ${p.status} payout cannot be approved`);
  if (p.professionalId === u.id) throw forbidden('The professional cannot approve their own payout');
  if (p.reviewedBy === u.id) throw forbidden('The person who reviewed this payout cannot also approve it');
  await ctx.db.update(pyo).set({ status: 'Approved', approvedBy: u.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(pyo.id, id));
  await audit(ctx, 'payout.approved', 'professional_payout', id, { status: 'Reviewed' }, { status: 'Approved', approvedBy: u.id });
  return { ok: true };
}

/** "Payout eligible" (Payouts & Compliance design, payout eligibility rules table): a payout cannot
 *  reach Payable for a professional whose tax identity is missing, still Submitted, or Rejected. */
export async function markPayable(ctx: Ctx, id: string) {
  allow(ctx, 'payouts', 'edit');
  const p = await loadPayout(ctx, id);
  if (p.status !== 'Approved') throw unprocessable(`A ${p.status} payout cannot move to Payable`);
  if (!(await isPayoutEligible(ctx, p.professionalId))) throw unprocessable('This professional\'s tax profile is missing or not yet verified. A verified tax identifier is required before a payout can move to Payable.');
  await ctx.db.update(pyo).set({ status: 'Payable', updatedAt: new Date() }).where(eq(pyo.id, id));
  await audit(ctx, 'payout.payable', 'professional_payout', id, { status: 'Approved' }, { status: 'Payable' });
  return { ok: true };
}

export async function listPayoutHolds(ctx: Ctx, payoutId: string) {
  allow(ctx, 'payouts', 'read');
  return ctx.db.select().from(ph).where(eq(ph.payoutId, payoutId)).orderBy(ph.createdAt);
}

/** A human-created hold (AI may flag a candidate but never creates one itself) blocks Payable -> Payment initiated only. */
export async function createPayoutHold(ctx: Ctx, payoutId: string, reason: string) {
  allow(ctx, 'payouts', 'edit');
  const u = need(ctx).user;
  const p = await loadPayout(ctx, payoutId);
  if (!['Approved', 'Payable'].includes(p.status)) throw unprocessable(`A ${p.status} payout cannot be held`);
  const [row] = await ctx.db.insert(ph).values({ payoutId, reason, createdBy: u.id }).returning();
  await audit(ctx, 'payout.hold_created', 'payout_hold', row.id, undefined, { payoutId, reason });
  return row;
}
export async function resolvePayoutHold(ctx: Ctx, holdId: string, resolutionNote?: string) {
  allow(ctx, 'payouts', 'edit');
  const u = need(ctx).user;
  const [hold] = await ctx.db.select().from(ph).where(eq(ph.id, holdId)).limit(1);
  if (!hold) throw notFound('Payout hold not found');
  if (hold.resolvedAt) throw conflict('This hold is already resolved');
  await ctx.db.update(ph).set({ resolvedBy: u.id, resolvedAt: new Date(), resolutionNote: resolutionNote ?? null }).where(eq(ph.id, holdId));
  await audit(ctx, 'payout.hold_resolved', 'payout_hold', holdId, { resolvedAt: null }, { resolvedBy: u.id, resolutionNote });
  return { ok: true };
}

export async function initiatePayment(ctx: Ctx, id: string, payoutMethod: string) {
  allow(ctx, 'payouts', 'edit');
  const p = await loadPayout(ctx, id);
  if (p.status !== 'Payable') throw unprocessable(`A ${p.status} payout cannot be initiated`);
  const openHolds = await ctx.db.select({ id: ph.id }).from(ph).where(and(eq(ph.payoutId, id), isNull(ph.resolvedAt))).limit(1);
  if (openHolds.length) throw conflict('This payout has an unresolved hold');
  await ctx.db.update(pyo).set({ status: 'Payment initiated', payoutMethod, updatedAt: new Date() }).where(eq(pyo.id, id));
  await audit(ctx, 'payout.payment_initiated', 'professional_payout', id, { status: 'Payable' }, { status: 'Payment initiated', payoutMethod });
  return { ok: true };
}

/** Posts the Professional Payable -> Cash ledger entry for this payout's own amount (not the whole pool). */
export async function markPaid(ctx: Ctx, id: string, paymentReference?: string) {
  allow(ctx, 'payouts', 'edit');
  const p = await loadPayout(ctx, id);
  if (p.status !== 'Payment initiated') throw unprocessable(`A ${p.status} payout cannot be marked paid`);
  await ctx.db.update(pyo).set({ status: 'Paid', paidAt: new Date(), paymentReference: paymentReference ?? null, updatedAt: new Date() }).where(eq(pyo.id, id));
  await postLedgerEntries(ctx, { referenceType: 'PAYOUT', referenceId: id, description: `Payout ${p.code} paid`,
    lines: [{ accountCode: 'PROFESSIONAL_PAYABLE', debitGhs: Number(p.amountGhs) }, { accountCode: 'CASH', creditGhs: Number(p.amountGhs) }] });
  await audit(ctx, 'payout.paid', 'professional_payout', id, { status: 'Payment initiated' }, { status: 'Paid', paymentReference });
  return { ok: true };
}

/** Matched against the actual provider transaction - never assumed from a frontend callback. */
export async function reconcilePayout(ctx: Ctx, id: string) {
  allow(ctx, 'payouts', 'edit');
  const p = await loadPayout(ctx, id);
  if (p.status !== 'Paid') throw unprocessable(`A ${p.status} payout cannot be reconciled`);
  await ctx.db.update(pyo).set({ status: 'Reconciled', reconciledAt: new Date(), updatedAt: new Date() }).where(eq(pyo.id, id));
  await audit(ctx, 'payout.reconciled', 'professional_payout', id, { status: 'Paid' }, { status: 'Reconciled' });
  return { ok: true };
}
