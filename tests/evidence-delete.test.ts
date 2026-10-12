import { beforeAll, describe, expect, it } from 'vitest';
import { answerSheet, api, ensureReference, makeOrg, makeUser, type Session } from './helpers';
import { can } from '@/lib/rbac';

let admin: Session, lead: Session, stranger: Session, owner: Session, caseId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  lead = await makeUser('EXPERT'); stranger = await makeUser('EXPERT');
  const org = await makeOrg(admin); owner = await makeUser('OWNER', { orgId: org.id });
  caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
  await api(admin).post(`/cases/${caseId}/assign`, { consultantId: lead.userId, coachId: null, reviewerId: null });
});

describe('evidence deletion', () => {
  it('has the delete action in the matrix for staff who may already edit evidence, plus the case owner', () => {
    expect(can('ADMIN', 'evidence', 'delete')).toBe(true);
    expect(can('EXPERT', 'evidence', 'delete')).toBe(true);
    expect(can('OWNER', 'evidence', 'delete')).toBe(true);
    expect(can('REVIEWER', 'evidence', 'delete')).toBe(false);
  });

  it('lets the lead expert delete an unverified evidence item they added', async () => {
    const add = await api(lead).post(`/cases/${caseId}/evidence`, { description: 'Sales ledger seen on site', class: 'Self-reported' });
    expect(add.status).toBe(201);
    const del = await api(lead).del(`/evidence/${add.data.id}`);
    expect(del.status).toBe(200);
    const list = await api(lead).get(`/cases/${caseId}/evidence`);
    expect(list.data.find((e: any) => e.id === add.data.id)).toBeUndefined();
  });

  it('refuses an expert not on the case (out of scope, so the row is reported not found, not forbidden)', async () => {
    const add = await api(lead).post(`/cases/${caseId}/evidence`, { description: 'Bank statement on file', class: 'Self-reported' });
    expect((await api(stranger).del(`/evidence/${add.data.id}`)).status).toBe(404);
  });

  it('lets the owner delete unverified evidence on their own case', async () => {
    const add = await api(lead).post(`/cases/${caseId}/evidence`, { description: 'Owner-visible note', class: 'Self-reported' });
    const del = await api(owner).del(`/evidence/${add.data.id}`);
    expect(del.status).toBe(200);
    const list = await api(lead).get(`/cases/${caseId}/evidence`);
    expect(list.data.find((e: any) => e.id === add.data.id)).toBeUndefined();
  });

  it('refuses the owner on verified evidence, same as everyone else', async () => {
    const add = await api(lead).post(`/cases/${caseId}/evidence`, { description: 'Verified bank statement for owner check', class: 'Self-reported' });
    const ver = await api(lead).patch(`/evidence/${add.data.id}`, { class: 'Verified' });
    expect(ver.status).toBe(200);
    const del = await api(owner).del(`/evidence/${add.data.id}`);
    expect(del.status).toBe(400);
    const list = await api(lead).get(`/cases/${caseId}/evidence`);
    expect(list.data.find((e: any) => e.id === add.data.id)).toBeDefined();
  });

  it('refuses the owner on evidence that backs a submitted diagnostic answer, even once a consultant has downgraded it', async () => {
    const answers = await answerSheet(3, 'Self-reported');
    const submit = await api(lead).post(`/cases/${caseId}/diagnostics`, { answers });
    expect(submit.status).toBe(201);
    const list = await api(lead).get(`/cases/${caseId}/evidence`);
    const backing = list.data.find((e: any) => !!e.responseId);
    expect(backing).toBeDefined();
    // The consultant rejects it (downgrades it to Missing) -- this is the state where deleting it would
    // matter most, since computeScore's fallback to the response's own frozen class would otherwise let
    // the owner silently undo the rejection by deleting the (now Missing) evidence row.
    const reject = await api(lead).patch(`/evidence/${backing.id}`, { class: 'Missing' });
    expect(reject.status).toBe(200);
    const del = await api(owner).del(`/evidence/${backing.id}`);
    expect(del.status).toBe(403);
    const after = await api(lead).get(`/cases/${caseId}/evidence`);
    expect(after.data.find((e: any) => e.id === backing.id)).toBeDefined();
    // The lead expert still can -- this restriction is owner-specific, not a blanket ban on response-linked evidence.
    const staffDel = await api(lead).del(`/evidence/${backing.id}`);
    expect(staffDel.status).toBe(200);
  });

  it('refuses to delete a 404 and a verified item, keeping it as a correction via reclassification instead', async () => {
    expect((await api(lead).del(`/evidence/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    const add = await api(lead).post(`/cases/${caseId}/evidence`, { description: 'Verified bank statement', class: 'Self-reported' });
    const ver = await api(lead).patch(`/evidence/${add.data.id}`, { class: 'Verified' });
    expect(ver.status).toBe(200);
    const del = await api(lead).del(`/evidence/${add.data.id}`);
    expect(del.status).toBe(400);
    const list = await api(lead).get(`/cases/${caseId}/evidence`);
    expect(list.data.find((e: any) => e.id === add.data.id)).toBeDefined();
  });
});
