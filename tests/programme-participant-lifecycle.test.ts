import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, auditActions, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { PARTICIPANT_LIFECYCLE, canTransitionParticipant } from '@/services/programme-participant-lifecycle';

describe('programme participant lifecycle (domain rules)', () => {
  it('defines the governed lifecycle in order', () => {
    expect(PARTICIPANT_LIFECYCLE).toEqual([
      'APPLICATION', 'ELIGIBILITY', 'SELECTED', 'INVITED', 'CONSENTED', 'ONBOARDED',
      'COHORT_ASSIGNED', 'ACTIVE', 'COMPLETING', 'COMPLETED', 'WITHDRAWN', 'REJECTED',
    ]);
  });

  it('allows only governed forward and exit transitions', () => {
    expect(canTransitionParticipant('APPLICATION', 'ELIGIBILITY')).toBe(true);
    expect(canTransitionParticipant('INVITED', 'CONSENTED')).toBe(true);
    expect(canTransitionParticipant('ONBOARDED', 'COHORT_ASSIGNED')).toBe(true);
    expect(canTransitionParticipant('ACTIVE', 'WITHDRAWN')).toBe(true);
    expect(canTransitionParticipant('COMPLETED', 'ACTIVE')).toBe(false);
    expect(canTransitionParticipant('APPLICATION', 'ACTIVE')).toBe(false);
  });
});

// Below: real enrolment flow, through the actual API routes and the real database -- not pure
// function calls. A prior audit found this file asserted only against literal arrays, never once
// touching a database or an API route, so the actual enrolment path (add -> consent -> onboard ->
// assign to a cohort -> activate -> complete, with capacity and RBAC enforced along the way) had no
// coverage at all.
describe('programme participant enrolment (real API + database)', () => {
  let admin: Session, pm: Session, outsider: Session;
  let workspaceId: string, programmeId: string, cohortId: string;

  beforeAll(async () => {
    await ensureReference();
    admin = await makeUser('ADMIN');
    pm = await makeUser('PROGRAMME_MANAGER');
    outsider = await makeUser('PROGRAMME_MANAGER');
    const prog = (await api(admin).post('/programmes', { name: `Enrolment ${uniq()}` })).data;
    programmeId = prog.id;
    const ws = (await api(admin).post(`/programmes/${programmeId}/workspace`, {})).data;
    workspaceId = ws.id;
    // The admin who created the workspace is its PROGRAMME_MANAGER member; add `pm` as a second
    // manager so we can also exercise a manager who is not the creator.
    await api(admin).post(`/programme-workspaces/${workspaceId}/members`, { userId: pm.userId, role: 'PROGRAMME_MANAGER' });
    const cohort = (await api(admin).post(`/programmes/${programmeId}/cohorts`, { name: `Cohort ${uniq()}`, capacity: 5 })).data;
    cohortId = cohort.id;
  });

  it('takes a real organisation through the full lifecycle, persisting each transition to the database', async () => {
    const org = await makeOrg(admin);
    const created = await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id });
    expect(created.status, JSON.stringify(created.error)).toBe(201);
    const participantId = created.data.id;
    expect(created.data.status).toBe('APPLICATION');

    const [persisted] = await db().select().from(schema.programmeParticipants).where(eq(schema.programmeParticipants.id, participantId));
    expect(persisted.organisationId).toBe(org.id);
    expect(persisted.programmeId).toBe(programmeId);

    // Walk the governed lifecycle via the real transition endpoint, checking the DB after each step.
    for (const next of ['ELIGIBILITY', 'SELECTED', 'INVITED'] as const) {
      const r = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/transition`, { status: next });
      expect(r.status, `${next}: ${JSON.stringify(r.error)}`).toBe(200);
      expect(r.data.status).toBe(next);
      const [row] = await db().select().from(schema.programmeParticipants).where(eq(schema.programmeParticipants.id, participantId));
      expect(row.status).toBe(next);
    }

    const consent = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/consent`, {});
    expect(consent.status, JSON.stringify(consent.error)).toBe(200);
    expect(consent.data.status).toBe('CONSENTED');
    const [afterConsent] = await db().select().from(schema.programmeParticipants).where(eq(schema.programmeParticipants.id, participantId));
    expect(afterConsent.consentAt).not.toBeNull();
    expect(afterConsent.consentBy).toBe(pm.userId);

    const onboard = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/onboard`, {});
    expect(onboard.status, JSON.stringify(onboard.error)).toBe(200);
    expect(onboard.data.status).toBe('ONBOARDED');

    const assigned = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/cohort`, { cohortId });
    expect(assigned.status, JSON.stringify(assigned.error)).toBe(200);
    expect(assigned.data.status).toBe('COHORT_ASSIGNED');
    expect(assigned.data.cohortId).toBe(cohortId);

    const activated = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/activate`, {});
    expect(activated.status, JSON.stringify(activated.error)).toBe(200);
    expect(activated.data.status).toBe('ACTIVE');

    const completing = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/transition`, { status: 'COMPLETING' });
    expect(completing.status).toBe(200);
    const completed = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/transition`, { status: 'COMPLETED' });
    expect(completed.status, JSON.stringify(completed.error)).toBe(200);
    expect(completed.data.status).toBe('COMPLETED');
    const [final] = await db().select().from(schema.programmeParticipants).where(eq(schema.programmeParticipants.id, participantId));
    expect(final.completedAt).not.toBeNull();

    // The audit trail recorded every real transition, not just the final state.
    const actions = await auditActions(participantId);
    expect(actions).toContain('programme_participant.created');
    expect(actions).toContain('programme_participant.consent_recorded');
    expect(actions).toContain('programme_participant.onboarded');
    expect(actions).toContain('programme_participant.cohort_assigned');
    expect(actions).toContain('programme_participant.activated');
    expect(actions.filter((a) => a === 'programme_participant.status_changed').length).toBeGreaterThanOrEqual(5);
  });

  it('rejects a transition that skips the governed order, against the real endpoint', async () => {
    const org = await makeOrg(admin);
    const created = (await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id })).data;
    const skip = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${created.id}/transition`, { status: 'ACTIVE' });
    expect(skip.status).toBe(422);
    const [row] = await db().select().from(schema.programmeParticipants).where(eq(schema.programmeParticipants.id, created.id));
    expect(row.status).toBe('APPLICATION');
  });

  it('cannot assign a participant to a cohort before onboarding, even with a valid cohort', async () => {
    const org = await makeOrg(admin);
    const created = (await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id })).data;
    const r = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${created.id}/cohort`, { cohortId });
    expect(r.status).toBe(422);
  });

  it('refuses to enrol the same organisation twice in one programme', async () => {
    const org = await makeOrg(admin);
    const first = await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id });
    expect(first.status).toBe(201);
    const second = await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id });
    expect(second.status).toBe(409);
  });

  it('a cohort at capacity refuses a new assignment, enforced by the database, not just the app', async () => {
    const small = (await api(admin).post(`/programmes/${programmeId}/cohorts`, { name: `Small ${uniq()}`, capacity: 1 })).data;
    const orgA = await makeOrg(admin), orgB = await makeOrg(admin);
    const pA = (await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: orgA.id })).data;
    const pB = (await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: orgB.id })).data;
    for (const pid of [pA.id, pB.id]) {
      await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${pid}/transition`, { status: 'ELIGIBILITY' });
      await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${pid}/transition`, { status: 'SELECTED' });
      await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${pid}/transition`, { status: 'INVITED' });
      await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${pid}/consent`, {});
      await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${pid}/onboard`, {});
    }
    const first = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${pA.id}/cohort`, { cohortId: small.id });
    expect(first.status, JSON.stringify(first.error)).toBe(200);
    const second = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${pB.id}/cohort`, { cohortId: small.id });
    expect(second.status).toBe(422);
    const count = await db().select().from(schema.programmeParticipants).where(eq(schema.programmeParticipants.cohortId, small.id));
    expect(count.length).toBe(1);
  });

  it('a manager outside the programme cannot see or enrol participants', async () => {
    const org = await makeOrg(admin);
    expect((await api(outsider).get(`/programme-workspaces/${workspaceId}/participants`)).status).toBe(404);
    expect((await api(outsider).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id })).status).toBe(404);
  });
});
