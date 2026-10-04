import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, auditActions, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { progress, valueOf, basisOf } from '@/domain/indicators';

describe('domain: indicator progress', () => {
  const now = new Date('2027-01-15T00:00:00Z');
  const f = { enrolled: 10, scored: 8, rescored: 4, avgScore: 55.5, avgChange: 6.5, improved: 3 };
  it('reads each metric from the facts', () => {
    expect(valueOf('enrolled', f)).toBe(10); expect(valueOf('avg_score', f)).toBe(55.5); expect(valueOf('avg_change', f)).toBe(6.5);
    expect(valueOf('pct_improved', f)).toBe(75); expect(valueOf('pct_improved', { ...f, rescored: 0, improved: 0 })).toBeNull();
    expect(basisOf('avg_score', f)).toBe(8); expect(basisOf('pct_improved', f)).toBe(4);
  });
  it('achieved, in progress, missed and no data', () => {
    expect(progress(60, 50, null, now)).toEqual({ pct: 120, status: 'Achieved' });
    expect(progress(25, 50, '2027-06-30', now)).toEqual({ pct: 50, status: 'In progress' });
    expect(progress(25, 50, '2026-12-31', now).status).toBe('Missed');
    expect(progress(null, 50, null, now)).toEqual({ pct: null, status: 'No data yet' });
    expect(progress(null, 50, '2026-12-31', now).status).toBe('Missed');
    expect(progress(-3, 5, null, now).pct).toBe(0);
  });
});

let admin: Session, pm: Session, pmOther: Session, funder: Session, owner: Session, expert: Session, progId: string, otherProg: string;
const mkProg = async () => (await api(admin).post('/programmes', { name: 'P ' + uniq(), funder: 'F', startDate: '2026-10-01', endDate: '2027-12-31', budgetGhs: 1000 })).data.id as string;
async function scoredCase(programmeId: string, scores: number[]) {
  const org = await makeOrg(admin); const id = (await api(admin).post('/cases', { orgId: org.id })).data.id as string;
  await db().update(schema.cases).set({ programmeId }).where(eq(schema.cases.id, id));
  for (const [i, o] of scores.entries()) {
    const [d] = await db().insert(schema.diagnostics).values({ caseId: id, status: 'Validated', version: i + 1 }).returning();
    await db().insert(schema.healthScores).values({ diagnosticId: d.id, caseId: id, run: i + 1, overall: String(o), maturity: 'Developing', confidenceClass: 'Medium', dimensions: [], evidenceShare: {} });
  }
  return id;
}
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); progId = await mkProg(); otherProg = await mkProg();
  pm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [progId] }); pmOther = await makeUser('PROGRAMME_MANAGER', { programmeIds: [otherProg] });
  funder = await makeUser('FUNDER', { programmeIds: [progId] }); expert = await makeUser('EXPERT');
  owner = await makeUser('OWNER', { orgId: (await makeOrg(admin)).id });
});

describe('programme indicators', () => {
  it('rejects bad input', async () => {
    expect((await api(admin).post(`/programmes/${progId}/indicators`, { name: 'ab', metric: 'enrolled', target: 5 })).status).toBe(400);
    expect((await api(admin).post(`/programmes/${progId}/indicators`, { name: 'Valid name', metric: 'nonsense', target: 5 })).status).toBe(400);
    expect((await api(admin).post(`/programmes/${progId}/indicators`, { name: 'Valid name', metric: 'enrolled', target: 0 })).status).toBe(400);
    expect((await api(admin).post(`/programmes/${progId}/indicators`, { name: 'Valid name', metric: 'pct_improved', target: 150 })).status).toBe(400);
  });
  it('only people who can edit the programme can set targets, and only in their own programme', async () => {
    const body = { name: 'Reach 3 businesses', metric: 'enrolled', target: 3 };
    expect((await api(expert).post(`/programmes/${progId}/indicators`, body)).status).toBe(403);
    expect((await api(owner).post(`/programmes/${progId}/indicators`, body)).status).toBe(403);
    expect((await api(funder).post(`/programmes/${progId}/indicators`, body)).status).toBe(403);
    expect((await api(pmOther).post(`/programmes/${progId}/indicators`, body)).status).toBe(404);
    const ok = await api(pm).post(`/programmes/${progId}/indicators`, body);
    expect(ok.status, JSON.stringify(ok.error)).toBe(201);
    expect(await auditActions(progId)).toContain('indicator.created');
    expect((await api(pm).post(`/programmes/${progId}/indicators`, body)).status).toBe(409);
  });
  it('computes progress from real scores and hides small values from funders', async () => {
    await scoredCase(progId, [40, 52]); await scoredCase(progId, [50]);
    const mk = (name: string, metric: string, target: number) => api(pm).post(`/programmes/${progId}/indicators`, { name, metric, target });
    await mk('Average score goal', 'avg_score', 60); await mk('Improvement goal', 'pct_improved', 50); await mk('Change goal', 'avg_change', 10);
    const rows = (await api(pm).get(`/programmes/${progId}/indicators`)).data as any[];
    const by = Object.fromEntries(rows.map((r) => [r.metric, r]));
    expect(by.enrolled.value).toBe(2); expect(by.enrolled.status).toBe('In progress');
    expect(by.avg_score.value).toBe(51); expect(by.avg_score.pct).toBe(85);
    expect(by.pct_improved.value).toBe(100); expect(by.pct_improved.status).toBe('Achieved');
    expect(by.avg_change.value).toBe(12); expect(by.avg_change.status).toBe('Achieved');
    // Funder: only 2 businesses, below the minimum of 5, so every value is hidden but targets stay visible.
    const fr = (await api(funder).get(`/programmes/${progId}/indicators`)).data as any[];
    expect(fr.length).toBe(rows.length);
    for (const r of fr) { expect(r.hidden).toBe(true); expect(r.value).toBeNull(); expect(r.status).toBe('Hidden'); expect(r.target).toBeGreaterThan(0); }
  });
  it('shows funders the value once enough businesses stand behind it', async () => {
    const p = await mkProg(); const f2 = await makeUser('FUNDER', { programmeIds: [p] }); const m2 = await makeUser('PROGRAMME_MANAGER', { programmeIds: [p] });
    for (let i = 0; i < 5; i++) await scoredCase(p, [40 + i, 50 + i]);
    await api(m2).post(`/programmes/${p}/indicators`, { name: 'Scored goal', metric: 'scored', target: 10 });
    const r = ((await api(f2).get(`/programmes/${p}/indicators`)).data as any[])[0];
    expect(r.hidden).toBe(false); expect(r.value).toBe(5); expect(r.pct).toBe(50);
  });
  it('appears on the programme dashboard and in the CSV export', async () => {
    const d = (await api(pm).get(`/programmes/${progId}/dashboard`)).data;
    expect(d.indicators.length).toBeGreaterThanOrEqual(4);
    const f = (await api(funder).get(`/programmes/${progId}/dashboard`)).data;
    expect(f.indicators.every((x: any) => x.hidden)).toBe(true);
    const csv = await api(admin).get(`/programmes/${progId}/export`);
    expect(csv.text).toContain('Target'); expect(csv.text).toContain('Reach 3 businesses');
  });
  it('can be changed and removed, with an audit trail', async () => {
    const id = (await api(pm).post(`/programmes/${progId}/indicators`, { name: 'Temp goal', metric: 'rescored', target: 2 })).data.id;
    expect((await api(pm).patch(`/indicators/${id}`, { target: 4 })).status).toBe(200);
    expect(((await api(pm).get(`/programmes/${progId}/indicators`)).data as any[]).find((x) => x.id === id).target).toBe(4);
    expect((await api(pm).patch(`/indicators/${id}`, { metric: 'pct_improved', target: 400 })).status).toBe(409);
    expect((await api(pmOther).del(`/indicators/${id}`)).status).toBe(404);
    expect((await api(pm).del(`/indicators/${id}`)).status).toBe(200);
    const acts = await auditActions(progId); expect(acts).toContain('indicator.updated'); expect(acts).toContain('indicator.deleted');
  });
});
