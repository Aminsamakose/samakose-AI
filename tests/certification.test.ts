import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@/db/client';
import { eq, sql } from 'drizzle-orm';
import { evaluateCertification, effectiveStatus, validUntil, type CertFacts } from '@/domain/certification';
import { answerSheet, api, call, drain, ensureReference, makeOrg, makeUser, type Session } from './helpers';

const base: CertFacts = { hasScore: true, overall: 80, confidence: 'High', frameworkPublished: true, dimensions: [{ dimension: 'Finance', value: 70 }], evidenceShare: { Verified: 0.7 }, readiness: null, diagnosisReviewed: true, prescriptionApproved: true };

describe('certification rules', () => {
  it('needs every criterion and then sets the level by score', () => {
    expect(evaluateCertification(base, {}).level).toBe('Established');
    expect(evaluateCertification({ ...base, overall: 65 }, {}).level).toBe('Foundation');
    expect(evaluateCertification({ ...base, overall: 50 }, {}).level).toBeNull();
    for (const bad of [{ confidence: 'Low' }, { frameworkPublished: false }, { diagnosisReviewed: false }, { prescriptionApproved: false }, { evidenceShare: { Verified: 0.2 } }, { dimensions: [{ dimension: 'Finance', value: 30 }] }])
      expect(evaluateCertification({ ...base, ...bad } as CertFacts, {}).eligible, JSON.stringify(bad)).toBe(false);
  });
  it('reaches Investment-ready only with a Ready index, and returns the framework unlocks', () => {
    const readiness = [{ code: 'R1', name: 'Loan readiness', level: 'Ready', unlocks: 'Access to the partner credit window', blocking: [] }, { code: 'R2', name: 'Grant readiness', level: 'Emerging', unlocks: 'Grants', blocking: [] }];
    const r = evaluateCertification({ ...base, overall: 90, readiness }, {});
    expect(r.level).toBe('Investment-ready'); expect(r.unlocks.map((u) => u.code)).toEqual(['R1']);
    expect(evaluateCertification({ ...base, overall: 90, readiness: readiness.map((x) => ({ ...x, level: 'Emerging' })) }, {}).level).toBe('Established');
  });
  it('a blocking gate stops certification', () => {
    const r = evaluateCertification({ ...base, readiness: [{ code: 'R1', name: 'Loan', level: 'Not ready', unlocks: null, blocking: [{ code: 'Q1', value: 1, label: 'No bank account' }] }] }, {});
    expect(r.eligible).toBe(false); expect(r.criteria.find((c) => c.id === 'gates')!.detail).toMatch(/No bank account/);
  });
  it('expires after the valid period', () => {
    const from = new Date('2026-01-31T00:00:00Z');
    expect(effectiveStatus('Certified', validUntil(from, 12), new Date('2027-06-01'))).toBe('Expired');
    expect(effectiveStatus('Certified', validUntil(from, 12), new Date('2026-06-01'))).toBe('Certified');
    expect(effectiveStatus('Revoked', null)).toBe('Revoked');
  });
});

let admin: Session, consultant: Session, coach: Session, reviewer: Session, owner: Session, other: Session, caseId: string, certId: string;
const poll = async (s: Session, jobId: string) => { for (let i = 0; i < 40; i++) { await drain(); const j = (await api(s).get(`/jobs/${jobId}`)).data; if (j.status === 'done' || j.status === 'failed') return j; } throw new Error('job timeout'); };

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); consultant = await makeUser('EXPERT'); coach = await makeUser('EXPERT'); reviewer = await makeUser('REVIEWER'); other = await makeUser('REVIEWER');
  const org = await makeOrg(admin); owner = await makeUser('OWNER', { orgId: org.id });
  caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
  await api(admin).post(`/cases/${caseId}/assign`, { consultantId: consultant.userId, coachId: coach.userId, reviewerId: reviewer.userId });
  await api(owner).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet(4, 'Self-reported') });
  for (const e of (await api(consultant).get(`/cases/${caseId}/evidence`)).data) await api(consultant).patch(`/evidence/${e.id}`, { class: 'Verified' });
});

describe('certification through the API', () => {
  it('is not eligible before a diagnosis and prescription are approved, and refuses a proposal', async () => {
    const c = (await api(consultant).get(`/cases/${caseId}/certification`)).data;
    expect(c.eligibility.eligible).toBe(false);
    expect(c.eligibility.criteria.filter((x: any) => !x.met).map((x: any) => x.id)).toEqual(expect.arrayContaining(['diagnosis', 'prescription']));
    expect((await api(consultant).post(`/cases/${caseId}/certification/propose`, { rationale: 'Ready on the evidence we hold.' })).status).toBe(422);
  });
  it('becomes eligible once the diagnosis is reviewed and the prescription approved', async () => {
    expect((await poll(consultant, (await api(consultant).post(`/cases/${caseId}/diagnoses/generate`)).data.jobId)).status).toBe('done');
    const dgn = (await api(consultant).get(`/cases/${caseId}/diagnoses`)).data[0];
    expect((await api(consultant).post(`/diagnoses/${dgn.id}/review`, { decision: 'Reviewed', note: 'Agreed' })).status).toBe(200);
    expect((await poll(consultant, (await api(consultant).post(`/cases/${caseId}/prescriptions/generate`)).data.jobId)).status).toBe('done');
    const rx = (await api(consultant).get(`/cases/${caseId}/prescriptions`)).data[0];
    await api(consultant).post(`/prescriptions/${rx.id}/submit`);
    expect((await api(reviewer).post(`/prescriptions/${rx.id}/review`, { decision: 'APPROVED', reason: 'Approved' })).status).toBe(200);
    const c = (await api(consultant).get(`/cases/${caseId}/certification`)).data;
    expect(c.eligibility.eligible).toBe(true); expect(c.eligibility.level).toBe('Established'); expect(c.canPropose).toBe(true);
  });
  it('only the lead expert or an administrator can propose', async () => {
    expect((await api(coach).post(`/cases/${caseId}/certification/propose`, { rationale: 'I would like this certified.' })).status).toBe(403);
    expect((await api(owner).post(`/cases/${caseId}/certification/propose`, { rationale: 'Please certify us now.' })).status).toBe(403);
    const r = await api(consultant).post(`/cases/${caseId}/certification/propose`, { rationale: 'Verified evidence covers the score and the plan is approved.' });
    expect(r.status).toBe(201); certId = r.data.id; expect(r.data.status).toBe('Proposed');
    expect((await api(consultant).post(`/cases/${caseId}/certification/propose`, { rationale: 'A second proposal should be refused.' })).status).toBe(422);
  });
  it('an owner sees nothing until it is issued', async () => {
    const c = (await api(owner).get(`/cases/${caseId}/certification`)).data;
    expect(c.current).toBeNull(); expect(c.history).toEqual([]); expect(c.eligibility).toBeNull();
  });
  it('four eyes: the proposer, the case team, an owner and an out-of-scope reviewer cannot decide', async () => {
    for (const s of [consultant, coach, owner]) expect((await api(s).post(`/certificates/${certId}/decision`, { decision: 'Certify', note: 'Looks good to me' })).status).toBe(403);
    expect((await api(other).post(`/certificates/${certId}/decision`, { decision: 'Certify', note: 'Looks good to me' })).status).toBe(404);
    // An administrator who proposed a certificate cannot decide it either.
    const [row] = await db().select().from(schema.certificates).where(eq(schema.certificates.id, certId));
    await expect(db().update(schema.certificates).set({ status: 'Certified', decidedBy: row.proposedBy }).where(eq(schema.certificates.id, certId))).rejects.toThrow();
  });
  it('the assigned reviewer certifies, with an expiry and the criteria frozen', async () => {
    const r = await api(reviewer).post(`/certificates/${certId}/decision`, { decision: 'Certify', note: 'Evidence checked against the record.' });
    expect(r.status).toBe(200); expect(r.data.status).toBe('Certified'); expect(r.data.expiresAt).toBeTruthy();
    expect((r.data.criteria as any[]).every((c) => c.met)).toBe(true);
    expect((await api(reviewer).post(`/certificates/${certId}/decision`, { decision: 'Certify', note: 'Second time round' })).status).toBe(422);
    const own = (await api(owner).get(`/cases/${caseId}/certification`)).data;
    expect(own.current.level).toBe('Established'); expect(own.history).toEqual([]);
  });
  it('shares nothing until the owner agrees, then shows only name, level and dates', async () => {
    expect((await call('GET', `/public/certificates/${certId}`)).status).toBe(404);
    expect((await api(reviewer).post(`/certificates/${certId}/verification`, { on: true })).status).toBe(403);
    expect((await api(owner).post(`/certificates/${certId}/verification`, { on: true })).status).toBe(200);
    const v = await call('GET', `/public/certificates/${certId}`);
    expect(v.status).toBe(200); expect(v.data).toMatchObject({ level: 'Established', status: 'Valid' });
    expect(Object.keys(v.data).sort()).toEqual(['expiresAt', 'issuedAt', 'level', 'organisation', 'revokedAt', 'status']);
    expect((await call('GET', '/public/certificates/not-an-id')).status).toBe(404);
    expect((await api(owner).post(`/certificates/${certId}/verification`, { on: false })).status).toBe(200);
    expect((await call('GET', `/public/certificates/${certId}`)).status).toBe(404);
    await api(owner).post(`/certificates/${certId}/verification`, { on: true });
  });
  it('gives the investment pack only for a valid Investment-ready certificate', async () => {
    expect((await api(owner).get(`/cases/${caseId}/investment-pack`)).status).toBe(422);
  });
  it('can be revoked with a reason and then stays final', async () => {
    expect((await api(consultant).post(`/certificates/${certId}/revoke`, { reason: 'Evidence was withdrawn' })).status).toBe(403);
    expect((await api(reviewer).post(`/certificates/${certId}/revoke`, { reason: 'x' })).status).toBe(400);
    expect((await api(reviewer).post(`/certificates/${certId}/revoke`, { reason: 'Evidence was withdrawn' })).data.status).toBe('Revoked');
    expect((await call('GET', `/public/certificates/${certId}`)).data.status).toBe('Revoked');
    await expect(db().update(schema.certificates).set({ status: 'Certified' }).where(eq(schema.certificates.id, certId))).rejects.toThrow();
    await expect(db().delete(schema.certificates).where(eq(schema.certificates.id, certId))).rejects.toThrow();
    const trail = (await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, certId))).map((a) => a.action);
    expect(trail).toEqual(expect.arrayContaining(['certificate.proposed', 'certificate.certified', 'certificate.revoked']));
  });
  it('shows an expired certificate as Expired', async () => {
    const r = await api(admin).post(`/cases/${caseId}/certification/propose`, { rationale: 'Renewal after the revocation was cleared.' });
    expect(r.status).toBe(201);
    const id = r.data.id;
    expect((await api(reviewer).post(`/certificates/${id}/decision`, { decision: 'Certify', note: 'Renewed on current evidence' })).status).toBe(200);
    await db().execute(sql`update certificates set expires_at = now() - interval '1 day' where id = ${id}`);
    const c = (await api(admin).get(`/cases/${caseId}/certification`)).data;
    expect(c.current).toBeNull(); expect(c.history.find((h: any) => h.id === id).status).toBe('Expired');
  });
});

describe('investment readiness pack with an Investment-ready certificate', () => {
  it('builds the pack from the certified score and leaves out risks and AI drafts', async () => {
    // Lift the latest score to Investment-ready: a strong score with one readiness index at Ready.
    const [sc] = await db().select().from(schema.healthScores).where(eq(schema.healthScores.caseId, caseId)).orderBy(sql`created_at desc`).limit(1);
    const readiness = [{ code: 'R1', name: 'Loan readiness', level: 'Ready', index: 88, unlocks: 'Unlocks: Access to the partner credit window', blocking: [] }];
    const { id: _id, createdAt: _c, ...rest } = sc;
    await db().insert(schema.healthScores).values({ ...rest, run: sc.run + 1, overall: '90.0', confidenceClass: 'High', extras: { ...(sc.extras ?? {}), readiness } });
    const r = await api(admin).post(`/cases/${caseId}/certification/propose`, { rationale: 'Strong evidence and a Ready loan index.' });
    expect(r.status).toBe(201);
    expect(r.data.level).toBe('Investment-ready');
    expect((await api(reviewer).post(`/certificates/${r.data.id}/decision`, { decision: 'Certify', note: 'Confirmed against the evidence' })).status).toBe(200);

    const pack = await api(owner).get(`/cases/${caseId}/investment-pack`);
    expect(pack.status).toBe(200);
    expect(pack.data.certificate.level).toBe('Investment-ready');
    expect(pack.data.score.overall).toBe(90);
    expect(pack.data.readiness[0]).toMatchObject({ code: 'R1', level: 'Ready', unlocks: 'Access to the partner credit window' });
    expect(pack.data.plan.length).toBeGreaterThan(0);
    expect(pack.data.organisation.name).toBeTruthy();
    const text = JSON.stringify(pack.data).toLowerCase();
    for (const banned of ['"risks"', 'aidraft', 'ai_draft', 'rationale']) expect(text).not.toContain(banned);
    // Other businesses and unrelated reviewers cannot read it.
    expect([403, 404]).toContain((await api(other).get(`/cases/${caseId}/investment-pack`)).status);
  });
  it('stops being available once the certificate is revoked', async () => {
    const cur = (await api(admin).get(`/cases/${caseId}/certification`)).data.current;
    expect((await api(reviewer).post(`/certificates/${cur.id}/revoke`, { reason: 'Evidence withdrawn after review' })).status).toBe(200);
    expect((await api(owner).get(`/cases/${caseId}/investment-pack`)).status).toBe(422);
  });
});
