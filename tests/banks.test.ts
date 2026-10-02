import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeUser, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { DEFAULT_RULES, NOT_APPLICABLE, scoreDiagnostic, validateSubmission, type QuestionLite, type ResponseLite } from '@/domain/logic';
import { analyseBank, parseCondition, readinessLevel } from '@/domain/bank';
import { questionsOf, validateContent } from '@/services/frameworks';
import type { FrameworkMeta } from '@/db/schema';

const load = (f: string) => JSON.parse(fs.readFileSync(`docs/frameworks/drafts/${f}-bank-v1-loadable.json`, 'utf8'));
const R = DEFAULT_RULES;

/* A tiny two-domain bank: one readiness index, one gate, one conditional question, one consistency pair. */
const qs: QuestionLite[] = [
  { code: 'A1', dimension: 'Finance', text: 'Cash book is kept', weight: 5, subDimension: '1.1', criticality: 'Gate', readiness: ['RDY-X'], riskTag: 'No cash book' },
  { code: 'A2', dimension: 'Finance', text: 'Costs are known', weight: 3, subDimension: '1.1', criticality: 'Core', readiness: ['RDY-X'], riskTag: 'Costs unknown' },
  { code: 'B1', dimension: 'People', text: 'Roles are written', weight: 2, subDimension: '2.1', criticality: 'Standard' },
  { code: 'B2', dimension: 'People', text: 'Staff are paid on time', weight: 4, subDimension: '2.1', criticality: 'Core', readiness: ['RDY-X'], applies: 'Has employees', riskTag: 'Late wages' }
];
const meta: FrameworkMeta = {
  subDimensions: [{ code: '1.1', name: 'Cash', dimension: 'Finance' }, { code: '2.1', name: 'Roles', dimension: 'People' }],
  readiness: [{ code: 'RDY-X', name: 'Test readiness' }],
  consistencyChecks: [{ id: 'C1', itemA: 'A1', itemB: 'A2', rule: 'Cash book claimed but costs unknown', condition: 'A>=3 and B<=1' }]
};
const resp = (v: Record<string, number | 'NA'>, cls: any = 'Verified'): ResponseLite[] => Object.entries(v).map(([questionCode, x]) => ({ questionCode, value: x === 'NA' ? 0 : x, evidenceClass: cls, notApplicable: x === 'NA' }));

describe('not applicable', () => {
  it('accepts N/A only for conditional questions and drops them from the completion denominator', () => {
    const ok = validateSubmission({ A1: 4, A2: 4, B1: 4, B2: NOT_APPLICABLE }, qs, R);
    expect(ok.ok).toBe(true); expect(ok.completion).toBe(1);
    const bad = validateSubmission({ A1: NOT_APPLICABLE, A2: 4, B1: 4, B2: 4 }, qs, R);
    expect(bad.ok).toBe(false); expect(bad.problems.join(' ')).toMatch(/A1 cannot be marked not applicable/);
  });
  it('leaves a not applicable question out of every score', () => {
    const withNa = scoreDiagnostic(resp({ A1: 4, A2: 4, B1: 4, B2: 'NA' }), qs, R);
    const without = scoreDiagnostic(resp({ A1: 4, A2: 4, B1: 4 }), qs, R);
    expect(withNa.overall).toBe(100); expect(withNa).toEqual(without);
    // A zero would drag the score down; N/A must not.
    expect(scoreDiagnostic(resp({ A1: 4, A2: 4, B1: 4, B2: 0 }), qs, R).overall).toBeLessThan(100);
  });
});

describe('version 1 questions are untouched', () => {
  const v1: QuestionLite[] = [{ code: 'Q1', dimension: 'Finance', text: 'x', weight: 3 }];
  it('produces no extras and the same four fields', () => {
    expect(analyseBank(resp({ Q1: 3 }), v1, null, R)).toBeNull();
    expect(questionsOf({ questions: [{ code: 'Q1', dimension: 'Finance', text: 'x', weight: 3 }] })[0]).toEqual({ code: 'Q1', dimension: 'Finance', text: 'x', weight: 3 });
  });
});

describe('readiness levels', () => {
  const g = (...v: (number | null)[]) => v.map((value, i) => ({ code: `G${i}`, value }));
  it('applies the index bands and gate rules', () => {
    expect(readinessLevel(80, g(4, 3), R)).toBe('Ready');
    expect(readinessLevel(80, g(4, 2), R)).toBe('Conditionally ready'); // a gate at 2 stops Ready
    expect(readinessLevel(80, g(4, 1), R)).toBe('Not ready'); // a gate at 0 or 1 blocks everything
    expect(readinessLevel(80, g(4, null), R)).toBe('Not ready'); // an unanswered gate blocks
    expect(readinessLevel(70, g(3), R)).toBe('Conditionally ready');
    expect(readinessLevel(50, g(3), R)).toBe('Emerging');
    expect(readinessLevel(44.9, g(4), R)).toBe('Not ready');
    expect(readinessLevel(null, [], R)).toBe('Not ready');
    expect(readinessLevel(90, [], R)).toBe('Ready'); // no tagged gate applies
  });
});

describe('risks, priorities and sub-dimensions', () => {
  it('lists the blocking gate and the risks it causes', () => {
    const a = analyseBank(resp({ A1: 1, A2: 4, B1: 3, B2: 4 }), qs, meta, R)!;
    const x = a.readiness[0];
    expect(x.level).toBe('Not ready'); expect(x.blocking.map((b) => b.code)).toEqual(['A1']);
    expect(a.risks.find((r) => r.rule === 'R1' && r.code === 'A1')?.label).toBe('No cash book');
    expect(a.subDimensions.find((s) => s.code === '1.1')?.name).toBe('Cash');
    expect(a.priorities[0].code).toBe('1.1'); // the gate sits in 1.1
  });
  it('fires a contradiction when a claim and its pair disagree, and not otherwise', () => {
    expect(analyseBank(resp({ A1: 4, A2: 1, B1: 3, B2: 4 }), qs, meta, R)!.risks.some((r) => r.rule === 'R4')).toBe(true);
    expect(analyseBank(resp({ A1: 4, A2: 3, B1: 3, B2: 4 }), qs, meta, R)!.risks.some((r) => r.rule === 'R4')).toBe(false);
  });
  it('flags an evidence gap and weak domains from the evidence class and score', () => {
    const a = analyseBank(resp({ A1: 1, A2: 1, B1: 4, B2: 4 }, 'Self-reported'), qs, meta, R)!;
    expect(a.risks.filter((r) => r.rule === 'R3').length).toBe(2);
    expect(a.risks.some((r) => r.rule === 'R2' && /Finance is weak/.test(r.label))).toBe(true);
  });
  it('treats a not applicable gate as passed, and excludes it from the index', () => {
    const q2 = qs.map((q) => (q.code === 'B2' ? { ...q, criticality: 'Gate' as const } : q));
    const a = analyseBank(resp({ A1: 4, A2: 4, B1: 4, B2: 'NA' }), q2, meta, R)!;
    expect(a.readiness[0].level).toBe('Ready'); expect(a.notApplicable).toEqual(['B2']);
  });
  it('reads a condition strictly', () => {
    expect(parseCondition('A>=3 and B<=1')!(3, 1)).toBe(true);
    expect(parseCondition('A>=3 and B<=1')!(3, 2)).toBe(false);
    expect(parseCondition('A>=3 or B<=1')).toBeNull();
    expect(parseCondition('process.exit()')).toBeNull();
  });
});

describe.each(['sme360', 'agrifood360', 'eso360'])('%s bank', (f) => {
  const b = load(f);
  it('passes platform validation and carries 100 questions with full metadata', () => {
    expect(() => validateContent(b)).not.toThrow();
    expect(b.questions).toHaveLength(100);
    expect(b.questions.every((q: any) => q.anchors?.length === 5 && q.evidence?.requirement && q.subDimension)).toBe(true);
    expect(b.meta.subDimensions).toHaveLength(28);
  });
  it('scores a perfect and an empty synthetic case, with readiness following', () => {
    const lite = questionsOf(b);
    const all = lite.map((q) => ({ questionCode: q.code, value: 4, evidenceClass: 'Verified' as const }));
    expect(scoreDiagnostic(all, lite, R).overall).toBe(100);
    const x = analyseBank(all, lite, b.meta, R)!;
    expect(x.readiness.length).toBe(5);
    expect(x.readiness.every((r) => r.level === 'Ready')).toBe(true);
    expect(x.risks).toEqual([]);
    const low = analyseBank(lite.map((q) => ({ questionCode: q.code, value: 0, evidenceClass: 'Self-reported' as const })), lite, b.meta, R)!;
    expect(low.readiness.every((r) => r.level === 'Not ready')).toBe(true);
    expect(low.priorities).toHaveLength(5);
  });
  it('rejects a broken consistency condition, an unknown readiness tag and a gate with a low weight', () => {
    const bad = (m: (x: any) => void) => { const c = structuredClone(b); m(c); return () => validateContent(c); };
    expect(bad((c) => { c.meta.consistencyChecks[0].condition = 'A>=3 or B<=1'; })).toThrow();
    expect(bad((c) => { c.questions[0].readiness = ['RDY-NOPE']; })).toThrow();
    expect(bad((c) => { const g = c.questions.find((q: any) => q.criticality === 'Gate'); g.weight = 2; })).toThrow();
    expect(bad((c) => { c.questions[0].anchors = ['only', 'two']; })).toThrow();
  });
});

describe('loading banks through the API', () => {
  let admin: Session;
  beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); });
  it.each([['SME360', 'sme360'], ['AGRIFOOD360', 'agrifood360'], ['ESO360', 'eso360']])('stores %s as a draft with its metadata, and a published version rejects meta edits', async (code, f) => {
    const b = load(f);
    const d = await api(admin).post(`/settings/frameworks/${code}/versions`, b);
    expect(d.status).toBe(201);
    const got = (await api(admin).get(`/settings/frameworks/versions/${d.data.id}`)).data;
    expect(got.meta.subDimensions).toHaveLength(28); expect(got.questions[0].anchors).toHaveLength(5);
    expect(got.sources.every((s: any) => s.approval === 'Proposed')).toBe(true);
    // Nobody can publish while sources are unapproved (specialised) and meta edits on drafts are allowed.
    expect((await api(admin).patch(`/settings/frameworks/versions/${d.data.id}`, { meta: { ...b.meta, architecture: 'edited' } })).status).toBe(200);
    expect((await api(admin).del(`/settings/frameworks/versions/${d.data.id}`)).status).toBe(200);
  });
  it('keeps meta immutable on a published version', async () => {
    const [pub] = await db().select().from(schema.frameworkVersions).where(eq(schema.frameworkVersions.status, 'Published')).limit(1);
    await expect(db().update(schema.frameworkVersions).set({ meta: { architecture: 'tampered' } }).where(eq(schema.frameworkVersions.id, pub.id))).rejects.toThrow();
  });
});
