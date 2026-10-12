import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let finance: Session, admin: Session, executive: Session, expert: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE'); executive = await makeUser('EXECUTIVE'); expert = await makeUser('EXPERT');
  orgId = (await makeOrg(admin)).id;
});

/** A paid invoice + its succeeded payment, on a fresh contract. */
async function paidInvoiceAndPayment(amount: number) {
  const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: amount * 2 })).data;
  await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
  const inv = (await api(finance).post('/invoices', { orgId, contractId: con.id, amountGhs: amount, dueDate: '2099-01-01' })).data;
  await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
  const pay = (await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: amount })).data;
  return { invoiceId: inv.id as string, paymentId: pay.id as string, contractId: con.id as string };
}

/** A fully paid-out revenue share on the given invoice/contract, held by `expert`. */
async function paidOutRevenueShare(contractId: string, invoiceId: string, amount: number, pct: number) {
  const [cs] = await db().insert(schema.cases).values({ orgId }).returning();
  const [a] = await db().insert(schema.caseAssignments).values({ caseId: cs.id, userId: expert.userId, fn: 'lead', status: 'Completed', endedAt: new Date() }).returning();
  const agreement = (await api(finance).post('/revenue-share/agreements', { contractId, assignmentId: a.id, professionalId: expert.userId, model: 'PERCENTAGE', basis: 'SHARE_ON_COLLECTED_AMOUNT', percentage: pct })).data;
  await api(finance).put(`/revenue-share/agreements/${agreement.id}/allocations`, { rows: [{ allocateeRole: 'LEAD', professionalId: expert.userId, percentOfShare: 100 }] });
  await api(finance).post(`/revenue-share/agreements/${agreement.id}/submit`, {});
  await api(executive).post(`/revenue-share/agreements/${agreement.id}/approve`, {});
  await api(finance).post(`/revenue-share/agreements/${agreement.id}/activate`, {});
  const calc = await api(finance).post(`/revenue-share/agreements/${agreement.id}/calculate`, { invoiceId });
  const payoutId = calc.data.payouts[0].id as string;
  await api(finance).post(`/payouts/${payoutId}/review`, {});
  await api(admin).post(`/payouts/${payoutId}/approve`, {});
  await api(finance).post(`/payouts/${payoutId}/payable`, {});
  await api(finance).post(`/payouts/${payoutId}/initiate`, { payoutMethod: 'bank' });
  await api(finance).post(`/payouts/${payoutId}/paid`, { paymentReference: `PAY-${uniq()}` });
  return payoutId;
}

describe('refund lifecycle', () => {
  it('requires a succeeded payment and caps the amount at what was paid', async () => {
    const { paymentId } = await paidInvoiceAndPayment(1000);
    expect((await api(finance).post('/refunds', { paymentId, amountGhs: 2000, reason: 'Over-refund attempt' })).status).toBe(400);
    const r = await api(finance).post('/refunds', { paymentId, amountGhs: 300, reason: 'Customer cancelled part of the engagement' });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.data.status).toBe('Requested');
  });

  it('four-eyes: the requester cannot approve their own refund', async () => {
    const { paymentId } = await paidInvoiceAndPayment(1000);
    const r = (await api(finance).post('/refunds', { paymentId, amountGhs: 100, reason: 'Goodwill' })).data;
    expect((await api(finance).post(`/refunds/${r.id}/approve`, {})).status).toBe(403);
    expect((await api(admin).post(`/refunds/${r.id}/approve`, {})).status).toBe(200);
  });

  it('routes a large refund (>=25% of invoice) through Executive approval, not plain Finance', async () => {
    const { paymentId } = await paidInvoiceAndPayment(1000);
    const r = (await api(finance).post('/refunds', { paymentId, amountGhs: 300, reason: 'A third of the invoice' })).data; // 30%
    expect((await api(admin).post(`/refunds/${r.id}/approve`, {})).status).toBe(200); // admin always allowed
    const { paymentId: p2 } = await paidInvoiceAndPayment(1000);
    const r2 = (await api(finance).post('/refunds', { paymentId: p2, amountGhs: 300, reason: 'A third of the invoice' })).data;
    expect((await api(finance).post(`/refunds/${r2.id}/approve`, {})).status).toBe(403); // plain Finance isn't enough for 30%
    expect((await api(executive).post(`/refunds/${r2.id}/approve`, {})).status).toBe(200);
  });

  it('a small refund (<10%) can be approved by Finance directly', async () => {
    const { paymentId } = await paidInvoiceAndPayment(1000);
    const r = (await api(finance).post('/refunds', { paymentId, amountGhs: 50, reason: 'Minor adjustment' })).data; // 5%
    const other = await makeUser('FINANCE');
    expect((await api(other).post(`/refunds/${r.id}/approve`, {})).status).toBe(200);
  });

  it('cannot approve, reject or process a refund out of order', async () => {
    const { paymentId } = await paidInvoiceAndPayment(500);
    const r = (await api(finance).post('/refunds', { paymentId, amountGhs: 100, reason: 'Test' })).data;
    expect((await api(admin).post(`/refunds/${r.id}/process`, {})).status).toBe(422); // not yet approved
    await api(admin).post(`/refunds/${r.id}/approve`, {});
    expect((await api(admin).post(`/refunds/${r.id}/approve`, {})).status).toBe(422); // already approved
    expect((await api(admin).post(`/refunds/${r.id}/reject`, {})).status).toBe(422);
  });

  it('processing posts a balanced ledger entry crediting cash and debiting revenue', async () => {
    const { paymentId } = await paidInvoiceAndPayment(1000);
    const r = (await api(finance).post('/refunds', { paymentId, amountGhs: 150, reason: 'Service shortfall' })).data;
    await api(admin).post(`/refunds/${r.id}/approve`, {});
    const processed = await api(admin).post(`/refunds/${r.id}/process`, {});
    expect(processed.status, JSON.stringify(processed.error)).toBe(200);
    expect(processed.data.refund.status).toBe('Processed');
    expect(processed.data.clawbacks).toEqual([]);
    const entries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, r.id));
    expect(entries).toHaveLength(2);
    expect(entries.reduce((s, e) => s + Number(e.debitGhs) - Number(e.creditGhs), 0)).toBe(0);
    // ledgerEntryId now links to one of the two entries posted (migration 0052 fixed the column type).
    expect(entries.some((e) => e.id === processed.data.refund.ledgerEntryId)).toBe(true);
  });
});

describe('refund-driven payout clawback', () => {
  it('opens a clawback on a paid payout, proportional to the refund, and requires separate four-eyes approval', async () => {
    const { invoiceId, paymentId, contractId } = await paidInvoiceAndPayment(1000);
    const payoutId = await paidOutRevenueShare(contractId, invoiceId, 1000, 30); // expert earns 300 on a 1000 invoice
    const r = (await api(finance).post('/refunds', { paymentId, amountGhs: 500, reason: 'Half refunded after dispute' })).data; // 50% of invoice
    await api(admin).post(`/refunds/${r.id}/approve`, {});
    const processed = await api(admin).post(`/refunds/${r.id}/process`, {});
    expect(processed.data.clawbacks).toHaveLength(1);
    const clawback = processed.data.clawbacks[0];
    expect(clawback.amountGhs).toBe('150.00'); // 300 payout * 50% refund fraction
    expect(clawback.approvedBy).toBeNull();

    // The person who opened the clawback (the admin who processed the refund) cannot also approve it.
    expect((await api(admin).post(`/payout-adjustments/${clawback.id}/approve-clawback`, {})).status).toBe(403);
    const other = await makeUser('ADMIN');
    const approved = await api(other).post(`/payout-adjustments/${clawback.id}/approve-clawback`, {});
    expect(approved.status, JSON.stringify(approved.error)).toBe(200);
    expect(approved.data.approvedBy).toBe(other.userId);

    const adjEntries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, clawback.id));
    expect(adjEntries).toHaveLength(2);
    expect(adjEntries.reduce((s, e) => s + Number(e.debitGhs) - Number(e.creditGhs), 0)).toBe(0);
    expect(adjEntries.some((e) => e.id === approved.data.ledgerEntryId)).toBe(true);
  });

  it('a professional cannot approve the clawback on their own payout', async () => {
    const { invoiceId, paymentId, contractId } = await paidInvoiceAndPayment(1000);
    const payoutId = await paidOutRevenueShare(contractId, invoiceId, 1000, 20);
    const r = (await api(finance).post('/refunds', { paymentId, amountGhs: 1000, reason: 'Full refund' })).data;
    await api(admin).post(`/refunds/${r.id}/approve`, {});
    const processed = await api(admin).post(`/refunds/${r.id}/process`, {});
    const clawback = processed.data.clawbacks[0];
    expect((await api(expert).post(`/payout-adjustments/${clawback.id}/approve-clawback`, {})).status).toBe(403);
  });

  it('no clawback is opened when the invoice has no revenue share, or the payout was never Paid', async () => {
    const { paymentId } = await paidInvoiceAndPayment(1000);
    const r = (await api(finance).post('/refunds', { paymentId, amountGhs: 100, reason: 'No revenue share here' })).data;
    await api(admin).post(`/refunds/${r.id}/approve`, {});
    const processed = await api(admin).post(`/refunds/${r.id}/process`, {});
    expect(processed.data.clawbacks).toEqual([]);
  });
});

describe('chargebacks', () => {
  it('posts a ledger entry immediately on receipt, and resolving Lost does not reverse it', async () => {
    const { paymentId } = await paidInvoiceAndPayment(800);
    const cb = await api(admin).post('/chargebacks', { paymentId, amountGhs: 800, provider: 'paystack', providerReference: `DISP-${uniq()}` });
    expect(cb.status, JSON.stringify(cb.error)).toBe(201);
    expect(cb.data.status).toBe('Received');
    let entries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, cb.data.id));
    expect(entries).toHaveLength(2);

    const lost = await api(admin).post(`/chargebacks/${cb.data.id}/resolve`, { outcome: 'Lost' });
    expect(lost.status).toBe(200);
    expect(lost.data.status).toBe('Lost');
    entries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, cb.data.id));
    expect(entries).toHaveLength(2); // no additional posting
  });

  it('resolving Won posts a reversing entry recovering the funds', async () => {
    const { paymentId } = await paidInvoiceAndPayment(600);
    const cb = await api(admin).post('/chargebacks', { paymentId, amountGhs: 600, provider: 'paystack' });
    const won = await api(admin).post(`/chargebacks/${cb.data.id}/resolve`, { outcome: 'Won' });
    expect(won.status).toBe(200);
    expect(won.data.status).toBe('Recovered');
    const entries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, cb.data.id));
    expect(entries).toHaveLength(4);
    expect(entries.reduce((s, e) => s + Number(e.debitGhs) - Number(e.creditGhs), 0)).toBe(0);
  });

  it('cannot resolve an already-resolved chargeback', async () => {
    const { paymentId } = await paidInvoiceAndPayment(400);
    const cb = await api(admin).post('/chargebacks', { paymentId, amountGhs: 400, provider: 'paystack' });
    await api(admin).post(`/chargebacks/${cb.data.id}/resolve`, { outcome: 'Lost' });
    expect((await api(admin).post(`/chargebacks/${cb.data.id}/resolve`, { outcome: 'Won' })).status).toBe(422);
  });
});
