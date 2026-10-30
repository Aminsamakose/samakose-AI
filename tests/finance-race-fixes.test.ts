import { beforeAll, describe, expect, it } from 'vitest';
import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';

/**
 * Regression tests for the audit of finance.ts, credit-notes.ts, refunds.ts, reconciliation.ts,
 * contracts.ts and contract-templates.ts: check-then-act races with no lock behind them, found and
 * closed with the same pg_advisory_xact_lock (lockCapacityScope) pattern used elsewhere this
 * session. Each test fires two concurrent requests that would, without the fix, both pass a
 * check meant to let only one through.
 */
let finance: Session, admin: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE');
  orgId = (await makeOrg(admin)).id;
});

async function activeContract(amountGhs: number) {
  const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs })).data;
  await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
  return con.id as string;
}
async function unpaidInvoice(amount: number) {
  const con = await activeContract(amount * 2);
  const inv = (await api(finance).post('/invoices', { orgId, contractId: con, amountGhs: amount, dueDate: '2099-01-01' })).data;
  await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
  return inv.id as string;
}
async function paidInvoiceAndPayment(amount: number) {
  const invoiceId = await unpaidInvoice(amount);
  const pay = (await api(finance).post(`/invoices/${invoiceId}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: amount })).data;
  return { invoiceId, paymentId: pay.id as string };
}

describe('invoice amount vs contract value (finance.ts withinContract race)', () => {
  it('two concurrent invoices that would together exceed the contract value: only one is accepted', async () => {
    const contractId = await activeContract(1000); // room for exactly one more 1000 invoice after this
    // Use up all but 1000 of the contract headroom first, leaving exactly 1000 left to invoice.
    const [r1, r2] = await Promise.all([
      api(finance).post('/invoices', { orgId, contractId, amountGhs: 600, dueDate: '2099-01-01' }),
      api(finance).post('/invoices', { orgId, contractId, amountGhs: 600, dueDate: '2099-01-01' })
    ]);
    const statuses = [r1.status, r2.status].sort();
    // Only one of the two 600s can fit in the 1000 of headroom; the race must not let both through.
    expect(statuses).toEqual([201, 400]);
    const invoices = await db().select().from(schema.invoices).where(and(eq(schema.invoices.contractId, contractId), inArray(schema.invoices.status, ['Draft'])));
    const total = invoices.reduce((s, i) => s + Number(i.amountGhs), 0);
    expect(total).toBeLessThanOrEqual(1000);
  });
});

describe('credit note issuance vs invoice outstanding balance (credit-notes.ts race)', () => {
  it('two concurrent credit notes that would together exceed the invoice amount: only one is accepted', async () => {
    const invoiceId = await unpaidInvoice(1000);
    const [r1, r2] = await Promise.all([
      api(finance).post('/credit-notes', { invoiceId, amountGhs: 700, reason: 'Concurrent A' }),
      api(finance).post('/credit-notes', { invoiceId, amountGhs: 700, reason: 'Concurrent B' })
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 400]);
    const notes = await db().select().from(schema.creditNotes).where(and(eq(schema.creditNotes.invoiceId, invoiceId), eq(schema.creditNotes.status, 'Issued')));
    const total = notes.reduce((s, n) => s + Number(n.amountGhs), 0);
    expect(total).toBeLessThanOrEqual(1000);
  });
});

describe('credit note application vs remaining balance (credit-notes.ts race)', () => {
  it('two concurrent applications that would together exceed the credit note balance: only one is accepted', async () => {
    const issuingInvoiceId = await unpaidInvoice(1000);
    const note = (await api(finance).post('/credit-notes', { invoiceId: issuingInvoiceId, amountGhs: 300, reason: 'Goodwill' })).data;
    const target1 = await unpaidInvoice(500);
    const target2 = await unpaidInvoice(500);
    const [r1, r2] = await Promise.all([
      api(admin).post(`/credit-notes/${note.id}/apply`, { invoiceId: target1, amountGhs: 200 }),
      api(admin).post(`/credit-notes/${note.id}/apply`, { invoiceId: target2, amountGhs: 200 })
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 400]);
    const apps = await db().select().from(schema.creditNoteApplications).where(eq(schema.creditNoteApplications.creditNoteId, note.id));
    const total = apps.reduce((s, a) => s + Number(a.amountGhs), 0);
    expect(total).toBeLessThanOrEqual(300);
  });

  it('a concurrent apply and void on the same credit note never both succeed', async () => {
    const issuingInvoiceId = await unpaidInvoice(1000);
    const note = (await api(finance).post('/credit-notes', { invoiceId: issuingInvoiceId, amountGhs: 200, reason: 'Goodwill' })).data;
    const target = await unpaidInvoice(500);
    const [applyRes, voidRes] = await Promise.all([
      api(admin).post(`/credit-notes/${note.id}/apply`, { invoiceId: target, amountGhs: 200 }),
      api(admin).post(`/credit-notes/${note.id}/void`, { reason: 'Concurrent void' })
    ]);
    // Never both: either the apply wins (and void is then refused because something is applied), or
    // the void wins first (and apply is then refused because the note is no longer Issued).
    const ok = [applyRes.status, voidRes.status].filter((s) => s === 200 || s === 201);
    expect(ok.length).toBe(1);
    const [final] = await db().select().from(schema.creditNotes).where(eq(schema.creditNotes.id, note.id));
    if (final.status === 'Void') {
      const apps = await db().select().from(schema.creditNoteApplications).where(eq(schema.creditNoteApplications.creditNoteId, note.id));
      expect(apps).toHaveLength(0);
    }
  });
});

describe('refund cumulative cap vs payment amount (refunds.ts)', () => {
  it('sequential refunds can never together exceed what was actually paid', async () => {
    const { paymentId } = await paidInvoiceAndPayment(1000);
    const r1 = await api(finance).post('/refunds', { paymentId, amountGhs: 700, reason: 'First refund' });
    expect(r1.status, JSON.stringify(r1.error)).toBe(201);
    // 700 already requested, only 300 left - a second 700 must be refused even though 700 alone is <= the payment.
    const r2 = await api(finance).post('/refunds', { paymentId, amountGhs: 700, reason: 'Second refund, would overdraw' });
    expect(r2.status).toBe(400);
    const r3 = await api(finance).post('/refunds', { paymentId, amountGhs: 300, reason: 'Second refund, sized correctly' });
    expect(r3.status, JSON.stringify(r3.error)).toBe(201);
  });

  it('two concurrent refund requests that would together exceed the payment amount: only one is accepted', async () => {
    const { paymentId } = await paidInvoiceAndPayment(1000);
    const [r1, r2] = await Promise.all([
      api(finance).post('/refunds', { paymentId, amountGhs: 700, reason: 'Concurrent A' }),
      api(finance).post('/refunds', { paymentId, amountGhs: 700, reason: 'Concurrent B' })
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 400]);
    const refunds = await db().select().from(schema.refunds).where(and(eq(schema.refunds.paymentId, paymentId), inArray(schema.refunds.status, ['Requested', 'Approved', 'Processed'])));
    const total = refunds.reduce((s, r) => s + Number(r.amountGhs), 0);
    expect(total).toBeLessThanOrEqual(1000);
  });

  it('a refund cannot be double-processed (no duplicate ledger posting)', async () => {
    const { paymentId } = await paidInvoiceAndPayment(1000);
    const r = (await api(finance).post('/refunds', { paymentId, amountGhs: 150, reason: 'Service shortfall' })).data;
    await api(admin).post(`/refunds/${r.id}/approve`, {});
    const [p1, p2] = await Promise.all([
      api(admin).post(`/refunds/${r.id}/process`, {}),
      api(admin).post(`/refunds/${r.id}/process`, {})
    ]);
    const statuses = [p1.status, p2.status].sort();
    expect(statuses).toEqual([200, 422]);
    const entries = await db().select().from(schema.financialLedgerEntries).where(eq(schema.financialLedgerEntries.referenceId, r.id));
    expect(entries).toHaveLength(2); // one balanced posting (debit + credit), not two
  });
});

describe('singular contract party vs concurrent add (contracts.ts race)', () => {
  it('two concurrent attempts to add the same singular role end up with exactly one party', async () => {
    const contractId = await activeContract(1000);
    const [r1, r2] = await Promise.all([
      api(finance).post(`/contracts/${contractId}/parties`, { role: 'CLIENT', partyType: 'INDIVIDUAL', name: 'Party A' }),
      api(finance).post(`/contracts/${contractId}/parties`, { role: 'CLIENT', partyType: 'INDIVIDUAL', name: 'Party B' })
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const parties = await db().select().from(schema.contractParties).where(and(eq(schema.contractParties.contractId, contractId), eq(schema.contractParties.role, 'CLIENT')));
    expect(parties).toHaveLength(1);
  });
});

describe('payout reconciliation match race (reconciliation.ts)', () => {
  it('two different pieces of evidence matched to the same payout concurrently: only one reconciles it', async () => {
    const expert = await makeUser('EXPERT');
    await api(expert).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: expert.email, taxIdentifier: `GHA-${uniq()}` });
    await api(admin).post(`/tax-profiles/${expert.userId}/verify`, { decision: 'Verified' });

    const con = await activeContract(2000);
    const inv = (await api(finance).post('/invoices', { orgId, contractId: con, amountGhs: 1000, dueDate: '2099-01-01' })).data;
    await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
    await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: 1000 });
    const [cs] = await db().insert(schema.cases).values({ orgId }).returning();
    const [a] = await db().insert(schema.caseAssignments).values({ caseId: cs.id, userId: expert.userId, fn: 'lead', status: 'Completed', endedAt: new Date() }).returning();
    const agreement = (await api(finance).post('/revenue-share/agreements', { contractId: con, assignmentId: a.id, professionalId: expert.userId, model: 'PERCENTAGE', basis: 'SHARE_ON_COLLECTED_AMOUNT', percentage: 20 })).data;
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

    const recordTx = async (amt: number) => (await api(finance).post('/external-transactions', { provider: 'bank_transfer', providerReference: `BANKTX-${uniq()}`, amountGhs: amt, transactionDate: '2026-01-15' })).data;
    const tx1 = await recordTx(amountGhs);
    const tx2 = await recordTx(amountGhs);

    const [r1, r2] = await Promise.all([
      api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: tx1.id }),
      api(finance).post(`/payouts/${payoutId}/reconcile`, { externalTransactionId: tx2.id })
    ]);
    const matched = [r1, r2].filter((r) => r.status === 201 && r.data.outcome === 'Matched');
    // Exactly one of the two concurrent matches may actually reconcile the payout - the other must
    // see it already Reconciled and refuse, never both succeed as Matched.
    expect(matched).toHaveLength(1);
    const [payout] = await db().select().from(schema.professionalPayouts).where(eq(schema.professionalPayouts.id, payoutId));
    expect(payout.status).toBe('Reconciled');
  });
});

describe('contract template publish race (contract-templates.ts)', () => {
  it('two Draft versions of the same template published concurrently: only one ends up Published', async () => {
    const name = `Race template ${uniq()}`;
    const t1 = (await api(finance).post('/contract-templates', { name, bodyMarkdown: 'Version one body text here.' })).data;
    const t2 = (await api(finance).post(`/contract-templates/${t1.id}/new-version`, { bodyMarkdown: 'Version two body text here.' })).data;
    const [r1, r2] = await Promise.all([
      api(finance).post(`/contract-templates/${t1.id}/publish`, {}),
      api(finance).post(`/contract-templates/${t2.id}/publish`, {})
    ]);
    // Publishing one version while another publishes too is not itself an error - each publish just
    // retires whatever was Published before it. What the lock must guarantee is that the two
    // concurrent publishes are serialized, so they never both read "nothing Published yet" and both
    // end up Published at once.
    expect(r1.status, JSON.stringify(r1.error)).toBe(200);
    expect(r2.status, JSON.stringify(r2.error)).toBe(200);
    const published = await db().select().from(schema.contractTemplates).where(and(eq(schema.contractTemplates.name, name), eq(schema.contractTemplates.status, 'Published')));
    expect(published).toHaveLength(1);
    const retired = await db().select().from(schema.contractTemplates).where(and(eq(schema.contractTemplates.name, name), eq(schema.contractTemplates.status, 'Retired')));
    expect(retired).toHaveLength(1);
  });
});
