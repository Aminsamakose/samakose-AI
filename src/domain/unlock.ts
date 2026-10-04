/**
 * UNLOCK rules. Pure functions, no database.
 * An opportunity states its own criteria. The matcher compares an enterprise's Business Health Record to them and explains the result.
 * It never decides a referral: a person approves, and the owner consents first.
 * Two kinds of criteria are kept apart. Fit (sector, region, size, type, country) cannot be changed by the enterprise, so a miss means the opportunity is not for them.
 * Readiness (score, certification, readiness indices, dimensions) can be improved, so a miss becomes a gap that the prescription can close.
 */
export const READINESS_ORDER = ['Not ready', 'Emerging', 'Conditionally ready', 'Ready'] as const;
export const CERT_ORDER = ['Foundation', 'Established', 'Investment-ready'] as const;
export const CONSENT_SCOPES = ['overall', 'maturity', 'dimensions', 'certification', 'readiness'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export type Criteria = {
  minOverall?: number;
  /** Lowest confidence class accepted for the score. */
  minConfidence?: 'Medium' | 'High';
  /** Lowest certification level accepted. The certificate must be Certified and in date. */
  certification?: (typeof CERT_ORDER)[number];
  readiness?: { code: string; min: 'Conditionally ready' | 'Ready' }[];
  dimensionMin?: Record<string, number>;
  sectors?: string[]; regions?: string[]; sizes?: string[]; orgTypes?: string[]; countries?: string[];
  minYearsOperating?: number;
};

export type Facts = {
  org: { type: string; sector: string | null; region: string | null; size: string | null; countryCode: string; yearsOperating: number | null };
  score: { overall: number; confidence: 'Low' | 'Medium' | 'High'; maturity: string; dimensions: { dimension: string; value: number }[]; readiness: { code: string; name: string; level: string }[] } | null;
  /** Highest certification level that is Certified and in date, or null. */
  certification: (typeof CERT_ORDER)[number] | null;
};

export type Gap = { id: string; label: string; detail: string };
export type Evaluation = {
  status: 'Eligible' | 'Close' | 'Not yet' | 'Not a fit' | 'Unknown';
  summary: string;
  met: string[]; gaps: Gap[]; mismatches: string[];
  /** Plain note when the result rests on a score the platform is not confident in. */
  caution: string | null;
};

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const oneOf = (list: string[] | undefined, v: string | null) => !list?.length || list.some((x) => norm(x) === norm(v));
const rank = <T extends readonly string[]>(order: T, v: string | null | undefined) => (v ? order.indexOf(v as T[number]) : -1);
export const CLOSE_MAX_GAPS = 3;

/** True when the criteria ask anything about readiness. */
export const needsReadiness = (c: Criteria) => c.minOverall !== undefined || !!c.minConfidence || !!c.certification || !!c.readiness?.length || !!c.dimensionMin && Object.keys(c.dimensionMin).length > 0;

export function evaluate(c: Criteria, f: Facts): Evaluation {
  const met: string[] = [], gaps: Gap[] = [], mismatches: string[] = [];

  // Fit: not something the enterprise can change.
  const fit = (ok: boolean, label: string, have: string | null, want: string[] | undefined) => {
    if (!want?.length) return;
    if (ok) met.push(`${label}: ${have}`); else mismatches.push(`${label} must be ${want.join(' or ')}${have ? ` (yours is ${have})` : ' (not recorded)'}`);
  };
  fit(oneOf(c.sectors, f.org.sector), 'Sector', f.org.sector, c.sectors);
  fit(oneOf(c.regions, f.org.region), 'Region', f.org.region, c.regions);
  fit(oneOf(c.sizes, f.org.size), 'Size', f.org.size, c.sizes);
  fit(oneOf(c.orgTypes, f.org.type), 'Organisation type', f.org.type, c.orgTypes);
  fit(oneOf(c.countries, f.org.countryCode), 'Country', f.org.countryCode, c.countries);
  if (c.minYearsOperating !== undefined) {
    const y = f.org.yearsOperating;
    if (y !== null && y >= c.minYearsOperating) met.push(`Operating for ${y} years`);
    else mismatches.push(`Must have operated for at least ${c.minYearsOperating} years${y === null ? ' (not recorded)' : ` (yours is ${y})`}`);
  }
  if (mismatches.length) return { status: 'Not a fit', summary: mismatches[0], met, gaps, mismatches, caution: null };

  // Readiness: can be improved.
  if (!needsReadiness(c)) return { status: 'Eligible', summary: 'Open to you. This opportunity sets no readiness requirement.', met, gaps, mismatches, caution: null };
  const s = f.score;
  if (!s) return { status: 'Unknown', summary: 'Complete a health check so we can see whether you meet the requirements.', met, gaps: [{ id: 'check', label: 'No health score yet', detail: 'The requirements are measured from your Business Health Record.' }], mismatches, caution: null };

  if (c.minOverall !== undefined) {
    if (s.overall >= c.minOverall) met.push(`Overall score ${s.overall} (needs ${c.minOverall})`);
    else gaps.push({ id: 'overall', label: `Raise the overall score to ${c.minOverall}`, detail: `Now ${s.overall}, which is ${Math.round((c.minOverall - s.overall) * 10) / 10} short.` });
  }
  for (const [dim, min] of Object.entries(c.dimensionMin ?? {})) {
    const d = s.dimensions.find((x) => norm(x.dimension) === norm(dim));
    if (d && d.value >= min) met.push(`${dim} ${d.value} (needs ${min})`);
    else gaps.push({ id: `dim:${dim}`, label: `Raise ${dim} to ${min}`, detail: d ? `Now ${d.value}.` : 'Not scored.' });
  }
  for (const r of c.readiness ?? []) {
    const have = s.readiness.find((x) => x.code === r.code);
    if (have && rank(READINESS_ORDER, have.level) >= rank(READINESS_ORDER, r.min)) met.push(`${have.name}: ${have.level}`);
    else gaps.push({ id: `ready:${r.code}`, label: `Reach "${r.min}" on ${have?.name ?? r.code}`, detail: have ? `Now ${have.level}.` : 'Not measured by the framework version you were scored on.' });
  }
  if (c.certification) {
    if (f.certification && rank(CERT_ORDER, f.certification) >= rank(CERT_ORDER, c.certification)) met.push(`Certified ${f.certification}`);
    else gaps.push({ id: 'cert', label: `Earn ${c.certification} certification`, detail: f.certification ? `Now ${f.certification}.` : 'No current certificate.' });
  }
  let caution: string | null = null;
  if (c.minConfidence) {
    const ok = rank(['Low', 'Medium', 'High'], s.confidence) >= rank(['Low', 'Medium', 'High'], c.minConfidence);
    if (ok) met.push(`Score confidence ${s.confidence}`); else gaps.push({ id: 'confidence', label: `Strengthen the evidence behind your score to ${c.minConfidence} confidence`, detail: `Now ${s.confidence}. Verified documents raise confidence.` });
  } else if (s.confidence === 'Low' && gaps.length === 0) {
    // Meeting the numbers on a weakly evidenced score is not the same as being ready.
    caution = 'Your score has Low confidence, so this match may change once evidence is verified.';
    gaps.push({ id: 'confidence', label: 'Strengthen the evidence behind your score', detail: 'Verified documents raise confidence. A staff member will check this before any referral.' });
  }

  if (!gaps.length) return { status: 'Eligible', summary: 'You meet every requirement on your current record.', met, gaps, mismatches, caution };
  const closable = gaps.length <= CLOSE_MAX_GAPS;
  return { status: closable ? 'Close' : 'Not yet', summary: `${gaps.length} requirement${gaps.length === 1 ? '' : 's'} to meet.`, met, gaps, mismatches, caution };
}

/** Which statuses may follow which, for staff. Owners withdraw separately. */
export const REFERRAL_NEXT: Record<string, string[]> = {
  Suggested: ['Declined'], Consented: ['Declined'], Approved: ['Referred', 'Declined'],
  Referred: ['Applied', 'Declined'], Applied: ['Shortlisted', 'Awarded', 'Declined'], Shortlisted: ['Awarded', 'Declined']
};
export const REFERRAL_TERMINAL = ['Awarded', 'Declined', 'Withdrawn'];
export const canAdvance = (from: string, to: string) => !!REFERRAL_NEXT[from]?.includes(to);
export const isOpenReferral = (status: string) => !REFERRAL_TERMINAL.includes(status);

/** Closed or past its deadline means no new referrals. A missing deadline means rolling. */
export function acceptingReferrals(o: { status: string; deadline: string | Date | null }, now = new Date()) {
  if (o.status !== 'Open') return false;
  if (!o.deadline) return true;
  const end = new Date(o.deadline); end.setUTCHours(23, 59, 59, 999);
  return end >= now;
}
