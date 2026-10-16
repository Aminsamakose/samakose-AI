/**
 * Shared, non-DB catalogue of plan structure: service tiers, platforms and entitlement keys/labels.
 * One source for the admin plan form (PlanForm.tsx), the public pricing page (site-content.ts), and
 * the API route validators (platform.ts) - so a tier or feature is defined once, not three times.
 * Adding an entitlement key here is a claim the product can enforce it: only add one once it's real.
 */
export const PLAN_SERVICE_TIERS = [
  { value: 'discovery', label: 'Discovery', who: 'For business owners who want an initial understanding of their business health.' },
  { value: 'diagnostic', label: 'Diagnostic', who: 'For business owners who need a comprehensive assessment and clear priorities.' },
  { value: 'transform', label: 'Transform', who: 'For businesses ready to implement improvements with structured support.' },
  { value: 'growth', label: 'Growth', who: 'For growing businesses seeking stronger market access, financing preparation and investment readiness.' },
  { value: 'programme', label: 'Programme', who: 'For programmes, partners and institutions supporting multiple businesses or organisations.' }
] as const;
export type PlanServiceTier = typeof PLAN_SERVICE_TIERS[number]['value'];

export const PLAN_PLATFORMS = [{ value: 'SME', label: 'SME360' }, { value: 'AGRIFOOD', label: 'AgriFood360' }, { value: 'ESO', label: 'ESO360' }] as const;

export const PLAN_DURATIONS = [
  { days: 30, label: '30 day plan', who: 'A fast start: fix the one or two things holding the business back.' },
  { days: 180, label: '180 day plan', who: 'Six months to build the systems behind the quick wins.' },
  { days: 360, label: '360 day plan', who: 'A full year of structured support toward investment readiness.' }
] as const;

export const PLAN_ENTITLEMENTS: { key: string; label: string; limited?: string }[] = [
  { key: 'free_assessment', label: 'Free preliminary assessment' },
  { key: 'full_assessment', label: 'Full 360 assessment' },
  { key: 'ai_assisted_report', label: 'AI-assisted diagnosis, reviewed against evidence' },
  { key: 'detailed_report', label: 'Detailed business health report' },
  { key: 'action_plan', label: 'Action plan' },
  { key: 'kpi_tracking', label: 'KPI tracking' },
  { key: 'coaching_sessions', label: 'Coaching sessions', limited: 'Sessions included' },
  { key: 'progress_reviews', label: 'Progress reviews' },
  { key: 'priority_support', label: 'Priority support' },
  { key: 'opportunity_matching', label: 'Opportunity matching (planned)' },
  { key: 'investment_readiness_pack', label: 'Investment readiness pack (planned)' },
  { key: 'cohort_management', label: 'Cohort management' },
  { key: 'coach_management', label: 'Coach management' },
  { key: 'portfolio_reporting', label: 'Portfolio intelligence and reporting', limited: 'Participant cap' }
];
export const ENTITLEMENT_LABEL: Record<string, string> = Object.fromEntries(PLAN_ENTITLEMENTS.map((e) => [e.key, e.label]));

/** A feature row rendered as a bullet, with its limit folded in (e.g. "Coaching sessions (4 included)"). */
export function entitlementLines(entitlements: { key: string; enabled: boolean; limit?: number | string }[] | null | undefined): string[] {
  return (entitlements ?? []).filter((e) => e.enabled).map((e) => {
    const label = ENTITLEMENT_LABEL[e.key] ?? e.key;
    return e.limit !== undefined && e.limit !== null && e.limit !== '' ? `${label} (${e.limit})` : label;
  });
}
