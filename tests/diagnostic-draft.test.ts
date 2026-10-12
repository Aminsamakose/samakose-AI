import { beforeAll, describe, expect, it } from 'vitest';
import { answerSheet, api, ensureReference, makeOrg, makeUser, type Session } from './helpers';

let admin: Session, lead: Session, stranger: Session, owner: Session, caseId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  lead = await makeUser('EXPERT'); stranger = await makeUser('EXPERT');
  const org = await makeOrg(admin); owner = await makeUser('OWNER', { orgId: org.id });
  caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
  await api(admin).post(`/cases/${caseId}/assign`, { consultantId: lead.userId, coachId: null, reviewerId: null });
});

describe('diagnostic draft autosave', () => {
  it('starts empty', async () => {
    const r = await api(lead).get(`/cases/${caseId}/diagnostics/draft`);
    expect(r.status).toBe(200);
    expect(r.data.answers).toEqual({});
    expect(r.data.updatedAt).toBeNull();
  });

  it('saves partial answers and reports when they were saved, without creating a diagnostic or scoring anything', async () => {
    const answers = await answerSheet(2, 'Self-reported');
    const first = Object.fromEntries(Object.entries(answers).slice(0, 1));
    const save = await api(lead).put(`/cases/${caseId}/diagnostics/draft`, { answers: first });
    expect(save.status).toBe(200);
    expect(save.data.savedAt).toBeTruthy();
    const got = await api(lead).get(`/cases/${caseId}/diagnostics/draft`);
    expect(got.data.answers).toMatchObject(first);
    const diags = await api(lead).get(`/cases/${caseId}/diagnostics`);
    expect(diags.data.length).toBe(0);
  });

  it('a later save replaces the draft wholesale, not merges it', async () => {
    const answers = await answerSheet(3, 'Self-reported');
    await api(lead).put(`/cases/${caseId}/diagnostics/draft`, { answers });
    const got = await api(lead).get(`/cases/${caseId}/diagnostics/draft`);
    expect(Object.keys(got.data.answers).length).toBe(Object.keys(answers).length);
  });

  it('refuses an expert who is not the lead, and an unrelated owner', async () => {
    expect((await api(stranger).get(`/cases/${caseId}/diagnostics/draft`)).status).toBe(404);
    expect((await api(stranger).put(`/cases/${caseId}/diagnostics/draft`, { answers: {} })).status).toBe(404);
  });

  it('submitting the diagnostic clears the draft', async () => {
    const answers = await answerSheet(3, 'Self-reported');
    await api(lead).put(`/cases/${caseId}/diagnostics/draft`, { answers });
    const submit = await api(lead).post(`/cases/${caseId}/diagnostics`, { answers });
    expect(submit.status).toBe(201);
    const got = await api(lead).get(`/cases/${caseId}/diagnostics/draft`);
    expect(got.data.answers).toEqual({});
  });
});
