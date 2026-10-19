import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let finance: Session, admin: Session, executive: Session, expert: Session, lead2: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE'); executive = await makeUser('EXECUTIVE');
  expert = await makeUser('EXPERT'); lead2 = await makeUser('EXPERT');
  const o = await makeOrg(admin); orgId = o.id;
});

/** A paid invoice (optionally discounted) on a fresh contract, with an Ended assignment for `expert`. */
async function paidInvoiceWithEndedAssignment(amount: number) {
  const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: amount * 2 })).data;
  await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
  const inv = (await api(finance).post('/invoices', { orgId, contractId: con.id, amountGhs: amount, dueDate: '2099-01-01' })).data;
  await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
  await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: amount });

  const [cs] = await db().insert(schema.cases).values({ orgId }).returning();
  const [a] = await db().insert(schema.caseAssignments).values({ caseId: cs.id, userId: expert.userId, fn: 'lead', status: 'Completed', endedAt: new Date() }).returning();
  return { contractId: con.id, invoiceId: inv.id, assignmentId: a.id };
}

async function activeAgreement(opts: { amount: number; model?: string; basis?: string; percentage?: number; fixedAmountGhs?: number; tierRules?: any }) {
  const { contractId, invoiceId, assignmentId } = await paidInvoiceWithEndedAssignment(opts.amount);
  const agreement = (await api(finance).post('/revenue-share/agreements', {
    contractId, assignmentId, professionalId: expert.userId,
    model: opts.model ?? 'PERCENTAGE', basis: opts.basis ?? 'SHARE_ON_COLLECTED_AMOUNT',
    percentage: opts.percentage, fixedAmountGhs: opts.fixedAmountGhs, tierRules: opts.tierRules
  })).data;
  expect((await api(finance).put(`/revenue-share/agreements/${agreement.id}/allocations`, { rows: [{ allocateeRole: 'LEAD', professionalId: expert.userId, percentOfShare: 100 }] })).status).toBe(200);
  expect((await api(finance).post(`/revenue-share/agreements/${agreement.id}/submit`, {})).status).toBe(200);
  expect((await api(executive).post(`/revenue-share/agreements/${agreement.id}/approve`, {})).status).toBe(200);
  expect((await api(finance).post(`/revenue-share/agreements/${agreement.id}/activate`, {})).status).toBe(200);
  return { agreementId: agreement.id, invoiceId };
}

describe('revenue share agreements', () => {
  it('requires allocations to sum to 100% and refuses self/co-interested approval', async () => {
    const { contractId, invoiceId, assignmentId } = await paidInvoiceWithEndedAssignment(1000);
    const agreement = (await api(finance).post('/revenue-share/agreements', { contractId, assignmentId, professionalId: expert.userId, model: 'PERCENTAGE', basis: 'SHARE_ON_NET_PRICE', percentage: 30 })).data;

    expect((await api(finance).put(`/revenue-share/agreements/${agreement.id}/allocations`, { rows: [{ allocateeRole: 'LEAD', professionalId: expert.userId, percentOfShare: 60 }] })).status).toBe(400);
    expect((await api(finance).put(`/revenue-share/agreements/${agreement.id}/allocations`, { rows: [{ allocateeRole: 'LEAD', professionalId: expert.userId, percentOfShare: 100 }] })).status).toBe(200);
    expect((await api(finance).post(`/revenue-share/agreements/${agreement.id}/submit`, {})).status).toBe(200);

    expect((await api(finance).post(`/revenue-share/agreements/${agreement.id}/approve`, {})).status).toBe(403); // proposer cannot approve
    expect((await api(expert).post(`/revenue-share/agreements/${agreement.id}/approve`, {})).status).toBe(403); // the professional cannot approve their own
    expect((await api(executive).post(`/revenue-share/agreements/${agreement.id}/approve`, {})).status).toBe(200);
    expect((await api(executive).post(`/revenue-share/agreements/${agreement.id}/activate`, {})).status).toBe(403); // EXECUTIVE can approve but not edit/activate
    expect((await api(finance).post(`/revenue-share/agreements/${agreement.id}/activate`, {})).status).toBe(200);
  });

  it('reproduces the Directive worked example exactly: list 5000, discount 1000, net 4000, expert 30% of net -> 1200 / 2800', async () => {
    const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: 5000 })).data;
    await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
    const inv = (await api(finance).post('/invoices', { orgId, contractId: con.id, amountGhs: 5000, dueDate: '2099-01-01' })).data;
    // Simulate the GHS 1,000 discount directly against the invoice amount (discounts.ts is a separate PR) via a promo_redemptions row,
    // which is exactly what applyPromoCode() would have written, so the gross/net reconstruction in calculateRevenueShare is exercised for real.
    await api(finance).patch(`/invoices/${inv.id}`, { amountGhs: 4000 });
    await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
    await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: 4000 });
    const [cust] = await db().select().from(schema.users).where(eq(schema.users.id, expert.userId));
    await db().insert(schema.promoRedemptions).values({ promoCodeId: (await ensurePromoFixture()).id, invoiceId: inv.id, customerId: cust.id, discountAppliedGhs: '1000.00' });

    const [cs] = await db().insert(schema.cases).values({ orgId }).returning();
    const [a] = await db().insert(schema.caseAssignments).values({ caseId: cs.id, userId: expert.userId, fn: 'lead', status: 'Completed', endedAt: new Date() }).returning();
    const agreement = (await api(finance).post('/revenue-share/agreements', { contractId: con.id, assignmentId: a.id, professionalId: expert.userId, model: 'PERCENTAGE', basis: 'SHARE_ON_NET_PRICE', percentage: 30 })).data;
    await api(finance).put(`/revenue-share/agreements/${agreement.id}/allocations`, { rows: [{ allocateeRole: 'LEAD', professionalId: expert.userId, percentOfShare: 100 }] });
    await api(finance).post(`/revenue-share/agreements/${agreement.id}/submit`, {});
    await api(executive).post(`/revenue-share/agreements/${agreement.id}/approve`, {});
    await api(finance).post(`/revenue-share/agreements/${agreement.id}/activate`, {});

    const r = await api(finance).post(`/revenue-share/agreements/${agreement.id}/calculate`, { invoiceId: inv.id });
    expect(r.status).toBe(201);
    expect(r.data.calculation.grossAmountGhs).toBe('5000.00');
    expect(r.data.calculation.discountAmountGhs).toBe('1000.00');
    expect(r.data.calculation.netAmountGhs).toBe('4000.00');
    expect(r.data.calculation.professionalAmountGhs).toBe('1200.00');
    expect(r.data.calculation.samakoseAmountGhs).toBe('2800.00');
    expect(r.data.payouts).toHaveLength(1);
    expect(r.data.payouts[0].amountGhs).toBe('1200.00');
  });

  it('refuses a duplicate calculation for the same agreement and invoice', async () => {
    const { agreementId, invoiceId } = await activeAgreement({ amount: 1000, percentage: 30, basis: 'SHARE_ON_NET_PRICE' });
    expect((await api(finance).post(`/revenue-share/agreements/${agreementId}/calculate`, { invoiceId })).status).toBe(201);
    expect((await api(finance).post(`/revenue-share/agreements/${agreementId}/calculate`, { invoiceId })).status).toBe(409);
  });

  it('computes a FIXED, HYBRID and TIERED model correctly', async () => {
    const fixed = await activeAgreement({ amount: 1000, model: 'FIXED', fixedAmountGhs: 250, basis: 'SHARE_ON_NET_PRICE' });
    const r1 = await api(finance).post(`/revenue-share/agreements/${fixed.agreementId}/calculate`, { invoiceId: fixed.invoiceId });
    expect(r1.data.calculation.professionalAmountGhs).toBe('250.00');

    const hybrid = await activeAgreement({ amount: 1000, model: 'HYBRID', fixedAmountGhs: 100, percentage: 10, basis: 'SHARE_ON_NET_PRICE' });
    const r2 = await api(finance).post(`/revenue-share/agreements/${hybrid.agreementId}/calculate`, { invoiceId: hybrid.invoiceId });
    expect(r2.data.calculation.professionalAmountGhs).toBe('200.00'); // 100 + 10% of 1000

    const tiered = await activeAgreement({ amount: 1000, model: 'TIERED', basis: 'SHARE_ON_NET_PRICE', tierRules: [{ upToGhs: 500, percentage: 10 }, { upToGhs: null, percentage: 20 }] });
    const r3 = await api(finance).post(`/revenue-share/agreements/${tiered.agreementId}/calculate`, { invoiceId: tiered.invoiceId });
    expect(r3.data.calculation.professionalAmountGhs).toBe('150.00'); // 500*10% + 500*20%
  });
});

async function ensurePromoFixture() {
  const [rule] = await db().insert(schema.discountRules).values({ kind: 'FIXED', value: '1000.00', active: true }).returning();
  const [camp] = await db().insert(schema.promoCampaigns).values({ name: `fixture-${uniq()}`, discountRuleId: rule.id }).returning();
  const [code] = await db().insert(schema.promoCodes).values({ campaignId: camp.id, code: `FIX-${uniq()}` }).returning();
  return code;
}

describe('professional payout lifecycle', () => {
  it('walks Earned -> Reviewed -> Approved -> Payable -> Payment initiated -> Paid -> Reconciled, with four-eyes at each decision', async () => {
    const { agreementId, invoiceId } = await activeAgreement({ amount: 1000, percentage: 30, basis: 'SHARE_ON_NET_PRICE' });
    const r = await api(finance).post(`/revenue-share/agreements/${agreementId}/calculate`, { invoiceId });
    const payoutId = r.data.payouts[0].id;

    expect((await api(expert).post(`/payouts/${payoutId}/review`, {})).status).toBe(403); // professional cannot review their own
    expect((await api(finance).post(`/payouts/${payoutId}/review`, {})).status).toBe(200);
    expect((await api(finance).post(`/payouts/${payoutId}/approve`, {})).status).toBe(403); // same reviewer cannot also approve
    expect((await api(admin).post(`/payouts/${payoutId}/approve`, {})).status).toBe(200);
    expect((await api(finance).post(`/payouts/${payoutId}/payable`, {})).status).toBe(200);

    const hold = (await api(finance).post(`/payouts/${payoutId}/hold`, { reason: 'Awaiting a signed delivery note' })).data;
    expect((await api(finance).post(`/payouts/${payoutId}/initiate`, { payoutMethod: 'bank' })).status).toBe(409); // blocked by the open hold

    const holdsBefore = await api(finance).get(`/payouts/${payoutId}/holds`);
    expect(holdsBefore.status).toBe(200);
    expect(holdsBefore.data.find((h: any) => h.id === hold.id)?.resolvedAt).toBeFalsy();

    expect((await api(finance).post(`/payout-holds/${hold.id}/resolve`, { resolutionNote: 'Received' })).status).toBe(200);

    const holdsAfter = await api(finance).get(`/payouts/${payoutId}/holds`);
    expect(holdsAfter.data.find((h: any) => h.id === hold.id)?.resolvedAt).toBeTruthy();
    expect((await api(finance).post(`/payouts/${payoutId}/initiate`, { payoutMethod: 'bank' })).status).toBe(200);
    expect((await api(finance).post(`/payouts/${payoutId}/paid`, { paymentReference: `PAY-${uniq()}` })).status).toBe(200);
    expect((await api(finance).post(`/payouts/${payoutId}/reconcile`, {})).status).toBe(200);

    const entries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, payoutId));
    expect(entries).toHaveLength(2);
    expect(entries.reduce((s, e) => s + Number(e.debitGhs) - Number(e.creditGhs), 0)).toBe(0);
  });

  it('scopes a professional to only their own payouts', async () => {
    const { agreementId, invoiceId } = await activeAgreement({ amount: 500, percentage: 10, basis: 'SHARE_ON_NET_PRICE' });
    await api(finance).post(`/revenue-share/agreements/${agreementId}/calculate`, { invoiceId });
    const mine = (await api(expert).get('/payouts')).data;
    expect(mine.every((p: any) => p.professionalId === expert.userId)).toBe(true);
    const otherExpertHasNone = (await api(lead2).get('/payouts')).data;
    expect(otherExpertHasNone.every((p: any) => p.professionalId === lead2.userId)).toBe(true);
  });
});
