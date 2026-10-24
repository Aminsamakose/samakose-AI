import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let finance: Session, admin: Session, executive: Session, expert: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE'); executive = await makeUser('EXECUTIVE'); expert = await makeUser('EXPERT');
  orgId = (await makeOrg(admin)).id;
});

/** A paid-out revenue-share payout held by `expert`, for amount*pct%. */
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
  await api(executive).post(`/revenue-share/agreements/${agreement.id}/approve`, {});
  await api(finance).post(`/revenue-share/agreements/${agreement.id}/activate`, {});
  const calc = await api(finance).post(`/revenue-share/agreements/${agreement.id}/calculate`, { invoiceId: inv.id });
  const payoutId = calc.data.payouts[0].id as string;
  await api(finance).post(`/payouts/${payoutId}/review`, {});
  await api(admin).post(`/payouts/${payoutId}/approve`, {});
  await api(finance).post(`/payouts/${payoutId}/payable`, {});
  await api(finance).post(`/payouts/${payoutId}/initiate`, { payoutMethod: 'bank' });
  await api(finance).post(`/payouts/${payoutId}/paid`, { paymentReference: `PAY-${uniq()}` });
  return payoutId;
}

async function withholdingTaxLine(payoutId: string, baseAmountGhs: number) {
  const j = `GH-${uniq()}`;
  await api(admin).post('/tax-rules', { type: 'WITHHOLDING', rate: 10, jurisdiction: j, effectiveFrom: '2020-01-01' });
  const r = await api(finance).post('/tax-lines', { payoutId, type: 'WITHHOLDING', jurisdiction: j, baseAmountGhs });
  expect(r.status, JSON.stringify(r.error)).toBe(201);
  return r.data.id as string;
}

describe('tax certificates', () => {
  it('requires a payout-side tax line - rejects an invoice-side VAT line', async () => {
    const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: 2000 })).data;
    await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
    const inv = (await api(finance).post('/invoices', { orgId, contractId: con.id, amountGhs: 1000, dueDate: '2099-01-01' })).data;
    await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
    await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: 1000 });
    const j = `GH-${uniq()}`;
    await api(admin).post('/tax-rules', { type: 'VAT', rate: 15, jurisdiction: j, effectiveFrom: '2020-01-01' });
    const line = await api(finance).post('/tax-lines', { invoiceId: inv.id, type: 'VAT', jurisdiction: j, baseAmountGhs: 1000 });
    const r = await api(finance).post('/tax-certificates', { taxLineId: line.data.id, periodLabel: '2026-Q1' });
    expect(r.status).toBe(422);
  });

  it('issues a certificate for a payout withholding line, carrying its amount and payee', async () => {
    const payoutId = await paidPayout(1000, 30);
    const lineId = await withholdingTaxLine(payoutId, 300);
    const r = await api(finance).post('/tax-certificates', { taxLineId: lineId, periodLabel: '2026-Q1' });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.data.payeeId).toBe(expert.userId);
    expect(r.data.amountGhs).toBe('30.00');
  });

  it('rejects issuing a second certificate for the same tax line', async () => {
    const payoutId = await paidPayout(1000, 30);
    const lineId = await withholdingTaxLine(payoutId, 300);
    await api(finance).post('/tax-certificates', { taxLineId: lineId, periodLabel: '2026-Q1' });
    const r = await api(finance).post('/tax-certificates', { taxLineId: lineId, periodLabel: '2026-Q1' });
    expect(r.status).toBe(409);
  });

  it('lists certificates by payee', async () => {
    const payoutId = await paidPayout(1000, 30);
    const lineId = await withholdingTaxLine(payoutId, 300);
    await api(finance).post('/tax-certificates', { taxLineId: lineId, periodLabel: '2026-Q1' });
    const r = await api(finance).get(`/tax-certificates?payeeId=${expert.userId}`);
    expect(r.status).toBe(200);
    expect(r.data.some((c: any) => c.taxLineId === lineId)).toBe(true);
  });
});

describe('tax remittances', () => {
  it('bundles lines into a batch, computes the total, then marks it remitted', async () => {
    const p1 = await paidPayout(1000, 30), p2 = await paidPayout(2000, 30);
    const l1 = await withholdingTaxLine(p1, 300), l2 = await withholdingTaxLine(p2, 600);
    const batch = await api(finance).post('/tax-remittances', { periodLabel: '2026-Q1', type: 'WITHHOLDING', taxLineIds: [l1, l2] });
    expect(batch.status, JSON.stringify(batch.error)).toBe(201);
    expect(batch.data.totalAmountGhs).toBe('90.00');
    expect(batch.data.status).toBe('Pending');

    const remit = await api(finance).post(`/tax-remittances/${batch.data.id}/remit`, { paymentReference: `GRA-${uniq()}` });
    expect(remit.status, JSON.stringify(remit.error)).toBe(200);

    const got = await api(finance).get(`/tax-remittances/${batch.data.id}`);
    expect(got.data.remittance.status).toBe('Remitted');
    expect(got.data.lines).toHaveLength(2);
  });

  it('rejects a second remittance of an already-remitted tax line', async () => {
    const payoutId = await paidPayout(1000, 30);
    const lineId = await withholdingTaxLine(payoutId, 300);
    await api(finance).post('/tax-remittances', { periodLabel: '2026-Q1', type: 'WITHHOLDING', taxLineIds: [lineId] });
    const r = await api(finance).post('/tax-remittances', { periodLabel: '2026-Q1', type: 'WITHHOLDING', taxLineIds: [lineId] });
    expect(r.status).toBe(409);
  });

  it('rejects a batch whose declared type does not match every line', async () => {
    const payoutId = await paidPayout(1000, 30);
    const lineId = await withholdingTaxLine(payoutId, 300);
    const r = await api(finance).post('/tax-remittances', { periodLabel: '2026-Q1', type: 'VAT', taxLineIds: [lineId] });
    expect(r.status).toBe(400);
  });

  it('lists remittances filtered by status', async () => {
    const payoutId = await paidPayout(1000, 30);
    const lineId = await withholdingTaxLine(payoutId, 300);
    const batch = (await api(finance).post('/tax-remittances', { periodLabel: '2026-Q1', type: 'WITHHOLDING', taxLineIds: [lineId] })).data;
    const pending = await api(finance).get('/tax-remittances?status=Pending');
    expect(pending.data.some((r: any) => r.id === batch.id)).toBe(true);
    await api(finance).post(`/tax-remittances/${batch.id}/remit`, { paymentReference: `GRA-${uniq()}` });
    const remitted = await api(finance).get('/tax-remittances?status=Remitted');
    expect(remitted.data.some((r: any) => r.id === batch.id)).toBe(true);
  });
});

describe('access control', () => {
  it('an expert has no access to tax reporting', async () => {
    expect((await api(expert).get('/tax-certificates')).status).toBe(403);
    expect((await api(expert).get('/tax-remittances')).status).toBe(403);
  });
});
