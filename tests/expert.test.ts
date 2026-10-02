import { beforeAll, describe, expect, it } from 'vitest';
import { answerSheet, api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { can } from '@/lib/rbac';

let admin: Session, pm: Session, lead: Session, coach: Session, stranger: Session, reviewer: Session, owner: Session, caseId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  lead = await makeUser('EXPERT'); coach = await makeUser('EXPERT'); stranger = await makeUser('EXPERT'); reviewer = await makeUser('REVIEWER');
  const prog = (await api(admin).post('/programmes', { name: `Programme ${uniq()}`, funder: 'Test Funder', startDate: '2026-01-01', endDate: '2027-01-01', budgetGhs: 1000 })).data;
  await api(admin).patch(`/programmes/${prog.id}`, { status: 'Active' });
  pm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [prog.id] });
  const org = await makeOrg(admin); owner = await makeUser('OWNER', { orgId: org.id });
  caseId = (await api(pm).post('/cases', { orgId: org.id, programmeId: prog.id })).data.id;
});

describe('one EXPERT role, least privilege by assignment', () => {
  it('has the new actions in the matrix, and only where intended', () => {
    expect(can('ADMIN', 'cases', 'assign')).toBe(true); expect(can('PROGRAMME_MANAGER', 'cases', 'assign')).toBe(true); expect(can('EXPERT', 'cases', 'assign')).toBe(false);
    expect(can('EXPERT', 'evidence', 'verify')).toBe(true); expect(can('ADMIN', 'evidence', 'verify')).toBe(false); expect(can('OWNER', 'evidence', 'verify')).toBe(false);
    expect(can('ADMIN', 'cases', 'certify')).toBe(true); expect(can('EXPERT', 'cases', 'certify')).toBe(false); expect(can('PROGRAMME_MANAGER', 'cases', 'certify')).toBe(false);
  });
  it('lets only an administrator or programme manager assign, and only experts and a reviewer', async () => {
    expect((await api(lead).post(`/cases/${caseId}/assign`, { consultantId: lead.userId })).status).toBe(403);
    expect((await api(pm).post(`/cases/${caseId}/assign`, { consultantId: reviewer.userId })).status).toBe(400);
    expect((await api(pm).post(`/cases/${caseId}/assign`, { consultantId: lead.userId, coachId: coach.userId, reviewerId: reviewer.userId })).status).toBe(200);
  });
  it('shows a case to its lead and its coach, and hides it from other experts', async () => {
    expect((await api(lead).get(`/cases/${caseId}`)).status).toBe(200);
    expect((await api(coach).get(`/cases/${caseId}`)).status).toBe(200);
    expect((await api(stranger).get(`/cases/${caseId}`)).status).toBe(404);
  });
  it('keeps diagnostic, evidence and diagnosis work with the lead, not the coaching expert', async () => {
    const answers = await answerSheet(3, 'Self-reported');
    expect((await api(coach).post(`/cases/${caseId}/diagnostics`, { answers, uuid: `x-${uniq()}` })).status).toBe(403);
    expect((await api(stranger).post(`/cases/${caseId}/diagnostics`, { answers, uuid: `x-${uniq()}` })).status).toBe(404);
    const ok = await api(lead).post(`/cases/${caseId}/diagnostics`, { answers, uuid: `x-${uniq()}` });
    expect(ok.status).toBe(201);
    expect((await api(coach).post(`/cases/${caseId}/diagnoses`, { summary: 'A coach should not write this diagnosis here', rootCauses: [{ cause: 'No written records kept', evidence_ids: ['EV-1'] }], priority: 'High', risks: [] })).status).toBe(403);
  });
  it('lets only the lead expert verify evidence', async () => {
    const e = await api(lead).post(`/cases/${caseId}/evidence`, { description: 'Sales ledger seen on site', class: 'Document-supported' });
    expect(e.status).toBe(201);
    expect((await api(coach).patch(`/evidence/${e.data.id}`, { class: 'Verified' })).status).toBe(403);
    expect((await api(admin).patch(`/evidence/${e.data.id}`, { class: 'Verified' })).status).toBe(403);
    expect((await api(lead).patch(`/evidence/${e.data.id}`, { class: 'Verified' })).status).toBe(200);
  });
  it('still lets the coaching expert do coaching work', async () => {
    const when = new Date(Date.now() + 86400000).toISOString();
    expect((await api(coach).post(`/cases/${caseId}/sessions`, { scheduledAt: when })).status).toBe(201);
  });
});
