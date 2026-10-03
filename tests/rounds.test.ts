import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, ensureReference, makeUser, makeOrg, api, login, lastEmailTo, tokenFrom, PASSWORD, uniq, type Session } from './helpers';
import { pool } from '@/db/client';

const q = (sql: string, p: unknown[] = []) => pool().query(sql, p);
let admin: Session; let pm: Session; let prog: any;

async function open() {
  for (const p of ['team_invites', 'account']) {
    await q(`update consent_notices set status='Retired' where purpose=$1 and country_code='GH' and status='Published' and version<>962`, [p]);
    await q(`insert into consent_notices (purpose,country_code,version,text,status) values ($1,'GH',962,$2,'Published') on conflict (purpose,country_code,version) do update set status='Published'`, [p, `${p} wording for round tests. Body of the notice.`]);
  }
}
beforeAll(async () => {
  await ensureReference(); admin = await makeUser('ADMIN');
  prog = (await api(admin).post('/programmes', { name: `Programme ${uniq()}`, funder: 'Test Funder', startDate: '2026-01-01', endDate: '2027-01-01', budgetGhs: 100000 })).data;
  await api(admin).patch(`/programmes/${prog.id}`, { status: 'Active' });
  pm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [prog.id] });
});
afterAll(async () => {
  await q(`update consent_notices set status='Retired' where version=962`);
  // The test banks stay as Retired versions: other suites ignore them, and published or retired versions are never deleted.
});

/** A business with an owner, one finance colleague who has accepted, a case, and a small test bank pinned to the round. */
async function world() {
  await open();
  const org = await makeOrg(admin); const owner = await makeUser('OWNER', { orgId: org.id });
  const email = `fin.${uniq()}@example.org`;
  const inv = await api(owner).post('/team/members', { name: 'Ama Mensah', email, jobRole: 'FINANCE', agree: true });
  const memberId = inv.data.id as string;
  await call('POST', '/auth/accept-invite', { body: { token: tokenFrom((await lastEmailTo(email)).body), password: PASSWORD, consent: true } });
  const colleague = await login(email);
  const areas = (await api(owner).get('/team/assignments')).data.areas as any[];
  const fin = areas.find((a) => a.suggested.kind === 'member').code as string;
  const own = areas.find((a) => a.code !== fin).code as string;
  const c = await api(pm).post('/cases', { orgId: org.id, programmeId: prog.id }); expect(c.status, JSON.stringify(c.error)).toBe(201);
  return { org, owner, colleague, memberId, fin, own, caseId: c.data.id as string };
}
/** Replaces the round's framework version with a four-question test bank: two in the finance area (one a gate), two in another. */
async function pinBank(roundId: string, fin: string, own: string) {
  const fw = (await q(`select id from frameworks where is_default=true limit 1`)).rows[0].id;
  const ver = 900000 + Math.floor(Math.random() * 90000); // Retired, so it never counts as a draft or the live version for other tests
  const questions = [
    { code: 'A1', dimension: 'Finance', text: 'Cash book is kept', weight: 5, subDimension: fin, criticality: 'Gate' },
    { code: 'A2', dimension: 'Finance', text: 'Costs are known', weight: 3, subDimension: fin, criticality: 'Core' },
    { code: 'B1', dimension: 'People', text: 'Roles are written', weight: 2, subDimension: own, criticality: 'Standard' },
    { code: 'B2', dimension: 'People', text: 'Staff are paid on time', weight: 4, subDimension: own, criticality: 'Gate' }
  ];
  const v = (await q(`insert into framework_versions (framework_id, version, status, questions, dimensions, meta) values ($1,$2,'Retired',$3,$4,$5) returning id`, [fw, ver, JSON.stringify(questions), JSON.stringify(['Finance', 'People']), JSON.stringify({ subDimensions: [{ code: fin, name: 'Finance area', dimension: 'Finance' }, { code: own, name: 'People area', dimension: 'People' }] })])).rows[0].id;
  await q(`update assessment_rounds set framework_version_id=$1 where id=$2`, [v, roundId]);
  return v as string;
}

describe('team assessment rounds', () => {
  it('opens one round per business, and only the owner opens it', async () => {
    const w = await world();
    const r = await api(w.owner).post(`/cases/${w.caseId}/round`, {}); expect(r.status, JSON.stringify(r.error)).toBe(201);
    expect((await api(w.owner).post(`/cases/${w.caseId}/round`, {})).status).toBe(422);
    expect((await api(w.colleague).post(`/cases/${w.caseId}/round`, {})).status).toBe(403);
    expect((await api(pm).post(`/cases/${w.caseId}/round`, {})).status).toBe(403);
    const other = await world(); // another business cannot reach this case
    expect((await api(other.owner).post(`/cases/${w.caseId}/round`, {})).status).toBe(404);
    expect((await api(other.owner).get(`/cases/${w.caseId}/round`)).status).toBe(404);
  });

  it('shows each person only their own questions, and refuses answers outside them', async () => {
    const w = await world();
    const { id } = (await api(w.owner).post(`/cases/${w.caseId}/round`, {})).data; await pinBank(id, w.fin, w.own);
    await api(w.owner).put(`/team/assignments/${w.fin}`, { memberId: w.memberId });
    const mineC = (await api(w.colleague).get('/me/round')).data.round; expect(mineC.questions.map((x: any) => x.code).sort()).toEqual(['A1', 'A2']);
    const mineO = (await api(w.owner).get('/me/round')).data.round; expect(mineO.questions.map((x: any) => x.code).sort()).toEqual(['B1', 'B2']);
    expect((await api(w.colleague).put(`/me/rounds/${id}/answers`, { answers: { B1: { value: 3 } } })).status).toBe(400);
    expect((await api(w.owner).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 3 } } })).status).toBe(400);
    expect((await api(w.colleague).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 9 } } })).status).toBe(400);
    expect((await api(w.colleague).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 3, evidence: 'Verified' } } })).status).toBe(400); // a colleague cannot claim verification
    const ok = await api(w.colleague).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 3, note: 'Cash book kept weekly' } } }); expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect((await api(w.colleague).get('/me/round')).data.round.answers.A1).toMatchObject({ value: 3, note: 'Cash book kept weekly' });
    expect((await api(w.owner).get('/me/round')).data.round.answers.A1).toBeUndefined(); // the owner's page carries only the owner's questions
    // Another business's colleague gets nothing, and an outsider cannot write.
    const other = await world(); expect((await api(other.colleague).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 1 } } })).status).toBe(404);
    for (const r of ['EXPERT', 'FINANCE'] as const) expect((await api(await makeUser(r)).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 1 } } })).status, r).toBe(403);
  });

  it('refuses to submit until every key question is answered and its area has a named person, then submits through the normal gate', async () => {
    const w = await world();
    const { id } = (await api(w.owner).post(`/cases/${w.caseId}/round`, {})).data; await pinBank(id, w.fin, w.own);
    await api(w.owner).put(`/team/assignments/${w.fin}`, { memberId: w.memberId });
    let view = (await api(w.owner).get(`/cases/${w.caseId}/round`)).data.round;
    expect(view.canSubmit).toBe(false);
    expect(view.blockers.map((b: any) => b.message).join(' ')).toMatch(/confirm who answers/); // the other area is not confirmed
    const s1 = await api(w.owner).post(`/rounds/${id}/submit`, {}); expect(s1.status).toBe(422); expect(s1.error.details?.blockers?.length ?? 0).toBeGreaterThan(0);
    await api(w.owner).put(`/team/assignments/${w.own}`, { memberId: null }); // the owner confirms they answer it
    view = (await api(w.owner).get(`/cases/${w.caseId}/round`)).data.round;
    expect(view.blockers.map((b: any) => b.message).join(' ')).toMatch(/key question/);
    expect((await api(w.colleague).post(`/rounds/${id}/submit`, {})).status).toBe(403); // a colleague cannot submit
    await api(w.colleague).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 3 }, A2: { value: 2 } } });
    await api(w.owner).put(`/me/rounds/${id}/answers`, { answers: { B1: { value: 4 }, B2: { value: 3 } } });
    view = (await api(w.owner).get(`/cases/${w.caseId}/round`)).data.round;
    expect(view.blockers).toEqual([]); expect(view.canSubmit).toBe(true); expect(view.answered).toBe(4);
    const done = await api(w.owner).post(`/rounds/${id}/submit`, {}); expect(done.status, JSON.stringify(done.error)).toBe(201); expect(done.data.accepted).toBe(true);
    // The mode is derived from who answered: the owner and a colleague both did.
    expect((await q(`select assessment_mode m from diagnostics where id=$1`, [done.data.id])).rows[0].m).toBe('hybrid');
    // Who answered each question is kept, and the diagnostic carries its round.
    const rows = (await q(`select r.question_code c, r.answered_by u from responses r where r.diagnostic_id=$1 order by 1`, [done.data.id])).rows;
    expect(rows.map((r) => r.c)).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(rows.filter((r) => r.c.startsWith('A')).every((r) => r.u === w.colleague.userId)).toBe(true);
    expect(rows.filter((r) => r.c.startsWith('B')).every((r) => r.u === w.owner.userId)).toBe(true);
    expect((await q(`select assessment_round_id r from diagnostics where id=$1`, [done.data.id])).rows[0].r).toBe(id);
    expect((await q(`select status, diagnostic_id from assessment_rounds where id=$1`, [id])).rows[0]).toMatchObject({ status: 'Submitted', diagnostic_id: done.data.id });
    expect(done.data.score.overall).toBeGreaterThan(0);
    // Closed: no more answers, no second submission, and the round view is gone.
    expect((await api(w.colleague).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 1 } } })).status).toBe(422);
    expect((await api(w.owner).post(`/rounds/${id}/submit`, {})).status).toBe(422);
    expect((await api(w.owner).get(`/cases/${w.caseId}/round`)).data.round).toBeNull();
  });

  it('keeps an earlier answer in the audit trail when an area is reassigned, and the previous person loses access', async () => {
    const w = await world();
    const { id } = (await api(w.owner).post(`/cases/${w.caseId}/round`, {})).data; await pinBank(id, w.fin, w.own);
    await api(w.owner).put(`/team/assignments/${w.fin}`, { memberId: w.memberId });
    await api(w.colleague).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 1 } } });
    await api(w.owner).put(`/team/assignments/${w.fin}`, { memberId: null });
    expect((await api(w.colleague).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 4 } } })).status).toBe(400);
    expect((await api(w.colleague).get('/me/round')).data.round.questions).toEqual([]);
    expect((await api(w.owner).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 4 } } })).status).toBe(200);
    const a = (await q(`select before from audit_log where action='round.draft_replaced' and entity_id=$1`, [id])).rows;
    expect(a).toHaveLength(1); expect(a[0].before).toMatchObject({ question: 'A1', value: 1, answeredBy: w.colleague.userId });
  });

  it('a failed data quality gate leaves the round open, and a cancelled round frees the business to start another', async () => {
    const w = await world();
    const { id } = (await api(w.owner).post(`/cases/${w.caseId}/round`, {})).data; await pinBank(id, w.fin, w.own);
    await api(w.owner).put(`/team/assignments/${w.fin}`, { memberId: null }); await api(w.owner).put(`/team/assignments/${w.own}`, { memberId: null });
    await api(w.owner).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 3 }, B2: { value: 3 } } }); // gates only: too little completion
    const r = await api(w.owner).post(`/rounds/${id}/submit`, {}); expect([422]).toContain(r.status);
    expect((await q(`select status from assessment_rounds where id=$1`, [id])).rows[0].status).toBe('Collecting');
    expect((await api(w.owner).post(`/rounds/${id}/cancel`, {})).status).toBe(200);
    expect((await api(w.owner).post(`/cases/${w.caseId}/round`, {})).status).toBe(201);
  });

  it('drafts never reach scoring: no responses, evidence or score exist until the owner submits', async () => {
    const w = await world();
    const { id } = (await api(w.owner).post(`/cases/${w.caseId}/round`, {})).data; await pinBank(id, w.fin, w.own);
    await api(w.owner).put(`/me/rounds/${id}/answers`, { answers: { A1: { value: 4 }, A2: { value: 4 }, B1: { value: 4 }, B2: { value: 4 } } });
    expect((await q(`select count(*)::int n from diagnostics where case_id=$1`, [w.caseId])).rows[0].n).toBe(0);
    expect((await q(`select count(*)::int n from health_scores where case_id=$1`, [w.caseId])).rows[0].n).toBe(0);
    expect((await q(`select count(*)::int n from response_drafts where round_id=$1`, [id])).rows[0].n).toBe(4);
  });
});

const pdf = (name = 'statement.pdf') => { const f = new FormData(); f.set('file', new File([new Uint8Array(Buffer.from('%PDF-1.4 test statement'))], name)); return f; };
const upl = (s: Session, id: string, form: FormData) => call('POST', `/me/rounds/${id}/documents`, { cookie: s.cookie, form });

describe('colleague evidence uploads', () => {
  async function setup() {
    const w = await world();
    const { id } = (await api(w.owner).post(`/cases/${w.caseId}/round`, {})).data; await pinBank(id, w.fin, w.own);
    await api(w.owner).put(`/team/assignments/${w.fin}`, { memberId: w.memberId });
    await api(w.owner).put(`/team/assignments/${w.own}`, { memberId: null });
    return { ...w, id };
  }

  it('a colleague sees and downloads only their own uploads; the owner sees all; other businesses see none', async () => {
    const w = await setup();
    const mine = await upl(w.colleague, w.id, pdf()); expect(mine.status, JSON.stringify(mine.error)).toBe(201);
    const ownerDoc = await upl(w.owner, w.id, pdf('licence.pdf')); expect(ownerDoc.status).toBe(201);
    expect((await api(w.colleague).get(`/me/rounds/${w.id}/documents`)).data.map((d: any) => d.code)).toEqual([mine.data.code]);
    expect((await api(w.owner).get(`/me/rounds/${w.id}/documents`)).data.length).toBe(2);
    expect((await api(w.colleague).get(`/me/rounds/${w.id}/documents/${mine.data.id}/download`)).status).toBe(200);
    expect((await api(w.colleague).get(`/me/rounds/${w.id}/documents/${ownerDoc.data.id}/download`)).status).toBe(404);
    const other = await setup();
    expect((await api(other.colleague).get(`/me/rounds/${w.id}/documents`)).status).toBe(404);
    expect((await upl(other.colleague, w.id, pdf())).status).toBe(404);
    expect((await upl(await makeUser('EXPERT'), w.id, pdf())).status).toBe(403);
  });

  it('refuses a wrong file type, a mismatched file, and uploads beyond the daily limit', async () => {
    const w = await setup();
    const bad = new FormData(); bad.set('file', new File([new Uint8Array(Buffer.from('MZ not a pdf'))], 'x.pdf'));
    expect((await upl(w.colleague, w.id, bad)).status).toBe(400);
    const exe = new FormData(); exe.set('file', new File([new Uint8Array(Buffer.from('MZ'))], 'x.exe'));
    expect((await upl(w.colleague, w.id, exe)).status).toBe(400);
    for (let i = 0; i < 20; i++) await q(`insert into documents (org_id,case_id,filename,mime,size,sha256,storage_key,uploaded_by) values ($1,$2,'f.pdf','application/pdf',1,'x','k/'||gen_random_uuid(),$3)`, [w.org.id, w.caseId, w.colleague.userId]);
    expect((await upl(w.colleague, w.id, pdf())).status).toBe(429);
  });

  it('a colleague can mark Document-supported only with their own stored document, never Verified', async () => {
    const w = await setup();
    const mine = (await upl(w.colleague, w.id, pdf())).data; const theirs = (await upl(w.owner, w.id, pdf('o.pdf'))).data;
    const put = (a: any) => api(w.colleague).put(`/me/rounds/${w.id}/answers`, { answers: { A1: a } });
    expect((await put({ value: 3, evidence: 'Document-supported' })).status).toBe(400); // no document
    expect((await put({ value: 3, evidence: 'Document-supported', ref: theirs.code })).status).toBe(400); // someone else's file
    expect((await put({ value: 3, evidence: 'Document-supported', ref: 'doc-nope' })).status).toBe(400);
    expect((await put({ value: 3, evidence: 'Verified', ref: mine.code })).status).toBe(400);
    expect((await put({ value: 3, evidence: 'Document-supported', ref: mine.code })).status).toBe(200);
    expect((await api(w.colleague).get('/me/round')).data.round.answers.A1).toMatchObject({ evidence: 'Document-supported', ref: mine.code });
    // A quarantined document cannot be attached.
    await q(`update documents set status='Quarantined' where id=$1`, [mine.id]);
    expect((await put({ value: 3, evidence: 'Document-supported', ref: mine.code })).status).toBe(400);
    // Another business's document cannot be attached by this business's owner.
    const o2 = await setup(); const foreign = (await upl(o2.owner, o2.id, pdf('f.pdf'))).data;
    expect((await api(w.owner).put(`/me/rounds/${w.id}/answers`, { answers: { B1: { value: 2, evidence: 'Document-supported', ref: foreign.code } } })).status).toBe(400);
  });

  it('the owner sees attached documents, can detach one, and the submitted evidence carries the document', async () => {
    const w = await setup();
    const doc = (await upl(w.colleague, w.id, pdf())).data;
    await api(w.colleague).put(`/me/rounds/${w.id}/answers`, { answers: { A1: { value: 3, evidence: 'Document-supported', ref: doc.code }, A2: { value: 2, evidence: 'Document-supported', ref: doc.code } } });
    const view = (await api(w.owner).get(`/cases/${w.caseId}/round`)).data.round;
    expect(view.uploads.map((u: any) => u.question).sort()).toEqual(['A1', 'A2']); expect(view.uploads[0]).toMatchObject({ filename: 'statement.pdf', document: doc.code });
    expect((await api(w.colleague).post(`/rounds/${w.id}/answers/A2/detach`, {})).status).toBe(403);
    expect((await api(w.owner).post(`/rounds/${w.id}/answers/A2/detach`, {})).status).toBe(200);
    expect((await api(w.owner).post(`/rounds/${w.id}/answers/A2/detach`, {})).status).toBe(422); // nothing left to detach
    expect((await api(w.colleague).get('/me/round')).data.round.answers.A2).toMatchObject({ evidence: 'Self-reported', ref: null });
    await api(w.owner).put(`/me/rounds/${w.id}/answers`, { answers: { B1: { value: 4 }, B2: { value: 3 } } });
    const done = await api(w.owner).post(`/rounds/${w.id}/submit`, {}); expect(done.status, JSON.stringify(done.error)).toBe(201);
    const rows = (await q(`select question_code c, evidence_class e, evidence_ref r from responses where diagnostic_id=$1 order by 1`, [done.data.id])).rows;
    expect(rows.find((r) => r.c === 'A1')).toMatchObject({ e: 'Document-supported', r: doc.code });
    expect(rows.find((r) => r.c === 'A2')).toMatchObject({ e: 'Self-reported', r: null });
  });
});
