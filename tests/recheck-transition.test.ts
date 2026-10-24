import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { answerSheet, api, ensureReference, makeOrg, makeUser, type Session } from './helpers';
import { db, schema } from '@/db/client';

type CaseStatus = typeof schema.cases.$inferInsert.status;

/**
 * #87's RE-CHECK loop: a new score should classify as progressing/regressing/stable, and a
 * regression on an already-in-delivery case (RE-CHECK, not the original baseline) should point
 * toward a new prescription, not just a silent number change. This drives the real computeScore
 * path (services/diagnostics.ts) through two submitted diagnostics and checks the events and
 * notification it produces.
 */
let admin: Session;
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); });
const events = (caseId: string, type: string) => db().select().from(schema.events).where(and(eq(schema.events.caseId, caseId), eq(schema.events.type, type)));
const notes = (userId: string, kind: string) => db().select().from(schema.notifications).where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, kind)));

async function caseWithBaseline(status: CaseStatus) {
  const org = await makeOrg(admin); const owner = await makeUser('OWNER', { orgId: org.id });
  const consultant = await makeUser('EXPERT');
  const c = (await api(admin).post('/cases', { orgId: org.id })).data;
  await api(admin).post(`/cases/${c.id}/assign`, { consultantId: consultant.userId });
  const baseline = await api(consultant).post(`/cases/${c.id}/diagnostics`, { answers: await answerSheet(4, 'Self-reported') });
  expect(baseline.status, JSON.stringify(baseline.error)).toBe(201);
  await db().update(schema.cases).set({ status }).where(eq(schema.cases.id, c.id));
  return { caseId: c.id as string, consultant, owner };
}

describe('#87: RE-CHECK transition classification feeds HealthDeclined/HealthImproved and the regression nudge', () => {
  it('a large drop on a case already in a RE-CHECK phase fires HealthDeclined and notifies the consultant to consider a new prescription', async () => {
    const { caseId, consultant } = await caseWithBaseline('MONITORING');
    // Submitted by someone other than the consultant -- notifyUsers never notifies the actor who
    // triggered the change, and the point here is the consultant being told about someone else's RE-CHECK.
    const recheck = await api(admin).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet(0, 'Self-reported') });
    expect(recheck.status, JSON.stringify(recheck.error)).toBe(201);
    expect((await events(caseId, 'HealthDeclined')).length).toBe(1);
    expect((await events(caseId, 'HealthImproved')).length).toBe(0);
    expect((await notes(consultant.userId, 'RecheckRegression')).length).toBe(1);
  });

  it('the same drop on a case still at its original baseline (not yet a RE-CHECK) still fires HealthDeclined, but does not nudge toward a new prescription', async () => {
    const { caseId, consultant } = await caseWithBaseline('DIAGNOSTIC');
    const second = await api(admin).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet(0, 'Self-reported') });
    expect(second.status, JSON.stringify(second.error)).toBe(201);
    expect((await events(caseId, 'HealthDeclined')).length).toBe(1);
    expect((await notes(consultant.userId, 'RecheckRegression')).length).toBe(0);
  });

  it('a large rise on a RE-CHECK fires HealthImproved, not HealthDeclined, and no regression nudge', async () => {
    const org = await makeOrg(admin); const consultant = await makeUser('EXPERT');
    const c = (await api(admin).post('/cases', { orgId: org.id })).data;
    await api(admin).post(`/cases/${c.id}/assign`, { consultantId: consultant.userId });
    const low = await api(consultant).post(`/cases/${c.id}/diagnostics`, { answers: await answerSheet(0, 'Self-reported') });
    expect(low.status, JSON.stringify(low.error)).toBe(201);
    await db().update(schema.cases).set({ status: 'MIDLINE' }).where(eq(schema.cases.id, c.id));
    const high = await api(admin).post(`/cases/${c.id}/diagnostics`, { answers: await answerSheet(4, 'Self-reported') });
    expect(high.status, JSON.stringify(high.error)).toBe(201);
    expect((await events(c.id, 'HealthImproved')).length).toBe(1);
    expect((await events(c.id, 'HealthDeclined')).length).toBe(0);
    expect((await notes(consultant.userId, 'RecheckRegression')).length).toBe(0);
  });
});
