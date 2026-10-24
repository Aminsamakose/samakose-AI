import { describe, expect, it } from 'vitest';
import { classifyTransition, DEFAULT_STABLE_BAND_POINTS, RECHECK_CASE_STATES } from '@/domain/health-transition';

describe('#87: classifyTransition', () => {
  it('is null for a null delta (first score, or an incomparable framework change)', () => {
    expect(classifyTransition(null)).toBeNull();
  });
  it('classifies against the default 5-point band', () => {
    expect(classifyTransition(5)).toBe('Progressing');
    expect(classifyTransition(-5)).toBe('Regressing');
    expect(classifyTransition(4.9)).toBe('Stable');
    expect(classifyTransition(-4.9)).toBe('Stable');
    expect(classifyTransition(0)).toBe('Stable');
  });
  it('respects a configured band', () => {
    expect(classifyTransition(2, 1)).toBe('Progressing');
    expect(classifyTransition(2, 10)).toBe('Stable');
  });
  it('the default band is 5, matching the pre-existing HealthImproved/HealthDeclined threshold', () => {
    expect(DEFAULT_STABLE_BAND_POINTS).toBe(5);
  });
  it('RECHECK_CASE_STATES names the lifecycle states a re-score counts as a RE-CHECK rather than a baseline', () => {
    expect(RECHECK_CASE_STATES).toEqual(['MONITORING', 'MIDLINE', 'ENDLINE', 'FOLLOW-UP', 'GRADUATED', 'RE-ENTRY']);
  });
});
