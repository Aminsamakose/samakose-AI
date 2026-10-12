import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, type Session } from './helpers';
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
