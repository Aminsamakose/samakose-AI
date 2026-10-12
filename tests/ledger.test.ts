import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let finance: Session, admin: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE');
  const o = await makeOrg(admin); orgId = o.id;
});

async function accountId(code: string) {
  const [row] = await db().select({ id: schema.financialAccounts.id }).from(schema.financialAccounts).where(eq(schema.financialAccounts.code, code)).limit(1);
  expect(row, `account ${code} should be seeded`).toBeTruthy();
  return row.id;
}
async function entriesFor(referenceType: string, referenceId: string) {
  return db().select().from(schema.financialLedgerEntries).where(and(eq(schema.financialLedgerEntries.referenceType, referenceType), eq(schema.financialLedgerEntries.referenceId, referenceId)));
}

describe('financial ledger (wired to invoice/payment events only)', () => {
  it('seeds the fixed chart of accounts idempotently', async () => {
    for (const code of ['RECEIVABLE', 'CASH', 'PAYSTACK_CLEARING', 'REVENUE', 'PAYABLE', 'TAX_PAYABLE', 'DISCOUNT_CONTRA']) await accountId(code);
  });

  it('posts a balanced Receivable/Revenue entry when an invoice is sent, and a reversal when voided', async () => {
    const inv = (await api(finance).post('/invoices', { orgId, amountGhs: 777, dueDate: '2099-01-01' })).data;
    expect((await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' })).status).toBe(200);

    const sentEntries = await entriesFor('INVOICE', inv.id);
    expect(sentEntries).toHaveLength(2);
    const receivable = await accountId('RECEIVABLE'), revenue = await accountId('REVENUE');
    const debit = sentEntries.find((e) => e.accountId === receivable)!, credit = sentEntries.find((e) => e.accountId === revenue)!;
    expect(Number(debit.debitGhs)).toBe(777); expect(Number(debit.creditGhs)).toBe(0);
    expect(Number(credit.creditGhs)).toBe(777); expect(Number(credit.debitGhs)).toBe(0);

    expect((await api(finance).patch(`/invoices/${inv.id}`, { status: 'Void' })).status).toBe(200);
    const afterVoid = await entriesFor('INVOICE', inv.id);
    expect(afterVoid).toHaveLength(4); // the original posting plus its reversal; nothing is ever updated or deleted
    const totalDebitReceivable = afterVoid.filter((e) => e.accountId === receivable).reduce((s, e) => s + Number(e.debitGhs) - Number(e.creditGhs), 0);
    expect(totalDebitReceivable).toBe(0); // fully reversed
  });

  it('does not post anything for a Draft invoice, only once it is Sent', async () => {
    const inv = (await api(finance).post('/invoices', { orgId, amountGhs: 50, dueDate: '2099-01-01' })).data;
    expect(await entriesFor('INVOICE', inv.id)).toHaveLength(0);
  });

  it('posts a balanced Cash/Receivable entry when a manual payment settles an invoice', async () => {
    const inv = (await api(finance).post('/invoices', { orgId, amountGhs: 400, dueDate: '2099-01-01' })).data;
    await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
    const pay = (await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: 400 })).data;

    const paymentEntries = await entriesFor('PAYMENT', pay.id);
    expect(paymentEntries).toHaveLength(2);
    const cash = await accountId('CASH'), receivable = await accountId('RECEIVABLE');
    expect(Number(paymentEntries.find((e) => e.accountId === cash)!.debitGhs)).toBe(400);
    expect(Number(paymentEntries.find((e) => e.accountId === receivable)!.creditGhs)).toBe(400);

    // The invoice-level Receivable debit (on Sent) and the payment-level Receivable credit (on settle) net to zero.
    const invoiceEntries = await entriesFor('INVOICE', inv.id);
    const net = [...invoiceEntries, ...paymentEntries].filter((e) => e.accountId === receivable).reduce((s, e) => s + Number(e.debitGhs) - Number(e.creditGhs), 0);
    expect(net).toBe(0);
  });

  it('enforces append-only at the database level even from real application code', async () => {
    const inv = (await api(finance).post('/invoices', { orgId, amountGhs: 10, dueDate: '2099-01-01' })).data;
    await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
    const [row] = await entriesFor('INVOICE', inv.id);
    await expect(db().update(schema.financialLedgerEntries).set({ description: 'tampered' }).where(eq(schema.financialLedgerEntries.id, row.id))).rejects.toThrow();
    await expect(db().delete(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.id, row.id))).rejects.toThrow();
  });

  it('resolves (and reuses) the current calendar-month financial period', async () => {
    const inv1 = (await api(finance).post('/invoices', { orgId, amountGhs: 5, dueDate: '2099-01-01' })).data;
    await api(finance).patch(`/invoices/${inv1.id}`, { status: 'Sent' });
    const inv2 = (await api(finance).post('/invoices', { orgId, amountGhs: 5, dueDate: '2099-01-01' })).data;
    await api(finance).patch(`/invoices/${inv2.id}`, { status: 'Sent' });
    const [e1] = await entriesFor('INVOICE', inv1.id), [e2] = await entriesFor('INVOICE', inv2.id);
    expect(e1.periodId).toBe(e2.periodId); // same month, same period row, created at most once
  });
});
