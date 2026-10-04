/**
 * RE-CHECK trend. Pure functions over the score history the Business Health Record already returns.
 * A point is marked "break" when it was scored under a framework version that could not be compared with the one before,
 * so the chart never implies a business change that the framework may have caused.
 */
export type TrendScore = {
  id: string; at: string; overall: number; framework: string; maturity: string; confidence: string;
  dimensions: { dimension: string; value: number }[];
  change: { delta: number | null; comparable?: boolean };
};
export type TrendCase = { code: string; scores: TrendScore[] };

export type TrendPoint = {
  id: string; at: string; time: number; overall: number; caseCode: string; framework: string; maturity: string; confidence: string;
  /** Change since the previous point, null for the first or when not comparable. */
  delta: number | null;
  /** The framework differs from the previous point, so the change may not come from the business. */
  frameworkChanged: boolean;
};

/** All scores across cases, oldest first, with the change since the previous point. */
export function trendPoints(cases: TrendCase[]): TrendPoint[] {
  const flat = cases.flatMap((c) => c.scores.map((s) => ({ c, s }))).sort((a, b) => new Date(a.s.at).getTime() - new Date(b.s.at).getTime());
  return flat.map(({ c, s }, i) => {
    const prev = i > 0 ? flat[i - 1].s : null;
    const comparable = s.change.comparable !== false;
    const delta = prev && comparable ? Math.round((s.overall - prev.overall) * 10) / 10 : null;
    return { id: s.id, at: s.at, time: new Date(s.at).getTime(), overall: s.overall, caseCode: c.code, framework: s.framework, maturity: s.maturity, confidence: s.confidence, delta, frameworkChanged: !!prev && prev.framework !== s.framework };
  });
}

export type DimensionMove = { dimension: string; first: number; latest: number; delta: number };

/** First and latest value per dimension. Only dimensions present in both ends are compared. */
export function dimensionMoves(cases: TrendCase[]): DimensionMove[] {
  const flat = cases.flatMap((c) => c.scores).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  if (flat.length < 2) return [];
  const first = new Map(flat[0].dimensions.map((d) => [d.dimension, d.value]));
  return flat[flat.length - 1].dimensions
    .filter((d) => first.has(d.dimension))
    .map((d) => ({ dimension: d.dimension, first: first.get(d.dimension)!, latest: d.value, delta: Math.round((d.value - first.get(d.dimension)!) * 10) / 10 }))
    .sort((a, b) => b.delta - a.delta);
}

/** One plain sentence for screen readers and for people who do not read charts. */
export function trendSummary(points: TrendPoint[]): string {
  if (!points.length) return 'No scores yet.';
  if (points.length === 1) return `One score so far: ${points[0].overall} out of 100. Complete a re-check to see a trend.`;
  const a = points[0], b = points[points.length - 1];
  const d = Math.round((b.overall - a.overall) * 10) / 10;
  const dir = d > 0 ? `up ${d}` : d < 0 ? `down ${Math.abs(d)}` : 'unchanged';
  const broke = points.some((p) => p.frameworkChanged);
  return `${points.length} scores from ${a.at.slice(0, 10)} to ${b.at.slice(0, 10)}: ${a.overall} to ${b.overall}, ${dir}.${broke ? ' The framework version changed along the way, so part of the movement may come from the framework.' : ''}`;
}
