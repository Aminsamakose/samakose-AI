/** Indicator metrics and progress. Pure functions: the database work is in services/indicators.ts. */
export const METRICS = {
  enrolled: { label: 'Businesses enrolled', unit: 'businesses', base: 'enrolled' },
  scored: { label: 'Businesses scored', unit: 'businesses', base: 'scored' },
  rescored: { label: 'Businesses re-scored', unit: 'businesses', base: 'rescored' },
  avg_score: { label: 'Average health score', unit: 'points', base: 'scored' },
  avg_change: { label: 'Average score change', unit: 'points', base: 'rescored' },
  pct_improved: { label: 'Re-scored businesses that improved', unit: '%', base: 'rescored' }
} as const;
export type Metric = keyof typeof METRICS;
export type Facts = { enrolled: number; scored: number; rescored: number; avgScore: number | null; avgChange: number | null; improved: number };

/** The current value of a metric, or null when there is nothing to measure yet. */
export function valueOf(metric: Metric, f: Facts): number | null {
  switch (metric) {
    case 'enrolled': return f.enrolled;
    case 'scored': return f.scored;
    case 'rescored': return f.rescored;
    case 'avg_score': return f.avgScore;
    case 'avg_change': return f.avgChange;
    case 'pct_improved': return f.rescored ? Math.round((f.improved / f.rescored) * 1000) / 10 : null;
  }
}
/** How many businesses the value rests on. Funders do not see a value resting on fewer than the privacy minimum. */
export const basisOf = (metric: Metric, f: Facts) => f[METRICS[metric].base];

export type Status = 'Achieved' | 'Missed' | 'In progress' | 'No data yet';
export function progress(value: number | null, target: number, dueDate: string | null, now: Date): { pct: number | null; status: Status } {
  if (value === null) return { pct: null, status: dueDate && new Date(dueDate + 'T23:59:59Z') < now ? 'Missed' : 'No data yet' };
  const pct = Math.max(0, Math.round((value / target) * 100));
  if (value >= target) return { pct, status: 'Achieved' };
  return { pct, status: dueDate && new Date(dueDate + 'T23:59:59Z') < now ? 'Missed' : 'In progress' };
}
