import { describe, expect, it } from 'vitest';
import { dimensionMoves, trendPoints, trendSummary, type TrendCase } from '@/lib/client/trend';

const sc = (id: string, at: string, overall: number, framework: string, dims: [string, number][], comparable = true, delta: number | null = null) => ({
  id, at, overall, framework, maturity: 'Developing', confidence: 'Medium', dimensions: dims.map(([dimension, value]) => ({ dimension, value })), change: { delta, comparable }
});

describe('RE-CHECK trend', () => {
  const cases: TrendCase[] = [
    { code: 'C-2', scores: [sc('c', '2027-03-01T00:00:00Z', 62, 'SME360 v2', [['Finance', 60], ['Market', 64]])] },
    { code: 'C-1', scores: [sc('a', '2026-10-01T00:00:00Z', 48, 'SME360 v1', [['Finance', 40], ['Market', 56], ['Legacy', 50]]), sc('b', '2026-12-01T00:00:00Z', 55, 'SME360 v1', [['Finance', 50], ['Market', 60]])] }
  ];
  it('orders scores across cases oldest first and computes change', () => {
    const p = trendPoints(cases);
    expect(p.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(p.map((x) => x.delta)).toEqual([null, 7, 7]);
  });
  it('flags a framework change so the chart does not imply a business change', () => {
    const p = trendPoints(cases);
    expect(p.map((x) => x.frameworkChanged)).toEqual([false, false, true]);
  });
  it('gives no delta when the framework versions are not comparable', () => {
    const c: TrendCase[] = [{ code: 'C', scores: [sc('a', '2026-10-01T00:00:00Z', 40, 'A v1', []), sc('b', '2026-11-01T00:00:00Z', 70, 'A v2', [], false)] }];
    expect(trendPoints(c)[1].delta).toBeNull();
    expect(trendPoints(c)[1].frameworkChanged).toBe(true);
  });
  it('compares dimensions present at both ends only, largest gain first', () => {
    expect(dimensionMoves(cases)).toEqual([{ dimension: 'Finance', first: 40, latest: 60, delta: 20 }, { dimension: 'Market', first: 56, latest: 64, delta: 8 }]);
  });
  it('summarises in plain words and handles empty and single', () => {
    expect(trendSummary([])).toBe('No scores yet.');
    expect(trendSummary(trendPoints([cases[1]]))).toContain('up 7');
    expect(trendSummary(trendPoints(cases))).toContain('framework version changed');
    expect(trendSummary(trendPoints([{ code: 'x', scores: [cases[0].scores[0]] }]))).toContain('One score so far');
  });
  it('handles no history', () => { expect(trendPoints([])).toEqual([]); expect(dimensionMoves([])).toEqual([]); });
});
