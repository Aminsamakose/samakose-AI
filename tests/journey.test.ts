import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { answerSheet, api, auditActions, call, drain, ensureReference, jobOf, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

type World = Awaited<ReturnType<typeof build>>;
let W: World;

async function build() {
  const admin = await makeUser('ADMIN');
  const prog = (await api(admin).post('/programmes', { name: `Programme ${uniq()}`, funder: 'Test Funder', startDate: '2026-01-01', endDate: '2027-01-01', budgetGhs: 100000 })).data;
  await api(admin).patch(`/programmes/${prog.id}`, { status: 'Active' });
  const cohort = (await api(admin).post(`/programmes/${prog.id}/cohorts`, { name: 'Cohort A', capacity: 40 })).data;
  const pm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [prog.id] });
  const consultant = await makeUser('CONSULTANT'), reviewer = await makeUser('REVIEWER'), coach = await makeUser('COACH');
  const finance = await makeUser('FINANCE');
  const funder = await makeUser('FUNDER', { programmeIds: [prog.id] });
  const org = await makeOrg(admin);
  const owner = await makeUser('OWNER', { orgId: org.id });
  return { admin, prog, cohort, pm, consultant, reviewer, coach, finance, funder, org, owner };
}
const poll = async (s: Session, jobId: string) => { await drain(); const r = await api(s).get(`/jobs/${jobId}`); return r.data; };

beforeAll(async () => { await ensureReference(); W = await build(); });

describe('the full case lifecycle', () => {
  let caseId = '', caseCode = '', dgnId = '', rxId = '';
  const S = () => W;

  it('opens a case and assigns people, with the four-eyes rule on assignment', async () => {
    const r = await api(S().pm).post('/cases', { orgId: S().org.id, programmeId: S().prog.id, cohortId: S().cohort.id });
    expect(r.status).toBe(201); caseId = r.data.id; caseCode = r.data.code;
    expect(r.data.status).toBe('PROFILED');
    expect(caseCode).toMatch(/^CASE-\d{4}-\d{6}$/);
    const same = await api(S().admin).post(`/cases/${caseId}/assign`, { consultantId: S().consultant.userId, reviewerId: S().consultant.userId });
    expect(same.status).toBe(400);
    const wrongRole = await api(S().admin).post(`/cases/${caseId}/assign`, { coachId: S().reviewer.userId });
    expect(wrongRole.status).toBe(400);
    const ok = await api(S().admin).post(`/cases/${caseId}/assign`, { consultantId: S().consultant.userId, coachId: S().coach.userId, reviewerId: S().reviewer.userId });
    expect(ok.status).toBe(200);
  });

  it('refuses a second open case for the same organisation in the same programme', async () => {
    const r = await api(S().admin).post('/cases', { orgId: S().org.id, programmeId: S().prog.id });
    expect(r.status).toBe(409);
  });

  it('rejects a diagnostic below the quality gate and does not save it', async () => {
    const partial = await answerSheet(2); for (const k of Object.keys(partial).slice(0, 10)) delete partial[k];
    const r = await api(S().owner).post(`/cases/${caseId}/diagnostics`, { answers: partial });
    expect(r.status).toBe(422); expect(r.error.code).toBe('data_quality'); expect(r.error.details.problems.join()).toMatch(/Completion/);
    const list = await api(S().consultant).get(`/cases/${caseId}/diagnostics`);
    expect(list.data).toHaveLength(0);
    const bad = await answerSheet(2); bad.Q01 = 9;
    expect((await api(S().owner).post(`/cases/${caseId}/diagnostics/validate`, { answers: bad })).data.ok).toBe(false);
  });

  it('stops an owner claiming verified evidence or a document they never uploaded', async () => {
    const r1 = await api(S().owner).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet(3, 'Verified') });
    expect(r1.status).toBe(400); expect(Object.keys(r1.error.details).length).toBeGreaterThan(0);
    const r2 = await api(S().owner).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet(3, 'Document-supported') });
    expect(r2.status).toBe(400);
  });

  it('accepts a good diagnostic, scores it, and moves the case to DIAGNOSED', async () => {
    const answers = await answerSheet((_c, i) => (i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 3), 'Self-reported');
    const r = await api(S().owner).post(`/cases/${caseId}/diagnostics`, { answers, uuid: `web-${uniq()}` });
    expect(r.status).toBe(201); expect(r.data.accepted).toBe(true);
    expect(r.data.score.overall).toBeGreaterThan(0); expect(r.data.score.overall).toBeLessThan(100);
    expect(r.data.caseStatus).toBe('DIAGNOSED');
    const c = await api(S().consultant).get(`/cases/${caseId}`);
    expect(c.data.status).toBe('DIAGNOSED'); expect(c.data.score.dimensions).toHaveLength(6);
    expect(c.data.score.confidenceClass).toBe('Low'); // all self-reported
    expect(await api(S().owner).get(`/cases/${caseId}/scores`)).toMatchObject({ status: 200 });
  });

  it('versions the diagnostic on resubmission and blocks a duplicate submission id', async () => {
    const answers = await answerSheet(2, 'Self-reported');
    const id = `dup-${uniq()}`;
    const a = await api(S().owner).post(`/cases/${caseId}/diagnostics`, { answers, uuid: id });
    expect(a.status).toBe(201); expect(a.data.version).toBe(2);
    const b = await api(S().owner).post(`/cases/${caseId}/diagnostics`, { answers, uuid: id });
    expect(b.status).toBe(422);
  });

  it('shows the owner progress but never internal workings', async () => {
    const c = await api(S().owner).get(`/cases/${caseId}`);
    expect(c.data.facts).toBeUndefined();
    expect((await api(S().owner).get(`/cases/${caseId}/diagnoses`)).status).toBe(403);
    expect((await api(S().owner).get(`/cases/${caseId}/risks`)).status).toBe(403);
    const sc = await api(S().owner).get(`/cases/${caseId}/scores`);
    expect(sc.data.answers).toEqual([]);
  });

  it('lets the consultant verify evidence, which changes the score and confidence', async () => {
    const before = (await api(S().consultant).get(`/cases/${caseId}/scores`)).data;
    const ev = (await api(S().consultant).get(`/cases/${caseId}/evidence`)).data;
    expect(ev.length).toBeGreaterThan(10);
    expect((await api(S().admin).patch(`/evidence/${ev[0].id}`, { class: 'Verified' })).status).toBe(403);
    for (const e of ev.slice(0, 12)) expect((await api(S().consultant).patch(`/evidence/${e.id}`, { class: 'Verified' })).status).toBe(200);
    const after = (await api(S().consultant).get(`/cases/${caseId}/scores`)).data;
    expect(after.history.length).toBeGreaterThan(before.history.length);
    expect(after.latest.overall).toBeGreaterThanOrEqual(before.latest.overall);
    expect(['Medium', 'High']).toContain(after.latest.confidenceClass);
  });

  it('drafts a diagnosis in the background, and validates what AI wrote', async () => {
    const g = await api(S().consultant).post(`/cases/${caseId}/diagnoses/generate`);
    expect(g.status).toBe(202); expect(g.data.jobId).toBeTruthy();
    expect((await api(S().consultant).post(`/cases/${caseId}/diagnoses/generate`)).status).toBe(409); // already running
    const j = await poll(S().consultant, g.data.jobId);
    expect(j.status).toBe('done');
    const list = (await api(S().consultant).get(`/cases/${caseId}/diagnoses`)).data;
    expect(list).toHaveLength(1); expect(list[0].status).toBe('Draft'); expect(list[0].aiDrafted).toBe(true);
    dgnId = list[0].id;
    const risks = (await api(S().consultant).get(`/cases/${caseId}/risks`)).data;
    expect(risks.length).toBeGreaterThan(0);
    const req = await db().select().from(schema.aiRequests).where(eq(schema.aiRequests.caseId, caseId));
    expect(req[0].ok).toBe(true); expect(req[0].model).toBe('mock');
  });

  it('does not let a prescription be drafted before the diagnosis is reviewed', async () => {
    expect((await api(S().consultant).post(`/cases/${caseId}/prescriptions/generate`)).status).toBe(422);
  });

  it('versions a revised diagnosis and only the consultant on the case reviews it', async () => {
    const ev = (await api(S().consultant).get(`/cases/${caseId}/evidence`)).data;
    const rev = await api(S().consultant).post(`/diagnoses/${dgnId}/revise`, { summary: 'Revised summary: cash discipline and records are the two gaps holding this business back.', rootCauses: [{ cause: 'No weekly cash routine', evidence_ids: [ev[0].code] }], priority: 'High', risks: [{ text: 'Cash surprises', severity: 'Medium' }] });
    expect(rev.status).toBe(201);
    expect((await api(S().consultant).post(`/diagnoses/${dgnId}/review`, { decision: 'Reviewed' })).status).toBe(409); // old version
    const bad = await api(S().consultant).post(`/cases/${caseId}/diagnoses`, { summary: 'x'.repeat(30), rootCauses: [{ cause: 'ok', evidence_ids: ['EVD-9999-000000'] }], priority: 'High', risks: [] });
    expect(bad.status).toBe(400);
    dgnId = rev.data.id;
    expect((await api(S().reviewer).post(`/diagnoses/${dgnId}/review`, { decision: 'Reviewed' })).status).toBe(403);
    const ok = await api(S().consultant).post(`/diagnoses/${dgnId}/review`, { decision: 'Reviewed', note: 'Agreed with the evidence' });
    expect(ok.status).toBe(200); expect(ok.data.caseStatus).toBe('PRESCRIBED');
  });

  it('drafts a prescription from the approved library and the consultant submits it', async () => {
    const g = await api(S().consultant).post(`/cases/${caseId}/prescriptions/generate`);
    expect(g.status).toBe(202);
    expect((await poll(S().consultant, g.data.jobId)).status).toBe('done');
    const list = (await api(S().consultant).get(`/cases/${caseId}/prescriptions`)).data;
    expect(list[0].status).toBe('DRAFT'); expect(list[0].items[0].title).toBeTruthy();
    rxId = list[0].id;
    const lib = (await api(S().admin).get('/settings/library')).data.map((l: any) => l.code);
    for (const it of list[0].items) expect(lib).toContain(it.library_id);
    expect((await api(S().reviewer).post(`/prescriptions/${rxId}/review`, { decision: 'APPROVED' })).status).toBe(422); // not submitted yet
    const sub = await api(S().consultant).post(`/prescriptions/${rxId}/submit`);
    expect(sub.status).toBe(200);
    expect((await api(S().consultant).get(`/cases/${caseId}`)).data.status).toBe('APPROVAL');
  });

  it('enforces four-eyes: admin, consultant, owner cannot approve; the reviewer can, with a reason to return', async () => {
    for (const s of [S().admin, S().consultant, S().owner, S().coach]) expect((await api(s).post(`/prescriptions/${rxId}/review`, { decision: 'APPROVED' })).status).toBe(403);
    const otherReviewer = await makeUser('REVIEWER');
    expect((await api(otherReviewer).post(`/prescriptions/${rxId}/review`, { decision: 'APPROVED' })).status).toBe(404); // outside their scope
    expect((await api(S().reviewer).post(`/prescriptions/${rxId}/review`, { decision: 'RETURNED' })).status).toBe(400); // needs reason
    const ret = await api(S().reviewer).post(`/prescriptions/${rxId}/review`, { decision: 'RETURNED', reason: 'Deadlines are too tight for a rainy season' });
    expect(ret.status).toBe(200);
    const q = (await api(S().consultant).get('/reviews/queue')).data;
    expect(q.returned).toHaveLength(1);
    const rev = await api(S().consultant).post(`/prescriptions/${rxId}/revise`, { items: (await api(S().consultant).get(`/cases/${caseId}/prescriptions`)).data[0].items.map((i: any) => ({ library_id: i.library_id, actions: i.actions })) });
    expect(rev.status).toBe(201); rxId = rev.data.id;
    expect((await api(S().consultant).post(`/prescriptions/${rxId}/submit`)).status).toBe(200);
    expect((await api(S().reviewer).get('/reviews/queue')).data.prescriptions).toHaveLength(1);
    const ok = await api(S().reviewer).post(`/prescriptions/${rxId}/review`, { decision: 'APPROVED', reason: 'Approved' });
    expect(ok.status).toBe(200); expect(ok.data.caseStatus).toBe('IN EXECUTION');
    expect((await api(S().reviewer).post(`/prescriptions/${rxId}/review`, { decision: 'APPROVED' })).status).toBe(422); // already decided
  });

  it('turns the approved prescription into interventions, actions with owners and dates, and KPIs', async () => {
    const acts = (await api(S().consultant).get(`/actions?caseId=${caseId}&pageSize=100`)).data;
    expect(acts.total).toBeGreaterThan(2);
    const today = new Date().toISOString().slice(0, 10);
    for (const a of acts.items) { expect(a.dueDate > today).toBe(true); expect(a.assigneeId).toBeTruthy(); }
    expect(acts.items.some((a: any) => a.ownerRole === 'OWNER' && a.assigneeId === S().owner.userId)).toBe(true);
    expect(acts.items.some((a: any) => a.ownerRole === 'COACH' && a.assigneeId === S().coach.userId)).toBe(true);
    expect((await api(S().consultant).get(`/cases/${caseId}/kpis`)).data.length).toBeGreaterThan(0);
    expect((await api(S().owner).get(`/cases/${caseId}/prescriptions`)).data.every((p: any) => p.status === 'APPROVED')).toBe(true);
  });

  it('lets the owner work their own actions, needing a note to finish, and only theirs', async () => {
    const acts = (await api(S().owner).get(`/actions?caseId=${caseId}&pageSize=100`)).data.items;
    const mine = acts.find((a: any) => a.ownerRole === 'OWNER'), coachs = acts.find((a: any) => a.ownerRole === 'COACH');
    expect((await api(S().owner).patch(`/actions/${coachs.id}`, { status: 'In progress' })).status).toBe(403);
    expect((await api(S().owner).patch(`/actions/${mine.id}`, { status: 'Done' })).status).toBe(400); // no evidence note
    expect((await api(S().owner).patch(`/actions/${mine.id}`, { status: 'In progress' })).status).toBe(200);
    expect((await api(S().consultant).get(`/cases/${caseId}`)).data.status).toBe('COACHING');
    expect((await api(S().owner).patch(`/actions/${mine.id}`, { status: 'Done', evidenceNote: 'Cash book started, photo shared' })).status).toBe(200);
    expect((await api(S().owner).patch(`/actions/${mine.id}`, { status: 'Open' })).status).toBe(422); // done is final
    expect((await api(S().owner).patch(`/actions/${mine.id}`, { dueDate: '2030-01-01' })).status).toBe(403);
  });

  it('moves to MONITORING after three held sessions, and needs notes to hold one', async () => {
    const when = new Date(Date.now() + 86400_000).toISOString();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) { const r = await api(S().coach).post(`/cases/${caseId}/sessions`, { scheduledAt: when }); expect(r.status).toBe(201); ids.push(r.data.id); }
    expect((await api(S().coach).post(`/cases/${caseId}/sessions`, { scheduledAt: '2020-01-01T10:00:00Z' })).status).toBe(400);
    const b = await api(S().coach).post(`/sessions/${ids[0]}/brief`); expect(b.status).toBe(202);
    await drain();
    expect((await api(S().coach).get(`/sessions?caseId=${caseId}`)).data.find((s: any) => s.id === ids[0]).brief).toMatch(/Questions to ask/);
    expect((await api(S().owner).get(`/sessions?caseId=${caseId}`)).data.every((s: any) => s.brief === null)).toBe(true);
    expect((await api(S().coach).patch(`/sessions/${ids[0]}`, { status: 'Held' })).status).toBe(400);
    for (let i = 0; i < 3; i++) expect((await api(S().coach).patch(`/sessions/${ids[i]}`, { status: 'Held', notes: `Session ${i + 1}: reviewed cash book and agreed next steps` })).status).toBe(200);
    expect((await api(S().consultant).get(`/cases/${caseId}`)).data.status).toBe('MONITORING');
  });

  it('records KPI readings that cannot be edited, with owner readings forced to self-reported', async () => {
    const k = (await api(S().consultant).get(`/cases/${caseId}/kpis`)).data[0];
    await api(S().consultant).patch(`/kpis/${k.id}`, { baseline: 10, target: 50, unit: 'weeks' });
    expect((await api(S().owner).post(`/kpis/${k.id}/readings`, { value: 30, readingDate: new Date().toISOString().slice(0, 10), sourceClass: 'Verified' })).status).toBe(201);
    expect((await api(S().owner).post(`/kpis/${k.id}/readings`, { value: 30, readingDate: '2099-01-01' })).status).toBe(400);
    const after = (await api(S().consultant).get(`/cases/${caseId}/kpis`)).data[0];
    expect(after.latest.sourceClass).toBe('Self-reported'); expect(after.progress).toBeCloseTo(0.5);
    await expect(db().update(schema.kpiReadings).set({ value: '1' }).where(eq(schema.kpiReadings.kpiId, k.id))).rejects.toThrow();
  });

  it('confirms manual steps only with the conditions met, and never lets an owner move a case', async () => {
    expect((await api(S().owner).post(`/cases/${caseId}/transition`, { to: 'MIDLINE' })).status).toBe(403);
    expect((await api(S().consultant).post(`/cases/${caseId}/transition`, { to: 'GRADUATED' })).status).toBe(422);
    expect((await api(S().consultant).post(`/cases/${caseId}/transition`, { to: 'COACHING' })).status).toBe(422); // automatic only
    expect((await api(S().consultant).post(`/cases/${caseId}/transition`, { to: 'MIDLINE', reason: 'Midline date reached' })).status).toBe(200);
    expect((await api(S().consultant).post(`/cases/${caseId}/transition`, { to: 'ENDLINE' })).status).toBe(200);
    expect((await api(S().consultant).post(`/cases/${caseId}/transition`, { to: 'FOLLOW-UP' })).status).toBe(403); // endline approval
    expect((await api(S().pm).post(`/cases/${caseId}/transition`, { to: 'FOLLOW-UP' })).status).toBe(200);
  });

  it('drafts a report; only the case reviewer releases it; the owner sees it only once released', async () => {
    const g = await api(S().consultant).post(`/cases/${caseId}/reports/generate`); expect(g.status).toBe(202);
    await drain();
    const list = (await api(S().consultant).get(`/cases/${caseId}/reports`)).data;
    expect(list).toHaveLength(1); const id = list[0].id;
    expect((await api(S().owner).get(`/cases/${caseId}/reports`)).data).toHaveLength(0);
    expect((await api(S().owner).get(`/reports/${id}`)).status).toBe(404);
    const full = (await api(S().consultant).get(`/reports/${id}`)).data;
    expect(full.content.length).toBeGreaterThan(3); expect(full.basis.verified + full.basis.unverified).toBe(100);
    expect((await api(S().consultant).post(`/reports/${id}/release`)).status).toBe(403);
    expect((await api(S().reviewer).post(`/reports/${id}/return`, { reason: 'ok' })).status).toBe(400);
    expect((await api(S().reviewer).post(`/reports/${id}/release`)).status).toBe(200);
    expect((await api(S().owner).get(`/reports/${id}`)).status).toBe(200);
    expect((await api(S().consultant).patch(`/reports/${id}`, { title: 'Changed after release' })).status).toBe(422);
    expect((await api(S().reviewer).post(`/reports/${id}/release`)).status).toBe(422);
  });

  it('leaves a complete audit trail and activity feed, and secrets never appear in it', async () => {
    const acts = (await api(S().admin).get(`/audit?caseId=${caseId}&pageSize=100`)).data;
    const names = acts.items.map((a: any) => a.action);
    for (const n of ['case.created', 'case.assigned', 'diagnostic.submitted', 'score.computed', 'diagnosis.reviewed', 'prescription.approved', 'prescription.returned', 'action.updated', 'session.updated', 'report.released']) expect(names).toContain(n);
    expect(names.filter((n: string) => n === 'case.state').length).toBeGreaterThanOrEqual(9);
    expect(JSON.stringify(acts)).not.toMatch(/passwordHash|password_hash|mfaSecret/);
    const feed = (await api(S().owner).get(`/cases/${caseId}/activity`)).data;
    expect(feed.length).toBeGreaterThan(3); expect(feed.every((f: any) => f.actor === null && f.detail === null)).toBe(true);
    expect((await api(S().owner).get('/audit')).status).toBe(403);
    const ev = await db().select().from(schema.events).where(eq(schema.events.caseId, caseId));
    for (const t of ['DiagnosticCompleted', 'HealthScoreChanged', 'PrescriptionApproved', 'ActionCompleted', 'CoachingCompleted', 'RiskDetected']) expect(ev.map((e) => e.type)).toContain(t);
    const n = (await api(S().consultant).get('/notifications')).data;
    expect(n.items.length).toBeGreaterThan(0);
    const read = await api(S().consultant).post(`/notifications/${n.items[0].id}/read`); expect(read.status).toBe(200);
    expect((await api(S().reviewer).post(`/notifications/${n.items[0].id}/read`)).status).toBe(404); // someone else's
    expect(await auditActions(caseId)).toContain('case.created');
  });

  it('shows a funder aggregates only, hiding groups below the minimum size', async () => {
    const d = (await api(S().funder).get(`/programmes/${S().prog.id}/dashboard`)).data;
    expect(d.suppressed).toBe(true); expect(d.total).toBeNull(); // one business is below 5
    expect(d.byState).toEqual([]); expect(JSON.stringify(d)).not.toMatch(/Org |consultant|@/);
    const staff = (await api(S().pm).get(`/programmes/${S().prog.id}/dashboard`)).data;
    expect(staff.total).toBe(1); expect(staff.byState.length).toBeGreaterThan(0);
    const pg = (await api(S().funder).get(`/programmes/${S().prog.id}`)).data;
    expect(pg.caseCount === null || pg.caseCount >= 5).toBe(true);
    expect(pg.cohorts.every((c: any) => c.enrolled === null || c.enrolled >= 5)).toBe(true);
    const pl = (await api(S().funder).get('/programmes')).data.items.find((x: any) => x.id === S().prog.id);
    expect(pl.caseCount === null || pl.caseCount >= 5).toBe(true);
    expect((await api(S().funder).get('/cases')).status).toBe(403);
    expect((await api(S().funder).get(`/cases/${caseId}`)).status).toBe(403);
    const csv = await call('GET', `/programmes/${S().prog.id}/export`, { cookie: S().funder.cookie });
    expect(csv.status).toBe(200); expect(csv.text).not.toMatch(/Org /);
  });

  it('gives each role a dashboard with real numbers', async () => {
    for (const [s, kind] of [[S().admin, 'management'], [S().pm, 'management'], [S().consultant, 'consultant'], [S().reviewer, 'reviewer'], [S().coach, 'coach'], [S().finance, 'finance'], [S().owner, 'owner'], [S().funder, 'funder']] as const) {
      const r = await api(s).get('/dashboard'); expect(r.status, kind).toBe(200); expect(r.data.kind).toBe(kind);
    }
    const o = (await api(S().owner).get('/dashboard')).data;
    expect(o.case.code).toBe(caseCode); expect(o.dimensions).toHaveLength(6); expect(o.history.length).toBeGreaterThan(1); expect(o.reports).toHaveLength(1);
    const m = (await api(S().admin).get('/dashboard')).data;
    expect(m.totals.cases).toBeGreaterThan(0); expect(m.byState.length).toBeGreaterThan(0);
    expect((await api(S().pm).get('/dashboard')).data.finance).toBeNull();
  });
});

describe('cases and organisations lists', () => {
  it('search, filter, sort, paginate and export cases within scope', async () => {
    const r = await api(W.admin).get(`/cases?programmeId=${W.prog.id}&pageSize=5&sort=code&dir=asc`);
    expect(r.status).toBe(200); expect(r.data.items[0].orgName).toBeTruthy(); expect(r.data.items[0]).toHaveProperty('score');
    expect((await api(W.admin).get('/cases?q=zzzznomatch')).data.total).toBe(0);
    expect((await api(W.admin).get('/cases?pageSize=0')).status).toBe(400);
    expect((await api(W.admin).get('/cases?page=abc')).status).toBe(400);
    const csv = await call('GET', '/cases?format=csv', { cookie: W.admin.cookie }); expect(csv.text.split('\r\n')[0]).toContain('Organisation');
    expect((await call('GET', '/cases?format=csv', { cookie: W.reviewer.cookie })).status).toBe(403); // reviewers cannot export
  });
  it('validates organisations, requires consent and blocks duplicates', async () => {
    expect((await api(W.admin).post('/organisations', { name: 'X' })).status).toBe(400);
    expect((await api(W.admin).post('/organisations', { name: 'No Consent Ltd', consent: false, consentBy: 'A B' })).status).toBe(400);
    const name = `Dup Org ${uniq()}`;
    const a = await api(W.admin).post('/organisations', { name, region: 'Northern', consent: true, consentBy: 'Owner A' });
    expect(a.status).toBe(201);
    expect((await api(W.admin).post('/organisations', { name: name.toUpperCase(), region: 'Northern', consent: true, consentBy: 'Owner A' })).status).toBe(400);
    expect((await api(W.admin).post('/organisations', { name, region: 'Ashanti', consent: true, consentBy: 'Owner A' })).status).toBe(201);
    expect((await api(W.owner).patch(`/organisations/${W.org.id}`, { name: 'Renamed' })).status).toBe(403);
    expect((await api(W.owner).patch(`/organisations/${W.org.id}`, { contactPhone: '0244000000' })).status).toBe(200);
  });
  it('archives an organisation only when no case is open, and hides it afterwards', async () => {
    const org = await makeOrg(W.admin);
    const c = await api(W.admin).post('/cases', { orgId: org.id });
    expect((await api(W.admin).del(`/organisations/${org.id}`)).status).toBe(409);
    await db().update(schema.cases).set({ status: 'GRADUATED' }).where(eq(schema.cases.id, c.data.id));
    expect((await api(W.admin).del(`/organisations/${org.id}`)).status).toBe(200);
    expect((await api(W.admin).get(`/organisations/${org.id}`)).status).toBe(404);
  });
  it('rejects malformed ids as not found, never as a server error', async () => {
    expect((await api(W.admin).get('/cases/not-a-uuid')).status).toBe(404);
    expect((await api(W.admin).get('/cases/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});
export { jobOf };
