import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, freeAssessmentClassification, scoreFreeAssessment, type FreeAssessmentAnswer } from '@/domain/logic';
import { SME360_ANSWER_OPTIONS } from '@/services/frameworks';
import { normaliseEmail } from '@/services/publicAssessments';

// SME360_QUESTIONS isn't exported (kept module-private in frameworks.ts); re-derive the 25-question
// shape locally from the answer-options map, which IS exported, purely so these tests don't need DB access.
const questions = Object.keys(SME360_ANSWER_OPTIONS).map((code, i) => ({ code, dimension: `D${Math.floor(i / 4)}` }));

describe('free assessment scorer (plain, unweighted -- not scoreDiagnostic)', () => {
  it('matches the approved spec\'s own worked example: 4,3,2,3 over 4 questions = 75', () => {
    const qs = [{ code: 'Q1', dimension: 'Dim' }, { code: 'Q2', dimension: 'Dim' }, { code: 'Q3', dimension: 'Dim' }, { code: 'Q4', dimension: 'Dim' }];
    const answers: FreeAssessmentAnswer[] = [{ questionCode: 'Q1', value: 4 }, { questionCode: 'Q2', value: 3 }, { questionCode: 'Q3', value: 2 }, { questionCode: 'Q4', value: 3 }];
    const r = scoreFreeAssessment(answers, qs, DEFAULT_RULES);
    expect(r.dimensions[0].score).toBe(75);
    expect(r.overall).toBe(75);
  });
  it('scores 100 for all A answers, unlike the evidence-weighted engine which would cap at 80', () => {
    const qs = [{ code: 'Q1', dimension: 'D' }, { code: 'Q2', dimension: 'D' }];
    const answers: FreeAssessmentAnswer[] = [{ questionCode: 'Q1', value: 4 }, { questionCode: 'Q2', value: 4 }];
    expect(scoreFreeAssessment(answers, qs, DEFAULT_RULES).overall).toBe(100);
  });
  it('scores 0 for all D answers', () => {
    const qs = [{ code: 'Q1', dimension: 'D' }];
    expect(scoreFreeAssessment([{ questionCode: 'Q1', value: 1 }], qs, DEFAULT_RULES).overall).toBe(0);
  });
  it('throws rather than silently scoring a missing answer as the lowest value (spec, Phase 5 safeguard)', () => {
    const qs = [{ code: 'Q1', dimension: 'D' }, { code: 'Q2', dimension: 'D' }];
    expect(() => scoreFreeAssessment([{ questionCode: 'Q1', value: 4 }], qs, DEFAULT_RULES)).toThrow(/Q2/);
  });
  it('classifies against the provisional bands exactly as specified', () => {
    expect(freeAssessmentClassification(0, DEFAULT_RULES)).toBe('Critical Attention');
    expect(freeAssessmentClassification(39, DEFAULT_RULES)).toBe('Critical Attention');
    expect(freeAssessmentClassification(40, DEFAULT_RULES)).toBe('Needs Improvement');
    expect(freeAssessmentClassification(59, DEFAULT_RULES)).toBe('Needs Improvement');
    expect(freeAssessmentClassification(60, DEFAULT_RULES)).toBe('Developing');
    expect(freeAssessmentClassification(79, DEFAULT_RULES)).toBe('Developing');
    expect(freeAssessmentClassification(80, DEFAULT_RULES)).toBe('Strong Foundation');
    expect(freeAssessmentClassification(100, DEFAULT_RULES)).toBe('Strong Foundation');
  });
});

describe('SME360 question bank', () => {
  it('has exactly 25 questions with 4 answer options each', () => {
    expect(questions).toHaveLength(25);
    for (const code of Object.keys(SME360_ANSWER_OPTIONS)) {
      const opts = SME360_ANSWER_OPTIONS[code];
      expect(Object.keys(opts).sort()).toEqual(['A', 'B', 'C', 'D']);
    }
  });
});

describe('email normalisation (spec, Phase 6: trim + case-fold only, never strip dots or plus-tags)', () => {
  it('trims and lowercases', () => expect(normaliseEmail('  Amin.Yahaya@Gmail.com  ')).toBe('amin.yahaya@gmail.com'));
  it('does not strip dots', () => expect(normaliseEmail('a.b.c@example.com')).toBe('a.b.c@example.com'));
  it('does not strip plus-addressing', () => expect(normaliseEmail('amin+test@example.com')).toBe('amin+test@example.com'));
  it('treats case-only variants as the same address', () => expect(normaliseEmail('USER@EXAMPLE.COM')).toBe(normaliseEmail('user@example.com')));
  it('treats dot/plus variants as genuinely distinct addresses', () => {
    expect(normaliseEmail('user@example.com')).not.toBe(normaliseEmail('u.ser@example.com'));
    expect(normaliseEmail('user@example.com')).not.toBe(normaliseEmail('user+tag@example.com'));
  });
});
