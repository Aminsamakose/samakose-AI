import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';

/**
 * Programme approval/versioning: the programme's own core definition (name, funder, dates,
 * budget) now goes through the same DRAFT -> SUBMITTED -> APPROVED/REJECTED -> SUPERSEDED
 * lifecycle that programme_workspace_configurations already has, rather than being edited
 * directly with no sign-off. Approval is restricted to ADMIN/EXECUTIVE -- unlike workspace
 * configuration, there is no programme-scoped REVIEWER membership to delegate to.
 */
describe('programme version (approval and versioning of the programme definition)', () => {
  let admin: Session, exec: Session, owner: Session;
  let programmeId: string;

  beforeAll(async () => {
    await ensureReference();
    admin = await makeUser('ADMIN');
    exec = await makeUser('EXECUTIVE');
    const prog = (await api(admin).post('/programmes', { name: `Version ${uniq()}`, budgetGhs: 10000 })).data;
    programmeId = prog.id;
    const org = await makeOrg(admin);
    owner = await makeUser('OWNER', { orgId: org.id });
  });

  it('has no approved version until one is created and approved', async () => {
    const current = await api(admin).get(`/programmes/${programmeId}/version`);
    expect(current.data.version).toBeNull();
    expect(current.data.governanceStatus).toBe('UNVERSIONED');
  });

  it('a draft inherits unset fields from the live programme row', async () => {
    const draft = await api(admin).post(`/programmes/${programmeId}/versions`, { changeReason: 'Initial funder commitment' });
    expect(draft.status, JSON.stringify(draft.error)).toBe(201);
    expect(draft.data.version).toBe(1);
    expect(draft.data.status).toBe('DRAFT');
    expect(Number(draft.data.budgetGhs)).toBe(10000);
  });

  it('refuses to submit a draft whose end date precedes its start date', async () => {
    const draft = (await api(admin).post(`/programmes/${programmeId}/versions`, { name: 'Bad dates', startDate: '2027-06-01', endDate: '2027-01-01' })).data;
    const submit = await api(admin).post(`/programmes/${programmeId}/versions/${draft.version}/submit`, {});
    expect(submit.status).toBe(422);
  });

  it('only an admin or executive can approve a submitted version', async () => {
    const draft = (await api(admin).post(`/programmes/${programmeId}/versions`, { name: 'Phase 2', funder: 'ACME Foundation', budgetGhs: 15000 })).data;
    const submitted = await api(admin).post(`/programmes/${programmeId}/versions/${draft.version}/submit`, {});
    expect(submitted.status, JSON.stringify(submitted.error)).toBe(200);

    const deniedApproval = await api(owner).post(`/programmes/${programmeId}/versions/${draft.version}/approve`, {});
    expect(deniedApproval.status).toBe(403);

    const approved = await api(exec).post(`/programmes/${programmeId}/versions/${draft.version}/approve`, {});
    expect(approved.status, JSON.stringify(approved.error)).toBe(200);
    expect(approved.data.status).toBe('APPROVED');

    const current = await api(admin).get(`/programmes/${programmeId}/version`);
    expect(current.data.version.id).toBe(approved.data.id);

    const programme = await api(admin).get(`/programmes/${programmeId}`);
    expect(programme.data.name).toBe('Phase 2');
    expect(programme.data.funder).toBe('ACME Foundation');
    expect(Number(programme.data.budgetGhs)).toBe(15000);
  });

  it('approving a new version supersedes the prior approved one', async () => {
    const draft = (await api(admin).post(`/programmes/${programmeId}/versions`, { name: 'Phase 3', budgetGhs: 20000 })).data;
    await api(admin).post(`/programmes/${programmeId}/versions/${draft.version}/submit`, {});
    const approved = await api(exec).post(`/programmes/${programmeId}/versions/${draft.version}/approve`, {});
    expect(approved.status).toBe(200);

    const versions = await api(admin).get(`/programmes/${programmeId}/versions`);
    const superseded = versions.data.find((v: any) => v.status === 'SUPERSEDED');
    expect(superseded).toBeTruthy();
    expect(superseded.name).toBe('Phase 2');
  });

  it('a rejected draft can be revised into a new draft carrying its reason forward', async () => {
    const draft = (await api(admin).post(`/programmes/${programmeId}/versions`, { name: 'Phase 4 (over budget)', budgetGhs: 500000 })).data;
    await api(admin).post(`/programmes/${programmeId}/versions/${draft.version}/submit`, {});
    const rejected = await api(exec).post(`/programmes/${programmeId}/versions/${draft.version}/reject`, { reason: 'Budget exceeds funder ceiling' });
    expect(rejected.status, JSON.stringify(rejected.error)).toBe(200);
    expect(rejected.data.status).toBe('REJECTED');

    const revised = await api(admin).post(`/programmes/${programmeId}/versions/${draft.version}/revise`, {});
    expect(revised.status, JSON.stringify(revised.error)).toBe(200);
    expect(revised.data.status).toBe('DRAFT');
    expect(revised.data.changeReason).toBe('Budget exceeds funder ceiling');
    expect(revised.data.version).toBe(draft.version + 1);
  });

  it('refuses an out-of-order transition, such as approving a draft directly', async () => {
    const draft = (await api(admin).post(`/programmes/${programmeId}/versions`, { name: 'Phase 5' })).data;
    const approve = await api(exec).post(`/programmes/${programmeId}/versions/${draft.version}/approve`, {});
    expect(approve.status).toBe(409);
  });
});
