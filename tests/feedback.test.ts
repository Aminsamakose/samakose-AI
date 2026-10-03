import { beforeAll, describe, expect, it } from 'vitest';
import { answerSheet, api, auditActions, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { pool } from '@/db/client';

const q = (sql: string, p: unknown[] = []) => pool().query(sql, p);
let admin: Session; let pm: Session; let prog: any;
beforeAll(async () => {
  await ensureReference(); admin = await makeUser('ADMIN');
  prog = (await api(admin).post('/programmes', { name: `Programme ${uniq()}`, funder: 'Test Funder', startDate: '2026-01-01', endDate: '2027-01-01', budgetGhs: 100000 })).data;
  await api(admin).patch(`/programmes/${prog.id}`, { status: 'Active' });
  pm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [prog.id] });
});
const anOwner = async () => makeUser('OWNER', { orgId: (await makeOrg(admin)).id });
const scoredBusiness = async () => {
  const org = await makeOrg(admin); const owner = await makeUser('OWNER', { orgId: org.id });
  const c = await api(pm).post('/cases', { orgId: org.id, programmeId: prog.id }); expect(c.status).toBe(201);
  const d = await api(owner).post(`/cases/${c.data.id}/diagnostics`, { answers: await answerSheet(3) }); expect(d.status, JSON.stringify(d.error)).toBe(201);
  return { org, owner, caseId: c.data.id as string };
};

describe('feedback about a screen', () => {
  it('any signed-in person can send it; the page and the sender are recorded', async () => {
    for (const r of ['OWNER', 'EXPERT', 'FINANCE', 'FUNDER'] as const) {
      const s = r === 'OWNER' ? await anOwner() : await makeUser(r);
      const x = await api(s).post('/me/feedback', { page: '/team?x=1', rating: 4, message: `The ${r} screen was clear but slow to load` }); expect(x.status, r + JSON.stringify(x.error)).toBe(201);
      const row = (await q(`select role, page, rating, kind, status from feedback where id=$1`, [x.data.id])).rows[0];
      expect(row).toEqual({ role: r, page: '/team', rating: 4, kind: 'app', status: 'New' }); // the query string is dropped
    }
    expect((await api(null).post('/me/feedback', { message: 'Hello there, signed out' })).status).toBe(401);
  });
  it('needs a real message, a rating from 1 to 5, and ignores a page that is not on this site', async () => {
    const s = await anOwner();
    expect((await api(s).post('/me/feedback', { message: 'no' })).status).toBe(400);
    expect((await api(s).post('/me/feedback', { message: 'A proper message here', rating: 9 })).status).toBe(400);
    const x = await api(s).post('/me/feedback', { message: 'A proper message here', page: 'https://evil.example/phish' });
    expect((await q(`select page from feedback where id=$1`, [x.data.id])).rows[0].page).toBeNull();
  });
  it('limits how much one person can send in a day', async () => {
    const s = await anOwner(); let last = 201;
    for (let i = 0; i < 22 && last === 201; i++) last = (await api(s).post('/me/feedback', { message: `Note number ${i} about the page` })).status;
    expect(last).toBe(429);
  });
});

describe('who can read and triage it', () => {
  it('lets the administrator read and triage; executives only read; nobody else sees it', async () => {
    const s = await anOwner(); const sent = await api(s).post('/me/feedback', { message: 'The invite email never arrived for my finance lead', page: '/team' });
    const list = await api(admin).get('/feedback?pageSize=50&sort=createdAt&dir=desc'); expect(list.status).toBe(200);
    const mine = list.data.items.find((x: any) => x.id === sent.data.id); expect(mine).toMatchObject({ kind: 'app', role: 'OWNER', page: '/team', status: 'New', name: s.name ?? expect.anything() });
    const exec = await makeUser('EXECUTIVE');
    expect((await api(exec).get('/feedback')).status).toBe(200);
    expect((await api(exec).patch(`/feedback/${sent.data.id}`, { status: 'Triaged' })).status).toBe(403);
    for (const r of ['OWNER', 'EXPERT', 'FINANCE', 'FUNDER', 'PROGRAMME_MANAGER'] as const) { const u = r === 'OWNER' ? await anOwner() : await makeUser(r); expect((await api(u).get('/feedback')).status, r).toBe(403); expect((await api(u).get('/feedback/summary')).status, r).toBe(403); }
    const t = await api(admin).patch(`/feedback/${sent.data.id}`, { status: 'Triaged', note: 'Checked the mail log' }); expect(t.status, JSON.stringify(t.error)).toBe(200);
    expect(await auditActions(sent.data.id)).toContain('feedback.status');
    expect((await q(`select status, admin_note, handled_by from feedback where id=$1`, [sent.data.id])).rows[0]).toMatchObject({ status: 'Triaged', admin_note: 'Checked the mail log', handled_by: admin.userId });
    expect((await api(admin).patch(`/feedback/${sent.data.id}`, { status: 'Done' })).status).toBe(400);
    expect((await api(admin).patch(`/feedback/${'00000000-0000-4000-8000-000000000000'}`, { status: 'Resolved' })).status).toBe(404);
    const csv = await api(admin).get('/feedback?format=csv'); expect(csv.status).toBe(200);
  });
});

describe('feedback on a score', () => {
  it('needs a score, belongs to the owner of that business, and a second answer updates the first', async () => {
    const { owner, caseId } = await scoredBusiness();
    expect((await api(owner).get(`/me/feedback/result/${caseId}`)).data).toMatchObject({ scored: true, given: null });
    const a = await api(owner).post('/me/feedback/result', { caseId, accuracy: 'partly', rating: 3, message: 'Finance score felt too low' }); expect(a.status, JSON.stringify(a.error)).toBe(201);
    const b = await api(owner).post('/me/feedback/result', { caseId, accuracy: 'accurate', rating: 5 }); expect(b.status).toBe(201);
    expect((await q(`select count(*)::int n from feedback where case_id=$1 and kind='result'`, [caseId])).rows[0].n).toBe(1);
    expect((await api(owner).get(`/me/feedback/result/${caseId}`)).data.given).toMatchObject({ accuracy: 'accurate', rating: 5 });
    expect((await api(owner).post('/me/feedback/result', { caseId, accuracy: 'maybe' })).status).toBe(400);
    const other = await scoredBusiness();
    expect((await api(other.owner).post('/me/feedback/result', { caseId, accuracy: 'accurate' })).status).toBe(404);
    expect((await api(other.owner).get(`/me/feedback/result/${caseId}`)).status).toBe(404);
    expect((await api(await makeUser('EXPERT')).post('/me/feedback/result', { caseId, accuracy: 'accurate' })).status).toBe(403);
    const sum = (await api(admin).get('/feedback/summary')).data; expect(sum.scoreMatched.accurate).toBeGreaterThanOrEqual(1); expect(Object.keys(sum.byStatus)).toEqual(['New', 'Triaged', 'Resolved', 'Not an issue']);
  });
  it('refuses when the business has no score yet', async () => {
    const org = await makeOrg(admin); const owner = await makeUser('OWNER', { orgId: org.id });
    const c = await api(pm).post('/cases', { orgId: org.id, programmeId: prog.id });
    expect((await api(owner).get(`/me/feedback/result/${c.data.id}`)).data).toMatchObject({ scored: false });
    expect((await api(owner).post('/me/feedback/result', { caseId: c.data.id, accuracy: 'accurate' })).status).toBe(422);
  });
  it('never touches a score: feedback rows hold no score values and the score count is unchanged', async () => {
    const { owner, caseId } = await scoredBusiness();
    const before = (await q(`select count(*)::int n, max(overall) o from health_scores where case_id=$1`, [caseId])).rows[0];
    await api(owner).post('/me/feedback/result', { caseId, accuracy: 'not_accurate', message: 'Does not match' });
    expect((await q(`select count(*)::int n, max(overall) o from health_scores where case_id=$1`, [caseId])).rows[0]).toEqual(before);
  });
});
