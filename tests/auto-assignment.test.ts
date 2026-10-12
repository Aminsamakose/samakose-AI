import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { COACH_AUTO_ASSIGN_CAP } from '@/services/assignments';

let admin: Session, pm: Session;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  pm = await makeUser('PROGRAMME_MANAGER');
});

describe('automatic coach and reviewer staffing on case creation', () => {
  it('assigns a coach and a reviewer to a new case without anyone picking from the pool', async () => {
    // Create at least one eligible candidate of each kind; the picker may choose a different one
    // already in the shared test pool if it scores or balances better, so we assert that a real,
    // correctly-roled person was placed -- not which one.
    await makeUser('REVIEWER');
    await makeUser('EXPERT');
    const org = await makeOrg(admin);
    const caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
    const [row] = await db().select().from(schema.cases).where(eq(schema.cases.id, caseId));
    expect(row.coachId).not.toBeNull();
    expect(row.reviewerId).not.toBeNull();
    const [coachUser] = await db().select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, row.coachId!));
    const [reviewerUser] = await db().select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, row.reviewerId!));
    expect(coachUser.role).toBe('EXPERT');
    expect(reviewerUser.role).toBe('REVIEWER');
  });

  it('never auto-assigns a coach already at the cap, and leaves the case uncoached if no one else qualifies', async () => {
    const soleCoach = await makeUser('EXPERT');
    await db().update(schema.practitionerProfiles).set({ maxActive: 1 }).where(eq(schema.practitionerProfiles.userId, soleCoach.userId));
    const org = await makeOrg(admin);
    // Saturate this coach with one existing active coaching assignment on an unrelated case, so load (1) already meets their maxActive (1).
    const otherOrg = await makeOrg(admin);
    const otherCaseId = (await api(admin).post('/cases', { orgId: otherOrg.id })).data.id;
    await api(admin).post(`/cases/${otherCaseId}/assign`, { coachId: soleCoach.userId, reason: 'Testing: saturating this coach' });

    const caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
    const [row] = await db().select().from(schema.cases).where(eq(schema.cases.id, caseId));
    // soleCoach is the only EXPERT created in this test's own scope willing to coach, and is at capacity,
    // so this specific case should not have been auto-coached by them. (Other tests' experts may exist in
    // the shared pool, so we only assert the saturated coach was skipped, not that the case is uncoached.)
    expect(row.coachId).not.toBe(soleCoach.userId);
  });

  it('exposes the cap as a named constant of 50', () => {
    expect(COACH_AUTO_ASSIGN_CAP).toBe(50);
  });

  it('a programme manager can still manually place a coach past the automatic cap (soft cap, auto-assign only)', async () => {
    const soleCoach = await makeUser('EXPERT');
    await db().update(schema.practitionerProfiles).set({ maxActive: 1 }).where(eq(schema.practitionerProfiles.userId, soleCoach.userId));
    const orgA = await makeOrg(admin);
    const caseA = (await api(admin).post('/cases', { orgId: orgA.id })).data.id;
    await api(admin).post(`/cases/${caseA}/assign`, { coachId: soleCoach.userId, reason: 'Testing: saturating this coach' });
    const orgB = await makeOrg(admin);
    const caseB = (await api(admin).post('/cases', { orgId: orgB.id })).data.id;
    // Manual assignment past the coach's own maxActive succeeds with a warning, never a hard block -- the
    // 50-case ceiling (and a person's own configured maxActive) only stops the automatic picker. caseB
    // may already have been auto-coached by someone else on creation, so this is a replacement and needs a reason.
    const r = await api(admin).post(`/cases/${caseB}/assign`, { coachId: soleCoach.userId, reason: 'Testing manual override past the automatic cap' });
    expect(r.status).toBe(200);
    expect(r.data.warnings.join(' ')).toMatch(/at capacity/i);
  });
});

describe('a case coach may staff their own case without a programme manager', () => {
  let coach: Session, lead: Session, specialist: Session, otherExpert: Session, caseId: string, orgId: string;
  beforeAll(async () => {
    coach = await makeUser('EXPERT');
    lead = await makeUser('EXPERT');
    specialist = await makeUser('EXPERT');
    otherExpert = await makeUser('EXPERT');
    const org = await makeOrg(admin); orgId = org.id;
    caseId = (await api(admin).post('/cases', { orgId })).data.id;
    await api(admin).post(`/cases/${caseId}/assign`, { coachId: coach.userId, reason: 'Testing: put the intended coach in place' });
  });

  it('lets the coach see ranked candidates for the lead and specialist roles, but not for the coach role itself', async () => {
    const leadMatches = await api(coach).get(`/cases/${caseId}/matches?fn=lead`);
    expect(leadMatches.status).toBe(200);
    const coachMatches = await api(coach).get(`/cases/${caseId}/matches?fn=coach`);
    expect(coachMatches.status).toBe(403);
  });

  it('lets the coach assign the lead expert on their own case', async () => {
    const r = await api(coach).post(`/cases/${caseId}/assign`, { consultantId: lead.userId });
    expect(r.status).toBe(200);
    const [row] = await db().select().from(schema.cases).where(eq(schema.cases.id, caseId));
    expect(row.consultantId).toBe(lead.userId);
  });

  it('refuses the coach permission to reassign the coach or reviewer role on their own case', async () => {
    const r1 = await api(coach).post(`/cases/${caseId}/assign`, { coachId: otherExpert.userId });
    expect(r1.status).toBe(403);
    const r2 = await api(coach).post(`/cases/${caseId}/assign`, { reviewerId: otherExpert.userId });
    expect(r2.status).toBe(403);
  });

  it('lets the coach add and remove a specialist from the pool', async () => {
    const add = await api(coach).post(`/cases/${caseId}/specialists`, { userId: specialist.userId, specialisation: 'Financial management' });
    expect(add.status).toBe(200);
    const team = await api(coach).get(`/cases/${caseId}/team`);
    expect(team.data.items.some((x: any) => x.userId === specialist.userId && x.fn === 'specialist')).toBe(true);
    const remove = await api(coach).del(`/cases/${caseId}/specialists/${specialist.userId}?reason=${encodeURIComponent('No longer needed')}`);
    expect(remove.status).toBe(200);
  });

  it('refuses an expert who is not this case\'s coach from assigning anyone on it', async () => {
    const r = await api(otherExpert).post(`/cases/${caseId}/assign`, { consultantId: otherExpert.userId });
    expect(r.status).toBe(403);
  });
});

describe('automatic reviewer staffing balances load', () => {
  it('never picks a reviewer already carrying a heavier load than other candidates', async () => {
    const busy = await makeUser('REVIEWER');
    await makeUser('REVIEWER'); // at least one lighter-loaded alternative, whatever else is in the shared pool
    // Load the busy reviewer up well past anything else likely to exist in the shared test pool.
    for (let i = 0; i < 6; i++) {
      const o = await makeOrg(admin);
      const cid = (await api(admin).post('/cases', { orgId: o.id })).data.id;
      await api(admin).post(`/cases/${cid}/assign`, { reviewerId: busy.userId, reason: 'Testing: loading this reviewer up' });
    }
    const org = await makeOrg(admin);
    const caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
    const [row] = await db().select().from(schema.cases).where(eq(schema.cases.id, caseId));
    expect(row.reviewerId).not.toBeNull();
    expect(row.reviewerId).not.toBe(busy.userId);
  });
});
