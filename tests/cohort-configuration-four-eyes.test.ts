import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';

/**
 * Four-eyes on cohort delivery configuration: an ADMIN holds both programme_workspaces:edit (to
 * draft) and the approver role (ADMIN/REVIEWER) checked by approveCohortConfiguration, so without
 * an explicit createdBy-vs-approver check, the same administrator could draft a configuration and
 * approve their own change with no independent review.
 */
describe('cohort configuration (four-eyes on approval)', () => {
  let admin: Session, otherAdmin: Session;
  let cohortId: string;

  beforeAll(async () => {
    await ensureReference();
    admin = await makeUser('ADMIN');
    // Note: REVIEWER only has read on programme_workspaces (src/lib/rbac.ts), so in practice only
    // ADMIN ever clears the permission gate on this route; a second administrator stands in here
    // for "a different, independent approver".
    otherAdmin = await makeUser('ADMIN');
    const prog = (await api(admin).post('/programmes', { name: `Cohort config ${uniq()}` })).data;
    const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `C-${uniq()}`, capacity: 10 })).data;
    cohortId = cohort.id;
  });

  it('refuses to let the administrator who drafted a configuration approve it themselves', async () => {
    const draft = (await api(admin).post(`/cohorts/${cohortId}/configurations`, { deliveryMode: 'HYBRID', changeReason: 'Initial plan' })).data;
    const submitted = await api(admin).post(`/cohorts/${cohortId}/configurations/${draft.version}/submit`, {});
    expect(submitted.status, JSON.stringify(submitted.error)).toBe(200);

    const selfApprove = await api(admin).post(`/cohorts/${cohortId}/configurations/${draft.version}/approve`, {});
    expect(selfApprove.status).toBe(403);

    // A different administrator still can.
    const otherApprove = await api(otherAdmin).post(`/cohorts/${cohortId}/configurations/${draft.version}/approve`, {});
    expect(otherApprove.status, JSON.stringify(otherApprove.error)).toBe(200);
  });
});
