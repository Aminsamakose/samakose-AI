import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

/**
 * #201 Phase 0: a professional's own tax identity, and the one thing the payout lifecycle actually
 * needs from it -- a payout cannot reach Payable for a professional whose tax profile is missing or
 * not yet verified by someone other than themselves (Payouts & Compliance design, Component 2 and the
 * payout eligibility rules table).
 */
let admin: Session, finance: Session, executive: Session, expert: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); finance = await makeUser('FINANCE'); executive = await makeUser('EXECUTIVE');
  expert = await makeUser('EXPERT');
  orgId = (await makeOrg(admin)).id;
});

describe('submitting a tax profile', () => {
  it('requires a party type, legal name and identifier', async () => {
    const p = await makeUser('EXPERT');
    expect((await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: '', taxIdentifier: `GHA-${uniq()}` })).status).toBe(400);
    expect((await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: p.email, taxIdentifier: '' })).status).toBe(400);
    expect((await api(p).put('/tax-profiles/me', { partyType: 'NOT-A-TYPE', legalName: p.email, taxIdentifier: `GHA-${uniq()}` })).status).toBe(400);
  });

  it('starts Submitted, defaults residency to GH, and a professional can only see their own', async () => {
    const p = await makeUser('EXPERT');
    const r = await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: p.email, taxIdentifier: `GHA-${uniq()}` });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.data.status).toBe('Submitted');
    expect(r.data.taxResidency).toBe('GH');
    expect((await api(p).get('/tax-profiles/me')).data.userId).toBe(p.userId);
  });

  it('re-submitting resets a Verified profile back to Submitted and clears the prior verification', async () => {
    const p = await makeUser('EXPERT');
    await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: p.email, taxIdentifier: `GHA-${uniq()}` });
    await api(admin).post(`/tax-profiles/${p.userId}/verify`, { decision: 'Verified' });
    const r = await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: p.email, taxIdentifier: `GHA-${uniq()}` });
    expect(r.data.status).toBe('Submitted');
    expect(r.data.verifiedBy).toBeNull();
    expect(r.data.verifiedAt).toBeNull();
  });
});

describe('verifying a tax profile', () => {
  it('a professional cannot verify their own tax profile', async () => {
    const p = await makeUser('EXPERT');
    await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: p.email, taxIdentifier: `GHA-${uniq()}` });
    expect((await api(p).post(`/tax-profiles/${p.userId}/verify`, { decision: 'Verified' })).status).toBe(403);
  });

  it('an expert cannot verify someone else\'s tax profile either (no verify grant at all)', async () => {
    const p = await makeUser('EXPERT');
    await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: p.email, taxIdentifier: `GHA-${uniq()}` });
    expect((await api(expert).post(`/tax-profiles/${p.userId}/verify`, { decision: 'Verified' })).status).toBe(403);
  });

  it('finance and admin can verify or reject someone else\'s profile, with a note', async () => {
    const p = await makeUser('EXPERT');
    await api(p).put('/tax-profiles/me', { partyType: 'ORGANISATION', legalName: 'Some Co Ltd', taxIdentifier: `TIN-${uniq()}` });
    const r = await api(finance).post(`/tax-profiles/${p.userId}/verify`, { decision: 'Rejected', note: 'Identifier does not match legal name' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.data.status).toBe('Rejected');
    expect(r.data.verificationNote).toBe('Identifier does not match legal name');

    const r2 = await api(admin).post(`/tax-profiles/${p.userId}/verify`, { decision: 'Verified' });
    expect(r2.data.status).toBe('Verified');
    expect(r2.data.verifiedBy).toBe(admin.userId);
  });

  it('lists profiles filtered by status, for the finance verification queue', async () => {
    const p = await makeUser('EXPERT');
    await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: p.email, taxIdentifier: `GHA-${uniq()}` });
    const r = await api(finance).get('/tax-profiles?status=Submitted');
    expect(r.status).toBe(200);
    expect(r.data.some((row: any) => row.userId === p.userId)).toBe(true);
  });
});

describe('the payout eligibility gate', () => {
  async function paidInvoiceWithEndedAssignment(amount: number, professional: Session) {
    const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: amount * 2 })).data;
    await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
    const inv = (await api(finance).post('/invoices', { orgId, contractId: con.id, amountGhs: amount, dueDate: '2099-01-01' })).data;
    await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
    await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: amount });
    const [cs] = await db().insert(schema.cases).values({ orgId }).returning();
    const [a] = await db().insert(schema.caseAssignments).values({ caseId: cs.id, userId: professional.userId, fn: 'lead', status: 'Completed', endedAt: new Date() }).returning();
    return { contractId: con.id, invoiceId: inv.id, assignmentId: a.id };
  }

  async function payableAttempt(professional: Session, amount = 1000) {
    const { contractId, invoiceId, assignmentId } = await paidInvoiceWithEndedAssignment(amount, professional);
    const agreement = (await api(finance).post('/revenue-share/agreements', { contractId, assignmentId, professionalId: professional.userId, model: 'PERCENTAGE', basis: 'SHARE_ON_NET_PRICE', percentage: 30 })).data;
    await api(finance).put(`/revenue-share/agreements/${agreement.id}/allocations`, { rows: [{ allocateeRole: 'LEAD', professionalId: professional.userId, percentOfShare: 100 }] });
    await api(finance).post(`/revenue-share/agreements/${agreement.id}/submit`, {});
    await api(executive).post(`/revenue-share/agreements/${agreement.id}/approve`, {});
    await api(finance).post(`/revenue-share/agreements/${agreement.id}/activate`, {});
    const calc = await api(finance).post(`/revenue-share/agreements/${agreement.id}/calculate`, { invoiceId });
    const payoutId = calc.data.payouts[0].id;
    await api(finance).post(`/payouts/${payoutId}/review`, {});
    await api(admin).post(`/payouts/${payoutId}/approve`, {});
    return payoutId as string;
  }

  it('blocks Payable when the professional has no tax profile at all', async () => {
    const p = await makeUser('EXPERT');
    const payoutId = await payableAttempt(p);
    const r = await api(finance).post(`/payouts/${payoutId}/payable`, {});
    expect(r.status).toBe(422);
    expect(r.error?.message ?? JSON.stringify(r.error)).toMatch(/tax profile/i);
  });

  it('blocks Payable while the profile is only Submitted, not yet Verified', async () => {
    const p = await makeUser('EXPERT');
    await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: p.email, taxIdentifier: `GHA-${uniq()}` });
    const payoutId = await payableAttempt(p);
    expect((await api(finance).post(`/payouts/${payoutId}/payable`, {})).status).toBe(422);
  });

  it('blocks Payable when the profile was Rejected', async () => {
    const p = await makeUser('EXPERT');
    await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: p.email, taxIdentifier: `GHA-${uniq()}` });
    await api(admin).post(`/tax-profiles/${p.userId}/verify`, { decision: 'Rejected', note: 'Mismatch' });
    const payoutId = await payableAttempt(p);
    expect((await api(finance).post(`/payouts/${payoutId}/payable`, {})).status).toBe(422);
  });

  it('allows Payable once the profile is Verified', async () => {
    const p = await makeUser('EXPERT');
    await api(p).put('/tax-profiles/me', { partyType: 'INDIVIDUAL', legalName: p.email, taxIdentifier: `GHA-${uniq()}` });
    await api(admin).post(`/tax-profiles/${p.userId}/verify`, { decision: 'Verified' });
    const payoutId = await payableAttempt(p);
    expect((await api(finance).post(`/payouts/${payoutId}/payable`, {})).status).toBe(200);
  });
});
