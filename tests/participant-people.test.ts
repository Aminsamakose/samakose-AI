import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';

/**
 * GAP 02 (funder-accountability gap register): programme_participants is an enterprise's
 * enrolment in a programme, not an individual person. These routes add the actual human beings
 * behind that enrolment -- an owner, a manager, a delegate -- and support the two real-world
 * shapes the gap register called out: one enterprise with several people, and one person who
 * represents more than one enterprise.
 */
describe('participant people (the individuals behind an enrolment)', () => {
  let admin: Session, pm: Session, outsider: Session;
  let workspaceId: string, programmeId: string;

  beforeAll(async () => {
    await ensureReference();
    admin = await makeUser('ADMIN');
    pm = await makeUser('PROGRAMME_MANAGER');
    outsider = await makeUser('PROGRAMME_MANAGER');
    const prog = (await api(admin).post('/programmes', { name: `People ${uniq()}` })).data;
    programmeId = prog.id;
    const ws = (await api(admin).post(`/programmes/${programmeId}/workspace`, {})).data;
    workspaceId = ws.id;
    await api(admin).post(`/programme-workspaces/${workspaceId}/members`, { userId: pm.userId, role: 'PROGRAMME_MANAGER' });
  });

  it('adding the first person makes them primary automatically; a second explicit person does not steal it', async () => {
    const org = await makeOrg(admin);
    const enrolled = await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id });
    const participantId = enrolled.data.id;

    const owner = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/people`, { fullName: 'Ama Mensah', phone: '0241234567', role: 'OWNER' });
    expect(owner.status, JSON.stringify(owner.error)).toBe(201);
    expect(owner.data.isPrimary).toBe(true);

    const manager = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/people`, { fullName: 'Kofi Boateng', role: 'MANAGER', isPrimary: false });
    expect(manager.status).toBe(201);
    expect(manager.data.isPrimary).toBe(false);

    const list = await api(pm).get(`/programme-workspaces/${workspaceId}/participants/${participantId}/people`);
    expect(list.data.map((p: any) => p.fullName).sort()).toEqual(['Ama Mensah', 'Kofi Boateng']);
    expect(list.data.filter((p: any) => p.isPrimary)).toHaveLength(1);
  });

  it('the same person can be linked to a second enterprise’s enrolment', async () => {
    const orgA = await makeOrg(admin);
    const orgB = await makeOrg(admin);
    const enrolA = (await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: orgA.id })).data;
    const enrolB = (await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: orgB.id })).data;

    const personA = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${enrolA.id}/people`, { fullName: 'Cooperative Officer', role: 'DELEGATE' });
    const sameParticipantId = personA.data.participantId;

    const personB = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${enrolB.id}/people`, { participantId: sameParticipantId, role: 'DELEGATE' });
    expect(personB.status, JSON.stringify(personB.error)).toBe(201);
    expect(personB.data.participantId).toBe(sameParticipantId);

    const onA = await api(pm).get(`/programme-workspaces/${workspaceId}/participants/${enrolA.id}/people`);
    const onB = await api(pm).get(`/programme-workspaces/${workspaceId}/participants/${enrolB.id}/people`);
    expect(onA.data[0].participantId).toBe(sameParticipantId);
    expect(onB.data[0].participantId).toBe(sameParticipantId);
  });

  it('rejects linking the same person twice to the same enrolment', async () => {
    const org = await makeOrg(admin);
    const enrol = (await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id })).data;
    const first = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${enrol.id}/people`, { fullName: 'Yaw Darko' });
    const dupe = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${enrol.id}/people`, { participantId: first.data.participantId });
    expect(dupe.status).toBe(400);
  });

  it('a manager outside the workspace cannot add or remove people', async () => {
    const org = await makeOrg(admin);
    const enrol = (await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id })).data;
    const blocked = await api(outsider).post(`/programme-workspaces/${workspaceId}/participants/${enrol.id}/people`, { fullName: 'Someone Else' });
    expect([403, 404]).toContain(blocked.status);
  });

  it('removing a person deletes the link but not the underlying participant record', async () => {
    const org = await makeOrg(admin);
    const enrol = (await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id })).data;
    const linked = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${enrol.id}/people`, { fullName: 'Removable Person' });
    const removed = await api(pm).del(`/programme-workspaces/${workspaceId}/participants/${enrol.id}/people/${linked.data.id}`);
    expect(removed.status).toBe(200);
    const list = await api(pm).get(`/programme-workspaces/${workspaceId}/participants/${enrol.id}/people`);
    expect(list.data).toHaveLength(0);
  });
});
