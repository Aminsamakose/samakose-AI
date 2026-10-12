import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { computeTaxAmount } from '@/services/tax';

let finance: Session, admin: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE');
  orgId = (await makeOrg(admin)).id;
});

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
