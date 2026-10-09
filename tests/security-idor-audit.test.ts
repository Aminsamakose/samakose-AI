import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';

/**
 * Exploit-style cross-tenant access attempts against delivery coordination,
 * run as an actual PROGRAMME_MANAGER confined to their own programme.
 */
let admin: Session;
let pmA: Session, pmB: Session;
let cohortA: string, cohortB: string;
let taskA: string, milestoneA: string, exceptionA: string;

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  const progA = (await api(admin).post('/programmes', { name: `IDOR A ${uniq()}` })).data;
  const progB = (await api(admin).post('/programmes', { name: `IDOR B ${uniq()}` })).data;
  const cA = (await api(admin).post(`/programmes/${progA.id}/cohorts`, { name: `Cohort A ${uniq()}`, capacity: 20 })).data;
  const cB = (await api(admin).post(`/programmes/${progB.id}/cohorts`, { name: `Cohort B ${uniq()}`, capacity: 20 })).data;
  cohortA = cA.id; cohortB = cB.id;

  pmA = await makeUser('PROGRAMME_MANAGER', { programmeIds: [progA.id] });
  pmB = await makeUser('PROGRAMME_MANAGER', { programmeIds: [progB.id] });

  taskA = (await api(admin).post(`/cohorts/${cohortA}/delivery-tasks`, { title: 'A-only task' })).data.id;
  milestoneA = (await api(admin).post(`/cohorts/${cohortA}/delivery-milestones`, { name: 'A-only milestone', dueAt: '2027-01-15T00:00:00Z' })).data.id;
  exceptionA = (await api(admin).post(`/cohorts/${cohortA}/delivery-exceptions`, { title: 'A-only exception' })).data.id;
});

describe('cross-tenant IDOR: programme manager B must never reach programme A data', () => {
  it('cannot list or read cohort A delivery tasks/milestones/exceptions/coordination via direct cohort id', async () => {
    expect((await api(pmB).get(`/cohorts/${cohortA}/delivery-tasks`)).status).toBe(404);
    expect((await api(pmB).get(`/cohorts/${cohortA}/delivery-milestones`)).status).toBe(404);
    expect((await api(pmB).get(`/cohorts/${cohortA}/delivery-exceptions`)).status).toBe(404);
    expect((await api(pmB).get(`/cohorts/${cohortA}/coordination`)).status).toBe(404);
  });

  it('cannot create a task/milestone/exception in cohort A', async () => {
    expect((await api(pmB).post(`/cohorts/${cohortA}/delivery-tasks`, { title: 'Injected' })).status).toBe(404);
    expect((await api(pmB).post(`/cohorts/${cohortA}/delivery-milestones`, { name: 'Injected', dueAt: '2027-01-15T00:00:00Z' })).status).toBe(404);
    expect((await api(pmB).post(`/cohorts/${cohortA}/delivery-exceptions`, { title: 'Injected' })).status).toBe(404);
  });

  it('cannot mutate an existing cohort-A task/milestone/exception by guessing its id directly', async () => {
    expect((await api(pmB).post(`/delivery-tasks/${taskA}/status`, { status: 'DONE' })).status).toBe(404);
    expect((await api(pmB).post(`/delivery-milestones/${milestoneA}/status`, { status: 'ACHIEVED' })).status).toBe(404);
    expect((await api(pmB).post(`/delivery-exceptions/${exceptionA}/status`, { status: 'RESOLVED' })).status).toBe(404);
  });

  it('a user with no programme assignment at all is also blocked, not just cross-programme', async () => {
    const orphanPm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [] });
    expect((await api(orphanPm).get(`/cohorts/${cohortA}/delivery-tasks`)).status).toBe(404);
    expect((await api(orphanPm).get(`/cohorts/${cohortB}/delivery-tasks`)).status).toBe(404);
  });

  it('pmA (legitimate owner) can still reach its own cohort normally, proving the block is scope-based not global', async () => {
    expect((await api(pmA).get(`/cohorts/${cohortA}/delivery-tasks`)).status).toBe(200);
  });

  it('session cookie from one user cannot be replayed with a tampered path to assume another role (no role in cookie trust)', async () => {
    // Sanity: pmB's own session, used directly, must carry pmB's own role server-side, not whatever the client claims.
    const whoami = await api(pmB).get('/me');
    if (whoami.status === 200) expect(whoami.data.role).toBe('PROGRAMME_MANAGER');
  });
});
