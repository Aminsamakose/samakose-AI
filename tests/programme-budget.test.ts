import { beforeAll, describe, expect, it } from 'vitest';
import { api, auditActions, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { budgetPosition, checkParent } from '@/domain/logframe';

describe('domain: budget position and logframe parents', () => {
  it('works out allocation, schedule, receipts and overdue tranches', () => {
    const p = budgetPosition(100000, [40000, 30000], [{ amount: 50000, status: 'Received', received: 49500, due: '2027-01-01' }, { amount: 30000, status: 'Planned', received: null, due: '2027-02-01' }, { amount: 10000, status: 'Planned', received: null, due: '2027-06-01' }], '2027-03-01');
    expect(p).toMatchObject({ allocated: 70000, unallocated: 30000, plannedTranches: 90000, unscheduled: 10000, received: 49500, outstanding: 40500, overdueTranches: 1 });
    expect(budgetPosition(null, [], [], '2027-01-01').unallocated).toBeNull();
  });
  it('a parent is exactly one level up', () => {
    expect(checkParent('impact', null, 'p')).toBeNull();
    expect(checkParent('impact', { level: 'impact', programmeId: 'p' }, 'p')).toBeTruthy();
    expect(checkParent('outcome', { level: 'impact', programmeId: 'p' }, 'p')).toBeNull();
    expect(checkParent('outcome', { level: 'output', programmeId: 'p' }, 'p')).toBeTruthy();
    expect(checkParent('output', { level: 'impact', programmeId: 'p' }, 'p')).toBeTruthy();
    expect(checkParent('output', { level: 'outcome', programmeId: 'q' }, 'p')).toBeTruthy();
    expect(checkParent('output', null, 'p')).toBeNull();
  });
});

let admin: Session, pm: Session, pmOther: Session, funder: Session, owner: Session, progId: string, noBudget: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  progId = (await api(admin).post('/programmes', { name: `Budget ${uniq()}`, startDate: '2027-01-01', endDate: '2027-12-31', budgetGhs: 100000 })).data.id;
  noBudget = (await api(admin).post('/programmes', { name: `NoBudget ${uniq()}`, startDate: '2027-01-01', endDate: '2027-12-31' })).data.id;
  const other = (await api(admin).post('/programmes', { name: `Other ${uniq()}`, startDate: '2027-01-01', endDate: '2027-12-31', budgetGhs: 5 })).data.id;
  pm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [progId] }); pmOther = await makeUser('PROGRAMME_MANAGER', { programmeIds: [other] });
  funder = await makeUser('FUNDER', { programmeIds: [progId] }); owner = await makeUser('OWNER', { orgId: (await makeOrg(admin)).id });
});

describe('budget lines', () => {
  it('adds lines up to the budget, never beyond, and audits', async () => {
    const a = await api(pm).post(`/programmes/${progId}/budget-lines`, { category: 'Coaching', amountGhs: 60000 }); expect(a.status).toBe(201);
    const over = await api(pm).post(`/programmes/${progId}/budget-lines`, { category: 'Travel', amountGhs: 40000.01 }); expect(over.status).toBe(400); expect(over.text).toContain('exceed the programme budget');
    const b = await api(pm).post(`/programmes/${progId}/budget-lines`, { category: 'Travel', amountGhs: 40000 }); expect(b.status).toBe(201);
    expect((await api(pm).post(`/programmes/${progId}/budget-lines`, { category: 'Travel', amountGhs: 1 })).status).toBe(400); // full
    expect((await api(pm).patch(`/budget-lines/${b.data.id}`, { amountGhs: 45000 })).status).toBe(400);
    expect((await api(pm).patch(`/budget-lines/${b.data.id}`, { amountGhs: 30000 })).status).toBe(200);
    const o = (await api(pm).get(`/programmes/${progId}/budget`)).data;
    expect(o.position).toMatchObject({ budget: 100000, allocated: 90000, unallocated: 10000 }); expect(o.lines.find((l: any) => l.category === 'Coaching').share).toBe(60);
    expect((await api(pm).del(`/budget-lines/${b.data.id}`)).status).toBe(200);
    expect(await auditActions(progId)).toEqual(expect.arrayContaining(['budget_line.created', 'budget_line.updated', 'budget_line.deleted']));
  });
  it('needs a programme budget, bad amounts and duplicate categories are refused', async () => {
    expect((await api(admin).post(`/programmes/${noBudget}/budget-lines`, { category: 'Coaching', amountGhs: 10 })).status).toBe(400);
    expect((await api(pm).post(`/programmes/${progId}/budget-lines`, { category: 'Coaching', amountGhs: 1 })).status).toBe(409);
    expect((await api(pm).post(`/programmes/${progId}/budget-lines`, { category: 'X', amountGhs: -5 })).status).toBe(400);
  });
});

describe('tranches', () => {
  it('plans, receives with a real date, locks once received', async () => {
    const t = await api(pm).post(`/programmes/${progId}/tranches`, { label: 'Tranche 1', amountGhs: 50000, dueDate: '2020-01-01' }); expect(t.status).toBe(201);
    expect((await api(pm).post(`/programmes/${progId}/tranches`, { label: 'Tranche 2', amountGhs: 50001 })).status).toBe(400);
    expect((await api(pm).get(`/programmes/${progId}/budget`)).data.position.overdueTranches).toBe(1);
    expect((await api(pm).post(`/tranches/${t.data.id}/receive`, { receivedOn: '2999-01-01', receivedGhs: 1 })).status).toBe(400);
    expect((await api(pm).post(`/tranches/${t.data.id}/receive`, { receivedOn: '2026-10-01', receivedGhs: 49500 })).status).toBe(200);
    const o = (await api(pm).get(`/programmes/${progId}/budget`)).data;
    expect(o.position).toMatchObject({ received: 49500, outstanding: 500, overdueTranches: 0 });
    expect((await api(pm).post(`/tranches/${t.data.id}/receive`, { receivedOn: '2026-10-01', receivedGhs: 1 })).status).toBe(409);
    expect((await api(pm).patch(`/tranches/${t.data.id}`, { amountGhs: 1 })).status).toBe(409);
    expect((await api(pm).del(`/tranches/${t.data.id}`)).status).toBe(409);
    expect(await auditActions(progId)).toEqual(expect.arrayContaining(['tranche.created', 'tranche.received']));
  });
});

describe('who can see and change it', () => {
  it('scopes by programme and role', async () => {
    expect((await api(pmOther).get(`/programmes/${progId}/budget`)).status).toBe(404);
    expect((await api(pmOther).post(`/programmes/${progId}/tranches`, { label: 'Sneaky', amountGhs: 1 })).status).toBe(404);
    expect((await api(funder).get(`/programmes/${progId}/budget`)).status).toBe(200);
    expect((await api(funder).post(`/programmes/${progId}/budget-lines`, { category: 'Nope', amountGhs: 1 })).status).toBe(403);
    expect((await api(owner).get(`/programmes/${progId}/budget`)).status).toBeGreaterThanOrEqual(403);
  });
});

describe('logframe levels', () => {
  it('builds impact, outcome, output and protects the hierarchy', async () => {
    const mk = (b: object) => api(pm).post(`/programmes/${progId}/indicators`, b);
    const imp = await mk({ name: 'Stronger SMEs', metric: 'avg_change', target: 10, level: 'impact' }); expect(imp.status).toBe(201);
    expect((await mk({ name: 'Bad impact', metric: 'enrolled', target: 5, level: 'impact', parentId: imp.data.id })).status).toBe(400);
    const out = await mk({ name: 'Scores improve', metric: 'pct_improved', target: 60, level: 'outcome', parentId: imp.data.id }); expect(out.status).toBe(201);
    expect((await mk({ name: 'Skips a level', metric: 'enrolled', target: 5, level: 'output', parentId: imp.data.id })).status).toBe(400);
    const op = await mk({ name: 'Businesses coached', metric: 'enrolled', target: 100, level: 'output', parentId: out.data.id }); expect(op.status).toBe(201);
    const list = (await api(pm).get(`/programmes/${progId}/indicators`)).data as any[];
    expect(list.find((x) => x.id === op.data.id)).toMatchObject({ level: 'output', parentId: out.data.id });
    expect((await api(pm).del(`/indicators/${out.data.id}`)).status).toBe(409);
    expect((await api(pm).patch(`/indicators/${out.data.id}`, { level: 'output' })).status).toBe(400);
    expect((await api(pm).patch(`/indicators/${out.data.id}`, { parentId: out.data.id })).status).toBe(400);
    expect((await api(pm).del(`/indicators/${op.data.id}`)).status).toBe(200);
    expect((await api(pm).del(`/indicators/${out.data.id}`)).status).toBe(200);
  });
});
