import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, auditActions, ensureReference, makeOrg, makeUser, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { needsAcceptance } from '@/services/contracts';

describe('domain: acceptance needed', () => {
  const t0 = new Date('2027-01-01'), t1 = new Date('2027-02-01');
  it('active and never accepted, or amended after acceptance', () => {
    expect(needsAcceptance({ status: 'Active', acceptedAt: null }, null)).toBe(true);
    expect(needsAcceptance({ status: 'Active', acceptedAt: t0 }, null)).toBe(false);
    expect(needsAcceptance({ status: 'Active', acceptedAt: t0 }, t1)).toBe(true);
    expect(needsAcceptance({ status: 'Draft', acceptedAt: null }, null)).toBe(false);
    expect(needsAcceptance({ status: 'Expired', acceptedAt: null }, null)).toBe(false);
  });
});

let admin: Session, fin: Session, owner: Session, otherOwner: Session, pmOut: Session, orgId: string;
const mk = async (extra: Record<string, unknown> = {}, activate = true) => {
  const id = (await api(fin).post('/contracts', { orgId, startDate: '2027-01-01', endDate: '2027-12-31', amountGhs: 5000, ...extra })).data.id as string;
  if (activate) expect((await api(fin).patch(`/contracts/${id}`, { status: 'Active' })).status).toBe(200);
  return id;
};
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); fin = await makeUser('FINANCE'); pmOut = await makeUser('PROGRAMME_MANAGER');
  const org = await makeOrg(admin); orgId = org.id; owner = await makeUser('OWNER', { orgId });
  otherOwner = await makeUser('OWNER', { orgId: (await makeOrg(admin)).id });
});

describe('owner contract view', () => {
  it('shows an owner their own non-draft contracts only', async () => {
    const draft = await mk({}, false); const active = await mk();
    const list = (await api(owner).get('/contracts')).data.items as any[];
    expect(list.some((c) => c.id === active)).toBe(true); expect(list.some((c) => c.id === draft)).toBe(false);
    expect(list.every((c) => c.orgId === orgId)).toBe(true);
    expect((await api(owner).get(`/contracts/${draft}`)).status).toBe(404);
    expect((await api(otherOwner).get(`/contracts/${active}`)).status).toBe(404);
    expect(((await api(otherOwner).get('/contracts')).data.items as any[]).some((c) => c.id === active)).toBe(false);
    const d = (await api(owner).get(`/contracts/${active}`)).data;
    expect(d.needsAcceptance).toBe(true); expect(d.invoices).toEqual({ billed: 0, paid: 0 });
  });
  it('cannot create, edit, amend or renew', async () => {
    const id = await mk();
    expect((await api(owner).post('/contracts', { orgId, amountGhs: 1 })).status).toBe(403);
    expect((await api(owner).patch(`/contracts/${id}`, { status: 'Cancelled' })).status).toBe(403);
    expect((await api(owner).post(`/contracts/${id}/amend`, { amountGhs: 9000, reason: 'Because I said so' })).status).toBe(403);
    expect((await api(owner).post(`/contracts/${id}/renew`, {})).status).toBe(403);
  });
  it('a programme manager with no link to the business cannot open it', async () => {
    expect((await api(pmOut).get(`/contracts/${await mk()}`)).status).toBe(404);
  });
});

describe('acceptance', () => {
  it('the owner accepts once and it is recorded with who, when and how', async () => {
    const id = await mk();
    expect((await api(owner).post(`/contracts/${id}/accept`, { signatoryName: 'Ab' })).status).toBe(400);
    const ok = await api(owner).post(`/contracts/${id}/accept`, { signatoryName: 'Ama Owusu', signatoryTitle: 'Managing Director' });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    const d = (await api(owner).get(`/contracts/${id}`)).data;
    expect(d.acceptance).toMatchObject({ accepted: true, signatoryName: 'Ama Owusu', signatoryTitle: 'Managing Director', method: 'online' }); expect(d.needsAcceptance).toBe(false);
    expect((await api(owner).post(`/contracts/${id}/accept`, { signatoryName: 'Ama Owusu' })).status).toBe(409);
    expect(await auditActions(id)).toContain('contract.accepted');
  });
  it('a draft or another business cannot be accepted', async () => {
    const draft = await mk({}, false); const active = await mk();
    expect((await api(owner).post(`/contracts/${draft}/accept`, { signatoryName: 'Ama Owusu' })).status).toBe(404);
    expect((await api(otherOwner).post(`/contracts/${active}/accept`, { signatoryName: 'Kofi Mensah' })).status).toBe(404);
  });
  it('staff can record a signed paper copy but must say how it was received', async () => {
    const id = await mk();
    expect((await api(fin).post(`/contracts/${id}/accept`, { signatoryName: 'Ama Owusu' })).status).toBe(400);
    expect((await api(fin).post(`/contracts/${id}/accept`, { signatoryName: 'Ama Owusu', note: 'Signed copy in the file cabinet' })).status).toBe(200);
    expect((await api(fin).get(`/contracts/${id}`)).data.acceptance.method).toBe('recorded');
    // The owner does not see the staff note.
    expect((await api(owner).get(`/contracts/${id}`)).data.acceptance.note).toBeUndefined();
  });
  it('acceptance never blocks activation', async () => {
    const id = await mk({}, false);
    expect((await api(fin).patch(`/contracts/${id}`, { status: 'Active' })).status).toBe(200);
  });
});

describe('amendments', () => {
  it('extends a contract, keeps the history and asks the owner to accept again', async () => {
    const id = await mk();
    await api(owner).post(`/contracts/${id}/accept`, { signatoryName: 'Ama Owusu' });
    const r = await api(fin).post(`/contracts/${id}/amend`, { endDate: '2028-03-31', amountGhs: 6500, reason: 'Three month extension with added coaching' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const d = (await api(owner).get(`/contracts/${id}`)).data;
    expect(d.endDate).toBe('2028-03-31'); expect(Number(d.amountGhs)).toBe(6500);
    expect(d.amendments).toHaveLength(1); expect(d.amendments[0]).toMatchObject({ previousEnd: '2027-12-31', newEnd: '2028-03-31' });
    expect(d.needsAcceptance).toBe(true);
    expect((await api(owner).post(`/contracts/${id}/accept`, { signatoryName: 'Ama Owusu' })).status).toBe(200);
    expect((await api(owner).get(`/contracts/${id}`)).data.needsAcceptance).toBe(false);
    expect(await auditActions(id)).toContain('contract.amended');
    const note = await db().select().from(schema.notifications).where(eq(schema.notifications.userId, owner.userId));
    expect(note.some((n) => n.kind === 'ContractAmended')).toBe(true);
  });
  it('refuses shortening, no change, a missing reason and an amount below what is invoiced', async () => {
    const id = await mk();
    expect((await api(fin).post(`/contracts/${id}/amend`, { endDate: '2027-06-30', reason: 'Shorten it please' })).status).toBe(400);
    expect((await api(fin).post(`/contracts/${id}/amend`, { reason: 'Nothing changes here' })).status).toBe(422);
    expect((await api(fin).post(`/contracts/${id}/amend`, { amountGhs: 6000 })).status).toBe(400);
    await api(fin).post('/invoices', { orgId, contractId: id, amountGhs: 4000, dueDate: '2027-03-01' });
    const low = await api(fin).post(`/contracts/${id}/amend`, { amountGhs: 3000, reason: 'Reduce the scope of work' });
    expect(low.status).toBe(400); expect(JSON.stringify(low.error)).toContain('already been invoiced');
  });
  it('only an active contract can be amended', async () => {
    const draft = await mk({}, false);
    expect((await api(fin).post(`/contracts/${draft}/amend`, { amountGhs: 7000, reason: 'Change before activation' })).status).toBe(422);
  });
  it('amendment records cannot be changed or removed, even directly in the database', async () => {
    const id = await mk(); await api(fin).post(`/contracts/${id}/amend`, { amountGhs: 5500, reason: 'Added a workshop' });
    await expect(db().update(schema.contractAmendments).set({ reason: 'edited later' }).where(eq(schema.contractAmendments.contractId, id))).rejects.toThrow();
    await expect(db().delete(schema.contractAmendments).where(eq(schema.contractAmendments.contractId, id))).rejects.toThrow();
  });
});

describe('renewals', () => {
  it('creates a draft that continues the old contract, once only', async () => {
    const id = await mk();
    const r = await api(fin).post(`/contracts/${id}/renew`, {});
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    const n = (await api(fin).get(`/contracts/${r.data.id}`)).data;
    expect(n).toMatchObject({ status: 'Draft', startDate: '2028-01-01', endDate: '2028-12-30', renewalOf: id }); expect(Number(n.amountGhs)).toBe(5000);
    expect((await api(fin).get(`/contracts/${id}`)).data.renewedBy.id).toBe(r.data.id);
    const again = await api(fin).post(`/contracts/${id}/renew`, {}); expect(again.status).toBe(409);
    expect(await auditActions(id)).toContain('contract.renewed');
  });
  it('accepts new terms, and refuses a draft or a bad date', async () => {
    const id = await mk(); const draft = await mk({}, false);
    expect((await api(fin).post(`/contracts/${draft}/renew`, {})).status).toBe(422);
    expect((await api(fin).post(`/contracts/${id}/renew`, { startDate: '2028-02-01', endDate: '2028-01-01' })).status).toBe(400);
    const r = await api(fin).post(`/contracts/${id}/renew`, { startDate: '2028-02-01', endDate: '2029-01-31', amountGhs: 7000 });
    expect(r.status).toBe(201); expect(Number((await api(fin).get(`/contracts/${r.data.id}`)).data.amountGhs)).toBe(7000);
  });
});
