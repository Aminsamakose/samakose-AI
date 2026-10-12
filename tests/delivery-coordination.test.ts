import { beforeAll, describe, expect, it } from 'vitest';
import { api, auditActions, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';

let admin: Session, funder: Session, cohortId: string;

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  const prog = (await api(admin).post('/programmes', { name: `Delivery coordination ${uniq()}` })).data;
  const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `Cohort ${uniq()}`, capacity: 20 })).data;
  cohortId = cohort.id;
  funder = await makeUser('FUNDER', { programmeIds: [prog.id] });
});

describe('delivery coordination: tasks, milestones and exceptions', () => {
  it('creates a task, lists it, and will not let a completed task silently reopen', async () => {
    const r = await api(admin).post(`/cohorts/${cohortId}/delivery-tasks`, { title: 'Confirm venue for session 1', priority: 'HIGH' });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect(r.data).toMatchObject({ cohortId, title: 'Confirm venue for session 1', priority: 'HIGH', status: 'TODO' });

    const list = await api(admin).get(`/cohorts/${cohortId}/delivery-tasks`);
    expect(list.data.map((t: any) => t.id)).toContain(r.data.id);

    const done = await api(admin).post(`/delivery-tasks/${r.data.id}/status`, { status: 'DONE' });
    expect(done.status).toBe(200);
    const reopen = await api(admin).post(`/delivery-tasks/${r.data.id}/status`, { status: 'TODO' });
    expect(reopen.status).toBe(409);

    const acts = await auditActions(r.data.id);
    expect(acts).toEqual(expect.arrayContaining(['delivery.task.created', 'delivery.task.status']));
  });

  it('creates a milestone and will not let an achieved milestone silently reopen', async () => {
    const r = await api(admin).post(`/cohorts/${cohortId}/delivery-milestones`, { name: 'Mid-cohort review', dueAt: '2027-01-15T00:00:00Z' });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    const achieved = await api(admin).post(`/delivery-milestones/${r.data.id}/status`, { status: 'ACHIEVED' });
    expect(achieved.status).toBe(200);
    const reopen = await api(admin).post(`/delivery-milestones/${r.data.id}/status`, { status: 'AT_RISK' });
    expect(reopen.status).toBe(409);
  });

  it('creates an exception linked to a task in the same cohort, and rejects a task from another cohort', async () => {
    const task = (await api(admin).post(`/cohorts/${cohortId}/delivery-tasks`, { title: 'Facilitator no-show' })).data;
    const ok = await api(admin).post(`/cohorts/${cohortId}/delivery-exceptions`, { title: 'Facilitator unavailable', severity: 'HIGH', taskId: task.id });
    expect(ok.status, JSON.stringify(ok.error)).toBe(201);

    const prog2 = (await api(admin).post('/programmes', { name: `Other ${uniq()}` })).data;
    const otherCohort = (await api(admin).post(`/programmes/${prog2.id}/cohorts`, { name: `Other cohort ${uniq()}`, capacity: 10 })).data;
    const otherTask = (await api(admin).post(`/cohorts/${otherCohort.id}/delivery-tasks`, { title: 'Unrelated task' })).data;
    const bad = await api(admin).post(`/cohorts/${cohortId}/delivery-exceptions`, { title: 'Cross-cohort', taskId: otherTask.id });
    expect(bad.status).toBe(422);

    const resolve = await api(admin).post(`/delivery-exceptions/${ok.data.id}/status`, { status: 'RESOLVED', resolution: 'Backup facilitator assigned' });
    expect(resolve.status).toBe(200);
  });

  it('the coordination summary counts open and overdue items', async () => {
    const overdueTask = (await api(admin).post(`/cohorts/${cohortId}/delivery-tasks`, { title: 'Overdue task', dueAt: '2020-01-01T00:00:00Z' })).data;
    const summary = (await api(admin).get(`/cohorts/${cohortId}/coordination`)).data;
    expect(summary.tasks.some((t: any) => t.id === overdueTask.id)).toBe(true);
    expect(summary.counts.overdueTasks).toBeGreaterThanOrEqual(1);
    expect(summary.counts.openTasks).toBeGreaterThanOrEqual(1);
  });

  it('only people who can edit programme workspaces may create or change coordination records', async () => {
    expect((await api(funder).post(`/cohorts/${cohortId}/delivery-tasks`, { title: 'Blocked' })).status).toBe(403);
    expect((await api(funder).get(`/cohorts/${cohortId}/delivery-tasks`)).status).toBe(200);
  });
});
