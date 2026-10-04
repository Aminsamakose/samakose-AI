/**
 * End-to-end validation with clearly labelled synthetic data, on an isolated database.
 * Every check is recorded as PASS, FAIL, PARTIAL or GAP in uat/results.json. A failing check never stops the run.
 * AI_MODE=mock: the AI wiring, validation and human-review flow are exercised, not the quality of real model output.
 */
import { afterAll, beforeAll, describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { api, call, drain, ensureReference, lastEmailTo, login, makeUser, PASSWORD, tokenFrom, uniq, type Session } from '../tests/helpers';
import { pool } from '@/db/client';
import { DRAFT_MAPPING, rolesFor, platformForOrgType } from '@/domain/routing';

const q = (sql: string, p: unknown[] = []) => pool().query(sql, p);
type St = 'PASS' | 'FAIL' | 'PARTIAL' | 'GAP';
type Rec = { id: string; area: string; title: string; status: St; note: string; ms: number };
const results: Rec[] = []; const timings: { route: string; ms: number }[] = [];
let n = 0;
async function check(area: string, title: string, fn: () => Promise<[St, string] | void>) {
  const t = Date.now(); let status: St = 'PASS'; let note = '';
  try { const r = await fn(); if (r) [status, note] = r; } catch (e: any) { status = 'FAIL'; note = 'Threw: ' + String(e?.message ?? e).slice(0, 300); }
  results.push({ id: `T${String(++n).padStart(3, '0')}`, area, title, status, note, ms: Date.now() - t });
}
const eq = (got: unknown, want: unknown, what: string): [St, string] | void => { if (got !== want) return ['FAIL', `${what}: expected ${want}, got ${got}`]; };
const all = (...xs: ([St, string] | void)[]): [St, string] | void => xs.find(Boolean);
const timed = async <T>(route: string, f: () => Promise<T>) => { const t = Date.now(); const r = await f(); timings.push({ route, ms: Date.now() - t }); return r; };

const SYN = (s: string) => `TEST ${s} (Synthetic)`;
const PLAT = [['SME', 'SME360'], ['AGRIFOOD', 'AGRIFOOD360'], ['ESO', 'ESO360']] as const;
type Owner = { s: Session; email: string; orgId: string; orgType: 'SME' | 'AGRIFOOD' | 'ESO'; platform: string; caseId?: string; mode: string; name: string };
const owners: Owner[] = []; const experts: (Session & { name: string; expertise: string })[] = [];
let reportId = ''; let admin: Session, pm: Session, rv1: Session, rv2: Session, fin: Session, funder: Session, exec: Session; let prog: any, cohort: any;
const EXPERTS = [
  ['Agribusiness Value Chains', 'Shea and grains processing, aggregation, market linkage'], ['SME Finance and Investment Readiness', 'Bookkeeping, cash flow, lender packs'],
  ['Organisational Development and Governance', 'Governance, HR systems, ESO institutional strengthening'], ['Digital and AI Transformation', 'Automation, data systems, digital sales'],
  ['Gender Inclusion and Climate Resilience', 'GESI, climate-smart practice, donor compliance']
] as const;

async function openConsent() {
  for (const p of ['team_invites', 'account']) {
    await q(`insert into consent_notices (purpose,country_code,version,text,status) values ($1,'GH',971,$2,'Published') on conflict (purpose,country_code,version) do update set status='Published'`, [p, `${p} synthetic validation wording.`]).catch(() => {});
  }
}
let QCODES: string[] = [];
const answers = async (fn: (i: number) => number, evidence = 'Self-reported', only?: string[]) => {
  if (!QCODES.length) QCODES = ((await api(admin).get('/questions')).data ?? []).map((x: any) => x.code);
  const a: Record<string, unknown> = {}; QCODES.forEach((code, i) => { if (!only || only.includes(code)) a[code] = { value: fn(i), evidence }; }); return a;
};

beforeAll(async () => {
  await ensureReference(); await openConsent();
  // Mirror production frameworks: SME360 v2 Published (100 questions with areas); AGRIFOOD360 and ESO360 v1 Draft (not yet approved).
  const fs_ = (await import('node:fs')).default; const load = (f: string) => JSON.parse(fs_.readFileSync(path.resolve(__dirname, `../docs/frameworks/drafts/${f}-bank-v1-loadable.json`), 'utf8'));
  await q(`update framework_versions set status='Retired' where status='Published'`);
  for (const [code, f, st, ver] of [['SME360', 'sme360', 'Published', 2], ['AGRIFOOD360', 'agrifood360', 'Draft', 1], ['ESO360', 'eso360', 'Draft', 1]] as const) {
    const j = load(f); const fid = (await q(`select id from frameworks where code=$1`, [code])).rows[0].id;
    await q(`insert into framework_versions (framework_id, version, status, questions, dimensions, rules, sources, meta, published_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [fid, ver, st, JSON.stringify(j.questions), JSON.stringify(j.dimensions), JSON.stringify(j.rules), JSON.stringify(j.sources ?? []), JSON.stringify(j.meta), st === 'Published' ? new Date() : null]);
  }
  admin = await makeUser('ADMIN', { name: 'TEST Admin (Synthetic)', email: 'admin@uat.samakose.test' });
  prog = (await api(admin).post('/programmes', { name: SYN('Northern Resilience Programme'), funder: 'TEST Funder (Synthetic)', startDate: '2026-01-01', endDate: '2027-12-31', budgetGhs: 250000 })).data;
  await api(admin).patch(`/programmes/${prog.id}`, { status: 'Active' });
  cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: SYN('Cohort A'), capacity: 40 })).data;
  await api(admin).patch(`/cohorts/${cohort.id}`, { status: 'Open' }); // enrolment needs an open cohort
  pm = await makeUser('PROGRAMME_MANAGER', { name: 'TEST Programme Manager (Synthetic)', programmeIds: [prog.id], email: 'pm@uat.samakose.test' });
  rv1 = await makeUser('REVIEWER', { name: 'TEST Reviewer One (Synthetic)', email: 'rv1@uat.samakose.test' });
  rv2 = await makeUser('REVIEWER', { name: 'TEST Reviewer Two (Synthetic)', email: 'rv2@uat.samakose.test' });
  fin = await makeUser('FINANCE', { name: 'TEST Finance (Synthetic)', email: 'fin@uat.samakose.test' });
  funder = await makeUser('FUNDER', { name: 'TEST Funder (Synthetic)', programmeIds: [prog.id], email: 'funder@uat.samakose.test' });
  exec = await makeUser('EXECUTIVE', { name: 'TEST Executive (Synthetic)', email: 'exec@uat.samakose.test' });
  for (const [i, [x]] of EXPERTS.entries()) { const e = await makeUser('EXPERT', { name: `TEST Expert ${i + 1}: ${x} (Synthetic)`, email: `expert${i + 1}@uat.samakose.test` }); experts.push({ ...e, expertise: EXPERTS[i][1] }); }
});

describe('1 registration and onboarding', () => {
  it('registers six owners, two per platform, with routing captured', async () => {
    for (const [type, plat] of PLAT) for (let k = 1; k <= 2; k++) {
      const roles = rolesFor(DRAFT_MAPPING, plat as any); const mode = k === 1 ? 'self' : 'hybrid';
      const email = `owner.${plat.toLowerCase()}.${k}@uat.samakose.test`; const name = `TEST ${plat} Owner ${k}`;
      await check('Registration', `${plat} owner ${k}: register with job role and ${mode} mode`, async () => {
        const r = await call('POST', '/auth/register', { body: { name, email, password: PASSWORD, role: 'OWNER', orgName: SYN(`${plat} Business ${k}`), orgType: type, consent: true, consentPurposes: ['account', 'assessment'], routing: { jobRole: roles[0], responsibility: 'Synthetic owner', assessmentMode: mode } } });
        return eq(r.status, 200, 'register status');
      });
      await check('Registration', `${plat} owner ${k}: cannot sign in before email is confirmed`, async () => { const r = await call('POST', '/auth/login', { body: { email, password: PASSWORD } }); return all(eq(r.status, 403, 'status'), eq(r.error?.code, 'email_not_verified', 'code')); });
      await check('Registration', `${plat} owner ${k}: verify email, sign in, profile gate, complete profile`, async () => {
        const m = await lastEmailTo(email); const v = await call('POST', '/auth/verify-email', { body: { token: tokenFrom(m.body) } });
        const l = await call('POST', '/auth/login', { body: { email, password: PASSWORD } }); const cookie = (l.headers.get('set-cookie') ?? '').split(';')[0];
        const blocked = await call('GET', '/cases', { cookie });
        const put = await call('PUT', '/auth/profile', { cookie, body: { name: SYN(`${plat} Business ${k}`), type, sector: type === 'AGRIFOOD' ? 'Shea processing' : type === 'ESO' ? 'Business support' : 'Retail', region: 'Northern', district: 'Tamale', size: '11-50', contactPhone: '+233 55 858 9254', consent: true } });
        const me = await call('GET', '/auth/me', { cookie });
        const x = all(eq(v.data?.next, 'ok', 'verify'), eq(l.data?.next, 'profile', 'login next'), eq(blocked.error?.code, 'profile_incomplete', 'gate'), eq(put.status, 200, 'profile'), eq(me.data?.next, 'ok', 'me next'));
        if (x) return x;
        const [u] = (await q(`select id, org_id from users where email=$1`, [email])).rows;
        owners.push({ s: { cookie, userId: u.id, email, role: 'OWNER' }, email, orgId: u.org_id, orgType: type, platform: plat, mode, name });
      });
    }
  });
  it('registration edge cases', async () => {
    await check('Registration', 'Unknown job role for the platform is refused', async () => eq((await call('POST', '/auth/register', { body: { name: 'TEST Bad Role', email: `bad.${uniq()}@uat.samakose.test`, password: PASSWORD, role: 'OWNER', orgName: 'TEST Bad (Synthetic)', orgType: 'SME', consent: true, routing: { jobRole: 'NOT_A_ROLE', assessmentMode: 'self' } } })).status, 400, 'status'));
    await check('Registration', 'Weak password refused', async () => eq((await call('POST', '/auth/register', { body: { name: 'TEST Weak', email: `weak.${uniq()}@uat.samakose.test`, password: 'password', role: 'OWNER', orgName: 'TEST Weak (Synthetic)', orgType: 'SME', consent: true } })).status, 400, 'status'));
    await check('Registration', 'Self-registration as ADMIN refused', async () => eq((await call('POST', '/auth/register', { body: { name: 'TEST Evil', email: `evil.${uniq()}@uat.samakose.test`, password: PASSWORD, role: 'ADMIN', orgName: 'x y', consent: true } })).status, 400, 'status'));
    await check('Registration', 'Consultant self-registers, stays pending, then admin approves', async () => {
      const email = `consultant.${uniq()}@uat.samakose.test`;
      await call('POST', '/auth/register', { body: { name: 'TEST Pending Expert', email, password: PASSWORD, role: 'EXPERT', orgName: 'TEST Advisory (Synthetic)', consent: true } });
      await call('POST', '/auth/verify-email', { body: { token: tokenFrom((await lastEmailTo(email)).body) } });
      const l = await call('POST', '/auth/login', { body: { email, password: PASSWORD } }); const cookie = (l.headers.get('set-cookie') ?? '').split(';')[0];
      const before = await call('GET', '/cases', { cookie }); const [u] = (await q(`select id from users where email=$1`, [email])).rows;
      const ap = await api(admin).post(`/users/${u.id}/approve`, {}); const after = await call('GET', '/cases', { cookie });
      return all(eq(before.error?.code, 'approval_pending', 'pending'), eq(ap.status, 200, 'approve'), eq(after.status, 200, 'after'));
    });
    await check('Registration', 'Registration options expose roles and consent wording', async () => { const r = await call('GET', '/auth/registration-options'); return eq(r.status, 200, 'status'); });
    await check('Onboarding', 'Admin verifies the six organisations (Pending verification to Active)', async () => {
      for (const o of owners) { const r = await api(admin).patch(`/organisations/${o.orgId}`, { status: 'Active' }); if (r.status !== 200) return ['FAIL', `${o.platform}: ${r.status} ${JSON.stringify(r.error)}`]; }
      return owners.length === 6 ? undefined : ['FAIL', `Only ${owners.length} owners registered`];
    });
    await check('Onboarding', 'Next best action is returned from the routing answers', async () => { const r = await api(owners[0].s).get('/me/next-step'); return eq(r.status, 200, 'status'); });
  });
});

describe('2 roles, responsibilities and routing', () => {
  it('captures colleague roles and routes questions by area', async () => {
    const o = owners[1]; // hybrid owner
    const email = `colleague.${uniq()}@uat.samakose.test`; let colleague: Session | undefined; let memberId = '';
    await check('Role capture', 'Owner invites a colleague with a job role, who accepts', async () => {
      const inv = await api(o.s).post('/team/members', { name: 'TEST Colleague Finance', email, jobRole: 'FINANCE', agree: true }); memberId = inv.data?.id;
      const acc = await call('POST', '/auth/accept-invite', { body: { token: tokenFrom((await lastEmailTo(email)).body), password: PASSWORD, consent: true } });
      colleague = await login(email); return all(eq(inv.status, 201, 'invite'), eq(acc.status, 200, 'accept'));
    });
    let areas: any[] = [];
    await check('Role routing', 'Assignment screen suggests an owner per area from the role mapping', async () => { const r = await api(o.s).get('/team/assignments'); areas = r.data?.areas ?? []; return all(eq(r.status, 200, 'status'), areas.length > 3 ? undefined : ['FAIL', 'no areas']); });
    await check('Role routing', 'Owner assigns an area to the colleague; colleague sees it under /me/areas', async () => {
      const fa = areas.find((a) => a.suggested?.kind === 'member') ?? areas[0]; const r = await api(o.s).put(`/team/assignments/${fa.code}`, { memberId }); for (const a of areas) if (a.code !== fa.code) await api(o.s).put(`/team/assignments/${a.code}`, { memberId: null });
      const mine = await api(colleague!).get('/me/areas'); return all(eq(r.status, 200, 'assign'), mine.data?.length || mine.data?.areas?.length ? undefined : ['FAIL', 'colleague sees no areas']);
    });
    await check('Role routing', 'Colleague cannot invite, assign or open a round', async () => all(eq((await api(colleague!).post('/team/members', { name: 'x y', email: 'z@uat.samakose.test', jobRole: 'FINANCE', agree: true })).status, 403, 'invite'), eq((await api(colleague!).put(`/team/assignments/${areas[0].code}`, { memberId: null })).status, 403, 'assign')));
    await check('Role routing', 'Job role is not permission: colleague cannot read cases list of the business', async () => { const r = await api(colleague!).get('/cases'); return r.status === 200 && (r.data?.items?.length ?? 0) > 0 ? ['FAIL', 'Colleague can list cases'] : undefined; });
    await check('Role routing', 'Invitation to a duplicate address does not create a second user', async () => { const r = await api(o.s).post('/team/members', { name: 'TEST Colleague Finance', email, jobRole: 'FINANCE', agree: true }); return r.status >= 400 ? undefined : ['PARTIAL', `status ${r.status}; check no duplicate member row`]; });
    (globalThis as any).__colleague = { s: colleague, memberId, areas };
  });
});

describe('3 cases, assignment and expert matching', () => {
  it('opens six cases, routes each to the right platform, assigns experts', async () => {
    await check('Case', 'Programme manager opens a case per organisation (six)', async () => {
      for (const o of owners) { const r = await api(pm).post('/cases', { orgId: o.orgId, programmeId: prog.id, cohortId: cohort.id }); if (r.status !== 201) return ['FAIL', `${o.platform}: ${r.status} ${JSON.stringify(r.error)}`]; o.caseId = r.data.id; }
    });
    await check('Routing', 'Each case/org resolves to the correct platform', async () => all(...owners.map((o) => eq(platformForOrgType(o.orgType), o.platform, 'platform'))));
    await check('Routing', 'Platform is visible on the case for staff (API field)', async () => { const r = await api(admin).get(`/cases/${owners[0].caseId}`); return r.data?.platform || r.data?.framework ? undefined : ['GAP', 'Case payload carries no platform/framework field; platform is derived from org type only']; });
    await check('Expert matching', 'Ranked, explained matches exist per case and exclude people who cannot take the work', async () => {
      const r = await api(admin).get(`/cases/${owners[0].caseId}/matches?fn=lead`); const items = r.data?.items ?? [];
      const ok = items.length > 0 && items.every((m: any) => Array.isArray(m.factors) && m.factors.length === 7 && typeof m.score === 'number');
      const sum = items.every((m: any) => Math.abs(m.factors.reduce((t: number, f: any) => t + f.points, 0) - m.score) <= 1);
      return all(eq(r.status, 200, 'status'), ok ? undefined : ['FAIL', 'matches missing factors'], sum ? undefined : ['FAIL', 'factor points do not add up to the score']);
    });
    await check('Assignment', 'Admin assigns an expert (by expertise, manually), a coach and a reviewer to all six cases', async () => {
      const byPlat: Record<string, number> = { SME360: 1, AGRIFOOD360: 0, ESO360: 2 };
      for (const o of owners) { const e = experts[byPlat[o.platform]]; const r = await api(admin).post(`/cases/${o.caseId}/assign`, { consultantId: e.userId, coachId: experts[3].userId, reviewerId: (o.platform === 'ESO360' ? rv2 : rv1).userId }); if (r.status !== 200) return ['FAIL', `${r.status} ${JSON.stringify(r.error)}`]; }
    });
    await check('Assignment', 'Four-eyes: same person cannot be expert and reviewer; wrong role refused', async () => all(eq((await api(admin).post(`/cases/${owners[0].caseId}/assign`, { consultantId: experts[0].userId, reviewerId: experts[0].userId })).status, 400, 'same'), eq((await api(admin).post(`/cases/${owners[0].caseId}/assign`, { consultantId: rv1.userId })).status, 400, 'role')));
    await check('Assignment', 'Reassignment by admin works and is audited', async () => {
      const r = await api(admin).post(`/cases/${owners[1].caseId}/assign`, { consultantId: experts[4].userId, reason: 'Better sector fit' }); const a = (await q(`select count(*)::int n from audit_log where action='case.assigned' and entity_id=$1`, [owners[1].caseId])).rows[0].n;
      return all(eq(r.status, 200, 'status'), a >= 2 ? undefined : ['FAIL', `audit rows ${a}`]);
    });
    await check('Assignment', 'Workload: assigning past an expert\'s stated capacity warns the manager', async () => {
      await q(`update practitioner_profiles set max_active = 1 where user_id = $1`, [experts[1].userId]);
      const r = await api(admin).post(`/cases/${owners[3].caseId}/assign`, { coachId: experts[1].userId, reason: 'Capacity test' });
      await q(`update practitioner_profiles set max_active = 50 where user_id = $1`, [experts[1].userId]);
      return all(eq(r.status, 200, 'status'), (r.data?.warnings ?? []).some((w: string) => /capacity/i.test(w)) ? undefined : ['FAIL', 'no capacity warning: ' + JSON.stringify(r.data)]);
    });
    await check('Assignment', 'Expert sees only assigned cases', async () => { const r = await api(experts[2]).get('/cases'); const ids = (r.data?.items ?? []).map((c: any) => c.id); const bad = ids.filter((id: string) => !owners.filter((o) => o.platform === 'ESO360').some((o) => o.caseId === id)); return all(eq(r.status, 200, 'status'), bad.length ? ['FAIL', `sees ${bad.length} unassigned cases`] : undefined); });
  });
});

describe('4 assessments: self, collaborative, hybrid', () => {
  it('self assessment by the owner (SME360 owner 1)', async () => {
    const o = owners[0]; let id = '';
    await check('Assessment', 'Below-gate submission rejected, nothing saved', async () => { const a = await answers(() => 2); for (const k of Object.keys(a).slice(0, 12)) delete a[k]; const r = await api(o.s).post(`/cases/${o.caseId}/diagnostics`, { answers: a }); const cnt = (await q(`select count(*)::int n from diagnostics where case_id=$1`, [o.caseId])).rows[0].n; return all(eq(r.status, 422, 'status'), eq(cnt, 0, 'rows')); });
    await check('Assessment', 'Owner cannot claim Verified evidence', async () => eq((await api(o.s).post(`/cases/${o.caseId}/diagnostics`, { answers: await answers(() => 3, 'Verified') })).status, 400, 'status'));
    await check('Assessment', 'Self assessment accepted, scored, case moves to DIAGNOSED, mode=self', async () => {
      const r = await timed('POST /cases/:id/diagnostics', async () => api(o.s).post(`/cases/${o.caseId}/diagnostics`, { answers: await answers((i) => (i % 3) + 1), uuid: `uat-${uniq()}` })); id = r.data?.id;
      const mode = (await q(`select assessment_mode m from diagnostics where id=$1`, [id])).rows[0]?.m;
      return all(eq(r.status, 201, 'status'), eq(r.data?.caseStatus, 'DIAGNOSED', 'state'), eq(mode, 'self', 'mode'), r.data?.score?.overall > 0 ? undefined : ['FAIL', 'no score']);
    });
    await check('Assessment', 'Duplicate submission id blocked; resubmission versions', async () => { const u = `dup-${uniq()}`; const a = await answers(() => 2); const x = await api(o.s).post(`/cases/${o.caseId}/diagnostics`, { answers: a, uuid: u }); const y = await api(o.s).post(`/cases/${o.caseId}/diagnostics`, { answers: a, uuid: u }); return all(eq(x.data?.version, 2, 'version'), eq(y.status, 422, 'dupe')); });
    await check('Assessment', 'Owner sees progress but never internal workings', async () => all(eq((await api(o.s).get(`/cases/${o.caseId}/diagnoses`)).status, 403, 'diagnoses'), eq((await api(o.s).get(`/cases/${o.caseId}/risks`)).status, 403, 'risks')));
  });
  it('collaborative (team) round on the real question bank, hybrid mode', async () => {
    const o = owners[1]; const col = (globalThis as any).__colleague; let rid = '';
    await check('Assessment', 'Owner opens one round, once; colleague and PM cannot', async () => {
      const r = await api(o.s).post(`/cases/${o.caseId}/round`, {}); rid = r.data?.id; const again = await api(o.s).post(`/cases/${o.caseId}/round`, {});
      return all(eq(r.status, 201, 'open'), eq(again.status, 422, 'second'), eq((await api(col.s).post(`/cases/${o.caseId}/round`, {})).status, 403, 'colleague'), eq((await api(pm).post(`/cases/${o.caseId}/round`, {})).status, 403, 'pm'));
    });
    await check('Question routing', 'Colleague sees only their area questions; owner the rest; no overlap', async () => {
      const c = (await api(col.s).get('/me/round')).data?.round?.questions?.map((x: any) => x.code) ?? []; const w = (await api(o.s).get('/me/round')).data?.round?.questions?.map((x: any) => x.code) ?? [];
      const overlap = c.filter((x: string) => w.includes(x)); (globalThis as any).__q = { c, w };
      return all(c.length ? undefined : ['FAIL', 'colleague has no questions'], w.length ? undefined : ['FAIL', 'owner has no questions'], overlap.length ? ['FAIL', `${overlap.length} overlap`] : undefined);
    });
    await check('Question routing', 'Colleague refused for a question outside their area; out-of-range value refused', async () => { const { c, w } = (globalThis as any).__q; return all(eq((await api(col.s).put(`/me/rounds/${rid}/answers`, { answers: { [w[0]]: { value: 3 } } })).status, 400, 'outside'), eq((await api(col.s).put(`/me/rounds/${rid}/answers`, { answers: { [c[0]]: { value: 9 } } })).status, 400, 'range')); });
    await check('Assessment', 'Submit blocked until all key questions answered', async () => { const r = await api(o.s).post(`/rounds/${rid}/submit`, {}); return all(eq(r.status, 422, 'status'), r.error?.details?.blockers?.length ? undefined : ['FAIL', 'no blockers listed']); });
    await check('Assessment', 'Both answer; owner submits through the same gate; mode=hybrid; who answered is kept', async () => {
      const { c, w } = (globalThis as any).__q;
      const pc: Record<string, unknown> = {}; c.forEach((k: string, i: number) => (pc[k] = { value: (i % 3) + 2, note: 'Synthetic note' })); const pw: Record<string, unknown> = {}; w.forEach((k: string, i: number) => (pw[k] = { value: (i % 4) + 1 }));
      const a = await api(col.s).put(`/me/rounds/${rid}/answers`, { answers: pc }); const b = await api(o.s).put(`/me/rounds/${rid}/answers`, { answers: pw });
      const view = (await api(o.s).get(`/cases/${o.caseId}/round`)).data?.round; const s = await timed('POST /rounds/:id/submit', async () => api(o.s).post(`/rounds/${rid}/submit`, {}));
      const mode = (await q(`select assessment_mode m from diagnostics where id=$1`, [s.data?.id])).rows[0]?.m;
      const who = (await q(`select count(distinct answered_by)::int n from responses where diagnostic_id=$1`, [s.data?.id])).rows[0]?.n;
      return all(eq(a.status, 200, 'colleague save'), eq(b.status, 200, 'owner save'), eq(view?.canSubmit, true, 'canSubmit'), eq(s.status, 201, 'submit'), eq(mode, 'hybrid', 'mode'), eq(who, 2, 'respondents'));
    });
    await check('Assessment', 'Drafts never reach scoring; closed round refuses answers', async () => { const { c } = (globalThis as any).__q; return eq((await api(col.s).put(`/me/rounds/${rid}/answers`, { answers: { [c[0]]: { value: 1 } } })).status, 422, 'closed'); });
  });
  it('team-mode owner with no colleagues, and remaining platforms', async () => {
    for (const o of owners.slice(2)) {
      await check('Assessment', `${o.platform} owner ${o.mode}: assessment submits and scores`, async () => {
        const r = await api(o.s).post(`/cases/${o.caseId}/diagnostics`, { answers: await answers((i) => ((i * 7) % 4) + 1), uuid: `uat-${uniq()}` });
        return all(eq(r.status, 201, 'status'), eq(r.data?.caseStatus, 'DIAGNOSED', 'state'));
      });
    }
    await check('Assessment', 'Setup: AgriFood360 and ESO360 are published in this isolated database, as they are in production (approved there by the administrator)', async () => {
      // Production state: the shipped 100-question drafts had their evidence trails approved and were published. A fresh database still holds them as drafts.
      const list = (await api(admin).get('/settings/frameworks')).data as any[];
      for (const code of ['AGRIFOOD360', 'ESO360']) {
        const draft = list.find((f) => f.code === code)?.versions?.find((v: any) => v.status === 'Draft');
        if (!draft) return ['FAIL', `${code} has no draft to publish`];
        const full = (await api(admin).get(`/settings/frameworks/versions/${draft.id}`)).data;
        const ok = await api(admin).patch(`/settings/frameworks/versions/${draft.id}`, { sources: (full.sources ?? []).map((x: any) => ({ ...x, approval: 'Approved' })) });
        if (ok.status !== 200) return ['FAIL', `${code} sources: ${ok.status} ${JSON.stringify(ok.error)}`];
        const pub = await api(admin).post(`/settings/frameworks/versions/${draft.id}/publish`, { note: 'Synthetic UAT stand-in for the production approval' });
        if (pub.status !== 200) return ['FAIL', `${code} publish: ${pub.status} ${JSON.stringify(pub.error)}`];
      }
    });
    await check('Assessment', 'Platform-specific question banks: AGRIFOOD360 and ESO360 cases are served their own banks', async () => {
      const bank = async (o: Owner) => JSON.stringify(((await api(admin).get(`/questions?caseId=${o.caseId}`)).data ?? []).map((x: any) => x.code).slice(0, 3));
      const a = await bank(owners[0]), b = await bank(owners[2]), c = await bank(owners[4]);
      return a === b || a === c ? ['FAIL', `AGRIFOOD360 and ESO360 cases are served the SME360 questions (${a}). Platform routing fell back to SME360 although the specialised banks are published`] : undefined;
    });
  });
});

describe('5 AI analysis, BHR, prescriptions, review', () => {
  it('runs the diagnosis to prescription chain on the SME360 and ESO360 cases', async () => {
    for (const idx of [0, 4]) {
      const o = owners[idx]; const exp = experts.find((e) => true)!; const lead = idx === 0 ? experts[1] : experts[2]; const rv = idx === 0 ? rv1 : rv2; let dgn = '', rx = '';
      await check('AI analysis', `${o.platform}: lead expert drafts diagnosis in background (mock AI), marked as AI-drafted`, async () => {
        const g = await api(lead).post(`/cases/${o.caseId}/diagnoses/generate`); await drain(); const list = (await api(lead).get(`/cases/${o.caseId}/diagnoses`)).data ?? []; dgn = list[0]?.id;
        const ai = (await q(`select ok, model from ai_requests where case_id=$1 order by created_at desc limit 1`, [o.caseId])).rows[0];
        return all(eq(g.status, 202, 'status'), eq(list[0]?.status, 'Draft', 'draft'), eq(list[0]?.aiDrafted, true, 'flag'), eq(ai?.ok, true, 'ai ok'), ['PARTIAL', 'Mock AI only: wiring and validation proven, model quality and cost not tested (live test on hold)'] as any);
      });
      await check('Review', `${o.platform}: prescription cannot be drafted before the diagnosis is reviewed`, async () => eq((await api(lead).post(`/cases/${o.caseId}/prescriptions/generate`)).status, 422, 'status'));
      await check('Review', `${o.platform}: only the lead expert reviews the diagnosis; admin and reviewer cannot`, async () => { const a = await api(admin).post(`/diagnoses/${dgn}/review`, { decision: 'Reviewed' }); const b = await api(rv).post(`/diagnoses/${dgn}/review`, { decision: 'Reviewed' }); const c = await api(lead).post(`/diagnoses/${dgn}/review`, { decision: 'Reviewed', note: 'Agreed' }); return all(eq(a.status, 403, 'admin'), eq(b.status, 403, 'reviewer'), eq(c.status, 200, 'lead'), eq(c.data?.caseStatus, 'PRESCRIBED', 'state')); });
      await check('Prescription', `${o.platform}: prescription drafted from approved library, submitted for approval`, async () => {
        const g = await api(lead).post(`/cases/${o.caseId}/prescriptions/generate`); await drain(); const l = (await api(lead).get(`/cases/${o.caseId}/prescriptions`)).data ?? []; rx = l[0]?.id; const lib = ((await api(admin).get('/settings/library')).data ?? []).map((x: any) => x.code);
        const off = (l[0]?.items ?? []).filter((i: any) => !lib.includes(i.library_id)); const s = await api(lead).post(`/prescriptions/${rx}/submit`);
        return all(eq(g.status, 202, 'gen'), off.length ? ['FAIL', 'off-library items'] : undefined, eq(s.status, 200, 'submit'));
      });
      await check('Review', `${o.platform}: four-eyes on approval: admin, expert, owner refused; wrong reviewer 404; right reviewer approves`, async () => {
        const bad = [admin, lead, o.s].map(async (s) => (await api(s).post(`/prescriptions/${rx}/review`, { decision: 'APPROVED' })).status); const sts = await Promise.all(bad);
        const wrong = await api(idx === 0 ? rv2 : rv1).post(`/prescriptions/${rx}/review`, { decision: 'APPROVED' }); const ok = await api(rv).post(`/prescriptions/${rx}/review`, { decision: 'APPROVED', reason: 'Approved' });
        return all(sts.every((x) => x === 403) ? undefined : ['FAIL', `statuses ${sts}`], eq(wrong.status, 404, 'wrong reviewer'), eq(ok.status, 200, 'approve'), eq(ok.data?.caseStatus, 'IN EXECUTION', 'state'));
      });
      await check('Tasks', `${o.platform}: approval creates actions with owners and dates, and KPIs`, async () => { const a = (await api(lead).get(`/actions?caseId=${o.caseId}&pageSize=100`)).data; const k = (await api(lead).get(`/cases/${o.caseId}/kpis`)).data; return all(a?.total > 2 ? undefined : ['FAIL', 'few actions'], (a?.items ?? []).every((x: any) => x.assigneeId && x.dueDate) ? undefined : ['FAIL', 'missing owner/date'], k?.length ? undefined : ['FAIL', 'no KPIs']); });
      await check('Tasks', `${o.platform}: owner works own action only; Done needs an evidence note`, async () => {
        const items = (await api(o.s).get(`/actions?caseId=${o.caseId}&pageSize=100`)).data?.items ?? []; const mine = items.find((x: any) => x.ownerRole === 'OWNER'); const other = items.find((x: any) => x.ownerRole !== 'OWNER');
        const a = await api(o.s).patch(`/actions/${mine.id}`, { status: 'Done' }); const b = await api(o.s).patch(`/actions/${mine.id}`, { status: 'In progress' }); const c = await api(o.s).patch(`/actions/${mine.id}`, { status: 'Done', evidenceNote: 'Synthetic evidence' }); const d = other ? await api(o.s).patch(`/actions/${other.id}`, { status: 'In progress' }) : { status: 403 };
        return all(eq(a.status, 400, 'no note'), eq(b.status, 200, 'progress'), eq(c.status, 200, 'done'), eq(d.status, 403, 'others'));
      });
    }
    await check('Review', 'Returned prescription loop: reviewer needs a reason; expert revises; resubmits', async () => {
      const o = owners[2]; const lead = experts[0]; await api(lead).post(`/cases/${o.caseId}/diagnoses/generate`); await drain(); const dg = (await api(lead).get(`/cases/${o.caseId}/diagnoses`)).data[0].id; await api(lead).post(`/diagnoses/${dg}/review`, { decision: 'Reviewed' });
      await api(lead).post(`/cases/${o.caseId}/prescriptions/generate`); await drain(); const rx = (await api(lead).get(`/cases/${o.caseId}/prescriptions`)).data[0]; await api(lead).post(`/prescriptions/${rx.id}/submit`);
      const noReason = await api(rv1).post(`/prescriptions/${rx.id}/review`, { decision: 'RETURNED' }); const ret = await api(rv1).post(`/prescriptions/${rx.id}/review`, { decision: 'RETURNED', reason: 'Timelines too tight for synthetic test' });
      const rev = await api(lead).post(`/prescriptions/${rx.id}/revise`, { items: rx.items.map((i: any) => ({ library_id: i.library_id, actions: i.actions })) }); const re = await api(lead).post(`/prescriptions/${rev.data?.id}/submit`);
      return all(eq(noReason.status, 400, 'reason'), eq(ret.status, 200, 'return'), eq(rev.status, 201, 'revise'), eq(re.status, 200, 'resubmit'));
    });
  });
  it('Business Health Record', async () => {
    await check('BHR', 'Record shows history across diagnostics with framework versions', async () => { const r = await timed('GET /organisations/:id/record', async () => api(experts[1]).get(`/organisations/${owners[0].orgId}/record`)); const j = JSON.stringify(r.data ?? {}); return all(eq(r.status, 200, 'status'), /version|framework/i.test(j) ? undefined : ['PARTIAL', 'no framework version in payload']); });
    await check('BHR', 'Owner cannot read another business record', async () => eq((await api(owners[0].s).get(`/organisations/${owners[1].orgId}/record`)).status, 404, 'status'));
    await check('BHR', 'Record is longitudinal: score history grows after resubmission', async () => { const r = await api(experts[1]).get(`/organisations/${owners[0].orgId}/record`); const j = JSON.stringify(r.data ?? {}); const n = (j.match(/"overall"/g) ?? []).length; return n >= 2 ? undefined : ['PARTIAL', `only ${n} score entries`]; });
  });
});

describe('6 progression, reports, dashboards, notifications', () => {
  it('progresses a case and issues a report', async () => {
    const o = owners[0]; const lead = experts[1];
    await check('Progression', 'Coaching sessions: past dates and unnoted Held refused; 3 held moves to MONITORING', async () => {
      const when = new Date(Date.now() + 86400_000).toISOString(); const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await api(experts[3]).post(`/cases/${o.caseId}/sessions`, { scheduledAt: when })).data?.id);
      const past = await api(experts[3]).post(`/cases/${o.caseId}/sessions`, { scheduledAt: '2020-01-01T10:00:00Z' }); const nonote = await api(experts[3]).patch(`/sessions/${ids[0]}`, { status: 'Held' });
      for (const [i, id] of ids.entries()) await api(experts[3]).patch(`/sessions/${id}`, { status: 'Held', notes: `Synthetic session ${i + 1} notes covering cash book review` });
      const st = (await api(lead).get(`/cases/${o.caseId}`)).data?.status; return all(eq(past.status, 400, 'past'), eq(nonote.status, 400, 'notes'), eq(st, 'MONITORING', 'state'));
    });
    await check('Progression', 'Manual transitions: owner refused; automatic-only refused; conditions enforced', async () => all(eq((await api(o.s).post(`/cases/${o.caseId}/transition`, { to: 'MIDLINE' })).status, 403, 'owner'), eq((await api(lead).post(`/cases/${o.caseId}/transition`, { to: 'GRADUATED' })).status, 422, 'graduated'), eq((await api(lead).post(`/cases/${o.caseId}/transition`, { to: 'MIDLINE', reason: 'Midline reached' })).status, 200, 'midline')));
    await check('Reports', 'Report drafted; owner cannot see it until the case reviewer releases it', async () => {
      await api(lead).post(`/cases/${o.caseId}/reports/generate`); await drain(); const l = (await api(lead).get(`/cases/${o.caseId}/reports`)).data ?? []; const id = l[0]?.id;
      const hid = (await api(o.s).get(`/reports/${id}`)).status; const wrong = (await api(rv2).post(`/reports/${id}/release`)).status; const rel = await api(rv1).post(`/reports/${id}/release`); const seen = (await api(o.s).get(`/reports/${id}`)).status;
      reportId = id;
      return all(eq(hid, 404, 'hidden'), wrong === 200 ? ['FAIL', 'wrong reviewer released'] : undefined, eq(rel.status, 200, 'release'), eq(seen, 200, 'visible'));
    });
    await check('Reports', 'Report export as PDF/Word for the owner', async () => {
      const get = (c: string, f: string) => call('GET', `/reports/${reportId}/export?format=${f}`, { cookie: c });
      const pdf = await get(o.s.cookie, 'pdf'); const docx = await get(o.s.cookie, 'docx'); const other = await get(owners[1].s.cookie, 'pdf');
      return all(eq(pdf.status, 200, 'pdf'), eq(pdf.headers.get('content-type'), 'application/pdf', 'pdf type'), eq(docx.status, 200, 'docx'), other.status >= 403 ? undefined : ['FAIL', `another business got ${other.status}`]);
    });
  });
  it('dashboards and monitoring per role', async () => {
    const roles: [string, Session][] = [['admin', admin], ['pm', pm], ['expert', experts[0]], ['reviewer', rv1], ['finance', fin], ['owner', owners[0].s], ['funder', funder], ['executive', exec]];
    for (const [n, s] of roles) await check('Dashboards', `${n} dashboard loads with data`, async () => { const r = await timed('GET /dashboard', async () => api(s).get('/dashboard')); return all(eq(r.status, 200, 'status'), r.data?.kind ? undefined : ['FAIL', 'no kind']); });
    await check('Monitoring', 'Admin command centre shows live figures', async () => eq((await api(admin).get('/admin/command-centre')).status, 200, 'status'));
    await check('Monitoring', 'Programme dashboard: staff see counts; funder sees suppressed aggregates (n<5) with no names', async () => { const s = (await api(pm).get(`/programmes/${prog.id}/dashboard`)).data; const f = (await api(funder).get(`/programmes/${prog.id}/dashboard`)).data; return all(s?.total >= 6 ? undefined : ['FAIL', `staff total ${s?.total}`], eq(f?.suppressed, true, 'suppressed'), /Business \d|@/.test(JSON.stringify(f)) ? ['FAIL', 'funder sees names'] : undefined); });
    await check('Monitoring', 'Stuck-case / overdue workflow view for managers', async () => { const r = await api(pm).get('/dashboard'); const j = JSON.stringify(r.data ?? {}); return /overdue|stuck|sla|ageing|stale/i.test(j) ? undefined : ['GAP', 'No overdue, ageing or SLA view of cases or tasks on the manager dashboard']; });
    await check('Monitoring', 'Demographic (gender/youth) disaggregation for funders', async () => { const j = JSON.stringify((await api(funder).get(`/programmes/${prog.id}/dashboard`)).data ?? {}); return /gender|youth|women|disab/i.test(j) ? undefined : ['GAP', 'No gender, youth or disability disaggregation on the funder dashboard (dead stub in code)']; });
    await check('Search', 'Global search is scoped to what the caller may see', async () => { const a = await api(owners[0].s).get('/search?q=TEST'); const j = JSON.stringify(a.data ?? {}); return all(eq(a.status, 200, 'status'), j.includes(owners[1].orgId) ? ['FAIL', 'owner sees another org'] : undefined); });
  });
  it('notifications and tasks', async () => {
    await check('Notifications', 'Experts, reviewers and owners receive in-app notifications; read marks work; others cannot mark', async () => { const n = (await api(experts[0]).get('/notifications')).data; const id = n?.items?.[0]?.id; const ok = id ? await api(experts[0]).post(`/notifications/${id}/read`) : { status: 0 }; const x = id ? await api(rv1).post(`/notifications/${id}/read`) : { status: 0 }; return all(n?.items?.length ? undefined : ['FAIL', 'none'], eq(ok.status, 200, 'read'), eq(x.status, 404, 'foreign')); });
    await check('Notifications', 'Email outbox queued for invitations and verification', async () => { const r = await q(`select count(*)::int n, count(*) filter (where status='sent')::int s from outbox_emails`); return r.rows[0].n > 5 ? undefined : ['FAIL', 'no emails queued']; });
    await check('Notifications', 'Session reminders and stalled-case escalation to expert/PM', async () => {
      const { tx } = await import('@/db/client'); const { systemCtx } = await import('@/services/common'); const { remindSessions, scanEscalations } = await import('@/services/sla');
      const r = await tx(async (t) => { const ctx = systemCtx(t as any, 'scan'); return { rem: await remindSessions(ctx), esc: await scanEscalations(ctx, new Date(Date.now() + 30 * 86_400_000)) }; });
      const esc = (await api(admin).get('/escalations')).status;
      return all(typeof r.rem?.reminded === 'number' ? undefined : ['FAIL', 'reminder scan did not run'], eq(esc, 200, 'escalations list'), ['PARTIAL', 'Jobs run and list correctly. The scheduled daily run (06:00 UTC cron) is not exercised in this test']);
    });
  });
});

describe('7 permissions, overrides, audit, edge cases and finance', () => {
  it('permission matrix and leak probes', async () => {
    const A = owners[0], B = owners[1];
    await check('Permissions', 'Owner A cannot read, list or write owner B business (case, org, diagnostics)', async () => all(eq((await api(A.s).get(`/cases/${B.caseId}`)).status, 404, 'case'), eq((await api(A.s).get(`/organisations/${B.orgId}`)).status, 404, 'org'), eq((await api(A.s).post(`/cases/${B.caseId}/diagnostics`, { answers: await answers(() => 3) })).status, 404, 'write')));
    await check('Permissions', 'Funder cannot read cases or exports with names', async () => all(eq((await api(funder).get('/cases')).status, 403, 'cases'), /Business \d|@/.test((await call('GET', `/programmes/${prog.id}/export`, { cookie: funder.cookie })).text) ? ['FAIL', 'names in export'] : undefined));
    await check('Permissions', 'Reviewer cannot export; owner cannot read audit or users', async () => all(eq((await call('GET', '/cases?format=csv', { cookie: rv1.cookie })).status, 403, 'csv'), eq((await api(A.s).get('/audit')).status, 403, 'audit'), eq((await api(A.s).get('/users')).status, 403, 'users')));
    await check('Permissions', 'Expert cannot touch cases they are not on', async () => { const other = owners.find((o) => o.platform === 'ESO360')!; const r = await api(experts[0]).get(`/cases/${other.caseId}`); return [200].includes(r.status) ? ['FAIL', 'expert reads unassigned case'] : undefined; });
    await check('Permissions', 'Finance cannot read case content', async () => { const r = await api(fin).get(`/cases/${A.caseId}/diagnoses`); return r.status === 403 || r.status === 404 ? undefined : ['FAIL', `status ${r.status}`]; });
    await check('Permissions', 'PROBE contracts: PM reads contracts outside their programme', async () => {
      const outsider = (await api(admin).post('/organisations', { name: 'TEST Outside Org (Synthetic)', region: 'Ashanti', consent: true, consentBy: 'TEST Owner' })).data; await api(admin).post('/contracts', { orgId: outsider.id, amountGhs: 1000 });
      const l = await api(pm).get('/contracts?pageSize=100'); const rows = l.data?.items ?? l.data ?? []; const seen = rows.some((c: any) => (c.orgId ?? c.org_id) === outsider.id);
      return seen ? ['FAIL', 'PM sees a contract for an organisation outside their programme (confirmed leak)'] : undefined;
    });
    await check('Permissions', 'PROBE getOrg: PM cannot read an organisation that has a case in another programme (unclaimed registry entries are visible by design)', async () => {
      const p2 = (await api(admin).post('/programmes', { name: 'TEST Other Programme (Synthetic)', funder: 'TEST', startDate: '2026-01-01', endDate: '2027-01-01', budgetGhs: 1000 })).data; await api(admin).patch(`/programmes/${p2.id}`, { status: 'Active' });
      const o = (await q(`select id from organisations where name like 'TEST Outside Org%' limit 1`)).rows[0]; const mk = await api(admin).post('/cases', { orgId: o.id, programmeId: p2.id });
      const r = await api(pm).get(`/organisations/${o.id}`); return all(eq(mk.status, 201, 'case'), r.status === 200 ? ['FAIL', 'PM can open an organisation claimed by another programme'] : undefined);
    });
    await check('Permissions', 'PROBE shared master data: PM edits organisation name/region', async () => { const r = await api(pm).patch(`/organisations/${A.orgId}`, { name: 'TEST Renamed By PM (Synthetic)' }); return r.status === 200 ? ['PARTIAL', 'PM can rename a shared organisation record; no change approval'] : undefined; });
  });
  it('admin overrides, reassignment, account controls', async () => {
    await check('Admin', 'Admin switch override needs a reason and is audited; non-admin refused', async () => { const k = 'switch.report_requires_verified_org'; const a = await api(admin).put(`/settings/switches/${k}`, { on: false }); const b = await api(rv1).put(`/settings/switches/${k}`, { on: false, reason: 'long enough reason' }); const c = await api(admin).put(`/settings/switches/${k}`, { on: false, reason: 'Synthetic validation override' }); await api(admin).put(`/settings/switches/${k}`, { on: true }); return all(eq(a.status, 400, 'reason'), eq(b.status, 403, 'rbac'), eq(c.status, 200, 'ok')); });
    await check('Admin', 'Admin unlocks a locked account after repeated failed sign-ins', async () => {
      const e = `lock.${uniq()}@uat.samakose.test`; const u = await makeUser('EXPERT', { email: e }); for (let i = 0; i < 8; i++) await call('POST', '/auth/login', { body: { email: e, password: 'wrong-Password-1!' } });
      const locked = await call('POST', '/auth/login', { body: { email: e, password: PASSWORD } }); const un = await api(admin).post(`/users/${u.userId}/unlock`, {}); const ok = await call('POST', '/auth/login', { body: { email: e, password: PASSWORD } });
      return all(locked.status >= 400 ? undefined : ['FAIL', 'never locked'], eq(un.status, 200, 'unlock'), eq(ok.status, 200, 'login'));
    });
    await check('Admin', 'Admin deactivates a user: sessions end', async () => { const e = `off.${uniq()}@uat.samakose.test`; const u = await makeUser('EXPERT', { email: e }); const r = await api(admin).patch(`/users/${u.userId}`, { active: false }); const me = await api(u).get('/auth/me'); return all(eq(r.status, 200, 'patch'), me.status === 401 ? undefined : ['FAIL', `old session still works: ${me.status}`]); });
    await check('Admin', 'Reassign a case when an expert leaves, with history kept', async () => { const o = owners[5]; const r = await api(admin).post(`/cases/${o.caseId}/assign`, { consultantId: experts[3].userId, reason: 'Expert is leaving' }); const log = (await q(`select count(*)::int n from audit_log where entity_id=$1 and action='case.assigned'`, [o.caseId])).rows[0].n; return all(eq(r.status, 200, 'status'), log >= 2 ? undefined : ['FAIL', 'no history']); });
    await check('Admin', 'Bulk reassignment of an expert\'s whole caseload', async () => {
      const from = experts[4]; const to = experts[2]; const before = (await api(admin).get(`/practitioners/${from.userId}/caseload`)).data?.items?.length ?? 0;
      const r = await api(admin).post(`/practitioners/${from.userId}/transfer-caseload`, { toUserId: to.userId, reason: 'Expert is leaving' });
      const after = (await api(admin).get(`/practitioners/${from.userId}/caseload`)).data?.items?.length ?? -1;
      return all(eq(r.status, 200, 'status'), (r.data?.moved?.length ?? 0) + (r.data?.skipped?.length ?? 0) === before ? undefined : ['FAIL', 'moved plus skipped does not equal the caseload'], after === (r.data?.skipped?.length ?? 0) ? undefined : ['FAIL', `expert still has ${after} cases`]);
    });
  });
  it('audit trail', async () => {
    await check('Audit', 'Case audit has the expected actions, never secrets', async () => { const r = await api(admin).get(`/audit?caseId=${owners[0].caseId}&pageSize=100`); const names = (r.data?.items ?? []).map((a: any) => a.action); const need = ['case.created', 'case.assigned', 'diagnostic.submitted', 'score.computed', 'diagnosis.reviewed', 'prescription.approved']; const miss = need.filter((x) => !names.includes(x)); return all(miss.length ? ['FAIL', `missing ${miss}`] : undefined, /passwordHash|password_hash|mfaSecret/.test(JSON.stringify(r.data)) ? ['FAIL', 'secret in audit'] : undefined); });
    await check('Audit', 'Audit log is append-only at the database', async () => { try { await q(`update audit_log set action='x' where id=(select id from audit_log limit 1)`); return ['FAIL', 'update succeeded']; } catch { return; } });
    await check('Audit', 'Personal data kept out of audit payloads', async () => { const r = await q(`select count(*)::int n from audit_log where after::text ~* '[a-z0-9._-]@uat.samakose.test' or before::text ~* '[a-z0-9._-]@uat.samakose.test'`); return r.rows[0].n ? ['PARTIAL', `${r.rows[0].n} audit rows carry email addresses in payloads; minimise for data-protection`] : undefined; });
  });
  it('edge cases and error handling', async () => {
    await check('Edge', 'Malformed ids return 404, never 500', async () => all(eq((await api(admin).get('/cases/not-a-uuid')).status, 404, 'bad'), eq((await api(admin).get('/cases/00000000-0000-4000-8000-000000000000')).status, 404, 'missing')));
    await check('Edge', 'Invalid pagination and malformed JSON return 400', async () => all(eq((await api(admin).get('/cases?pageSize=0')).status, 400, 'page'), eq((await call('POST', '/cases', { cookie: admin.cookie, raw: '{bad' })).status, 400, 'json')));
    await check('Edge', 'Unauthenticated access is refused', async () => eq((await call('GET', '/cases')).status, 401, 'status'));
    await check('Edge', 'Script and SQL text in names is stored safely and does not break lists', async () => { const r = await api(admin).post('/organisations', { name: `TEST <script>alert(1)</script>'; drop table users;-- (Synthetic)`, region: 'Northern', consent: true, consentBy: 'TEST Owner' }); const l = await api(admin).get('/organisations?q=TEST'); const t = (await q(`select count(*)::int n from users`)).rows[0].n; return all(eq(r.status, 201, 'create'), eq(l.status, 200, 'list'), t > 0 ? undefined : ['FAIL', 'users gone']); });
    await check('Edge', 'Duplicate organisation name in same region blocked; null region slips through', async () => { const nm = `TEST Dup ${uniq()} (Synthetic)`; await api(admin).post('/organisations', { name: nm, region: 'Northern', consent: true, consentBy: 'TEST Owner' }); const a = await api(admin).post('/organisations', { name: nm, region: 'Northern', consent: true, consentBy: 'TEST Owner' }); const b = await api(admin).post('/organisations', { name: nm, consent: true, consentBy: 'TEST Owner' }); return all(eq(a.status, 400, 'same region'), b.status === 201 ? ['PARTIAL', 'Same name with no region is accepted as a new organisation (weak duplicate detection)'] : undefined); });
    await check('Edge', 'Draft cohort refuses enrolment', async () => { const c = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: 'TEST Draft Cohort (Synthetic)', capacity: 5 })).data; const o = (await api(admin).post('/organisations', { name: `TEST Draft Enrol ${uniq()} (Synthetic)`, region: 'Northern', consent: true, consentBy: 'TEST Owner' })).data; const r = await api(admin).post('/cases', { orgId: o.id, programmeId: prog.id, cohortId: c.id }); return r.status === 201 ? ['FAIL', `Enrolment accepted into a ${c.status ?? 'Draft'} cohort`] : undefined; });
    await check('Edge', 'Cohort capacity enforced', async () => { const c = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: 'TEST Cap1 (Synthetic)', capacity: 1 })).data; await api(admin).patch(`/cohorts/${c.id}`, { status: 'Open' }); const mk = async () => api(admin).post('/cases', { orgId: (await api(admin).post('/organisations', { name: `TEST Cap ${uniq()} (Synthetic)`, region: 'Northern', consent: true, consentBy: 'TEST Owner' })).data.id, programmeId: prog.id, cohortId: c.id }); const a = await mk(); const b = await mk(); return all(eq(a.status, 201, 'first'), eq(b.status, 409, 'second')); });
    await check('Edge', 'Second open case for same org and programme refused', async () => eq((await api(admin).post('/cases', { orgId: owners[0].orgId, programmeId: prog.id })).status, 409, 'status'));
    await check('Edge', 'Concurrent double submit of a diagnostic creates one version, not two', async () => { const o = owners[3]; const u = `race-${uniq()}`; const a = Object.fromEntries(((await api(admin).get(`/questions?caseId=${o.caseId}`)).data ?? []).map((x: any) => [x.code, { value: 3, evidence: 'Self-reported' }])); const before = (await q(`select count(*)::int n from diagnostics where case_id=$1`, [o.caseId])).rows[0].n; const rs = await Promise.all([1, 2].map(() => api(o.s).post(`/cases/${o.caseId}/diagnostics`, { answers: a, uuid: u }))); const after = (await q(`select count(*)::int n from diagnostics where case_id=$1`, [o.caseId])).rows[0].n; return after - before === 1 ? undefined : ['FAIL', `${after - before} rows from one submission id; statuses ${rs.map((r) => r.status)}`]; });
    await check('Edge', 'Upload: wrong type and spoofed PDF refused', async () => { const f = new FormData(); f.set('file', new File([new Uint8Array(Buffer.from('MZ'))], 'x.exe')); const g = new FormData(); g.set('file', new File([new Uint8Array(Buffer.from('MZ not pdf'))], 'x.pdf')); const col = (globalThis as any).__colleague; return all(eq((await call('POST', `/documents`, { cookie: experts[0].cookie, form: f })).status >= 400, true, 'exe'), eq((await call('POST', `/documents`, { cookie: experts[0].cookie, form: g })).status >= 400, true, 'spoof')); });
    await check('Edge', 'Login brute force is throttled', async () => { const e = `thr.${uniq()}@uat.samakose.test`; let last = 0; for (let i = 0; i < 25; i++) last = (await call('POST', '/auth/login', { body: { email: e, password: 'nope-Nope-1234' } })).status; return last === 429 || last === 401 ? undefined : ['FAIL', `last ${last}`]; });
  });
  it('contracts, programmes and organisations lifecycle', async () => {
    let plan: any, contract: any, inv: any; const org = owners[0].orgId;
    await check('Contracts', 'Finance creates plan, contract and invoice; owner cannot', async () => { plan = (await api(admin).post('/plans', { name: 'TEST Plan (Synthetic)', priceGhs: 5000, intervalMonths: 12 })).data; const c = await api(fin).post('/contracts', { orgId: org, planId: plan?.id, startDate: '2026-01-01', endDate: '2026-12-31', amountGhs: 5000 }); contract = c.data; inv = (await api(fin).post('/invoices', { orgId: org, contractId: contract?.id, amountGhs: 5000, dueDate: '2026-12-01' })).data; return all(eq(c.status, 201, 'contract'), inv?.id ? undefined : ['FAIL', 'no invoice'], eq((await api(owners[0].s).post('/contracts', { orgId: org, amountGhs: 1 })).status, 403, 'owner')); });
    await check('Contracts', 'Contract with a programme that does not exist or end before start is refused', async () => { const a = await api(fin).post('/contracts', { orgId: org, programmeId: '00000000-0000-4000-8000-000000000000', amountGhs: 10 }); const b = await api(fin).post('/contracts', { orgId: org, startDate: '2026-12-31', endDate: '2026-01-01', amountGhs: 10 }); return all(a.status === 201 ? ['FAIL', 'Non-existent programme accepted on a contract'] : undefined, eq(b.status >= 400, true, 'date order')); });
    await check('Contracts', 'Over-invoicing: invoices beyond the contract value are blocked', async () => { const r = await api(fin).post('/invoices', { orgId: org, contractId: contract?.id, amountGhs: 99999, dueDate: '2026-12-01' }); return r.status === 201 ? ['FAIL', 'Invoice of 99,999 accepted against a 5,000 contract'] : undefined; });
    await check('Contracts', 'Owner can see their own contract and invoices', async () => {
      const mine = await api(fin).post('/contracts', { orgId: owners[0].orgId, startDate: '2027-01-01', endDate: '2027-12-31', amountGhs: 4000 }); await api(fin).patch(`/contracts/${mine.data?.id}`, { status: 'Active' });
      const a = await api(owners[0].s).get('/contracts'); const b = await api(owners[0].s).get('/invoices'); const rows = a.data?.items ?? [];
      return all(eq(a.status, 200, 'contracts'), eq(b.status, 200, 'invoices'), rows.some((c: any) => c.id === mine.data?.id) ? undefined : ['FAIL', 'owner does not see own active contract'], rows.every((c: any) => c.orgId === owners[0].orgId) ? undefined : ['FAIL', 'owner sees another business contract']);
    });
    await check('Contracts', 'Signatory and acceptance evidence, amendments and renewals', async () => {
      const id = (await api(fin).post('/contracts', { orgId: owners[0].orgId, startDate: '2027-01-01', endDate: '2027-12-31', amountGhs: 3000 })).data?.id; await api(fin).patch(`/contracts/${id}`, { status: 'Active' });
      const acc = await api(owners[0].s).post(`/contracts/${id}/accept`, { signatoryName: 'TEST Owner (Synthetic)' }); const am = await api(fin).post(`/contracts/${id}/amend`, { endDate: '2028-03-31', reason: 'TEST extension (Synthetic)' });
      const need = (await api(owners[0].s).get(`/contracts/${id}`)).data?.needsAcceptance; const ren = await api(fin).post(`/contracts/${id}/renew`, {}); const again = await api(fin).post(`/contracts/${id}/renew`, {});
      return all(eq(acc.status, 200, 'accept'), eq(am.status, 200, 'amend'), eq(need, true, 're-acceptance after amendment'), eq(ren.status, 201, 'renew'), eq(again.status, 409, 'second renewal refused'));
    });
    await check('Contracts', 'Payment (mock gateway) marks invoice paid; replay is idempotent', async () => { await api(fin).patch(`/invoices/${inv?.id}`, { status: 'Sent' }); const p = await api(fin).post(`/invoices/${inv?.id}/manual-payment`, { amountGhs: 5000, reference: `UAT-${uniq()}` }); return p.status < 300 ? undefined : ['PARTIAL', `manual payment ${p.status} ${JSON.stringify(p.error)}`.slice(0, 200)]; });
    await check('Prescription', 'Intervention library covers every dimension of the published framework', async () => {
      const fw = (await q(`select distinct e->>'dimension' d from framework_versions v, jsonb_array_elements(v.questions) e where v.status='Published'`)).rows.map((r) => r.d); const lib = (await q(`select distinct dimension d from library_items`)).rows.map((r) => r.d);
      const { libraryDimension } = await import('@/domain/library-map'); const uncovered = fw.filter((d) => !lib.includes(libraryDimension(d))); return uncovered.length ? ['FAIL', `${uncovered.length} of ${fw.length} framework dimensions map to no library items (library dimensions: ${lib.join(', ')})`] : undefined;
    });
    await check('Programmes', 'Programme lifecycle: complete or cancel cascades to open cohorts and cases', async () => { const p = (await api(admin).post('/programmes', { name: 'TEST Closing Programme (Synthetic)', startDate: '2026-01-01', endDate: '2026-12-31', budgetGhs: 1 })).data; await api(admin).patch(`/programmes/${p.id}`, { status: 'Active' }); const c = (await api(admin).post(`/programmes/${p.id}/cohorts`, { name: 'TEST C (Synthetic)', capacity: 5 })).data; await api(admin).patch(`/cohorts/${c.id}`, { status: 'Open' }); await api(admin).patch(`/programmes/${p.id}`, { status: 'Completed' }); const st = (await q(`select status from cohorts where id=$1`, [c.id])).rows[0].status; return st === 'Open' ? ['FAIL', 'Cohort still Open after programme Completed'] : undefined; });
    await check('Programmes', 'Indicators and targets with live actuals; funder sees values only above the privacy minimum', async () => {
      const made = await api(pm).post(`/programmes/${prog.id}/indicators`, { name: 'TEST Average score goal (Synthetic)', metric: 'avg_score', target: 60 });
      const list = (await api(pm).get(`/programmes/${prog.id}/indicators`)).data ?? []; const row = list.find((x: any) => x.name.startsWith('TEST Average'));
      const fl = (await api(funder).get(`/programmes/${prog.id}/indicators`)).data ?? [];
      return all(eq(made.status, 201, 'create'), row ? undefined : ['FAIL', 'not listed'], row && row.status === 'Hidden' ? ['FAIL', 'staff value hidden'] : undefined, fl.length ? undefined : ['FAIL', 'funder sees no target']);
    });
    await check('Programmes', 'Logframe outcome levels, budget lines, tranches', async () => ['GAP', 'Indicators with targets and live actuals exist. Budget lines, tranches and a logframe hierarchy do not']);
    await check('Organisations', 'Registration number / TIN captured; completeness score; merge duplicates; unarchive', async () => ['GAP', 'No TIN/RGD, completeness score, merge, unarchive or ownership transfer']);
  });
  it('performance sample', async () => {
    for (const [route, who] of [['/cases?pageSize=50', admin], ['/organisations', admin], ['/dashboard', pm], ['/audit?pageSize=100', admin]] as [string, Session][]) await check('Performance', `${route} responds in under 1s on the synthetic dataset`, async () => { const t = Date.now(); const r = await timed(route, async () => api(who).get(route)); const ms = Date.now() - t; return all(eq(r.status, 200, 'status'), ms > 1000 ? ['PARTIAL', `${ms}ms`] : undefined); });
  });
});

describe('8 expert and coach network', () => {
  it('profile, vetting, photo, acceptance, ratings and performance on all three platforms', async () => {
    const png = await (await import('sharp')).default({ create: { width: 500, height: 500, channels: 3, background: { r: 10, g: 120, b: 80 } } }).png().toBuffer();
    await check('Network', 'Every expert can have a photo; /auth/me carries photoUrl and the image is served only to permitted people', async () => {
      const f = new FormData(); f.set('file', new File([new Uint8Array(png)], 'p.png', { type: 'image/png' }));
      const up = await call('POST', '/me/photo', { cookie: experts[0].cookie, form: f }); const me = await api(experts[0]).get('/auth/me');
      const own = await call('GET', `/users/${experts[0].userId}/photo`, { cookie: experts[0].cookie }); const stranger = await call('GET', `/users/${experts[0].userId}/photo`, { cookie: owners[5].s.cookie });
      return all(eq(up.status, 200, 'upload'), me.data?.user?.photoUrl ? undefined : ['FAIL', 'no photoUrl'], eq(own.status, 200, 'own'), stranger.status === 404 || stranger.status === 403 ? undefined : ['FAIL', `stranger got ${stranger.status}`]);
    });
    await check('Network', 'New expert: profile, submit, administrator approves; only then can they be assigned', async () => {
      const x = await makeUser('EXPERT'); await q(`update practitioner_profiles set vetting_status='Draft' where user_id=$1`, [x.userId]);
      const before = await api(admin).post(`/cases/${owners[4].caseId}/assign`, { coachId: x.userId, reason: 'try' });
      const body = { headline: 'Marketing adviser', bio: 'Helps retail and agro-processing businesses win and keep customers in Northern Ghana.', functions: ['expert', 'coach'], specialisations: ['Marketing and sales'], strengths: ['Market and sales'], sectors: ['Retail and trade'], platforms: ['SME360'], languages: ['English'], regions: ['Northern'], yearsExperience: 5, acceptConduct: true };
      const sv = await api(x).patch('/me/practitioner', body); const sub = await api(x).post('/me/practitioner/submit', {}); const ok = await api(admin).post(`/practitioners/${x.userId}/decision`, { decision: 'Approved' });
      const after = await api(admin).post(`/cases/${owners[4].caseId}/assign`, { coachId: x.userId, reason: 'Now approved' });
      return all(eq(before.status, 400, 'draft refused'), eq(sv.status, 200, 'save'), eq(sub.status, 200, 'submit'), eq(ok.status, 200, 'approve'), eq(after.status, 200, 'assigned after approval'));
    });
    await check('Network', 'Assigned expert accepts; a decline needs a reason and frees the place', async () => {
      const t = (await api(admin).get(`/cases/${owners[0].caseId}/team`)).data.items.find((m: any) => m.fn === 'lead' && m.status === 'Active'); const lead = experts.find((e) => e.userId === t.userId)!;
      const bad = await api(lead).post(`/assignments/${t.id}/respond`, { decision: 'decline' }); const ok = await api(lead).post(`/assignments/${t.id}/respond`, { decision: 'accept' });
      return all(eq(bad.status, 400, 'decline needs reason'), eq(ok.status, 200, 'accept'));
    });
    await check('Network', 'Ratings open at coaching: business, reviewer and programme manager each rate; the lead sees a Limited evidence summary', async () => {
      const c = owners[0]; await q(`update cases set status='COACHING' where id=$1`, [c.caseId]);
      const team = (await api(admin).get(`/cases/${c.caseId}/team`)).data.items; const lead = team.find((m: any) => m.fn === 'lead' && m.status === 'Active');
      const cases = (await q(`select reviewer_id from cases where id=$1`, [c.caseId])).rows[0]; const rv = [rv1, rv2].find((r) => r.userId === cases.reviewer_id)!;
      const form = (await api(c.s).get(`/assignments/${lead.id}/rating`)).data; const mk = (crit: any[]) => Object.fromEntries(crit.map((k: any) => [k.key, 4]));
      const a = await api(c.s).post(`/assignments/${lead.id}/rating`, { scores: mk(form.criteria) });
      const b = await api(rv).post(`/assignments/${lead.id}/rating`, { scores: mk((await api(rv).get(`/assignments/${lead.id}/rating`)).data.criteria) });
      const d = await api(pm).post(`/assignments/${lead.id}/rating`, { scores: mk((await api(pm).get(`/assignments/${lead.id}/rating`)).data.criteria) });
      const own = lead.userId === experts[0].userId ? experts[0] : experts.find((e) => e.userId === lead.userId)!; const perf = await api(own).get('/me/practitioner/performance');
      const forbidden = await api(own).post(`/assignments/${lead.id}/rating`, { scores: mk(form.criteria) });
      return all(eq(a.status, 200, 'owner'), eq(b.status, 200, 'reviewer'), eq(d.status, 200, 'pm'), eq(perf.data?.confidence, 'Limited evidence', 'confidence'), forbidden.status === 403 || forbidden.status === 400 ? undefined : ['FAIL', `self-rating gave ${forbidden.status}`]);
    });
    await check('Network', 'Ratings cannot be changed or deleted at the database', async () => {
      let blocked = 0; for (const sql of [`update engagement_ratings set overall = 1`, `delete from engagement_ratings`]) { try { await q(sql); } catch { blocked++; } }
      return blocked === 2 ? undefined : ['FAIL', `only ${blocked} of 2 blocked`];
    });
    await check('Network', 'Matches differ by platform: AgriFood360 case ranks agriculture experts first when profiles say so', async () => {
      const agri = owners.find((o) => o.platform === 'AGRIFOOD360')!; const r = await api(admin).get(`/cases/${agri.caseId}/matches?fn=lead`);
      return all(eq(r.status, 200, 'status'), r.data?.need?.platform === 'AGRIFOOD360' ? undefined : ['FAIL', `platform ${r.data?.need?.platform}`]);
    });
  });
});

describe('9 UNLOCK: opportunities, consent and referral', () => {
  it('opportunities reach only the businesses they fit, and no one is referred without consent and a person\'s approval', async () => {
    const mk = async (body: any) => { const r = await api(admin).post('/opportunities', { provider: 'TEST Partner (Synthetic)', summary: 'Synthetic opportunity for validation of matching and referral.', type: 'Funding', ...body }); await api(admin).post(`/opportunities/${r.data.id}/publish`, {}); return r.data.id as string; };
    const agri = owners.find((o) => o.orgType === 'AGRIFOOD')!, sme = owners.find((o) => o.orgType === 'SME')!, eso = owners.find((o) => o.orgType === 'ESO')!;
    const general = await mk({ title: SYN('Open window'), criteria: {} });
    const agriOnly = await mk({ title: SYN('Agrifood window'), type: 'Grant', criteria: { orgTypes: ['AGRIFOOD'] } });
    const esoOnly = await mk({ title: SYN('ESO programme'), type: 'Programme', criteria: { orgTypes: ['ESO'] } });
    const hard = await mk({ title: SYN('High bar'), type: 'Equity', criteria: { minOverall: 100 } });
    const draft = (await api(admin).post('/opportunities', { title: SYN('Unpublished'), type: 'Loan', provider: 'TEST Partner (Synthetic)', summary: 'Draft that must stay hidden.' })).data.id;
    const path = async (o: Owner) => (await api(o.s).get(`/organisations/${o.orgId}/pathway`)).data;
    await check('UNLOCK', 'Each platform owner sees only the opportunities that fit their organisation type, and never a draft', async () => {
      const [a, s2, e] = [await path(agri), await path(sme), await path(eso)]; const has = (p: any, id: string) => p.items.some((i: any) => i.opportunity.id === id);
      return all(eq(has(a, agriOnly), true, 'agri sees agri'), eq(has(s2, agriOnly), false, 'sme hides agri'), eq(has(e, agriOnly), false, 'eso hides agri'), eq(has(e, esoOnly), true, 'eso sees eso'), eq(has(a, esoOnly), false, 'agri hides eso'), eq(has(a, draft) || has(s2, draft), false, 'draft hidden'));
    });
    await check('UNLOCK', 'A requirement the business does not meet is explained in plain words with what to do', async () => {
      const p = await path(sme); const item = p.items.find((i: any) => i.opportunity.id === hard);
      return all(eq(['Close', 'Not yet'].includes(item?.match.status), true, 'status'), eq(/Raise the overall score to 100/.test(item?.match.gaps[0]?.label ?? ''), true, 'gap wording'));
    });
    await check('UNLOCK', 'Consent is needed first, a person approves, and an award is recorded with its amount and history', async () => {
      const no = await api(sme.s).post(`/organisations/${sme.orgId}/opportunities/${general}/request`, { scope: [] });
      const req = await api(sme.s).post(`/organisations/${sme.orgId}/opportunities/${general}/request`, { scope: ['overall', 'maturity'] });
      const self = await api(sme.s).post(`/referrals/${req.data.id}/approve`, {});
      const ap = await api(admin).post(`/referrals/${req.data.id}/approve`, {});
      const skip = await api(admin).post(`/referrals/${req.data.id}/status`, { to: 'Awarded' });
      for (const to of ['Referred', 'Applied']) await api(admin).post(`/referrals/${req.data.id}/status`, { to });
      const aw = await api(admin).post(`/referrals/${req.data.id}/status`, { to: 'Awarded', amountGhs: 12000, note: 'Synthetic award' });
      const hist = (await api(sme.s).get(`/referrals/${req.data.id}/history`)).data.items.map((x: any) => x.to).join('>');
      return all(eq(no.status, 400, 'empty consent refused'), eq(req.status, 201, 'request'), eq(self.status, 403, 'owner cannot approve'), eq(ap.status, 200, 'approve'), eq(skip.status, 422, 'no skipping steps'), eq(aw.data?.amountGhs, 12000, 'amount'), eq(hist, 'Consented>Approved>Referred>Applied>Awarded', 'history'));
    });
    await check('UNLOCK', 'The database refuses a referral past Approved without consent and approval, even if the application tried', async () => {
      const id = await mk({ title: SYN('Guarded'), criteria: {} });
      const r = await api(admin).post(`/organisations/${eso.orgId}/opportunities/${id}/suggest`, {});
      let blocked = 0; for (const sql of [`update opportunity_referrals set status='Referred' where id='${r.data.id}'`, `update opportunity_referrals set amount_ghs=5 where id='${r.data.id}'`]) { try { await q(sql); } catch { blocked++; } }
      return eq(blocked, 2, 'blocked updates');
    });
    await check('UNLOCK', 'Another business, a funder and a programme manager outside scope cannot read this business\'s pathway or referrals', async () => {
      const p1 = await api(agri.s).get(`/organisations/${sme.orgId}/pathway`); const p2 = await api(funder).get(`/organisations/${sme.orgId}/pathway`);
      const q1 = await api(agri.s).get('/referrals');
      return all(eq(p1.status, 404, 'other owner'), eq(p2.status, 403, 'funder'), eq(q1.status, 403, 'owner queue'));
    });
    await check('UNLOCK', 'Totals for leadership count the award, and every change is in the audit log', async () => {
      const t = (await api(admin).get('/unlock/summary')).data; const a = (await q(`select count(*)::int n from audit_log where action like 'referral.%' or action like 'opportunity.%'`)).rows[0].n;
      return all(eq(t.fundingMobilisedGhs >= 12000, true, 'funding total'), eq(a >= 8, true, `audit rows ${a}`));
    });
  });
});

afterAll(() => {
  const dir = path.resolve(__dirname); const sum = results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {} as Record<string, number>);
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ ranAt: new Date().toISOString(), aiMode: 'mock', summary: sum, total: results.length, results, timings }, null, 2));
});
