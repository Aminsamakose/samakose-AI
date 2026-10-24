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

/** One contract and one ended assignment for `expert`, shared by every agreement a test proposes against it. */
async function sharedAssignment() {
  const con = (await api(finance).post('/contracts', { orgId, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: 5000 })).data;
  await api(finance).patch(`/contracts/${con.id}`, { status: 'Active' });
  const [cs] = await db().insert(schema.cases).values({ orgId }).returning();
  const [a] = await db().insert(schema.caseAssignments).values({ caseId: cs.id, userId: expert.userId, fn: 'lead', status: 'Completed', endedAt: new Date() }).returning();
  return { contractId: con.id, assignmentId: a.id };
}

/** Proposes, allocates, submits, approves and activates an agreement on the given assignment. */
async function activeAgreementOn(contractId: string, assignmentId: string, opts: { percentage: number; effectiveFrom?: string | null; effectiveTo?: string | null }) {
  const agreement = (await api(finance).post('/revenue-share/agreements', {
    contractId, assignmentId, professionalId: expert.userId, model: 'PERCENTAGE', basis: 'SHARE_ON_NET_PRICE',
    percentage: opts.percentage, effectiveFrom: opts.effectiveFrom ?? null, effectiveTo: opts.effectiveTo ?? null
  })).data;
  await api(finance).put(`/revenue-share/agreements/${agreement.id}/allocations`, { rows: [{ allocateeRole: 'LEAD', professionalId: expert.userId, percentOfShare: 100 }] });
  await api(finance).post(`/revenue-share/agreements/${agreement.id}/submit`, {});
  await api(admin).post(`/revenue-share/agreements/${agreement.id}/approve`, {});
  const act = await api(finance).post(`/revenue-share/agreements/${agreement.id}/activate`, {});
  return { agreement, activation: act.data };
}

async function paidInvoice(contractId: string, amount: number) {
  const inv = (await api(finance).post('/invoices', { orgId, contractId, amountGhs: amount, dueDate: '2099-01-01' })).data;
  await api(finance).patch(`/invoices/${inv.id}`, { status: 'Sent' });
  await api(finance).post(`/invoices/${inv.id}/manual-payment`, { reference: `BANK-${uniq()}`, amountGhs: amount });
  return inv.id as string;
}

describe('revenue-share agreement conflict detection (Developer Spec §5.3)', () => {
  it('a single Active agreement on an assignment activates with no conflicts', async () => {
    const { contractId, assignmentId } = await sharedAssignment();
    const { activation } = await activeAgreementOn(contractId, assignmentId, { percentage: 20, effectiveFrom: '2026-01-01' });
    expect(activation.conflicts).toBe(0);
  });

  it('two Active agreements on the same assignment with overlapping effective dates are flagged, not silently resolved', async () => {
    const { contractId, assignmentId } = await sharedAssignment();
    const { agreement: a } = await activeAgreementOn(contractId, assignmentId, { percentage: 20, effectiveFrom: '2026-01-01', effectiveTo: null });
    const { agreement: b, activation } = await activeAgreementOn(contractId, assignmentId, { percentage: 15, effectiveFrom: '2026-06-01', effectiveTo: null });
    expect(activation.conflicts).toBe(1);

    const list = await api(finance).get(`/revenue-share/conflicts?assignmentId=${assignmentId}`);
    expect(list.status).toBe(200);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].status).toBe('Open');
    expect([list.data[0].agreementId, list.data[0].conflictingAgreementId].sort()).toEqual([a.id, b.id].sort());

    // Neither side can calculate while the conflict is open - the engine never silently picks one.
    const invId = await paidInvoice(contractId, 1000);
    expect((await api(finance).post(`/revenue-share/agreements/${a.id}/calculate`, { invoiceId: invId })).status).toBe(409);
    expect((await api(finance).post(`/revenue-share/agreements/${b.id}/calculate`, { invoiceId: invId })).status).toBe(409);
  });

  it('agreements whose effective windows do not overlap never conflict', async () => {
    const { contractId, assignmentId } = await sharedAssignment();
    await activeAgreementOn(contractId, assignmentId, { percentage: 20, effectiveFrom: '2026-01-01', effectiveTo: '2026-05-31' });
    const { agreement: b, activation } = await activeAgreementOn(contractId, assignmentId, { percentage: 15, effectiveFrom: '2026-06-01', effectiveTo: null });
    expect(activation.conflicts).toBe(0);
    const invId = await paidInvoice(contractId, 1000);
    expect((await api(finance).post(`/revenue-share/agreements/${b.id}/calculate`, { invoiceId: invId })).status).toBe(201);
  });

  it('resolving names the prevailing agreement; the losing agreement is permanently blocked, never re-opened by a later calculation attempt', async () => {
    const { contractId, assignmentId } = await sharedAssignment();
    const { agreement: a } = await activeAgreementOn(contractId, assignmentId, { percentage: 20, effectiveFrom: '2026-01-01' });
    const { agreement: b } = await activeAgreementOn(contractId, assignmentId, { percentage: 15, effectiveFrom: '2026-06-01' });
    const conflictId = (await api(finance).get(`/revenue-share/conflicts?assignmentId=${assignmentId}`)).data[0].id;

    // The proposer (finance) and the approver (admin) of these agreements cannot resolve the conflict between them.
    expect((await api(finance).post(`/revenue-share/conflicts/${conflictId}/resolve`, { prevailingAgreementId: a.id, resolutionNote: 'A predates B' })).status).toBe(403);
    expect((await api(admin).post(`/revenue-share/conflicts/${conflictId}/resolve`, { prevailingAgreementId: a.id, resolutionNote: 'A predates B' })).status).toBe(403);

    const r = await api(executive).post(`/revenue-share/conflicts/${conflictId}/resolve`, { prevailingAgreementId: a.id, resolutionNote: 'Agreement A was executed first; B should not have been activated' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);

    const invId = await paidInvoice(contractId, 1000);
    expect((await api(finance).post(`/revenue-share/agreements/${a.id}/calculate`, { invoiceId: invId })).status).toBe(201);
    const invId2 = await paidInvoice(contractId, 1000);
    const blocked = await api(finance).post(`/revenue-share/agreements/${b.id}/calculate`, { invoiceId: invId2 });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.error)).toMatch(/resolved conflict/);

    // A resolved conflict cannot be resolved again.
    expect((await api(executive).post(`/revenue-share/conflicts/${conflictId}/resolve`, { prevailingAgreementId: a.id, resolutionNote: 'again' })).status).toBe(422);
  });

  it('an EXPERT is row-scoped to conflicts on their own assignment, like every other revenue-share record', async () => {
    const { contractId, assignmentId } = await sharedAssignment();
    await activeAgreementOn(contractId, assignmentId, { percentage: 20, effectiveFrom: '2026-01-01' });
    await activeAgreementOn(contractId, assignmentId, { percentage: 15, effectiveFrom: '2026-06-01' });

    const mine = await api(expert).get(`/revenue-share/conflicts?assignmentId=${assignmentId}`);
    expect(mine.status).toBe(200);
    expect(mine.data).toHaveLength(1); // expert is the professional on this assignment

    const uninvolved = await makeUser('EXPERT');
    const theirs = await api(uninvolved).get(`/revenue-share/conflicts?assignmentId=${assignmentId}`);
    expect(theirs.status).toBe(200);
    expect(theirs.data).toHaveLength(0); // not their assignment, so nothing shows even with the right id

    expect((await api(expert).post(`/revenue-share/conflicts/${mine.data[0].id}/resolve`, { prevailingAgreementId: mine.data[0].agreementId, resolutionNote: 'nope' })).status).toBe(403);
  });
});
