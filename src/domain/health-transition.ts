/**
 * RE-CHECK transition classification (#87's "new score -> progression/regression/stable" step).
 *
 * This is deliberately one tiny pure function with one caller contract: feed it a delta that is
 * ALREADY framework-comparability-aware (services/record.ts's explainChange computes exactly that),
 * never a raw overall-score subtraction. Before this existed, services/diagnostics.ts computed its
 * own raw `s.overall - from` to decide whether to fire HealthImproved/HealthDeclined -- a different,
 * framework-naive number from the one services/record.ts's Business Health Record already showed the
 * same two scores as "Not compared" for, because they were scored under framework versions too
 * different to compare. That let the system notify a case team that a business had "declined" purely
 * because of a framework version change, not anything the business did. classifyTransition is the
 * single place that decision gets made now, fed the same comparable delta everywhere it is used.
 */

export const TRANSITIONS = ['Progressing', 'Regressing', 'Stable'] as const;
export type Transition = (typeof TRANSITIONS)[number];

/** Case states where a new score is a RE-CHECK rather than the original baseline diagnosis -- the same
 *  set domain/job-handlers.ts's recheck_scan job already reminds these cases about. */
export const RECHECK_CASE_STATES = ['MONITORING', 'MIDLINE', 'ENDLINE', 'FOLLOW-UP', 'GRADUATED', 'RE-ENTRY'] as const;

export const DEFAULT_STABLE_BAND_POINTS = 5;

/**
 * `delta` must already be null for an incomparable or first-ever score (see explainChange) -- this
 * function never decides comparability itself, only what a comparable delta means.
 * `bandPoints`: a move smaller than this, in either direction, counts as Stable rather than noise
 * being read as a real change. Configured by the `recheck.stable_band_points` rule.
 */
export function classifyTransition(delta: number | null, bandPoints: number = DEFAULT_STABLE_BAND_POINTS): Transition | null {
  if (delta === null) return null;
  if (delta >= bandPoints) return 'Progressing';
  if (delta <= -bandPoints) return 'Regressing';
  return 'Stable';
}
