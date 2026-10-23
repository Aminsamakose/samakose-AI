import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { answerSheet, api, drain, ensureReference, makeOrg, makeUser, type Session } from './helpers';

let admin: Session, consultant: Session, coach: Session, reviewer: Session, owner: Session, caseId: string, certId: string;
const poll = async (s: Session, jobId: string) => { for (let i = 0; i < 40; i++) { await drain(); const j = (await api(s).get(`/jobs/${jobId}`)).data; if (j.status === 'done' || j.status === 'failed') return j; } throw new Error('job timeout'); };
const notes = (userId: string, kind: string) => db().select().from(schema.notifications).where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, kind)));

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); consultant = await makeUser('EXPERT'); coach = await makeUser('EXPERT'); reviewer = await makeUser('REVIEWER');
  const org = await makeOrg(admin); owner = await makeUser('OWNER', { orgId: org.id });
  caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
  await api(admin).post(`/cases/${caseId}/assign`, { consultantId: consultant.userId, coachId: coach.userId, reviewerId: reviewer.userId });
  await api(owner).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet(4, 'Self-reported') });
  for (const e of (await api(consultant).get(`/cases/${caseId}/evidence`)).data) await api(consultant).patch(`/evidence/${e.id}`, { class: 'Verified' });
  expect((await poll(consultant, (await api(consultant).post(`/cases/${caseId}/diagnoses/generate`)).data.jobId)).status).toBe('done');
  const dgn = (await api(consultant).get(`/cases/${caseId}/diagnoses`)).data[0];
  await api(consultant).post(`/diagnoses/${dgn.id}/review`, { decision: 'Reviewed', note: 'Agreed' });
  expect((await poll(consultant, (await api(consultant).post(`/cases/${caseId}/prescriptions/generate`)).data.jobId)).status).toBe('done');
  const rx = (await api(consultant).get(`/cases/${caseId}/prescriptions`)).data[0];
  await api(consultant).post(`/prescriptions/${rx.id}/submit`);
  await api(reviewer).post(`/prescriptions/${rx.id}/review`, { decision: 'APPROVED', reason: 'Approved' });
  const prop = await api(consultant).post(`/cases/${caseId}/certification/propose`, { rationale: 'Verified evidence covers the score and the plan is approved.' });
  certId = prop.data.id;
  await api(reviewer).post(`/certificates/${certId}/decision`, { decision: 'Certify', note: 'Evidence checked against the record.' });
});

describe('#86 certificate expiry: warns before expiry, notifies again once actually expired, each once', () => {
  it('warns the owner and case team once a certificate is within the warning window, and does not repeat it', async () => {
    await db().update(schema.certificates).set({ expiresAt: new Date(Date.now() + 10 * 864e5) }).where(eq(schema.certificates.id, certId));
    await db().insert(schema.jobs).values({ kind: 'certificate_expiry_scan' }); await drain();
    expect((await notes(owner.userId, 'CertificateExpiringSoon')).length).toBe(1);
    expect((await notes(consultant.userId, 'CertificateExpiringSoon')).length).toBe(1);
    await db().insert(schema.jobs).values({ kind: 'certificate_expiry_scan' }); await drain();
    expect((await notes(owner.userId, 'CertificateExpiringSoon')).length).toBe(1); // still just one, not repeated
  });

  it('notifies once more when the certificate has actually expired, and does not repeat that either', async () => {
    await db().update(schema.certificates).set({ expiresAt: new Date(Date.now() - 1 * 864e5) }).where(eq(schema.certificates.id, certId));
    await db().insert(schema.jobs).values({ kind: 'certificate_expiry_scan' }); await drain();
    expect((await notes(owner.userId, 'CertificateExpired')).length).toBe(1);
    await db().insert(schema.jobs).values({ kind: 'certificate_expiry_scan' }); await drain();
    expect((await notes(owner.userId, 'CertificateExpired')).length).toBe(1);
    // The earlier warning is untouched -- this is a second, distinct notification, not a replacement.
    expect((await notes(owner.userId, 'CertificateExpiringSoon')).length).toBe(1);
  });

  it('never warns about a revoked certificate, even one past its expiry date', async () => {
    const [base] = await db().select().from(schema.certificates).where(eq(schema.certificates.id, certId));
    const [revoked] = await db().insert(schema.certificates).values({
      caseId: base.caseId, orgId: base.orgId, scoreId: base.scoreId, level: base.level, status: 'Certified',
      overall: base.overall, criteria: base.criteria, rationale: 'A second certificate, revoked, for the #86 job test',
      proposedBy: consultant.userId, decidedBy: reviewer.userId, decidedAt: new Date(),
      expiresAt: new Date(Date.now() - 1 * 864e5), revokedBy: reviewer.userId, revokedAt: new Date(), revokeReason: 'Superseded for this test'
    }).returning();
    await db().insert(schema.jobs).values({ kind: 'certificate_expiry_scan' }); await drain();
    const expired = (await notes(owner.userId, 'CertificateExpired')).filter((n) => (n as any).link?.includes(revoked.caseId));
    // Both certificates share the same case, so this only proves the revoked row itself never produced a *second*
    // CertificateExpired event -- check the event payload directly, which is unambiguous about which certificate fired.
    const ev = await db().select().from(schema.events).where(eq(schema.events.type, 'CertificateExpired'));
    expect(ev.some((e) => (e.payload as any)?.certId === revoked.id)).toBe(false);
    void expired;
  });
});
