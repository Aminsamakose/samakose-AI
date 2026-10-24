import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { computeTaxAmount } from '@/services/tax';

let finance: Session, admin: Session, executive: Session, expert: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE'); executive = await makeUser('EXECUTIVE'); expert = await makeUser('EXPERT');
  orgId = (await makeOrg(admin)).id;
  // The payout-eligibility gate (#201 Phase 0) requires a Verified tax profile before /payable.
  await api(expert).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: expert.email, taxIdentifier: `GHA-${uniq()}` });
  await api(admin).post(`/tax-profiles/${expert.userId}/verify`, { decision: 'Verified' });
});

/** An Approved (not yet Payable) payout held by `expert`, for amount*pct% of a fresh paid invoice. */
async function approvedPayout(amount: number, pct: number) {
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
  return payoutId;
}

async function paidInvoice(amount: number) {
  const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: amount * 2 })).data;
  await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
  const inv = (await api(finance).post('/invoices', { orgId, contractId: con.id, amountGhs: amount, dueDate: '2099-01-01' })).data;
  await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
  await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: amount });
  return inv.id as string;
}

describe('computeTaxAmount (pure)', () => {
  it('adds an exclusive-of-price tax on top', () => {
    expect(computeTaxAmount(100, 15, false)).toBe(15);
  });
  it('extracts an inclusive-of-price tax from the total', () => {
    // 115 inclusive at 15% VAT -> 15 tax, 100 net: 115 * 15/115 = 15
    expect(computeTaxAmount(115, 15, true)).toBe(15);
  });
  it('rounds to the cent', () => {
    expect(computeTaxAmount(33.33, 12.5, false)).toBe(4.17);
  });
});

describe('tax rules: versioning', () => {
  it('starts a (type, jurisdiction) pair at version 1 and increments on the next rule for the same pair', async () => {
    const j = `GH-${uniq()}`;
    const r1 = await api(admin).post('/tax-rules', { type: 'VAT', rate: 15, jurisdiction: j, effectiveFrom: '2026-01-01' });
    expect(r1.status, JSON.stringify(r1.error)).toBe(201);
    expect(r1.data.ruleVersion).toBe(1);
    const r2 = await api(admin).post('/tax-rules', { type: 'VAT', rate: 17.5, jurisdiction: j, effectiveFrom: '2027-01-01' });
    expect(r2.data.ruleVersion).toBe(2);
    // a different jurisdiction starts its own sequence at 1
    const other = await api(admin).post('/tax-rules', { type: 'VAT', rate: 10, jurisdiction: `GH-${uniq()}`, effectiveFrom: '2026-01-01' });
    expect(other.data.ruleVersion).toBe(1);
  });
  it('a non-admin/finance role cannot create a tax rule', async () => {
    const exec = await makeUser('EXECUTIVE');
    expect((await api(exec).post('/tax-rules', { type: 'VAT', rate: 15, jurisdiction: `GH-${uniq()}`, effectiveFrom: '2026-01-01' })).status).toBe(403);
  });
});

describe('applying tax to an invoice', () => {
  it('posts a balanced ledger entry and records the rule version used', async () => {
    const j = `GH-${uniq()}`;
    await api(admin).post('/tax-rules', { type: 'VAT', rate: 15, jurisdiction: j, effectiveFrom: '2020-01-01' });
    const invoiceId = await paidInvoice(1000);
    const r = await api(finance).post('/tax-lines', { invoiceId, type: 'VAT', jurisdiction: j, baseAmountGhs: 1000 });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.data.amountGhs).toBe('150.00');
    expect(r.data.ruleVersion).toBe(1);
    const entries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, invoiceId));
    expect(entries.reduce((s, e) => s + Number(e.debitGhs) - Number(e.creditGhs), 0)).toBe(0);
  });
  it('returns null and posts nothing when no rule is configured for the jurisdiction', async () => {
    const invoiceId = await paidInvoice(500);
    const r = await api(finance).post('/tax-lines', { invoiceId, type: 'WITHHOLDING', jurisdiction: `UNCONFIGURED-${uniq()}`, baseAmountGhs: 500 });
    expect(r.status).toBe(200);
    expect(r.data).toBeNull();
  });
  it('a rule effective only in the future does not apply today', async () => {
    const j = `GH-${uniq()}`;
    await api(admin).post('/tax-rules', { type: 'VAT', rate: 15, jurisdiction: j, effectiveFrom: '2099-01-01' });
    const invoiceId = await paidInvoice(400);
    const r = await api(finance).post('/tax-lines', { invoiceId, type: 'VAT', jurisdiction: j, baseAmountGhs: 400 });
    expect(r.data).toBeNull();
  });
  it('refuses to specify both invoiceId and payoutId, or neither', async () => {
    const j = `GH-${uniq()}`;
    await api(admin).post('/tax-rules', { type: 'VAT', rate: 15, jurisdiction: j, effectiveFrom: '2020-01-01' });
    const invoiceId = await paidInvoice(100);
    expect((await api(finance).post('/tax-lines', { type: 'VAT', jurisdiction: j, baseAmountGhs: 100 })).status).toBe(400);
  });
});

describe('applying withholding tax to a payout (#202)', () => {
  it('reduces PROFESSIONAL_PAYABLE and credits TAX_PAYABLE, never touching REVENUE a second time', async () => {
    const j = `GH-${uniq()}`;
    await api(admin).post('/tax-rules', { type: 'WITHHOLDING', rate: 10, jurisdiction: j, effectiveFrom: '2020-01-01' });
    const payoutId = await approvedPayout(1000, 30); // professional's gross payout is 300

    const r = await api(finance).post('/tax-lines', { payoutId, type: 'WITHHOLDING', jurisdiction: j, baseAmountGhs: 300 });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.data.amountGhs).toBe('30.00');

    const entries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, payoutId));
    expect(entries).toHaveLength(2); // one row per account line: debit PROFESSIONAL_PAYABLE, credit TAX_PAYABLE
    const byAccount: Record<string, { debit: number; credit: number }> = {};
    for (const e of entries) {
      const code = (await db().select({ code: schema.financialAccounts.code }).from(schema.financialAccounts).where(eq(schema.financialAccounts.id, e.accountId)).limit(1))[0].code;
      byAccount[code] = { debit: Number(e.debitGhs), credit: Number(e.creditGhs) };
    }
    expect(byAccount.PROFESSIONAL_PAYABLE).toEqual({ debit: 30, credit: 0 });
    expect(byAccount.TAX_PAYABLE).toEqual({ debit: 0, credit: 30 });
    expect(byAccount.REVENUE).toBeUndefined();
    expect(entries.reduce((s, e) => s + Number(e.debitGhs) - Number(e.creditGhs), 0)).toBe(0);
  });

  it('reduces the payout\'s netAmountGhs, and markPaid() disburses the net, not the gross', async () => {
    const j = `GH-${uniq()}`;
    await api(admin).post('/tax-rules', { type: 'WITHHOLDING', rate: 10, jurisdiction: j, effectiveFrom: '2020-01-01' });
    const payoutId = await approvedPayout(1000, 30); // gross 300
    await api(finance).post('/tax-lines', { payoutId, type: 'WITHHOLDING', jurisdiction: j, baseAmountGhs: 300 });

    const before = await db().select().from(schema.professionalPayouts).where(eq(schema.professionalPayouts.id, payoutId)).limit(1);
    expect(before[0].amountGhs).toBe('300.00');
    expect(before[0].taxWithheldGhs).toBe('30.00');
    expect(before[0].netAmountGhs).toBe('270.00');

    await api(finance).post(`/payouts/${payoutId}/payable`, {});
    await api(finance).post(`/payouts/${payoutId}/initiate`, { payoutMethod: 'bank' });
    expect((await api(finance).post(`/payouts/${payoutId}/paid`, { paymentReference: `PAY-${uniq()}` })).status).toBe(200);

    const entries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, payoutId));
    // withholding posting (2 rows) + payment posting (2 rows)
    expect(entries).toHaveLength(4);
    const paymentEntry = entries.find((e) => Number(e.debitGhs) > 0 && Number(e.debitGhs) !== 30);
    expect(Number(paymentEntry?.debitGhs)).toBe(270);
  });

  it('a payout with no withholding applied still disburses the full gross amount (unchanged, backward compatible)', async () => {
    const payoutId = await approvedPayout(1000, 20); // gross 200, no tax-lines ever applied
    await api(finance).post(`/payouts/${payoutId}/payable`, {});
    await api(finance).post(`/payouts/${payoutId}/initiate`, { payoutMethod: 'bank' });
    await api(finance).post(`/payouts/${payoutId}/paid`, { paymentReference: `PAY-${uniq()}` });
    const entries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, payoutId));
    expect(entries).toHaveLength(2); // debit PROFESSIONAL_PAYABLE, credit CASH
    const debitEntry = entries.find((e) => Number(e.debitGhs) > 0);
    expect(Number(debitEntry?.debitGhs)).toBe(200);
  });
});
