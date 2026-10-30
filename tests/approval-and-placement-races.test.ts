import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

/**
 * This session's audit of provider-assignment.ts, assignments.ts, programmes.ts,
 * programme-version.ts, programme-workspaces.ts, programme-workspace-configuration.ts,
 * cohort-configuration.ts, participant-people.ts and programme-participant-lifecycle.ts found
 * five more unguarded check-then-act races, the same class cohort-capacity-race.test.ts and
 * programme-budget-race.test.ts already cover for cohort capacity and budget ceilings:
 *
 *  - programme-version.approveVersion: two SUBMITTED versions of the same programme could both
 *    be read as SUBMITTED and both approved concurrently, leaving two APPROVED rows.
 *  - programme-workspace-configuration.approveConfiguration: the same race, one workspace.
 *  - cohort-configuration.approveCohortConfiguration: the same race, one cohort.
 *  - assignments.place: two concurrent placements for the same case+single-seat-function (lead/
 *    coach/reviewer) could both read "no one holds this seat yet" and both insert an Active row,
 *    leaving two Active assignments for one seat; addSpecialist had the analogous duplicate-add race.
 *  - participant-people.addPerson: two concurrent adds to the same enrolment could both read
 *    "no primary person yet" and both insert as primary, violating "exactly one primary".
 *
 * All five are fixed with a pg_advisory_xact_lock via lockCapacityScope, taken right before the
 * check, inside the route's existing transaction -- the same pattern already used for cohort
 * capacity, programme budget and workspace team/participant caps.
 */

let admin: Session, exec: Session, approverAdmin: Session, frameworkVersionId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  exec = await makeUser('EXECUTIVE');
  // A second administrator, distinct from `admin` who drafts the cohort configurations below --
  // approveCohortConfiguration refuses to let the drafter also approve their own draft (four-eyes).
  approverAdmin = await makeUser('ADMIN');
  const [fw] = await db().insert(schema.frameworks).values({ name: `Race test framework ${uniq()}`, code: `RTF-${uniq()}` }).returning();
  const [fv] = await db().insert(schema.frameworkVersions).values({ frameworkId: fw.id, version: 1, status: 'Published', questions: [], dimensions: [] }).returning();
  frameworkVersionId = fv.id;
});

describe('programme version approval race', () => {
  it('approving two submitted versions of the same programme concurrently leaves exactly one APPROVED', async () => {
    const prog = (await api(admin).post('/programmes', { name: `Version race ${uniq()}`, budgetGhs: 1000 })).data;
    const d1 = (await api(admin).post(`/programmes/${prog.id}/versions`, { name: 'Candidate A', changeReason: 'A' })).data;
    const d2 = (await api(admin).post(`/programmes/${prog.id}/versions`, { name: 'Candidate B', changeReason: 'B' })).data;
    expect((await api(admin).post(`/programmes/${prog.id}/versions/${d1.version}/submit`, {})).status).toBe(200);
    expect((await api(admin).post(`/programmes/${prog.id}/versions/${d2.version}/submit`, {})).status).toBe(200);

    const [r1, r2] = await Promise.all([
      api(exec).post(`/programmes/${prog.id}/versions/${d1.version}/approve`, {}),
      api(exec).post(`/programmes/${prog.id}/versions/${d2.version}/approve`, {}),
    ]);
    expect([r1.status, r2.status]).toContain(200);

    const rows = await db().select().from(schema.programmeVersions).where(and(eq(schema.programmeVersions.programmeId, prog.id), eq(schema.programmeVersions.status, 'APPROVED')));
    expect(rows.length).toBe(1);
  });
});

describe('programme workspace configuration approval race', () => {
  it('approving two submitted configuration drafts of the same workspace concurrently leaves exactly one APPROVED', async () => {
    const prog = (await api(admin).post('/programmes', { name: `Config race ${uniq()}` })).data;
    const ws = (await api(admin).post(`/programmes/${prog.id}/workspace`, {})).data;
    const minimalConfig = {
      frameworkVersionId,
      objectives: [{ code: 'OBJ-1', title: 'Improve business health' }],
      eligibilityRules: { criteria: ['registered_business'] },
      deliveryModel: { cadence: 'weekly' },
      reporting: { frequency: 'monthly' },
    };
    const d1 = (await api(admin).post(`/programme-workspaces/${ws.id}/configurations`, { ...minimalConfig, changeReason: 'A' })).data;
    const d2 = (await api(admin).post(`/programme-workspaces/${ws.id}/configurations`, { ...minimalConfig, changeReason: 'B' })).data;
    expect((await api(admin).post(`/programme-workspaces/${ws.id}/configurations/${d1.version}/submit`, {})).status).toBe(200);
    expect((await api(admin).post(`/programme-workspaces/${ws.id}/configurations/${d2.version}/submit`, {})).status).toBe(200);

    // Drafted by `admin`, approved by a different administrator -- approveConfiguration refuses
    // to let the drafter also approve their own draft (four-eyes).
    const [r1, r2] = await Promise.all([
      api(approverAdmin).post(`/programme-workspaces/${ws.id}/configurations/${d1.version}/approve`, {}),
      api(approverAdmin).post(`/programme-workspaces/${ws.id}/configurations/${d2.version}/approve`, {}),
    ]);
    expect([r1.status, r2.status]).toContain(200);

    const rows = await db().select().from(schema.programmeWorkspaceConfigurations).where(and(eq(schema.programmeWorkspaceConfigurations.workspaceId, ws.id), eq(schema.programmeWorkspaceConfigurations.status, 'APPROVED')));
    expect(rows.length).toBe(1);
  });
});

describe('cohort configuration approval race', () => {
  it('approving two submitted configuration drafts of the same cohort concurrently leaves exactly one APPROVED', async () => {
    const prog = (await api(admin).post('/programmes', { name: `Cohort config race ${uniq()}` })).data;
    const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: `C-${uniq()}`, capacity: 10 })).data;
    // Drafted by admin, approved by a different person (reviewer) so the four-eyes rule doesn't
    // block the test -- an approver cannot approve their own draft.
    const d1 = (await api(admin).post(`/cohorts/${cohort.id}/configurations`, { changeReason: 'A' })).data;
    const d2 = (await api(admin).post(`/cohorts/${cohort.id}/configurations`, { changeReason: 'B' })).data;
    expect((await api(admin).post(`/cohorts/${cohort.id}/configurations/${d1.version}/submit`, {})).status).toBe(200);
    expect((await api(admin).post(`/cohorts/${cohort.id}/configurations/${d2.version}/submit`, {})).status).toBe(200);

    const [r1, r2] = await Promise.all([
      api(approverAdmin).post(`/cohorts/${cohort.id}/configurations/${d1.version}/approve`, {}),
      api(approverAdmin).post(`/cohorts/${cohort.id}/configurations/${d2.version}/approve`, {}),
    ]);
    expect([r1.status, r2.status]).toContain(200);

    const rows = await db().select().from(schema.cohortConfigurations).where(and(eq(schema.cohortConfigurations.cohortId, cohort.id), eq(schema.cohortConfigurations.status, 'APPROVED')));
    expect(rows.length).toBe(1);
  });
});

describe('case assignment placement race (single-seat functions)', () => {
  it('assigning two different experts as lead on the same case concurrently leaves exactly one Active lead assignment', async () => {
    const org = await makeOrg(admin);
    const caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
    const e1 = await makeUser('EXPERT');
    const e2 = await makeUser('EXPERT');

    const [r1, r2] = await Promise.all([
      api(admin).post(`/cases/${caseId}/assign`, { consultantId: e1.userId, reason: 'Concurrent placement A' }),
      api(admin).post(`/cases/${caseId}/assign`, { consultantId: e2.userId, reason: 'Concurrent placement B' }),
    ]);
    expect([r1.status, r2.status]).toContain(200);

    const active = await db().select().from(schema.caseAssignments).where(and(eq(schema.caseAssignments.caseId, caseId), eq(schema.caseAssignments.fn, 'lead'), eq(schema.caseAssignments.status, 'Active')));
    expect(active.length).toBe(1);
    const [cs] = await db().select({ consultantId: schema.cases.consultantId }).from(schema.cases).where(eq(schema.cases.id, caseId));
    expect(cs.consultantId).toBe(active[0].userId);
  });

  it('adding the same specialist to a case twice concurrently leaves exactly one Active specialist row for them', async () => {
    const org = await makeOrg(admin);
    const caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
    const specialist = await makeUser('EXPERT');

    const [r1, r2] = await Promise.all([
      api(admin).post(`/cases/${caseId}/specialists`, { userId: specialist.userId }),
      api(admin).post(`/cases/${caseId}/specialists`, { userId: specialist.userId }),
    ]);
    expect([r1.status, r2.status]).toContain(200);

    const active = await db().select().from(schema.caseAssignments).where(and(eq(schema.caseAssignments.caseId, caseId), eq(schema.caseAssignments.fn, 'specialist'), eq(schema.caseAssignments.userId, specialist.userId), eq(schema.caseAssignments.status, 'Active')));
    expect(active.length).toBe(1);
  });
});

describe('enrolment primary-person race', () => {
  it('adding two people to the same enrolment concurrently, both as first-added, leaves exactly one primary', async () => {
    const prog = (await api(admin).post('/programmes', { name: `People race ${uniq()}` })).data;
    const ws = (await api(admin).post(`/programmes/${prog.id}/workspace`, {})).data;
    const org = await makeOrg(admin);
    const enrolment = (await api(admin).post(`/programme-workspaces/${ws.id}/participants`, { organisationId: org.id })).data;

    const [r1, r2] = await Promise.all([
      api(admin).post(`/programme-workspaces/${ws.id}/participants/${enrolment.id}/people`, { fullName: `Person A ${uniq()}` }),
      api(admin).post(`/programme-workspaces/${ws.id}/participants/${enrolment.id}/people`, { fullName: `Person B ${uniq()}` }),
    ]);
    expect([r1.status, r2.status]).toContain(201);

    const links = await db().select().from(schema.programmeParticipantPeople).where(eq(schema.programmeParticipantPeople.programmeParticipantId, enrolment.id));
    expect(links.length).toBe(2);
    expect(links.filter((l) => l.isPrimary).length).toBe(1);
  });
});
