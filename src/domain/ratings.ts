/**
 * Practitioner ratings and performance. Pure functions.
 * Four measures stay separate: performance, service quality, client experience and business outcome.
 * A score always travels with its sample size and confidence, and the status it suggests is only a suggestion:
 * a person decides any consequential status. A small sample can never produce a high status.
 */
export type RatingSource = 'client' | 'reviewer' | 'programme_manager';

export const CRITERIA: Record<RatingSource, { key: string; label: string; help: string }[]> = {
  client: [
    { key: 'quality', label: 'Quality of the support', help: 'How good was the advice, coaching or work?' },
    { key: 'relevance', label: 'Relevance to my business', help: 'Did it fit what my business needed?' },
    { key: 'communication', label: 'Communication', help: 'Clear, timely and respectful.' },
    { key: 'professionalism', label: 'Professionalism', help: 'Reliable, prepared and confidential.' },
    { key: 'responsiveness', label: 'Responsiveness', help: 'Replied and showed up when agreed.' },
    { key: 'usefulness', label: 'Usefulness', help: 'Did it help me act and improve?' },
    { key: 'trust', label: 'Trust', help: 'Did I trust this person with my business?' },
    { key: 'recommend', label: 'Would recommend', help: 'Would I recommend them to another business?' }
  ],
  reviewer: [
    { key: 'technical', label: 'Technical quality', help: 'Accuracy and soundness of the work.' },
    { key: 'appropriateness', label: 'Appropriateness', help: 'Right intervention for the diagnosed problem.' },
    { key: 'evidence', label: 'Evidence', help: 'Work is backed by evidence on the record.' },
    { key: 'deliverables', label: 'Deliverables', help: 'Complete, usable and on time.' },
    { key: 'documentation', label: 'Documentation', help: 'Notes and records are clear and complete.' }
  ],
  programme_manager: [
    { key: 'timeliness', label: 'Timeliness', help: 'Delivered within agreed timeframes.' },
    { key: 'reliability', label: 'Reliability', help: 'Did what was agreed.' },
    { key: 'communication', label: 'Communication', help: 'Kept the programme informed.' },
    { key: 'collaboration', label: 'Collaboration', help: 'Worked well with the coach, reviewer and team.' },
    { key: 'documentation', label: 'Documentation', help: 'Records and reporting were complete.' }
  ]
};

/** 1 to 5 stars becomes 0 to 100. */
export const toPercent = (stars: number) => Math.round(((Math.min(5, Math.max(1, stars)) - 1) / 4) * 100);

/** Validates the answers for a source and returns the overall 0 to 100 score. */
export function scoreRating(source: RatingSource, scores: Record<string, unknown>): { ok: true; overall: number; clean: Record<string, number> } | { ok: false; error: string } {
  const clean: Record<string, number> = {};
  for (const c of CRITERIA[source]) {
    const v = Number(scores[c.key]);
    if (!Number.isInteger(v) || v < 1 || v > 5) return { ok: false, error: `Rate "${c.label}" from 1 to 5` };
    clean[c.key] = v;
  }
  const avg = Object.values(clean).reduce((s, v) => s + v, 0) / Object.keys(clean).length;
  return { ok: true, overall: toPercent(avg), clean };
}

/** The default weights from the approved framework. They are version 1 settings. */
export const DEFAULT_WEIGHTS = { expertise: 0.15, quality: 0.2, professionalism: 0.15, delivery: 0.15, satisfaction: 0.15, outcome: 0.2 } as const;
export const FORMULA_VERSION = 'v1';

export type Evidence = { completed: number; rated: number; reviewed: number; };
export const DEFAULT_THRESHOLDS = {
  /** Fewer engagements than this and the person is shown as Limited Evidence whatever the score. */
  minCompleted: 3, minRated: 2,
  moderate: { completed: 5, rated: 3 },
  high: { completed: 20, rated: 10, reviewed: 5 },
  exceptional: { score: 90, completed: 20, rated: 10 },
  excellent: { score: 85, completed: 10, rated: 5 },
  good: { score: 70 },
  watch: { score: 60 }
} as const;
export type Thresholds = typeof DEFAULT_THRESHOLDS;

export type Confidence = 'High' | 'Moderate' | 'Limited evidence';
export function confidence(e: Evidence, t: Thresholds = DEFAULT_THRESHOLDS): Confidence {
  if (e.completed >= t.high.completed && e.rated >= t.high.rated && e.reviewed >= t.high.reviewed) return 'High';
  if (e.completed >= t.moderate.completed && e.rated >= t.moderate.rated) return 'Moderate';
  return 'Limited evidence';
}

/** What each source contributes to each of the six components. A component with no evidence is left out and the rest are re-weighted. */
const MAP: Record<string, { source: RatingSource; keys: string[] }[]> = {
  expertise: [{ source: 'reviewer', keys: ['technical', 'appropriateness'] }],
  quality: [{ source: 'client', keys: ['quality', 'relevance', 'usefulness'] }, { source: 'reviewer', keys: ['technical', 'appropriateness'] }],
  professionalism: [{ source: 'client', keys: ['professionalism', 'communication', 'responsiveness'] }, { source: 'programme_manager', keys: ['reliability', 'communication', 'collaboration'] }],
  delivery: [{ source: 'reviewer', keys: ['deliverables', 'evidence', 'documentation'] }, { source: 'programme_manager', keys: ['timeliness', 'documentation'] }],
  satisfaction: [{ source: 'client', keys: ['trust', 'recommend', 'usefulness'] }]
};

export type RatingRow = { source: RatingSource; scores: Record<string, number> };
export type SystemEvidence = { sessionsHeld: number; sessionsMissed: number; actionsDone: number; actionsTotal: number; scoreChange: number | null };

export function systemDelivery(s: SystemEvidence) {
  const sessions = s.sessionsHeld + s.sessionsMissed;
  return { attendance: sessions ? Math.round((s.sessionsHeld / sessions) * 100) : null, actionCompletion: s.actionsTotal ? Math.round((s.actionsDone / s.actionsTotal) * 100) : null };
}
/** Business outcome: movement in the Business Health score between runs, as a 0 to 100 figure (-20 or worse is 0, +20 or better is 100). Null with fewer than two scored runs. */
export const outcomeScore = (change: number | null) => (change == null ? null : Math.round(((Math.min(20, Math.max(-20, change)) + 20) / 40) * 100));

export type Performance = {
  score: number | null; components: Record<string, number | null>; coverage: string[]; evidence: Evidence; confidence: Confidence; suggestedStatus: string; formulaVersion: string; note: string;
};

export function performance(ratings: RatingRow[][], sys: SystemEvidence, completed: number, w: Record<string, number> = DEFAULT_WEIGHTS, t: Thresholds = DEFAULT_THRESHOLDS): Performance {
  // ratings: one list per rated engagement, so the sample size counts engagements, not rows.
  const flat = ratings.flat();
  const avg = (parts: { source: RatingSource; keys: string[] }[]) => {
    const vals: number[] = [];
    for (const p of parts) for (const r of flat.filter((x) => x.source === p.source)) for (const k of p.keys) if (r.scores[k] != null) vals.push(toPercent(r.scores[k]));
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  };
  const components: Record<string, number | null> = {};
  for (const k of Object.keys(MAP)) components[k] = avg(MAP[k]);
  const d = systemDelivery(sys);
  // System evidence supports delivery and professionalism when people have not yet rated them.
  if (components.delivery == null && d.actionCompletion != null) components.delivery = d.actionCompletion;
  if (components.professionalism == null && d.attendance != null) components.professionalism = d.attendance;
  components.outcome = outcomeScore(sys.scoreChange);
  const present = Object.keys(components).filter((k) => components[k] != null);
  const totalW = present.reduce((s, k) => s + (w[k] ?? 0), 0);
  const score = present.length && totalW > 0 ? Math.round(present.reduce((s, k) => s + (components[k] as number) * (w[k] ?? 0), 0) / totalW) : null;
  const evidence: Evidence = { completed, rated: ratings.filter((r) => r.length).length, reviewed: ratings.filter((r) => r.some((x) => x.source === 'reviewer')).length };
  const conf = confidence(evidence, t);
  return { score, components, coverage: present, evidence, confidence: conf, suggestedStatus: suggestStatus(score, evidence, t), formulaVersion: FORMULA_VERSION, note: present.length < Object.keys(w).length ? `Based on ${present.length} of ${Object.keys(w).length} components. Missing components are left out and the weights are rescaled.` : 'All six components have evidence.' };
}

/** A suggestion only. Suspension, review and removal are decisions for a person. */
export function suggestStatus(score: number | null, e: Evidence, t: Thresholds = DEFAULT_THRESHOLDS): string {
  if (score == null || e.completed < t.minCompleted || e.rated < t.minRated) return 'Not enough evidence yet';
  if (score >= t.exceptional.score && e.completed >= t.exceptional.completed && e.rated >= t.exceptional.rated && e.reviewed >= t.high.reviewed) return 'Exceptional';
  if (score >= t.excellent.score && e.completed >= t.excellent.completed && e.rated >= t.excellent.rated) return 'Excellent';
  if (score >= t.good.score) return 'Good standing';
  if (score >= t.watch.score) return 'Performance watch';
  return 'Improvement required';
}
