import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { answerSheet, api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';

/**
 * #90 is "make programme workspace monitoring, communications, command centre, MEL, reporting,
 * calendar and matching coherent" across #68 and #71-77. The piece that is actually testable as
 * ONE coherent story is whether a business delivered through the newer programme-workspace
 * enrolment system (programme_participants: application -> consent -> onboarding -> cohort ->
 * active -> completed) is visible to the older case-centric systems that reporting, dashboards
 * and programme close-out read from (cases, health_scores, reports).
 *
 * This walks one organisation through the full, real workspace lifecycle via the real API, then
 * checks whether the case-based machinery noticed. It is deliberately NOT testing the workspace
 * lifecycle rules themselves (tests/programme-participant-lifecycle.test.ts already does that) --
 * it is testing the seam between the workspace system and everything built on `cases`.
 *
 * The audit this test came from found three real gaps. Two are fixed here (the cohort `enrolled`
 * count and the close-out gate now both see programme_participants); the first -- whether workspace
 * activation should create a `case` at all, so the full diagnostic/prescription/certification/report
 * pipeline (which is keyed on caseId) can run for a workspace-delivered business -- is a product
 * decision for Samakose, not something this test or PR decides, and is still open.
 */
describe('#90: does a workspace-delivered participant connect to the case-based systems?', () => {
  let admin: Session, pm: Session, finance: Session;
  let programmeId: string, workspaceId: string, cohortId: string, orgId: string, participantId: string;

  beforeAll(async () => {
    await ensureReference();
    admin = await makeUser('ADMIN'); pm = await makeUser('PROGRAMME_MANAGER'); finance = await makeUser('FINANCE');
    const prog = (await api(admin).post('/programmes', { name: `Integration ${uniq()}` })).data;
    programmeId = prog.id;
    const ws = (await api(admin).post(`/programmes/${programmeId}/workspace`, {})).data;
    workspaceId = ws.id;
    await api(admin).post(`/programme-workspaces/${workspaceId}/members`, { userId: pm.userId, role: 'PROGRAMME_MANAGER' });
    const cohort = (await api(admin).post(`/programmes/${programmeId}/cohorts`, { name: `Cohort ${uniq()}`, capacity: 10 })).data;
    cohortId = cohort.id;
    const org = await makeOrg(admin);
    orgId = org.id;
  });

  it('takes one organisation all the way to ACTIVE through the real workspace enrolment API', async () => {
    const created = await api(pm).post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: orgId });
    expect(created.status, JSON.stringify(created.error)).toBe(201);
    participantId = created.data.id;
    for (const next of ['ELIGIBILITY', 'SELECTED', 'INVITED']) {
      expect((await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/transition`, { status: next })).status).toBe(200);
    }
    expect((await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/consent`, {})).status).toBe(200);
    expect((await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/onboard`, {})).status).toBe(200);
    expect((await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/cohort`, { cohortId })).status).toBe(200);
    const activated = await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/activate`, {});
    expect(activated.status, JSON.stringify(activated.error)).toBe(200);
    expect(activated.data.status).toBe('ACTIVE');
  });

  it('a case is not created for a workspace participant -- open: see the file-level comment above', async () => {
    const cases = await db().select().from(schema.cases).where(eq(schema.cases.programmeId, programmeId));
    // The organisation is ACTIVE in the programme's delivery cohort, with a consent record, an
    // onboarding date and a cohort assignment -- everything a real enrolment needs -- yet there is
    // no `cases` row for it at all. The entire diagnostic/prescription/certification/report pipeline
    // (services/diagnostics.ts, services/reports.ts, services/certificates.ts) is keyed on caseId and
    // has no way to know this organisation exists, let alone that it is mid-programme. Whether
    // workspace activation should create one is the open product decision above, not fixed here.
    expect(cases.length).toBe(0);
  });

  it('FIXED: the cohort\'s "enrolled" count now includes active workspace participants, not just cases', async () => {
    const view = await api(admin).get(`/programmes/${programmeId}`);
    expect(view.status).toBe(200);
    const cohort = view.data.cohorts.find((c: any) => c.id === cohortId);
    expect(cohort).toBeTruthy();
    expect(cohort.enrolled).toBe(1);
    const participants = await api(pm).get(`/programme-workspaces/${workspaceId}/participants`);
    expect(participants.data.filter((p: any) => p.cohortId === cohortId).length).toBe(1);
  });

  it('FIXED: the close-out gate now blocks completion while a workspace participant is still being delivered to', async () => {
    // assertCloseoutReady (services/programmes.ts) now also checks programme_participants: any
    // participant not yet COMPLETED, WITHDRAWN or REJECTED blocks the Active -> Completed move, the
    // same way an in-flight `case` already did. Before this fix, a programme delivered entirely
    // through the workspace path had zero `cases`, so every case-based check was vacuously satisfied
    // and completion sailed through with a business sitting ACTIVE mid-cohort.
    expect((await api(admin).patch(`/programmes/${programmeId}`, { status: 'Active' })).status).toBe(200);
    const complete = await api(admin).patch(`/programmes/${programmeId}`, { status: 'Completed' });
    expect(complete.status).toBe(422);
    expect(complete.error.message).toMatch(/workspace participant/i);
    const after = await api(admin).get(`/programmes/${programmeId}`);
    expect(after.data.status).toBe('Active'); // the flip never happened
    // Completing the participant first (its own terminal step) clears the gate.
    expect((await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/transition`, { status: 'COMPLETING' })).status).toBe(200);
    expect((await api(pm).post(`/programme-workspaces/${workspaceId}/participants/${participantId}/transition`, { status: 'COMPLETED' })).status).toBe(200);
    expect((await api(admin).patch(`/programmes/${programmeId}`, { status: 'Completed' })).status).toBe(200);
  });

  it('for contrast: the case-based path this gate was actually built for does enforce the released-report rule', async () => {
    // Same gate, exercised through the OTHER programme-delivery path, to confirm the rule genuinely
    // works end to end there -- the gap above is specific to the workspace path having no `cases`
    // row at all, not a general bug in assertCloseoutReady.
    const prog2 = (await api(admin).post('/programmes', { name: `Case-path ${uniq()}` })).data;
    const org2 = await makeOrg(admin);
    const consultant = await makeUser('EXPERT'); const reviewer = await makeUser('REVIEWER');
    const cs = (await api(admin).post('/cases', { orgId: org2.id, programmeId: prog2.id })).data;
    await api(admin).post(`/cases/${cs.id}/assign`, { consultantId: consultant.userId, reviewerId: reviewer.userId });
    expect((await api(finance).get('/invoices')).status).toBe(200); // sanity: finance session works before the real check below
    expect((await api(admin).patch(`/programmes/${prog2.id}`, { status: 'Active' })).status).toBe(200);
    const blocked = await api(admin).patch(`/programmes/${prog2.id}`, { status: 'Completed' });
    expect(blocked.status).toBe(422); // in-flight case, exactly as designed
    expect(blocked.error.message).toMatch(/active delivery/i);
  });
});
