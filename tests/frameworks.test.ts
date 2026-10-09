import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { answerSheet, api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let admin: Session, pm: Session, consultant: Session, reviewer: Session, owner: Session, orgId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); pm = await makeUser('PROGRAMME_MANAGER'); consultant = await makeUser('EXPERT'); reviewer = await makeUser('REVIEWER');
  const org = await makeOrg(admin); orgId = org.id; owner = await makeUser('OWNER', { orgId });
});

const frameworks = async () => (await api(admin).get("/settings/frameworks")).data as any[];
const baseline = async () => (await frameworks()).find((f) => f.isDefault);

describe('framework versions', () => {
  it('ships three frameworks, with the baseline published and the specialised ones empty', async () => {
    const list = await frameworks();
    expect(list.map((f) => f.code).sort()).toEqual(['AGRIFOOD360', 'ESO360', 'SME360']);
    const b = list.find((f) => f.code === 'SME360');
    expect(b.versions.some((v: any) => v.status === 'Published')).toBe(true);
    for (const code of ['AGRIFOOD360', 'ESO360']) expect(list.find((f) => f.code === code).versions.some((v: any) => v.status === 'Published')).toBe(false);

    const published = b.versions.find((v: any) => v.status === 'Published');
    const details = await api(admin).get(`/settings/frameworks/versions/${published.id}`);
    expect(details.status).toBe(200);
    expect(details.data.structuredAvailable).toBe(true);
    expect(details.data.structured.dimensions.map((d: any) => d.name).sort()).toEqual([...details.data.dimensions].sort());
    expect(details.data.structured.questions).toHaveLength(details.data.questions.length);
  });

  it('lets only an administrator approve, and others at most read', async () => {
    expect((await api(pm).get('/settings/frameworks')).status).toBe(200);
    expect((await api(pm).post('/settings/frameworks/SME360/versions', { fromBank: true })).status).toBe(403);
    expect((await api(consultant).post('/settings/frameworks/SME360/versions', { fromBank: true })).status).toBe(403);
    const d = await api(admin).post('/settings/frameworks/SME360/versions', { fromBank: true });
    expect(d.status).toBe(201);
    const draftRows = await db().select().from(schema.frameworkQuestions).where(eq(schema.frameworkQuestions.frameworkVersionId, d.data.id));
    const draftDimensions = await db().select().from(schema.frameworkDimensions).where(eq(schema.frameworkDimensions.frameworkVersionId, d.data.id));
    expect(draftDimensions).toHaveLength(d.data.dimensions.length);
    expect(draftRows).toHaveLength(d.data.questions.length);
    expect((await api(reviewer).post(`/settings/frameworks/versions/${d.data.id}/publish`, { note: 'try it on' })).status).toBe(403);
    expect((await api(admin).del(`/settings/frameworks/versions/${d.data.id}`)).status).toBe(200);
  });

  it('will not publish a specialised framework until every source is approved', async () => {
    const qs = [{ code: 'AG01', dimension: 'Production', text: 'Do you record yields each season?', weight: 3 }];
    const bad = await api(admin).post('/settings/frameworks/AGRIFOOD360/versions', { questions: qs, dimensions: ['Production'] });
    expect(bad.status).toBe(201);
    const id = bad.data.id;
    expect((await api(admin).post(`/settings/frameworks/versions/${id}/publish`, { note: 'No evidence trail yet' })).status).toBe(422);
    expect((await api(admin).patch(`/settings/frameworks/versions/${id}`, { sources: [{ component: 'Questions', source: 'Placeholder source for test', rationale: 'Test', adaptation: 'None', approval: 'Proposed' }] })).status).toBe(200);
    const withProposed = await api(admin).post(`/settings/frameworks/versions/${id}/publish`, { note: 'Source still proposed' });
    expect(withProposed.status).toBe(422); expect(withProposed.error.message).toMatch(/not yet approved/);
    expect((await api(admin).del(`/settings/frameworks/versions/${id}`)).status).toBe(200);
  });

  it('keeps published versions immutable in the database itself', async () => {
    const b = await baseline();
    const pub = b.versions.find((v: any) => v.status === 'Published');
    await expect(db().update(schema.frameworkVersions).set({ questions: [] }).where(eq(schema.frameworkVersions.id, pub.id))).rejects.toThrow();
    await expect(db().delete(schema.frameworkVersions).where(eq(schema.frameworkVersions.id, pub.id))).rejects.toThrow();
  });

  it('ties a score to the version it was produced under, and editing the bank cannot rewrite it', async () => {
    const c = await api(admin).post('/cases', { orgId });
    expect(c.status).toBe(201);
    const caseId = c.data.id;
    const sub = await api(owner).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet((_c, i) => (i % 4) + 1, 'Self-reported'), uuid: `fw-${uniq()}` });
    expect(sub.status).toBe(201);
    const [score] = await db().select().from(schema.healthScores).where(eq(schema.healthScores.caseId, caseId));
    const [dg] = await db().select().from(schema.diagnostics).where(eq(schema.diagnostics.caseId, caseId));
    expect(score.frameworkVersionId).toBeTruthy(); expect(dg.frameworkVersionId).toBe(score.frameworkVersionId);
    const overall = score.overall;

    // change a weight in the working bank, publish a new baseline version
    const qs = (await api(admin).get('/settings/questions')).data as any[];
    const q = qs.find((x) => x.active); const was = q.weight;
    expect((await api(admin).patch(`/settings/questions/${q.id}`, { weight: was === 5 ? 1 : 5 })).status).toBe(200);
    const d = await api(admin).post('/settings/frameworks/SME360/versions', { fromBank: true, note: 'weight test' });
    expect(d.status).toBe(201);
    const pub = await api(admin).post(`/settings/frameworks/versions/${d.data.id}/publish`, { note: 'Approved for test' });
    expect(pub.status).toBe(200);

    const [after] = await db().select().from(schema.healthScores).where(eq(schema.healthScores.id, score.id));
    expect(after.overall).toBe(overall); expect(after.frameworkVersionId).toBe(score.frameworkVersionId);
    const old = await api(admin).get(`/settings/frameworks/versions/${score.frameworkVersionId}`);
    expect(old.data.status).toBe('Retired');

    // restore the bank and republish so later tests see the original weights
    expect((await api(admin).patch(`/settings/questions/${q.id}`, { weight: was })).status).toBe(200);
    const d2 = await api(admin).post('/settings/frameworks/SME360/versions', { fromBank: true, note: 'restore' });
    expect((await api(admin).post(`/settings/frameworks/versions/${d2.data.id}/publish`, { note: 'Restore original weights' })).status).toBe(200);
  });
});

describe('business health record', () => {
  it('shows scores with the framework version and a reason for change, within scope', async () => {
    const admin2 = await makeUser('ADMIN'); const org = await makeOrg(admin2); const own = await makeUser('OWNER', { orgId: org.id });
    const c = await api(admin2).post('/cases', { orgId: org.id }); const caseId = c.data.id;
    await api(own).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet(2, 'Self-reported'), uuid: `rec-${uniq()}` });
    await api(own).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet(3, 'Self-reported'), uuid: `rec-${uniq()}` });
    const r = await api(admin2).get(`/organisations/${org.id}/record`);
    expect(r.status).toBe(200);
    const sc = r.data.cases[0].scores;
    expect(sc.length).toBe(2); expect(sc[0].framework).toMatch(/^SME360 v\d+/);
    expect(sc[0].change.reason).toMatch(/First score/); expect(sc[1].change.delta).toBeGreaterThan(0);
    expect(r.data.cases[0].diagnostics.length).toBe(2);
    expect((await api(own).get(`/organisations/${org.id}/record`)).status).toBe(200);
    const other = await makeUser('OWNER', { orgId: (await makeOrg(admin2)).id });
    expect((await api(other).get(`/organisations/${org.id}/record`)).status).toBe(404);
    const funder = await makeUser('FUNDER');
    expect((await api(funder).get(`/organisations/${org.id}/record`)).status).toBe(403);
  });
});
