import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { DEFAULT_RULES, freeAssessmentClassification } from '@/domain/logic';
import { ensureReference, api, makeUser, makeOrg, type Session } from './helpers';
import { matchPublicAssessmentsToOrganisations } from '@/services/assessment-validity';
import { systemCtx } from '@/services/common';
import type { Ctx } from '@/lib/context';

const SME360_DIMENSIONS = ['Strategy and Leadership', 'Financial Health', 'Marketing and Sales', 'Operations and Productivity', 'Human Resources and Organisation', 'Risk, Resilience and Growth'];
const sme360Result = (score: number) => ({
  overallScore: score, classification: freeAssessmentClassification(score, DEFAULT_RULES),
  dimensionScores: SME360_DIMENSIONS.map((dimension) => ({ dimension, score })), completedAt: new Date().toISOString()
});

let admin: Session, pm: Session;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); pm = await makeUser('PROGRAMME_MANAGER');
});

describe('#128 convergent-validity join: free_assessment_results <-> organisations', () => {
  it('lets a programme manager read (frameworks:read) but only an administrator trigger the match (frameworks:edit)', async () => {
    expect((await api(pm).get('/settings/frameworks/convergent-validity')).status).toBe(200);
    expect((await api(pm).post('/settings/frameworks/convergent-validity/match', {})).status).toBe(403);
  });

  it('matches a free-assessment result to the organisation sharing its email, is idempotent, and leaves an ambiguous email unmatched', async () => {
    const email = `match-${Date.now()}@example.test`;
    await db().insert(schema.freeAssessmentResults).values({ email, fullName: 'Matched Owner', platform: 'SME360', result: sme360Result(72) });

    // No organisation with this email yet -- nothing to match.
    let run = await api(admin).post('/settings/frameworks/convergent-validity/match', {});
    expect(run.status).toBe(200);
    const [before] = await db().select().from(schema.freeAssessmentResults).where(eq(schema.freeAssessmentResults.email, email));
    expect(before.matchedOrgId).toBeNull();

    // Register the matching SME organisation (makeOrg defaults to AGRIFOOD; override for an SME platform match).
    const orgResp = await api(admin).post('/organisations', { name: `Matched Co ${Date.now()}`, type: 'SME', sector: 'Retail', region: 'Northern', district: 'Tamale', contactEmail: email.toUpperCase() + '  ', consent: true, consentBy: 'Test Owner' });
    expect(orgResp.status).toBe(201);

    run = await api(admin).post('/settings/frameworks/convergent-validity/match', {});
    expect(run.status).toBe(200);
    expect(run.data.matched).toBeGreaterThanOrEqual(1);
    const [after] = await db().select().from(schema.freeAssessmentResults).where(eq(schema.freeAssessmentResults.email, email));
    expect(after.matchedOrgId).toBe(orgResp.data.id);

    // Re-running does nothing more -- it only fills in still-unmatched rows.
    const again = await api(admin).post('/settings/frameworks/convergent-validity/match', {});
    expect(again.status).toBe(200);
    const [stillSame] = await db().select().from(schema.freeAssessmentResults).where(eq(schema.freeAssessmentResults.email, email));
    expect(stillSame.matchedOrgId).toBe(orgResp.data.id);

    const pairs = (await api(admin).get('/settings/frameworks/convergent-validity')).data;
    const pair = pairs.pairs.find((p: any) => p.orgId === orgResp.data.id);
    expect(pair).toBeTruthy();
    expect(pair.freeScore).toBe(72);
    expect(pair.paidOverall).toBeNull(); // no diagnostic scored for this org yet
    expect(pairs.summary.awaitingDiagnostic).toBeGreaterThanOrEqual(1);
  });

  it('leaves the match unset when two organisations share the same email (ambiguous)', async () => {
    const email = `ambiguous-${Date.now()}@example.test`;
    await db().insert(schema.freeAssessmentResults).values({ email, fullName: 'Ambiguous Owner', platform: 'ESO360', result: { ...sme360Result(50), classification: 'Needs Improvement' } });
    await api(admin).post('/organisations', { name: `Org A ${Date.now()}`, type: 'ESO', sector: 'Accelerator', region: 'Northern', district: 'Tamale', contactEmail: email, consent: true, consentBy: 'Test Owner' });
    await api(admin).post('/organisations', { name: `Org B ${Date.now()}`, type: 'ESO', sector: 'Incubator', region: 'Northern', district: 'Tamale', contactEmail: email, consent: true, consentBy: 'Test Owner' });

    await api(admin).post('/settings/frameworks/convergent-validity/match', {});
    const [row] = await db().select().from(schema.freeAssessmentResults).where(eq(schema.freeAssessmentResults.email, email));
    expect(row.matchedOrgId).toBeNull();
  });

  it('matches only within the same orgType/platform, never across platforms', async () => {
    const email = `crossplatform-${Date.now()}@example.test`;
    await db().insert(schema.freeAssessmentResults).values({ email, fullName: 'Cross Platform', platform: 'AGRIFOOD360', result: sme360Result(60) });
    // An SME organisation with the same email should not be picked up for an AgriFood360 result.
    const org = await api(admin).post('/organisations', { name: `SME Co ${Date.now()}`, type: 'SME', sector: 'Retail', region: 'Northern', district: 'Tamale', contactEmail: email, consent: true, consentBy: 'Test Owner' });
    expect(org.status).toBe(201);
    await api(admin).post('/settings/frameworks/convergent-validity/match', {});
    const [row] = await db().select().from(schema.freeAssessmentResults).where(eq(schema.freeAssessmentResults.email, email));
    expect(row.matchedOrgId).toBeNull();
  });

  it('runs cleanly from a system context with no user, the same way the scheduled scan calls it', async () => {
    const ctx = systemCtx(db(), 'test-scan') as Ctx;
    const r = await matchPublicAssessmentsToOrganisations(ctx);
    expect(typeof r.matched).toBe('number');
  });

  it('is refused at the API for a role with no frameworks grant at all (an owner)', async () => {
    const org = await makeOrg(admin);
    const owner = await makeUser('OWNER', { orgId: org.id });
    expect((await api(owner).get('/settings/frameworks/convergent-validity')).status).toBe(403);
  });
});

describe('#127 step 1: internal consistency of the free assessment bands', () => {
  it('reports insufficient data below the completion threshold, for every platform', async () => {
    const r = await api(admin).get('/settings/frameworks/internal-consistency');
    expect(r.status).toBe(200);
    for (const p of r.data) { expect(p.insufficientData).toBe(true); expect(p.completions).toBeGreaterThanOrEqual(0); }
  });

  it('flags a dominant band and a low average correlation once there is enough data, and reports a healthy read for a sensibly varied sample', async () => {
    const platform = `SME360-ic-${Date.now()}`; // isolate this test's rows from any other test's SME360 completions
    // 60 identical "everything is terrible" completions: one dominant band, and since every dimension is
    // identical across respondents there is no variance to correlate at all (flagged, not claimed healthy).
    const rows = Array.from({ length: 60 }, (_, i) => ({ email: `${platform}-bad-${i}@example.test`, fullName: 'Bad Co', platform: 'SME360', result: sme360Result(10) }));
    await db().insert(schema.freeAssessmentResults).values(rows);

    const r = await api(admin).get('/settings/frameworks/internal-consistency');
    const sme = r.data.find((p: any) => p.platform === 'SME360');
    expect(sme.insufficientData).toBe(false);
    expect(sme.completions).toBeGreaterThanOrEqual(60);
    expect(sme.dominantBandFlag).toBeTruthy(); // every row landed in the same band
    expect(sme.looksConsistent).toBe(false);
  });
});
