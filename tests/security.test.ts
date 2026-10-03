import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import '@/api/routes';
import { routes } from '@/api/framework';
import { can } from '@/lib/rbac';
import { ROLES, type Role } from '@/db/schema';
import { answerSheet, api, call, drain, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

const NIL = '00000000-0000-4000-8000-000000000000';
const fill = (p: string) => p.replace(/:reference/g, 'nothing').replace(/:[a-zA-Z]+/g, NIL);
// The route allows the role, but the service narrows it further by design (documented in ARCHITECTURE.md).
const NARROWED = new Set(['POST /invoices/:id/manual-payment:OWNER', 'POST /payments/:reference/mock-complete:OWNER', 'POST /kpis/:id/readings:OWNER']);

let sessions: Record<Role, Session>;
beforeAll(async () => {
  await ensureReference();
  const admin = await makeUser('ADMIN');
  const org = await makeOrg(admin);
  sessions = { ADMIN: admin } as any;
  for (const r of ROLES.filter((x) => x !== 'ADMIN')) sessions[r] = await makeUser(r, r === 'OWNER' ? { orgId: org.id } : {});
});

describe('every endpoint enforces its permission for every role', () => {
  const guarded = routes.filter((r) => r.permission && r.auth !== 'public' && r.auth !== 'webhook');
  it('has a permission on every session route that touches business data', () => {
    const open = routes.filter((r) => !r.permission && r.auth !== 'public' && r.auth !== 'webhook').map((r) => `${r.method} ${r.path}`);
    // Open to any signed-in user by design: own profile, own optional answers and next step (/me), own notifications, search (scoped inside), job status (owner-checked), password and MFA
    for (const p of open) expect(p).toMatch(/\/auth\/|\/me\/|\/notifications|\/search|\/jobs\/:id/);
  });
  for (const r of guarded) {
    it(`${r.method} ${r.path}`, async () => {
      for (const role of ROLES) {
        const [res, act] = r.permission!;
        const resp = await call(r.method, fill(r.path), { cookie: sessions[role].cookie, body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
        const allowed = can(role, res, act);
        if (!allowed) expect(resp.status, `${role} must be denied`).toBe(403);
        else if (resp.status === 403 && !NARROWED.has(`${r.method} ${r.path}:${role}`)) throw new Error(`${role} is allowed by the matrix but got 403: ${resp.text}`);
        expect(resp.status, `${role} ${r.path} must never crash`).toBeLessThan(500);
      }
    });
  }
  it('answers 401 without a session on every session route', async () => {
    for (const r of routes.filter((x) => x.auth !== 'public' && x.auth !== 'webhook')) {
      const resp = await call(r.method, fill(r.path), { body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
      expect(resp.status, `${r.method} ${r.path}`).toBe(401);
    }
  });
});

describe('tenancy: no one reaches records outside their scope', () => {
  let A: any;
  beforeAll(async () => {
    const admin = sessions.ADMIN;
    const mk = async () => {
      const org = await makeOrg(admin);
      const owner = await makeUser('OWNER', { orgId: org.id });
      const consultant = await makeUser('EXPERT'), reviewer = await makeUser('REVIEWER'), coach = await makeUser('EXPERT');
      const c = (await api(admin).post('/cases', { orgId: org.id })).data;
      await api(admin).post(`/cases/${c.id}/assign`, { consultantId: consultant.userId, coachId: coach.userId, reviewerId: reviewer.userId });
      await api(owner).post(`/cases/${c.id}/diagnostics`, { answers: await answerSheet(2) });
      const doc = new FormData(); doc.set('file', new File(['%PDF-1.4 test'], 'a.pdf', { type: 'application/pdf' })); doc.set('caseId', c.id);
      const up = await call('POST', '/documents', { cookie: owner.cookie, form: doc });
      return { org, owner, consultant, reviewer, coach, case: c, docId: up.data.id as string };
    };
    A = { one: await mk(), two: await mk() };
  });
  it('a consultant, coach, reviewer and owner each see only their own case', async () => {
    for (const [mine, theirs] of [[A.one, A.two], [A.two, A.one]]) {
      for (const who of ['consultant', 'coach', 'reviewer', 'owner'] as const) {
        const s = mine[who] as Session;
        expect((await api(s).get(`/cases/${mine.case.id}`)).status, `${who} own`).toBe(200);
        const list = (await api(s).get('/cases?pageSize=100')).data;
        expect(list.items.map((c: any) => c.id)).toEqual([mine.case.id]);
        for (const path of [`/cases/${theirs.case.id}`, `/cases/${theirs.case.id}/scores`, `/cases/${theirs.case.id}/evidence`, `/cases/${theirs.case.id}/kpis`, `/cases/${theirs.case.id}/activity`, `/organisations/${theirs.org.id}`, `/documents/${theirs.docId}/download`, `/documents?caseId=${theirs.case.id}`])
          expect([403, 404], `${who} ${path}`).toContain((await api(s).get(path)).status);
      }
    }
  });
  it('cannot write into another case either', async () => {
    const t = A.two.case.id;
    expect((await api(A.one.owner).post(`/cases/${t}/diagnostics`, { answers: await answerSheet(2) })).status).toBe(404);
    expect((await api(A.one.consultant).post(`/cases/${t}/diagnoses/generate`)).status).toBe(404);
    expect((await api(A.one.owner).post(`/cases/${t}/evidence`, { description: 'sneaky evidence' })).status).toBe(404);
    expect((await api(A.one.coach).post(`/cases/${t}/sessions`, { scheduledAt: new Date(Date.now() + 1e8).toISOString() })).status).toBe(404);
    expect((await api(A.one.owner).post(`/cases/${t}/kpis`, { name: 'Nope' })).status).toBe(404);
    expect((await api(A.one.owner).post(`/cases/${A.one.case.id}/kpis`, { name: 'Nope' })).status).toBe(403); // advisers set indicators
  });
  it('uploads bind to the caller’s organisation', async () => {
    const f = new FormData(); f.set('file', new File(['%PDF-1.4 x'], 'b.pdf')); f.set('orgId', A.two.org.id);
    expect((await call('POST', '/documents', { cookie: A.one.owner.cookie, form: f })).status).toBe(404);
  });
  it('an owner can never see another organisation’s invoices, users or audit trail', async () => {
    expect((await api(A.one.owner).get('/invoices')).data.items).toEqual([]);
    expect((await api(A.one.owner).get('/users')).status).toBe(403);
    expect((await api(A.one.owner).get('/audit')).status).toBe(403);
    expect((await api(A.one.owner).get('/organisations')).data.items.map((o: any) => o.id)).toEqual([A.one.org.id]);
  });
  it('search returns only what the caller may see', async () => {
    const r = (await api(A.one.consultant).get(`/search?q=${encodeURIComponent(A.two.org.code)}`)).data;
    expect(r.filter((x: any) => x.type !== 'Programme')).toEqual([]);
    expect((await api(A.one.owner).get('/search?q=a')).status).toBe(400);
    const mine = (await api(A.one.owner).get(`/search?q=${encodeURIComponent(A.one.org.code)}`)).data;
    expect(mine.some((x: any) => x.type === 'Organisation')).toBe(true);
  });
  it('a programme manager sees only their programmes', async () => {
    const admin = sessions.ADMIN;
    const p1 = (await api(admin).post('/programmes', { name: `P1 ${uniq()}` })).data, p2 = (await api(admin).post('/programmes', { name: `P2 ${uniq()}` })).data;
    const pm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [p1.id] });
    const list = (await api(pm).get('/programmes?pageSize=100')).data.items.map((p: any) => p.id);
    expect(list).toContain(p1.id); expect(list).not.toContain(p2.id);
    expect((await api(pm).get(`/programmes/${p2.id}`)).status).toBe(404);
    expect((await api(pm).get(`/programmes/${p2.id}/dashboard`)).status).toBe(404);
    const org = await makeOrg(admin);
    expect((await api(pm).post('/cases', { orgId: org.id, programmeId: p2.id })).status).toBe(403);
    expect((await api(pm).post('/cases', { orgId: org.id })).status).toBe(400);
    expect((await api(pm).post('/cases', { orgId: org.id, programmeId: p1.id })).status).toBe(201);
  });
});

describe('injection and abuse resistance', () => {
  it('treats search text as data', async () => {
    const admin = sessions.ADMIN;
    for (const q of ["'; drop table users; --", '%', '_', '\\', '" OR 1=1 --']) {
      expect((await api(admin).get(`/cases?q=${encodeURIComponent(q)}`)).status).toBe(200);
      expect((await api(admin).get(`/organisations?q=${encodeURIComponent(q)}`)).status).toBe(200);
      expect((await api(admin).get(`/search?q=${encodeURIComponent(q + 'xx')}`)).status).toBe(200);
    }
    expect((await api(admin).get('/organisations?q=%25')).data.total).toBe(0); // % is literal, not a wildcard
    expect(Number((await db().select().from(schema.users).limit(1)).length)).toBe(1);
  });
  it('stores markup as text and never as anything the API interprets', async () => {
    const admin = sessions.ADMIN;
    const r = await api(admin).post('/organisations', { name: '<script>alert(1)</script> Traders', consent: true, consentBy: 'Test Person', region: uniq() });
    expect(r.status).toBe(201);
    const got = (await api(admin).get(`/organisations/${r.data.id}`)).data;
    expect(got.name).toBe('<script>alert(1)</script> Traders');
  });
  it('rate limits sign-in from one address', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200)}`;
    let last = 0;
    for (let i = 0; i < 35; i++) last = (await call('POST', '/auth/login', { headers: { 'x-forwarded-for': ip }, body: { email: `x${i}@x.test`, password: 'Some-Password-123' } })).status;
    expect(last).toBe(429);
  });
  it('unknown routes and methods are clean errors', async () => {
    expect((await call('GET', '/nope')).status).toBe(404);
    const r = await call('DELETE', '/cases', { cookie: sessions.ADMIN.cookie }); expect(r.status).toBe(405);
  });
  it('sends the error envelope with a request id and no stack traces', async () => {
    const r = await api(sessions.ADMIN).get('/cases/not-uuid');
    expect(r.error.requestId).toBeTruthy(); expect(r.text).not.toMatch(/at .*\.ts|node_modules/);
    expect(r.headers.get('x-request-id')).toBeTruthy();
  });
});
export { drain, eq };
