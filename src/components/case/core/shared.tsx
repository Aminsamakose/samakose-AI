'use client';
import { useApi, Badge } from '@/components/ui';
import { CASE_TRANSITIONS } from '@/domain/logic';

/** All case states in lifecycle order, derived from the transition table (no server import). */
export const CASE_STATE_ORDER: string[] = [...CASE_TRANSITIONS.map((t) => t.from as string), CASE_TRANSITIONS[CASE_TRANSITIONS.length - 1].to as string];

export type Me = { user: { id: string; name: string; email: string; role: string; orgId?: string | null }; permissions: Record<string, string[]> };

/** Current user and permission helper. `ready` is false until /auth/me answers. */
export function useMe() {
  const st = useApi<Me>('/auth/me');
  const perms = st.data?.permissions ?? {};
  return {
    ...st,
    me: st.data?.user ?? null,
    ready: !!st.data,
    can: (resource: string, action: string) => !!perms[resource]?.includes(action)
  };
}

export const MATURITY_TONE: Record<string, string> = { Critical: 'bad', Fragile: 'warn', Developing: 'info', Strong: 'ok' };
export const CONFIDENCE_TONE: Record<string, string> = { Low: 'warn', Medium: 'info', High: 'ok' };
export const CLASS_TONE: Record<string, string> = { Verified: 'ok', 'Document-supported': 'ok', 'Self-reported': 'info', Unverified: 'warn', Missing: 'bad' };

export const StateBadge = ({ state }: { state: string }) => <Badge tone={state === 'GRADUATED' ? 'ok' : state === 'PROSPECT' ? '' : 'brand'}>{state}</Badge>;
export const MaturityBadge = ({ value }: { value: string | null | undefined }) => value ? <Badge tone={MATURITY_TONE[value] ?? ''}>{value}</Badge> : null;

export const FACT_LABEL: Record<string, string> = {
  validation_ok: 'A diagnostic has passed the data quality gate',
  scored: 'The diagnostic has been scored',
  diagnosis_approved: 'The diagnosis has been reviewed',
  prescription_in_review: 'A prescription is drafted and in review',
  prescription_approved: 'The prescription is approved',
  action_started: 'At least one action has started',
  three_sessions: 'Enough coaching sessions have been held',
  confirmed: 'A team member confirms the step'
};

/** Which case tab needs which permission. Tabs without an entry are open to anyone who can read the case. */
export const TAB_PERMISSION: Record<string, [string, string]> = {
  diagnostic: ['diagnostics', 'read'], evidence: ['evidence', 'read'], score: ['scores', 'read'], diagnosis: ['diagnoses', 'read'],
  prescription: ['prescriptions', 'read'], actions: ['actions', 'read'], kpis: ['kpis', 'read'], risks: ['risks', 'read'],
  coaching: ['sessions', 'read'], reports: ['reports', 'read']
};

export const GHANA_REGIONS = ['Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra', 'North East', 'Northern', 'Oti', 'Savannah', 'Upper East', 'Upper West', 'Volta', 'Western', 'Western North'];

export const pct = (n: number | string | null | undefined) => n === null || n === undefined ? '-' : `${Math.round(Number(n) * 100)}%`;
export const one = (n: number | string | null | undefined) => n === null || n === undefined ? '-' : Number(n).toFixed(1);
