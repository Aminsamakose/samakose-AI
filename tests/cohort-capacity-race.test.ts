import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';

let admin: Session;

beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); });

/**
 * Cohort capacity is checked and acted on from three independent places:
 * cases.createCase, programme-participant-lifecycle.assignCohort, and
 * programmes.updateCohort. All three now serialize on the same
 * lockCapacityScope(`cohort:${id}`) key so none of them can race each other.
 */
describe('cohort capacity (check-then-act race across case creation, participant assignment and capacity edits)', () => {
  it('opening two cases against a cohort at capacity 1 concurrently only lets one through', async () => {
    const prog = (await api(admin).post('/programmes', { name: `Cohort race ${uniq()}` })).data;
    const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `C-${uniq()}`, capacity: 1 })).data;
    await api(admin).patch(`/cohorts/${cohort.id}`, { status: 'Open' });

    const org1 = await makeOrg(admin);
    const org2 = await makeOrg(admin);

    const open = (orgId: string) => api(admin).post('/cases', { orgId, programmeId: prog.id, cohortId: cohort.id });
    const [r1, r2] = await Promise.all([open(org1.id), open(org2.id)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const list = (await api(admin).get(`/cases?cohortId=${cohort.id}`)).data;
    expect(list.total).toBe(1);
  });

  it('cannot lower a cohort’s capacity below enrollment concurrently with a new enrollment racing it', async () => {
    const prog = (await api(admin).post('/programmes', { name: `Cohort edit race ${uniq()}` })).data;
    const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `C-${uniq()}`, capacity: 2 })).data;
    await api(admin).patch(`/cohorts/${cohort.id}`, { status: 'Open' });

    const org1 = await makeOrg(admin);
    await api(admin).post('/cases', { orgId: org1.id, programmeId: prog.id, cohortId: cohort.id });

    const org2 = await makeOrg(admin);
    const [enroll, shrink] = await Promise.all([
      api(admin).post('/cases', { orgId: org2.id, programmeId: prog.id, cohortId: cohort.id }),
      api(admin).patch(`/cohorts/${cohort.id}`, { capacity: 1 }),
    ]);
    // Whichever committed first wins; the other must see a consistent, not-overbooked state:
    // either the enrollment succeeded and the shrink was rejected (capacity now 1 but 2 enrolled
    // would be inconsistent, so the lock must have forced the shrink to see the new count), or
    // the shrink committed first and the enrollment correctly found the cohort full.
    if (enroll.status === 201) {
      expect(shrink.status).toBe(409);
    } else {
      expect(enroll.status).toBe(409);
      expect(shrink.status).toBe(200);
    }
  });
});
