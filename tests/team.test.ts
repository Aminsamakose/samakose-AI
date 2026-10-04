import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, ensureReference, makeUser, makeOrg, api, login, lastEmailTo, tokenFrom, PASSWORD, uniq } from './helpers';
import { pool } from '@/db/client';

const q = (sql: string, p: unknown[] = []) => pool().query(sql, p);
async function open() {
  for (const p of ['team_invites', 'account']) {
    await q(`update consent_notices set status='Retired' where purpose=$1 and country_code='GH' and status='Published' and version<>961`, [p]);
    await q(`insert into consent_notices (purpose,country_code,version,text,status) values ($1,'GH',961,$2,'Published') on conflict (purpose,country_code,version) do update set status='Published'`, [p, `${p} wording. Body.`]);
  }
}
let admin: any;
const owner = async () => { const org = await makeOrg(admin); const o = await makeUser('OWNER', { orgId: org.id }); return { o, orgId: org.id }; };
const invite = (o: any, over: Record<string, unknown> = {}) => api(o).post('/team/members', { name: 'Kofi Boateng', email: `kofi.${uniq()}@example.org`, jobRole: 'FINANCE', agree: true, ...over });
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); });
afterAll(async () => { await q(`update consent_notices set status='Retired' where version=961`); });

describe('team invitations', () => {
  it('refuses to invite without a Published notice, and without the owner confirming', async () => {
    await q(`update consent_notices set status='Retired' where purpose='team_invites' and country_code='GH' and status='Published'`);
    const { o } = await owner();
    expect((await invite(o)).status).toBe(422);
    await open();
    const r = await invite(o, { agree: false }); expect(r.status).toBe(400); expect(JSON.stringify(r.error)).toMatch(/told them/);
  });
  it('invites a colleague: account, membership, owner consent on record, email sent', async () => {
    await open(); const { o, orgId } = await owner(); const email = `kofi.${uniq()}@example.org`;
    const r = await invite(o, { email }); expect(r.status, JSON.stringify(r.error)).toBe(201);
    const u = (await q(`select id, role, org_id, active from users where email=$1`, [email])).rows[0];
    expect(u.role).toBe('RESPONDENT'); expect(u.org_id).toBe(orgId);
    expect((await q(`select status, job_role from org_members where user_id=$1`, [u.id])).rows[0]).toEqual({ status: 'invited', job_role: 'FINANCE' });
    expect((await q(`select n.purpose, c.action, c.source from consents c join consent_notices n on n.id=c.notice_id where c.user_id=$1`, [o.userId])).rows).toContainEqual({ purpose: 'team_invites', action: 'granted', source: 'invitation' });
    expect((await lastEmailTo(email)).subject).toMatch(/invited you/);
  });
  it('rejects a duplicate email and an unknown role', async () => {
    await open(); const { o } = await owner(); const email = `d.${uniq()}@example.org`;
    expect((await invite(o, { email })).status).toBe(201);
    expect((await invite(o, { email })).status).toBe(400);
    expect((await invite(o, { jobRole: 'NOPE' })).status).toBe(400);
  });
  it('the colleague agrees to the account wording themselves, becomes Active, and sees only their areas', async () => {
    await open(); const { o } = await owner(); const email = `k.${uniq()}@example.org`;
    await invite(o, { email });
    const token = tokenFrom((await lastEmailTo(email)).body);
    const info = await call('GET', `/auth/invite-info?token=${token}`); expect(info.data.respondent).toBe(true); expect(info.data.notice.text).toMatch(/account wording/);
    expect((await call('POST', '/auth/accept-invite', { body: { token, password: PASSWORD } })).status).toBe(400); // no consent
    expect((await call('POST', '/auth/accept-invite', { body: { token, password: PASSWORD, consent: true } })).status).toBe(200);
    const u = (await q(`select id from users where email=$1`, [email])).rows[0];
    expect((await q(`select status from org_members where user_id=$1`, [u.id])).rows[0].status).toBe('active');
    expect((await q(`select n.purpose, c.source from consents c join consent_notices n on n.id=c.notice_id where c.user_id=$1`, [u.id])).rows).toEqual([{ purpose: 'account', source: 'invitation' }]);
    const s = await login(email);
    const a = await api(s).get('/me/areas'); expect(a.status).toBe(200); expect(a.data.areas).toEqual([]);
    // No access to anything else.
    for (const p of ['/cases', '/organisations', '/team', '/admin/demographics', '/users']) expect((await api(s).get(p)).status, p).toBe(403);
  });
  it('suggests areas by role, only assigns once confirmed, and the colleague then sees exactly those', async () => {
    await open(); const { o } = await owner(); const email = `f.${uniq()}@example.org`;
    const { data } = await invite(o, { email }); const memberId = data.id;
    const token = tokenFrom((await lastEmailTo(email)).body); await call('POST', '/auth/accept-invite', { body: { token, password: PASSWORD, consent: true } });
    const list = (await api(o).get('/team/assignments')).data;
    expect(list.areas.length).toBeGreaterThan(10);
    const finance = list.areas.find((x: any) => x.suggested.kind === 'member'); expect(finance, 'a finance area is suggested to the colleague').toBeTruthy();
    expect(finance.confirmed).toBeNull();
    const s = await login(email); expect((await api(s).get('/me/areas')).data.areas).toEqual([]); // suggestion alone gives nothing
    expect((await api(o).put(`/team/assignments/${finance.code}`, { memberId })).status).toBe(200);
    const mine = (await api(s).get('/me/areas')).data; expect(mine.areas.map((x: any) => x.code)).toEqual([finance.code]); expect(mine.business).toBeTruthy();
    expect((await api(o).put('/team/assignments/9.9', { memberId })).status).toBe(400);
  });
  it('owners cannot touch another business\'s team', async () => {
    await open(); const a = await owner(); const b = await owner();
    const email = `x.${uniq()}@example.org`; const { data } = await invite(a.o, { email });
    expect((await api(b.o).del(`/team/members/${data.id}`)).status).toBe(404);
    expect((await api(b.o).put('/team/assignments/1.1', { memberId: data.id })).status).toBe(404);
    expect((await api(b.o).get('/team')).data.members).toEqual([]);
  });
  it('removing a colleague closes the account, frees their areas and ends their session', async () => {
    await open(); const { o } = await owner(); const email = `r.${uniq()}@example.org`;
    const { data } = await invite(o, { email }); const token = tokenFrom((await lastEmailTo(email)).body);
    await call('POST', '/auth/accept-invite', { body: { token, password: PASSWORD, consent: true } });
    const s = await login(email); await api(o).put('/team/assignments/1.1', { memberId: data.id });
    expect((await api(o).del(`/team/members/${data.id}`)).status).toBe(200);
    expect((await api(s).get('/me/areas')).status).toBe(401);
    expect((await q(`select count(*)::int n from area_assignments where member_id=$1`, [data.id])).rows[0].n).toBe(0);
    expect((await api(o).get('/team')).data.members).toEqual([]);
  });
  it('an owner can unsend a colleague invitation: the link says withdrawn, the seat is freed, and the same person can be invited again', async () => {
    await open(); const { o, orgId } = await owner(); const email = `u.${uniq()}@example.org`;
    const { data } = await invite(o, { email }); const link1 = tokenFrom((await lastEmailTo(email)).body);
    expect((await api(o).get('/team')).data.members).toHaveLength(1);
    expect((await api(o).post(`/team/members/${data.id}/cancel`, {})).status).toBe(200);
    expect((await api(o).get('/team')).data.members).toEqual([]);
    const info = await call('GET', `/auth/invite-info?token=${encodeURIComponent(link1)}`); expect(info.status).toBe(400); expect(info.error.code).toBe('invite_withdrawn');
    const acc = await call('POST', '/auth/accept-invite', { body: { token: link1, password: PASSWORD, consent: true } }); expect(acc.status).toBe(400); expect(acc.error.code).toBe('invite_withdrawn');
    expect((await api(o).post(`/team/members/${data.id}/cancel`, {})).status).toBe(404); // already gone
    expect((await api(o).post(`/team/members/${data.id}/resend`, {})).status).toBe(404);
    // invite the same person again: same record, new working link, old link still dead
    const again = await invite(o, { email, name: 'Kofi Again', jobRole: 'FINANCE' }); expect(again.status, JSON.stringify(again.error)).toBe(201);
    expect((await q(`select count(*)::int n from users where lower(email)=$1`, [email])).rows[0].n).toBe(1);
    const link2 = tokenFrom((await lastEmailTo(email)).body); expect(link2).not.toBe(link1);
    expect((await call('POST', '/auth/accept-invite', { body: { token: link1, password: PASSWORD, consent: true } })).status).toBe(400);
    expect((await call('POST', '/auth/accept-invite', { body: { token: link2, password: PASSWORD, consent: true } })).status).toBe(200);
    expect((await q(`select status from org_members where org_id=$1 and user_id=(select id from users where lower(email)=$2)`, [orgId, email])).rows[0].status).toBe('active');
    const log = (await q(`select action from audit_log where entity_id=(select id::text from users where lower(email)=$1)`, [email])).rows.map((r: any) => r.action);
    expect(log).toContain('team.invite_cancelled');
  });
  it('cannot unsend an invitation that was already accepted, and another business cannot', async () => {
    await open(); const a = await owner(); const b = await owner(); const email = `v.${uniq()}@example.org`;
    const { data } = await invite(a.o, { email }); const token = tokenFrom((await lastEmailTo(email)).body);
    expect((await api(b.o).post(`/team/members/${data.id}/cancel`, {})).status).toBe(404);
    await call('POST', '/auth/accept-invite', { body: { token, password: PASSWORD, consent: true } });
    expect((await api(a.o).post(`/team/members/${data.id}/cancel`, {})).status).toBe(422);
    const s = await makeUser('FINANCE'); expect((await api(s).post(`/team/members/${data.id}/cancel`, {})).status).toBe(403);
  });
  it('only a business owner can invite', async () => {
    await open();
    for (const r of ['EXPERT', 'FINANCE', 'FUNDER'] as const) { const s = await makeUser(r); expect((await api(s).post('/team/members', { name: 'A B', email: `z.${uniq()}@example.org`, jobRole: 'FINANCE', agree: true })).status, r).toBe(403); }
  });
});
