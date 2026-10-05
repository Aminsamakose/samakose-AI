import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, SEED_QUESTIONS, canTransitionCase, canTransitionPrescription, confidenceClass, extractJson, maturityBand, scoreDiagnostic, suppress, validateDiagnosis, validatePrescription, validateSubmission, CASE_TRANSITIONS } from '@/domain/logic';
import { csvCell, toCsv } from '@/lib/csv';
import { base32Decode, base32Encode, passwordProblems, totp, verifyTotp } from '@/lib/crypto';
import { suppressGroups } from '@/services/dashboards';
import { mockDiagnosis, mockPrescription } from '@/domain/mockai';

const qs = SEED_QUESTIONS.map(([code, dimension, text, weight]) => ({ code, dimension, text, weight }));
const all = (v: number, cls: any = 'Verified') => qs.map((q) => ({ questionCode: q.code, value: v, evidenceClass: cls }));

describe('data quality gate', () => {
  const answers = (n: number, v = 2) => Object.fromEntries(qs.slice(0, n).map((q) => [q.code, v]));
  it('accepts a complete sheet', () => expect(validateSubmission(answers(18), qs, DEFAULT_RULES).ok).toBe(true));
  it('accepts exactly 90 percent (17 of 18 is 94 percent, 16 of 18 is 88 percent)', () => {
    expect(validateSubmission(answers(17), qs, DEFAULT_RULES).ok).toBe(true);
    expect(validateSubmission(answers(16), qs, DEFAULT_RULES).ok).toBe(false);
  });
  it('rejects values outside 0 to 4 and non integers', () => {
    expect(validateSubmission({ ...answers(18), Q01: 5 }, qs, DEFAULT_RULES).problems.join()).toContain('Q01');
    expect(validateSubmission({ ...answers(18), Q02: 2.5 }, qs, DEFAULT_RULES).ok).toBe(false);
    expect(validateSubmission({ ...answers(18), Q03: -1 }, qs, DEFAULT_RULES).ok).toBe(false);
  });
  it('rejects duplicates by submission id', () => expect(validateSubmission(answers(18), qs, DEFAULT_RULES, ['u1'], 'u1').problems).toContain('Duplicate submission'));
  it('respects a rule change', () => expect(validateSubmission(answers(12), qs, { ...DEFAULT_RULES, 'validation.min_completion': 0.6 }).ok).toBe(true));
});

describe('scoring', () => {
  it('scores 100 for all fours with verified evidence', () => expect(scoreDiagnostic(all(4), qs, DEFAULT_RULES).overall).toBe(100));
  it('scores 0 for all zeros', () => expect(scoreDiagnostic(all(0), qs, DEFAULT_RULES).overall).toBe(0));
  it('discounts by evidence class', () => {
    const v = scoreDiagnostic(all(4, 'Verified'), qs, DEFAULT_RULES).overall;
    const s = scoreDiagnostic(all(4, 'Self-reported'), qs, DEFAULT_RULES).overall;
    const m = scoreDiagnostic(all(4, 'Missing'), qs, DEFAULT_RULES).overall;
    expect(v).toBe(100); expect(s).toBe(80); expect(m).toBe(50);
  });
  it('reports six dimensions', () => expect(scoreDiagnostic(all(2), qs, DEFAULT_RULES).dimensions).toHaveLength(6));
  it('maturity bands sit on the documented edges', () => {
    const b = (n: number) => maturityBand(n, DEFAULT_RULES);
    expect([b(39.9), b(40), b(59.9), b(60), b(74.9), b(75)]).toEqual(['Critical', 'Fragile', 'Fragile', 'Developing', 'Developing', 'Strong']);
  });
  it('confidence is computed from evidence, never stated', () => {
    expect(confidenceClass({ Verified: 0.7 }, true, true, DEFAULT_RULES)).toBe('High');
    expect(confidenceClass({ 'Document-supported': 0.4 }, true, true, DEFAULT_RULES)).toBe('Medium');
    expect(confidenceClass({ 'Self-reported': 1 }, true, true, DEFAULT_RULES)).toBe('Low');
    expect(confidenceClass({ Verified: 1 }, false, true, DEFAULT_RULES)).toBe('Medium');
    expect(confidenceClass({ Verified: 1 }, true, false, DEFAULT_RULES)).toBe('Low');
  });
});

describe('state machines', () => {
  it('has 15 case transitions', () => expect(CASE_TRANSITIONS).toHaveLength(15));
  it('blocks a jump', () => expect(canTransitionCase('PROFILED', 'DIAGNOSED', {}).ok).toBe(false));
  it('requires facts', () => {
    expect(canTransitionCase('DIAGNOSTIC', 'DIAGNOSED', {}).ok).toBe(false);
    expect(canTransitionCase('DIAGNOSTIC', 'DIAGNOSED', { validation_ok: true, scored: true }).ok).toBe(true);
  });
  it('lets only the reviewer approve a prescription', () => {
    expect(canTransitionPrescription('IN REVIEW', 'APPROVED', 'REVIEWER').ok).toBe(true);
    for (const r of ['ADMIN', 'EXPERT', 'AI', 'OWNER'] as const) expect(canTransitionPrescription('IN REVIEW', 'APPROVED', r).ok).toBe(false);
  });
});

describe('AI output rules', () => {
  const good = { summary: 'A summary that is long enough to pass.', root_causes: [{ cause: 'x', evidence_ids: ['EVD-1'] }], priority: 'High', risks: [{ text: 'r', severity: 'Low' }], model_confidence: 0.5 };
  it('accepts a valid diagnosis', () => expect(validateDiagnosis(good, ['EVD-1'])).toEqual([]));
  it('rejects invented evidence ids', () => expect(validateDiagnosis(good, ['EVD-2']).join()).toContain('Unknown evidence id'));
  it('rejects missing evidence and bad enums', () => {
    expect(validateDiagnosis({ ...good, root_causes: [{ cause: 'x', evidence_ids: [] }] }, []).length).toBeGreaterThan(0);
    expect(validateDiagnosis({ ...good, priority: 'Urgent' }, ['EVD-1']).length).toBeGreaterThan(0);
    expect(validateDiagnosis({ ...good, model_confidence: 2 }, ['EVD-1']).length).toBeGreaterThan(0);
  });
  const rx = { items: [{ library_id: 'IVL-001', actions: [{ text: 't', owner_role: 'OWNER', deadline_days: 30 }] }] };
  it('accepts 180 and 360 day actions', () => expect(validatePrescription({ items: [{ library_id: 'IVL-001', actions: [{ text: 't', owner_role: 'OWNER', deadline_days: 360 }] }] }, ['IVL-001'], DEFAULT_RULES)).toEqual([]));
  it('accepts a valid prescription', () => expect(validatePrescription(rx, ['IVL-001'], DEFAULT_RULES)).toEqual([]));
  it('rejects unknown library ids and out of range deadlines', () => {
    expect(validatePrescription(rx, ['IVL-002'], DEFAULT_RULES).length).toBe(1);
    expect(validatePrescription({ items: [{ library_id: 'IVL-001', actions: [{ text: 't', owner_role: 'OWNER', deadline_days: 800 }] }] }, ['IVL-001'], DEFAULT_RULES).length).toBe(1);
    expect(validatePrescription({ items: [{ library_id: 'IVL-001', actions: [{ text: 't', owner_role: 'ADMIN', deadline_days: 30 }] }] }, ['IVL-001'], DEFAULT_RULES).length).toBe(1);
  });
  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{bad json}')).toBeNull();
  });
  it('mock drafts always pass the validators', () => {
    const ctx = { business: { type: 'SME', sector: null, region: null, size: null }, overall: 42, maturity: 'Fragile', confidence_class: 'Low', dimensions: [{ dimension: 'Finance', value: 20 }, { dimension: 'Operations', value: 60 }, { dimension: 'Market and sales', value: 30 }],
      weakest_answers: [{ question_code: 'Q01', question: 'Cash is recorded', dimension: 'Finance', value: 0, evidence_class: 'Self-reported', evidence_id: 'EVD-1' }], allowed_evidence_ids: ['EVD-1'] };
    expect(validateDiagnosis(mockDiagnosis(ctx), ctx.allowed_evidence_ids)).toEqual([]);
    const lib = [{ id: 'IVL-001', title: 'Cash', dimension: 'Finance', description: 'Do cash', typical_days: 30 }, { id: 'IVL-003', title: 'Pricing', dimension: 'Market and sales', description: 'Do prices', typical_days: 200 }];
    const p = mockPrescription({ weakest_dimensions: ['Finance', 'Market and sales'], library: lib, limits: { min_days: 5, max_days: 120 } });
    expect(validatePrescription(p, lib.map((l) => l.id), DEFAULT_RULES)).toEqual([]);
  });
});

describe('privacy and output safety', () => {
  it('suppresses small cells', () => { expect(suppress(4, DEFAULT_RULES)).toBeNull(); expect(suppress(5, DEFAULT_RULES)).toBe(5); });
  it('hides a second group when one hidden group could be computed by subtraction', () => {
    const g = suppressGroups([{ key: 'a', n: 20 }, { key: 'b', n: 12 }, { key: 'c', n: 3 }], 35, 5);
    expect(g.filter((x) => x.n === null).map((x) => x.key).sort()).toEqual(['b', 'c']);
  });
  it('keeps everything when nothing is small', () => expect(suppressGroups([{ key: 'a', n: 20 }, { key: 'b', n: 12 }], 32, 5).every((x) => x.n !== null)).toBe(true));
  it('neutralises spreadsheet formulas in CSV', () => {
    for (const s of ['=1+1', '+1', '-1', '@SUM(A1)']) expect(csvCell(s).startsWith("'")).toBe(true);
    expect(csvCell('a,b')).toBe('"a,b"'); expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(toCsv([{ key: 'a', label: 'A' }], [{ a: '=cmd' }])).toContain("'=cmd");
  });
});

describe('crypto', () => {
  it('matches the RFC 6238 SHA1 test vector', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totp(secret, 59_000, 30, 8)).toBe('94287082');
    expect(totp(secret, 1111111109_000, 30, 8)).toBe('07081804');
  });
  it('verifies within one step and rejects far codes', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = Date.now();
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 300_000), now)).toBe(false);
  });
  it('round-trips base32', () => expect(base32Decode(base32Encode(Buffer.from('hello world'))).toString()).toBe('hello world'));
  it('enforces the password policy', () => {
    expect(passwordProblems('short1')).not.toEqual([]);
    expect(passwordProblems('onlyletterslongenough')).not.toEqual([]);
    expect(passwordProblems('password12345')).not.toEqual([]);
    expect(passwordProblems('Correct-Horse-Battery-42')).toEqual([]);
    expect(passwordProblems('amina-yahaya-2026x', 'amina.yahaya@x.com', 'Amina Yahaya')).not.toEqual([]);
  });
});

import { mapKobo } from '@/services/kobo';
describe('Kobo field names', () => {
  it('reads both the new style and the earlier form style (q_Q01, e_Q01, ref_Q01, case_id)', () => {
    const a = mapKobo({ _uuid: 'u1', case_code: 'CASE-1', Q01: '3', Q01_evidence: 'Verified', Q01_ref: 'EVD-1' });
    const b = mapKobo({ _uuid: 'u2', case_id: 'CASE-1', q_Q01: '3', e_Q01: 'Verified', ref_Q01: 'EVD-1' });
    expect(b.answers.Q01).toEqual(a.answers.Q01);
    expect(b.caseCode).toBe('CASE-1');
    expect(a.answers.Q01).toEqual({ value: 3, evidence: 'Verified', ref: 'EVD-1' });
  });
});
