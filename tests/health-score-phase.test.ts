import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { answerSheet, api, ensureReference, makeOrg, makeUser, type Session } from './helpers';

/**
 * Baseline/midline/endline tagging on health scores: "baseline" used to be inferred positionally
 * (run = 1), which breaks the moment a round is skipped, repeated or re-ordered. phase is now set
 * at scoring time from the case's own lifecycle state (computeScore, services/diagnostics.ts):
 * the first score a case ever gets is always BASELINE; a score taken while the case sits in
 * MIDLINE or ENDLINE carries that label; anything else is OTHER. The case is driven straight to
 * MIDLINE/ENDLINE via a direct status write here -- these tests isolate the phase-tagging rule
 * itself, not the full lifecycle state machine, which other tests already cover.
 */
describe('health score phase (baseline/midline/endline, not inferred from run number)', () => {
  let admin: Session, owner: Session, caseId: string;

  beforeAll(async () => {
    await ensureReference();
    admin = await makeUser('ADMIN');
    const org = await makeOrg(admin);
    owner = await makeUser('OWNER', { orgId: org.id });
    caseId = (await api(admin).post('/cases', { orgId: org.id, startState: 'PROFILED' })).data.id;
  });

  async function submit() {
    const r = await api(owner).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet(4, 'Self-reported') });
    expect(r.status, JSON.stringify(r.error)).toBe(201);
    return r;
  }
  async function setStatus(status: string) {
    await db().update(schema.cases).set({ status: status as any }).where(eq(schema.cases.id, caseId));
  }
  async function latestPhase() {
    const all = await db().select({ phase: schema.healthScores.phase }).from(schema.healthScores).where(eq(schema.healthScores.caseId, caseId)).orderBy(schema.healthScores.createdAt);
    return all[all.length - 1].phase;
  }

  it('the first-ever score for a case is always BASELINE', async () => {
    await submit();
    expect(await latestPhase()).toBe('BASELINE');
  });

  it('a score taken while the case sits in MIDLINE is tagged MIDLINE', async () => {
    await setStatus('MIDLINE');
    await submit();
    expect(await latestPhase()).toBe('MIDLINE');
  });

  it('a score taken while the case sits in ENDLINE is tagged ENDLINE', async () => {
    await setStatus('ENDLINE');
    await submit();
    expect(await latestPhase()).toBe('ENDLINE');
  });

  it('a score taken outside those milestones is OTHER, not mistaken for a repeat baseline', async () => {
    await setStatus('MONITORING');
    await submit();
    expect(await latestPhase()).toBe('OTHER');
  });

  it('the full score history for the case carries one tag per run, in order', async () => {
    const history = (await api(owner).get(`/cases/${caseId}/scores`)).data.history;
    expect(history.map((h: any) => h.phase)).toEqual(['BASELINE', 'MIDLINE', 'ENDLINE', 'OTHER']);
  });
});
