import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, auditActions, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

describe('delivery operations invariants', () => {
  it('uses explicit lifecycle states for activities and sessions', () => {
    expect(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).toContain('COMPLETED');
    expect(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).toContain('SCHEDULED');
  });

  it('uses cohort-scoped attendance states', () => {
    expect(['PRESENT', 'ABSENT', 'EXCUSED', 'LATE']).toContain('LATE');
  });
});

// Below: real activity -> session -> attendance flow, through the actual API routes and the real
// database. A prior audit found this file was 12 lines of pure constant-array assertions and was the
// ONLY file in the repo mentioning "attendance" at all -- the actual marking of who showed up to a
// delivery session, which cohort a participant must belong to for it to count, and whether a status
// change upserts cleanly, had zero coverage.
describe('delivery activities, sessions and attendance (real API + database)', () => {
  let admin: Session, pm: Session, outsider: Session;
  let workspaceId: string, programmeId: string, cohortId: string, otherCohortId: string;
  let activityId: string, sessionId: string;
  let participantInCohort: string, participantInOtherCohort: string;

  async function enrolAndAssign(cohort: string) {
    const org = await makeOrg(admin);
    const created = await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: org.id });
    expect(created.status, JSON.stringify(created.error)).toBe(201);
    const p = created.data;
    for (const next of ['ELIGIBILITY', 'SELECTED', 'INVITED']) {
      await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${p.id}/transition`, { status: next });
    }
    await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${p.id}/consent`, {});
    await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${p.id}/onboard`, {});
    const assigned = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${p.id}/cohort`, { cohortId: cohort });
    expect(assigned.status, JSON.stringify(assigned.error)).toBe(200);
    return p.id as string;
  }

  beforeAll(async () => {
    await ensureReference();
    admin = await makeUser('ADMIN');
    outsider = await makeUser('PROGRAMME_MANAGER');
    const prog = (await api(admin).post('/programmes', { name: `Delivery ${uniq()}` })).data;
    programmeId = prog.id;
    pm = await makeUser('PROGRAMME_MANAGER');
    const ws = (await api(admin).post(`/programmes/${programmeId}/workspace`, {})).data;
    workspaceId = ws.id;
    await api(admin).post(`/programme-workspaces/${workspaceId}/members`, { userId: pm.userId, role: 'PROGRAMME_MANAGER' });
    cohortId = (await api(admin).post(`/programmes/${programmeId}/cohorts`, { name: `Cohort ${uniq()}`, capacity: 10 })).data.id;
    otherCohortId = (await api(admin).post(`/programmes/${programmeId}/cohorts`, { name: `Other ${uniq()}`, capacity: 10 })).data.id;
    participantInCohort = await enrolAndAssign(cohortId);
    participantInOtherCohort = await enrolAndAssign(otherCohortId);

    const activity = await api(admin).post(`/cohorts/${cohortId}/activities`, { name: `Workshop ${uniq()}` });
    expect(activity.status, JSON.stringify(activity.error)).toBe(201);
    activityId = activity.data.id;

    const session = await api(admin).post(`/delivery-activities/${activityId}/sessions`, {
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
      mode: 'IN_PERSON',
    });
    expect(session.status, JSON.stringify(session.error)).toBe(201);
    sessionId = session.data.id;
  });

  it('records attendance for a cohort member, persisted to the database', async () => {
    const r = await api(admin).post(`/delivery-sessions/${sessionId}/attendance/${participantInCohort}`, { status: 'PRESENT' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.data.status).toBe('PRESENT');

    const [row] = await db().select().from(schema.deliveryAttendance).where(eq(schema.deliveryAttendance.sessionId, sessionId));
    expect(row.participantId).toBe(participantInCohort);
    expect(row.status).toBe('PRESENT');
    expect(row.recordedBy).toBe(admin.userId);

    const actions = await auditActions(sessionId);
    expect(actions).toContain('delivery.attendance.recorded');

    const listed = await api(admin).get(`/delivery-sessions/${sessionId}/attendance`);
    expect(listed.status).toBe(200);
    expect(listed.data.some((x: any) => x.attendance.participantId === participantInCohort && x.attendance.status === 'PRESENT')).toBe(true);
  });

  it('re-recording the same participant upserts rather than duplicating a row', async () => {
    const before = (await db().select().from(schema.deliveryAttendance).where(eq(schema.deliveryAttendance.sessionId, sessionId))).length;
    const updated = await api(admin).post(`/delivery-sessions/${sessionId}/attendance/${participantInCohort}`, { status: 'LATE', arrivedAt: new Date().toISOString(), note: 'Traffic' });
    expect(updated.status, JSON.stringify(updated.error)).toBe(200);
    expect(updated.data.status).toBe('LATE');
    const rows = await db().select().from(schema.deliveryAttendance).where(eq(schema.deliveryAttendance.sessionId, sessionId));
    expect(rows.length).toBe(before);
    expect(rows.find((r) => r.participantId === participantInCohort)?.status).toBe('LATE');
  });

  it('rejects attendance for a participant who belongs to a different cohort', async () => {
    const r = await api(admin).post(`/delivery-sessions/${sessionId}/attendance/${participantInOtherCohort}`, { status: 'PRESENT' });
    expect(r.status).toBe(422);
    const rows = await db().select().from(schema.deliveryAttendance).where(eq(schema.deliveryAttendance.participantId, participantInOtherCohort));
    expect(rows.length).toBe(0);
  });

  it('a completed session cannot be reopened, but attendance still records against it', async () => {
    const complete = await api(admin).post(`/delivery-sessions/${sessionId}/status`, { status: 'COMPLETED' });
    expect(complete.status, JSON.stringify(complete.error)).toBe(200);
    const reopen = await api(admin).post(`/delivery-sessions/${sessionId}/status`, { status: 'SCHEDULED' });
    expect(reopen.status).toBe(409);
    const late = await api(admin).post(`/delivery-sessions/${sessionId}/attendance/${participantInOtherCohort}`, { status: 'PRESENT' });
    // Still blocked by the cohort mismatch, not by session status -- a completed session is a record
    // of what happened, so attendance for its real participants must remain recordable after the fact.
    expect(late.status).toBe(422);
    const ok = await api(admin).post(`/delivery-sessions/${sessionId}/attendance/${participantInCohort}`, { status: 'ABSENT' });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
  });

  it('a manager outside the programme cannot see or record attendance', async () => {
    expect((await api(outsider).get(`/delivery-sessions/${sessionId}/attendance`)).status).toBe(404);
    expect((await api(outsider).post(`/delivery-sessions/${sessionId}/attendance/${participantInCohort}`, { status: 'PRESENT' })).status).toBe(404);
  });

  /**
   * Directive #8.2/#9.1.E: the calendar must handle facilitator availability, but must not
   * prohibit every overlap -- two sessions at the same time with different facilitators are fine.
   */
  describe('facilitator double-booking', () => {
    let facilitator: Session;
    beforeAll(async () => { facilitator = await makeUser('EXPERT'); });

    it('refuses a second session for the same facilitator at an overlapping time', async () => {
      const act = (await api(admin).post(`/cohorts/${cohortId}/activities`, { name: `Facilitator clash ${uniq()}` })).data;
      const start = new Date(Date.now() + 10 * 3600_000);
      const end = new Date(Date.now() + 11 * 3600_000);
      const first = await api(admin).post(`/delivery-activities/${act.id}/sessions`, { facilitatorUserId: facilitator.userId, startsAt: start.toISOString(), endsAt: end.toISOString(), mode: 'IN_PERSON' });
      expect(first.status, JSON.stringify(first.error)).toBe(201);

      // Overlaps the middle of the first session, with a different activity.
      const act2 = (await api(admin).post(`/cohorts/${cohortId}/activities`, { name: `Facilitator clash 2 ${uniq()}` })).data;
      const overlapStart = new Date(start.getTime() + 30 * 60_000);
      const overlapEnd = new Date(end.getTime() + 30 * 60_000);
      const clash = await api(admin).post(`/delivery-activities/${act2.id}/sessions`, { facilitatorUserId: facilitator.userId, startsAt: overlapStart.toISOString(), endsAt: overlapEnd.toISOString(), mode: 'IN_PERSON' });
      expect(clash.status).toBe(409);
    });

    it('allows two different facilitators at the exact same time', async () => {
      const otherFacilitator = await makeUser('EXPERT');
      const act = (await api(admin).post(`/cohorts/${cohortId}/activities`, { name: `Parallel sessions ${uniq()}` })).data;
      const start = new Date(Date.now() + 20 * 3600_000);
      const end = new Date(Date.now() + 21 * 3600_000);
      const a = await api(admin).post(`/delivery-activities/${act.id}/sessions`, { facilitatorUserId: facilitator.userId, startsAt: start.toISOString(), endsAt: end.toISOString(), mode: 'IN_PERSON' });
      expect(a.status, JSON.stringify(a.error)).toBe(201);
      const b = await api(admin).post(`/delivery-activities/${act.id}/sessions`, { facilitatorUserId: otherFacilitator.userId, startsAt: start.toISOString(), endsAt: end.toISOString(), mode: 'IN_PERSON' });
      expect(b.status, JSON.stringify(b.error)).toBe(201);
    });

    it('allows a new session for the same facilitator once the earlier one is cancelled', async () => {
      const act = (await api(admin).post(`/cohorts/${cohortId}/activities`, { name: `Freed slot ${uniq()}` })).data;
      const start = new Date(Date.now() + 30 * 3600_000);
      const end = new Date(Date.now() + 31 * 3600_000);
      const first = await api(admin).post(`/delivery-activities/${act.id}/sessions`, { facilitatorUserId: facilitator.userId, startsAt: start.toISOString(), endsAt: end.toISOString(), mode: 'IN_PERSON' });
      expect(first.status).toBe(201);
      await api(admin).post(`/delivery-sessions/${first.data.id}/status`, { status: 'CANCELLED' });
      const again = await api(admin).post(`/delivery-activities/${act.id}/sessions`, { facilitatorUserId: facilitator.userId, startsAt: start.toISOString(), endsAt: end.toISOString(), mode: 'IN_PERSON' });
      expect(again.status, JSON.stringify(again.error)).toBe(201);
    });

    it('two concurrent bookings for the same facilitator at overlapping times only let one through', async () => {
      const act = (await api(admin).post(`/cohorts/${cohortId}/activities`, { name: `Race ${uniq()}` })).data;
      const act2 = (await api(admin).post(`/cohorts/${cohortId}/activities`, { name: `Race 2 ${uniq()}` })).data;
      const raceFacilitator = await makeUser('EXPERT');
      const start = new Date(Date.now() + 40 * 3600_000);
      const end = new Date(Date.now() + 41 * 3600_000);
      const book = (activityId: string) => api(admin).post(`/delivery-activities/${activityId}/sessions`, { facilitatorUserId: raceFacilitator.userId, startsAt: start.toISOString(), endsAt: end.toISOString(), mode: 'IN_PERSON' });
      const [r1, r2] = await Promise.all([book(act.id), book(act2.id)]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);
    });
  });

  it('a cancelled activity refuses a new session', async () => {
    const act = (await api(admin).post(`/cohorts/${cohortId}/activities`, { name: `Cancel me ${uniq()}` })).data;
    await api(admin).post(`/delivery-activities/${act.id}/status`, { status: 'CANCELLED' });
    const r = await api(admin).post(`/delivery-activities/${act.id}/sessions`, {
      startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 7200_000).toISOString(),
    });
    expect(r.status).toBe(422);
  });
});
