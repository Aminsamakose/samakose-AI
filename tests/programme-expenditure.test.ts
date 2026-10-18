import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';

/**
 * GAP 16 (funder-accountability gap register): a controlled expenditure ledger tied to budget
 * lines, distinct from the commercial billing ledger (services/ledger.ts). Covers commitments,
 * payments settling a commitment, reversals, duplicate-reference rejection, and the
 * approved/committed/actual/available overview.
 */
describe('programme expenditure (commitments, payments and reversals)', () => {
  let admin: Session;
  let programmeId: string, lineId: string;

  beforeAll(async () => {
    await ensureReference();
    admin = await makeUser('ADMIN');
    const prog = (await api(admin).post('/programmes', { name: `Expenditure ${uniq()}`, budgetGhs: 10000 })).data;
    programmeId = prog.id;
    const line = (await api(admin).post(`/programmes/${programmeId}/budget-lines`, { category: `cat-${uniq()}`, amountGhs: 5000 })).data;
    lineId = line.id;
  });

  it('records a payment and reflects it in the overview', async () => {
    const pay = await api(admin).post(`/programmes/${programmeId}/expenditure/payments`, { budgetLineId: lineId, payee: 'Trainer A', category: 'Training', amountGhs: 1000, date: '2026-02-01', reference: `INV-${uniq()}` });
    expect(pay.status, JSON.stringify(pay.error)).toBe(201);

    const overview = await api(admin).get(`/programmes/${programmeId}/expenditure`);
    expect(overview.data.budget).toBe(10000);
    expect(overview.data.actual).toBe(1000);
    expect(overview.data.committed).toBe(0);
    expect(overview.data.available).toBe(9000);
  });

  it('rejects a duplicate reference on the same programme', async () => {
    const ref = `DUP-${uniq()}`;
    const first = await api(admin).post(`/programmes/${programmeId}/expenditure/payments`, { payee: 'Supplier B', category: 'Materials', amountGhs: 200, date: '2026-02-02', reference: ref });
    expect(first.status).toBe(201);
    const dupe = await api(admin).post(`/programmes/${programmeId}/expenditure/payments`, { payee: 'Supplier B', category: 'Materials', amountGhs: 200, date: '2026-02-02', reference: ref });
    expect(dupe.status).toBe(409);
  });

  it('a commitment counts as committed until a payment settles it, then moves to actual', async () => {
    const commit = await api(admin).post(`/programmes/${programmeId}/expenditure/commitments`, { payee: 'Consultant C', category: 'Advisory', amountGhs: 800, date: '2026-02-03' });
    expect(commit.status, JSON.stringify(commit.error)).toBe(201);

    const mid = await api(admin).get(`/programmes/${programmeId}/expenditure`);
    const committedBefore = mid.data.committed;
    expect(committedBefore).toBeGreaterThanOrEqual(800);

    const settle = await api(admin).post(`/programmes/${programmeId}/expenditure/payments`, { payee: 'Consultant C', category: 'Advisory', amountGhs: 800, date: '2026-02-10', settlesCommitmentId: commit.data.id });
    expect(settle.status, JSON.stringify(settle.error)).toBe(201);

    const after = await api(admin).get(`/programmes/${programmeId}/expenditure`);
    expect(after.data.committed).toBe(round(committedBefore - 800));
  });

  it('refuses to settle the same commitment twice', async () => {
    const commit = (await api(admin).post(`/programmes/${programmeId}/expenditure/commitments`, { payee: 'Consultant D', category: 'Advisory', amountGhs: 300, date: '2026-02-05' })).data;
    const first = await api(admin).post(`/programmes/${programmeId}/expenditure/payments`, { payee: 'Consultant D', category: 'Advisory', amountGhs: 300, date: '2026-02-11', settlesCommitmentId: commit.id });
    expect(first.status).toBe(201);
    const second = await api(admin).post(`/programmes/${programmeId}/expenditure/payments`, { payee: 'Consultant D', category: 'Advisory', amountGhs: 300, date: '2026-02-12', settlesCommitmentId: commit.id });
    expect(second.status).toBe(409);
  });

  it('reversing a payment preserves the original and opens a separate reversal transaction', async () => {
    const pay = (await api(admin).post(`/programmes/${programmeId}/expenditure/payments`, { payee: 'Supplier E', category: 'Materials', amountGhs: 150, date: '2026-02-06' })).data;
    const before = await api(admin).get(`/programmes/${programmeId}/expenditure`);
    const reversed = await api(admin).post(`/expenditure-transactions/${pay.id}/reverse`, { reason: 'Wrong amount recorded' });
    expect(reversed.status, JSON.stringify(reversed.error)).toBe(201);

    const after = await api(admin).get(`/programmes/${programmeId}/expenditure`);
    expect(after.data.actual).toBe(round(before.data.actual - 150));

    const txs = await api(admin).get(`/programmes/${programmeId}/expenditure/transactions`);
    const original = txs.data.find((t: any) => t.id === pay.id);
    const reversal = txs.data.find((t: any) => t.id === reversed.data.id);
    expect(original.status).toBe('REVERSED');
    expect(Number(original.amountGhs)).toBe(150); // untouched
    expect(reversal.type).toBe('REVERSAL');
    expect(reversal.reversalOfId).toBe(pay.id);
  });

  it('cannot reverse an already-reversed transaction twice', async () => {
    const pay = (await api(admin).post(`/programmes/${programmeId}/expenditure/payments`, { payee: 'Supplier F', category: 'Materials', amountGhs: 75, date: '2026-02-07' })).data;
    const first = await api(admin).post(`/expenditure-transactions/${pay.id}/reverse`, { reason: 'Duplicate entry' });
    expect(first.status).toBe(201);
    const second = await api(admin).post(`/expenditure-transactions/${pay.id}/reverse`, { reason: 'Trying again' });
    expect(second.status).toBe(409);
  });

  it('rejects a budget line from a different programme', async () => {
    const other = (await api(admin).post('/programmes', { name: `Other ${uniq()}`, budgetGhs: 1000 })).data;
    const otherLine = (await api(admin).post(`/programmes/${other.id}/budget-lines`, { category: `cat-${uniq()}`, amountGhs: 100 })).data;
    const pay = await api(admin).post(`/programmes/${programmeId}/expenditure/payments`, { budgetLineId: otherLine.id, payee: 'X', category: 'Misc', amountGhs: 10, date: '2026-02-08' });
    expect(pay.status).toBe(400);
  });
});

function round(n: number) { return Math.round(n * 100) / 100; }
