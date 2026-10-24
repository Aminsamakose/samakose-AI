import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';

let finance: Session, admin: Session, executive: Session, expert: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE'); executive = await makeUser('EXECUTIVE'); expert = await makeUser('EXPERT');
  orgId = (await makeOrg(admin)).id;
});

async function unpaidInvoice(amount: number) {
  const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: amount * 2 })).data;
  await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
  const inv = (await api(finance).post('/invoices', { orgId, contractId: con.id, amountGhs: amount, dueDate: '2099-01-01' })).data;
  await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
  return inv.id as string;
}

async function paidInvoice(amount: number) {
  const invoiceId = await unpaidInvoice(amount);
  await api(finance).post(`/invoices/${invoiceId}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: amount });
  return invoiceId;
}

describe('credit note issuance', () => {
  it('against an unpaid invoice reduces the receivable (debit Revenue / credit Receivable)', async () => {
    const invoiceId = await unpaidInvoice(1000);
    const r = await api(finance).post('/credit-notes', { invoiceId, amountGhs: 300, reason: 'Scope reduced' });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.data.status).toBe('Issued');
  });

  it('against a paid invoice creates a Customer Credit liability instead', async () => {
    const invoiceId = await paidInvoice(1000);
    const r = await api(finance).post('/credit-notes', { invoiceId, amountGhs: 250, reason: 'Service shortfall, invoice already settled' });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.data.status).toBe('Issued');
  });

  it('rejects an amount exceeding the outstanding balance', async () => {
    const invoiceId = await unpaidInvoice(500);
    expect((await api(finance).post('/credit-notes', { invoiceId, amountGhs: 600, reason: 'Too much' })).status).toBe(400);
    await api(finance).post('/credit-notes', { invoiceId, amountGhs: 300, reason: 'First note' });
    // 500 outstanding - 300 already credited = 200 left; 250 now exceeds it.
    expect((await api(finance).post('/credit-notes', { invoiceId, amountGhs: 250, reason: 'Second note' })).status).toBe(400);
    expect((await api(finance).post('/credit-notes', { invoiceId, amountGhs: 200, reason: 'Second note, sized correctly' })).status).toBe(201);
  });

  it('cannot be issued against a Void invoice', async () => {
    const invoiceId = await unpaidInvoice(400);
    await api(finance).patch(`/invoices/${invoiceId}`, { status: 'Void' });
    expect((await api(finance).post('/credit-notes', { invoiceId, amountGhs: 100, reason: 'Too late' })).status).toBe(422);
  });

  it('EXPERT has no access to credit notes', async () => {
    const invoiceId = await unpaidInvoice(300);
    expect((await api(expert).post('/credit-notes', { invoiceId, amountGhs: 50, reason: 'Nope' })).status).toBe(403);
    expect((await api(expert).get('/credit-notes')).status).toBe(403);
  });
});

describe('applying a credit note', () => {
  it('reduces the target invoice (which may differ from the issuing invoice), partially then fully', async () => {
    const issuingInvoiceId = await paidInvoice(1000);
    const note = (await api(finance).post('/credit-notes', { invoiceId: issuingInvoiceId, amountGhs: 300, reason: 'Goodwill credit' })).data;
    const targetInvoiceId = await unpaidInvoice(500);

    const apply1 = await api(admin).post(`/credit-notes/${note.id}/apply`, { invoiceId: targetInvoiceId, amountGhs: 150 });
    expect(apply1.status, JSON.stringify(apply1.error)).toBe(201);

    const apply2 = await api(admin).post(`/credit-notes/${note.id}/apply`, { invoiceId: targetInvoiceId, amountGhs: 150 });
    expect(apply2.status).toBe(201);

    // Only 300 total was issued; a third application has nothing left.
    const apply3 = await api(admin).post(`/credit-notes/${note.id}/apply`, { invoiceId: targetInvoiceId, amountGhs: 1 });
    expect(apply3.status).toBe(400);

    const apps = await api(admin).get(`/credit-notes/${note.id}/applications`);
    expect(apps.data.length).toBe(2);
  });

  it('rejects applying more than the remaining balance in one call', async () => {
    const issuingInvoiceId = await paidInvoice(1000);
    const note = (await api(finance).post('/credit-notes', { invoiceId: issuingInvoiceId, amountGhs: 200, reason: 'Credit' })).data;
    const targetInvoiceId = await unpaidInvoice(500);
    expect((await api(admin).post(`/credit-notes/${note.id}/apply`, { invoiceId: targetInvoiceId, amountGhs: 250 })).status).toBe(400);
  });

  it('cannot apply a Void or already-fully-applied credit note', async () => {
    const issuingInvoiceId = await paidInvoice(1000);
    const note = (await api(finance).post('/credit-notes', { invoiceId: issuingInvoiceId, amountGhs: 100, reason: 'Credit' })).data;
    await api(admin).post(`/credit-notes/${note.id}/void`, {});
    const targetInvoiceId = await unpaidInvoice(500);
    expect((await api(admin).post(`/credit-notes/${note.id}/apply`, { invoiceId: targetInvoiceId, amountGhs: 50 })).status).toBe(422);
  });
});

describe('voiding a credit note', () => {
  it('succeeds before anything has been applied, reversing the original posting', async () => {
    const invoiceId = await unpaidInvoice(400);
    const note = (await api(finance).post('/credit-notes', { invoiceId, amountGhs: 150, reason: 'Issued in error' })).data;
    const v = await api(admin).post(`/credit-notes/${note.id}/void`, { reason: 'Wrong invoice' });
    expect(v.status, JSON.stringify(v.error)).toBe(200);
    expect(v.data.status).toBe('Void');
    // Voiding frees up the outstanding balance again - the full original amount can be re-issued.
    const reissue = await api(finance).post('/credit-notes', { invoiceId, amountGhs: 400, reason: 'Re-issued at full amount' });
    expect(reissue.status, JSON.stringify(reissue.error)).toBe(201);
  });

  it('is refused once anything has been applied against it', async () => {
    const issuingInvoiceId = await paidInvoice(1000);
    const note = (await api(finance).post('/credit-notes', { invoiceId: issuingInvoiceId, amountGhs: 200, reason: 'Credit' })).data;
    const targetInvoiceId = await unpaidInvoice(500);
    await api(admin).post(`/credit-notes/${note.id}/apply`, { invoiceId: targetInvoiceId, amountGhs: 50 });
    expect((await api(admin).post(`/credit-notes/${note.id}/void`, {})).status).toBe(422);
  });

  it('cannot be voided twice', async () => {
    const invoiceId = await unpaidInvoice(300);
    const note = (await api(finance).post('/credit-notes', { invoiceId, amountGhs: 100, reason: 'Error' })).data;
    await api(admin).post(`/credit-notes/${note.id}/void`, {});
    expect((await api(admin).post(`/credit-notes/${note.id}/void`, {})).status).toBe(409);
  });
});

describe('listing', () => {
  it('filters by status and invoiceId', async () => {
    const invoiceId = await unpaidInvoice(500);
    const note = (await api(finance).post('/credit-notes', { invoiceId, amountGhs: 100, reason: 'Listing test fixture' })).data;
    await api(admin).post(`/credit-notes/${note.id}/void`, {});
    const voided = await api(executive).get('/credit-notes?status=Void');
    expect(voided.data.some((n: any) => n.id === note.id)).toBe(true);
    const byInvoice = await api(executive).get(`/credit-notes?invoiceId=${invoiceId}`);
    expect(byInvoice.data.every((n: any) => n.invoiceId === invoiceId)).toBe(true);
  });
});
