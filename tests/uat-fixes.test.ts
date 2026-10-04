import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, drain, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let admin: Session, pm: Session, fin: Session, prog: any;
beforeAll(async () => {
  await ensureReference(); admin = await makeUser('ADMIN'); fin = await makeUser('FINANCE');
  prog = (await api(admin).post('/programmes', { name: `Prog ${uniq()}`, startDate: '2026-01-01', endDate: '2027-01-01', budgetGhs: 1000 })).data;
  await api(admin).patch(`/programmes/${prog.id}`, { status: 'Active' });
  pm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [prog.id] });
});

describe('findings from the synthetic validation run', () => {
  it('a programme manager sees contracts only for their programmes or organisations on their cases', async () => {
    const mine = await makeOrg(admin), other = await makeOrg(admin);
    await api(pm).post('/cases', { orgId: mine.id, programmeId: prog.id });
    const c1 = (await api(fin).post('/contracts', { orgId: mine.id, amountGhs: 100 })).data, c2 = (await api(fin).post('/contracts', { orgId: other.id, amountGhs: 100 })).data;
    const ids = (await api(pm).get('/contracts?pageSize=100')).data.items.map((c: any) => c.id);
    expect(ids).toContain(c1.id); expect(ids).not.toContain(c2.id);
    expect((await api(fin).get('/contracts?pageSize=100')).data.items.map((c: any) => c.id)).toContain(c2.id);
  });
  it('an organisation page lists only the cases the viewer may see', async () => {
    const org = await makeOrg(admin); const p2 = (await api(admin).post('/programmes', { name: `Other ${uniq()}`, startDate: '2026-01-01', endDate: '2027-01-01' })).data; await api(admin).patch(`/programmes/${p2.id}`, { status: 'Active' });
    await api(admin).post('/cases', { orgId: org.id, programmeId: p2.id });
    await api(pm).post('/cases', { orgId: org.id, programmeId: prog.id }).catch(() => {});
    const mineCase = (await db().insert(schema.cases).values({ orgId: org.id, programmeId: prog.id, status: 'GRADUATED', createdBy: pm.userId }).returning())[0];
    const seen = (await api(pm).get(`/organisations/${org.id}`)).data.cases.map((c: any) => c.id);
    expect(seen).toContain(mineCase.id); expect(seen.length).toBe(1);
    expect((await api(admin).get(`/organisations/${org.id}`)).data.cases.length).toBeGreaterThan(1);
  });
  it('invoices cannot add up to more than the contract value, and void invoices free the balance', async () => {
    const org = await makeOrg(admin); const c = (await api(fin).post('/contracts', { orgId: org.id, amountGhs: 1000 })).data;
    const mk = (a: number) => api(fin).post('/invoices', { orgId: org.id, contractId: c.id, amountGhs: a, dueDate: '2027-01-01' });
    const a = await mk(600); expect(a.status).toBe(201);
    expect((await mk(500)).status).toBe(400);
    expect((await mk(400)).status).toBe(201);
    const b = await mk(1).catch(() => null); expect(b?.status).toBe(400);
    await api(fin).patch(`/invoices/${a.data.id}`, { status: 'Void' });
    expect((await mk(600)).status).toBe(201);
    const d = (await mk(1)); expect(d.status).toBe(400);
    const inv = (await api(fin).get(`/invoices?orgId=${org.id}&status=Draft&pageSize=50`)).data.items.find((i: any) => Number(i.amountGhs) === 400);
    expect((await api(fin).patch(`/invoices/${inv.id}`, { amountGhs: 900 })).status).toBe(400);
  });
  it('a draft cohort refuses enrolment, graduated cases free capacity, and closing a programme closes its cohorts', async () => {
    const p = (await api(admin).post('/programmes', { name: `Life ${uniq()}`, startDate: '2026-01-01', endDate: '2027-01-01' })).data; await api(admin).patch(`/programmes/${p.id}`, { status: 'Active' });
    const co = (await api(admin).post(`/programmes/${p.id}/cohorts`, { name: 'Cohort One', capacity: 1 })).data;
    const o1 = await makeOrg(admin), o2 = await makeOrg(admin);
    expect((await api(admin).post('/cases', { orgId: o1.id, programmeId: p.id, cohortId: co.id })).status).toBe(400);
    await api(admin).patch(`/cohorts/${co.id}`, { status: 'Open' });
    const c1 = await api(admin).post('/cases', { orgId: o1.id, programmeId: p.id, cohortId: co.id }); expect(c1.status, JSON.stringify(c1.error)).toBe(201);
    expect((await api(admin).post('/cases', { orgId: o2.id, programmeId: p.id, cohortId: co.id })).status).toBe(409);
    await db().update(schema.cases).set({ status: 'GRADUATED' }).where(eq(schema.cases.id, c1.data.id));
    expect((await api(admin).post('/cases', { orgId: o2.id, programmeId: p.id, cohortId: co.id })).status).toBe(201);
    await api(admin).patch(`/programmes/${p.id}`, { status: 'Completed' });
    expect((await db().select().from(schema.cohorts).where(eq(schema.cohorts.id, co.id)))[0].status).toBe('Closed');
    const log = await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, co.id));
    expect(log.map((l) => l.action)).toContain('cohort.closed_with_programme');
  });
  it('contracts that reach their end date expire with an audit record', async () => {
    const org = await makeOrg(admin); const c = (await api(fin).post('/contracts', { orgId: org.id, amountGhs: 10, startDate: '2025-01-01', endDate: '2025-06-01' })).data;
    await api(fin).patch(`/contracts/${c.id}`, { status: 'Active' });
    await db().insert(schema.jobs).values({ kind: 'invoice_scan' }); await drain();
    const row = (await db().select().from(schema.contracts).where(eq(schema.contracts.id, c.id)))[0];
    expect(row.status).toBe('Expired');
    expect((await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, c.id))).map((l) => l.action)).toContain('contract.expired');
  });
});
