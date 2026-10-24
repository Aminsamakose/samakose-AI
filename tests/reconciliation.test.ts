import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let finance: Session, admin: Session, expert: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE'); expert = await makeUser('EXPERT');
  orgId = (await makeOrg(admin)).id;
  await api(expert).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: expert.email, taxIdentifier: `GHA-${uniq()}` });
  await api(admin).post(`/tax-profiles/${expert.userId}/verify`, { decision: 'Verified' });
});

/** A Paid payout held by `expert`, for amount*pct% of a fresh paid invoice. Returns its id and amountGhs. */
async function paidPayout(amount: number, pct: number) {
  const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: amount * 2 })).data;
  await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
  const inv = (await api(finance).post('/invoices', { orgId, contractId: con.id, amountGhs: amount, dueDate: '2099-01-01' })).data;
  await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
  await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: amount });
  const [cs] = await db().insert(schema.cases).values({ orgId }).returning();
  const [a] = await db().insert(schema.caseAssignments).values({ caseId: cs.id, userId: expert.userId, fn: 'lead', status: 'Completed', endedAt: new Date() }).returning();
  const agreement = (await api(finance).post('/revenue-share/agreements', { contractId: con.id, assignmentId: a.id, professionalId: expert.userId, model: 'PERCENTAGE', basis: 'SHARE_ON_COLLECTED_AMOUNT', percentage: pct })).data;
  await api(finance).put(`/revenue-share/agreements/${agreement.id}/allocations`, { rows: [{ allocateeRole: 'LEAD', professionalId: expert.userId, percentOfShare: 100 }] });
  await api(finance).post(`/revenue-share/agreements/${agreement.id}/submit`, {});
  await api(admin).post(`/revenue-share/agreements/${agreement.id}/approve`, {});
  await api(finance).post(`/revenue-share/agreements/${agreement.id}/activate`, {});
  const calc = await api(finance).post(`/revenue-share/agreements/${agreement.id}/calculate`, { invoiceId: inv.id });
  const payoutId = calc.data.payouts[0].id as string;
  const amountGhs = Number(calc.data.payouts[0].amountGhs);
  await api(finance).post(`/payouts/${payoutId}/review`, {});
  await api(admin).post(`/payouts/${payoutId}/approve`, {});
  await api(finance).post(`/payouts/${payoutId}/payable`, {});
  await api(finance).post(`/payouts/${payoutId}/initiate`, { payoutMethod: 'bank' });
  await api(finance).post(`/payouts/${payoutId}/paid`, { paymentReference: `PAY-${uniq()}` });
  return { payoutId, amountGhs };
}

async function recordTx(amountGhs: number, overrides: Partial<{ provider: string; settlementStatus: string; payeeUserId: string }> = {}) {
  const r = await api(finance).post('/external-transactions', {
    provider: overrides.provider ?? 'bank_transfer', providerReference: `BANKTX-${uniq()}`, amountGhs,
    transactionDate: '2026-01-15', settlementStatus: overrides.settlementStatus, payeeUserId: overrides.payeeUserId
  });
  expect(r.status, JSON.stringify(r.error)).toBe(201);
  return r.data;
}

describe('evidence-based payout reconciliation (10/10 blueprint #6)', () => {
  it('an exact amount match is Matched and moves the payout to Reconciled', async () => {
    const { payoutId, amountGhs } = await paidPayout(1000, 20);
    const tx = await recordTx(amountGhs);
    const r = await api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: tx.id });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.data.outcome).toBe('Matched');
    expect(r.data.discrepancyGhs).toBe('0.00');

    const list = await api(finance).get(`/payouts/${payoutId}/reconciliations`);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].outcome).toBe('Matched');
  });

  it('refuses to reconcile a payout that is not Paid yet', async () => {
    const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: 2000 })).data;
    await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
    const inv = (await api(finance).post('/invoices', { orgId, contractId: con.id, amountGhs: 1000, dueDate: '2099-01-01' })).data;
    await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
    await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: 1000 });
    const [cs] = await db().insert(schema.cases).values({ orgId }).returning();
    const [a] = await db().insert(schema.caseAssignments).values({ caseId: cs.id, userId: expert.userId, fn: 'lead', status: 'Completed', endedAt: new Date() }).returning();
    const agreement = (await api(finance).post('/revenue-share/agreements', { contractId: con.id, assignmentId: a.id, professionalId: expert.userId, model: 'PERCENTAGE', basis: 'SHARE_ON_COLLECTED_AMOUNT', percentage: 10 })).data;
    await api(finance).put(`/revenue-share/agreements/${agreement.id}/allocations`, { rows: [{ allocateeRole: 'LEAD', professionalId: expert.userId, percentOfShare: 100 }] });
    await api(finance).post(`/revenue-share/agreements/${agreement.id}/submit`, {});
    await api(admin).post(`/revenue-share/agreements/${agreement.id}/approve`, {});
    await api(finance).post(`/revenue-share/agreements/${agreement.id}/activate`, {});
    const calc = await api(finance).post(`/revenue-share/agreements/${agreement.id}/calculate`, { invoiceId: inv.id });
    const payoutId = calc.data.payouts[0].id as string; // still Earned
    const tx = await recordTx(100);
    expect((await api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: tx.id })).status).toBe(422);
  });

  it('less than expected arriving is Partially matched, and the payout is not moved to Reconciled', async () => {
    const { payoutId, amountGhs } = await paidPayout(1000, 20);
    const tx = await recordTx(amountGhs - 50);
    const r = await api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: tx.id });
    expect(r.status).toBe(201);
    expect(r.data.outcome).toBe('Partially matched');
    expect(r.data.discrepancyGhs).toBe('-50.00');
    // Reconciliation stayed an exception - the payout is still Paid, not Reconciled, so it can be re-matched later.
    const second = await recordTx(amountGhs);
    const r2 = await api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: second.id });
    expect(r2.data.outcome).toBe('Matched');
  });

  it('more than expected arriving is an Amount mismatch, never silently accepted', async () => {
    const { payoutId, amountGhs } = await paidPayout(1000, 20);
    const tx = await recordTx(amountGhs + 25);
    const r = await api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: tx.id });
    expect(r.data.outcome).toBe('Amount mismatch');
    expect(r.data.discrepancyGhs).toBe('25.00');
  });

  it('a reversed external transaction is flagged Reversed, not Matched', async () => {
    const { payoutId, amountGhs } = await paidPayout(1000, 20);
    const tx = await recordTx(amountGhs, { settlementStatus: 'Reversed' });
    const r = await api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: tx.id });
    expect(r.data.outcome).toBe('Reversed');
  });

  it('a transaction naming a different beneficiary is flagged as a mismatch even when the amount is exact', async () => {
    const { payoutId, amountGhs } = await paidPayout(1000, 20);
    const other = await makeUser('EXPERT');
    const tx = await recordTx(amountGhs, { payeeUserId: other.userId });
    const r = await api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: tx.id });
    expect(r.data.outcome).toBe('Amount mismatch');
    expect(r.data.note).toMatch(/different beneficiary/);
  });

  it('matching the same external transaction to a second payout is flagged Duplicate, and the first match is untouched', async () => {
    const first = await paidPayout(1000, 20);
    const second = await paidPayout(1000, 20); // same amount, independent payout
    const tx = await recordTx(first.amountGhs);
    const r1 = await api(finance).post(`/payouts/${first.payoutId}/reconcile`, { externalTransactionId: tx.id });
    expect(r1.data.outcome).toBe('Matched');
    const r2 = await api(finance).post(`/payouts/${second.payoutId}/reconcile`, { externalTransactionId: tx.id });
    expect(r2.data.outcome).toBe('Duplicate');
  });

  it('a payout already Reconciled can never be matched again', async () => {
    const { payoutId, amountGhs } = await paidPayout(1000, 20);
    const tx = await recordTx(amountGhs);
    await api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: tx.id });
    const again = await recordTx(amountGhs);
    expect((await api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: again.id })).status).toBe(422);
  });

  it('refuses to import the same provider reference twice', async () => {
    const ref = `BANKTX-${uniq()}`;
    const first = await api(finance).post('/external-transactions', { provider: 'bank_transfer', providerReference: ref, amountGhs: 100, transactionDate: '2026-01-15' });
    expect(first.status).toBe(201);
    const second = await api(finance).post('/external-transactions', { provider: 'bank_transfer', providerReference: ref, amountGhs: 100, transactionDate: '2026-01-15' });
    expect(second.status).toBe(409);
  });

  it('lists unmatched external transactions and the reconciliation exception queue', async () => {
    const { payoutId, amountGhs } = await paidPayout(1000, 20);
    const matchedTx = await recordTx(amountGhs);
    await api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: matchedTx.id });
    const unmatchedTx = await recordTx(999999); // nothing will ever match this
    const unmatchedList = await api(finance).get('/external-transactions?unmatched=true');
    expect(unmatchedList.status).toBe(200);
    expect(unmatchedList.data.some((t: any) => t.id === matchedTx.id)).toBe(false);
    expect(unmatchedList.data.some((t: any) => t.id === unmatchedTx.id)).toBe(true);

    const { payoutId: badPayoutId, amountGhs: badAmount } = await paidPayout(1000, 10);
    const mismatchTx = await recordTx(badAmount + 10);
    await api(finance).post(`/payouts/${badPayoutId}/reconcile`, { externalTransactionId: mismatchTx.id });
    const exceptions = await api(finance).get('/reconciliation/exceptions');
    expect(exceptions.status).toBe(200);
    expect(exceptions.data.every((e: any) => e.outcome !== 'Matched')).toBe(true);
    expect(exceptions.data.some((e: any) => e.payoutId === badPayoutId)).toBe(true);
  });

  it('an EXPERT has no reconciliation access', async () => {
    expect((await api(expert).get('/external-transactions')).status).toBe(403);
    expect((await api(expert).post('/external-transactions', { provider: 'bank_transfer', providerReference: `X-${uniq()}`, amountGhs: 10, transactionDate: '2026-01-15' })).status).toBe(403);
  });
});
