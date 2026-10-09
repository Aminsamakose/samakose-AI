import { conflict, unprocessable } from '@/lib/errors';

export const PROGRAMME_LIFECYCLE = [
  'DRAFT',
  'COMMERCIAL_REVIEW',
  'INVOICED',
  'PAYMENT_PENDING',
  'APPROVED',
  'CONFIGURING',
  'READY',
  'ACTIVE',
  'PAUSED',
  'COMPLETING',
  'COMPLETED',
  'CLOSED',
  'ARCHIVED',
] as const;

export type ProgrammeLifecycle = (typeof PROGRAMME_LIFECYCLE)[number];

export const PROVIDER_SOURCES = ['SAMAKOSE_NETWORK', 'BRING_YOUR_OWN', 'HYBRID'] as const;
export type ProviderSource = (typeof PROVIDER_SOURCES)[number];

export const PARTICIPANT_LIFECYCLE = [
  'APPLICATION',
  'ELIGIBILITY',
  'SELECTED',
  'INVITED',
  'CONSENTED',
  'ONBOARDED',
  'COHORT_ASSIGNED',
  'ACTIVE',
  'COMPLETING',
  'COMPLETED',
  'WITHDRAWN',
  'REJECTED',
] as const;

export type ParticipantLifecycle = (typeof PARTICIPANT_LIFECYCLE)[number];

export type ProgrammeEntitlementKey =
  | 'participant_capacity'
  | 'programme_managers'
  | 'assessors'
  | 'reviewers'
  | 'experts'
  | 'coaches'
  | 'cohorts'
  | 'storage_gb'
  | 'reporting_tier'
  | 'mel'
  | 'integrations'
  | 'api_access'
  | 'white_label';

export interface ProgrammeEntitlement {
  key: ProgrammeEntitlementKey;
  limit: number | boolean | string;
  used?: number;
}

export interface ProgrammeOperatingModel {
  programmeId: string;
  workspaceId: string;
  providerSource: ProviderSource;
  lifecycle: ProgrammeLifecycle;
  entitlements: ProgrammeEntitlement[];
  frameworkVersionId?: string;
  configurationVersion: number;
  participantConsentRequired: boolean;
  funderReportingEnabled: boolean;
}

export interface ProgrammeWorkspaceSummary {
  programmeId: string;
  programmeName: string;
  lifecycle: ProgrammeLifecycle;
  participants: {
    total: number;
    onboarded: number;
    active: number;
    completed: number;
  };
  cases: {
    total: number;
    diagnosed: number;
    prescribed: number;
    inTreatment: number;
    rechecked: number;
  };
  delivery: {
    overdue: number;
    atRisk: number;
    unassigned: number;
  };
}

const TRANSITIONS: Record<ProgrammeLifecycle, readonly ProgrammeLifecycle[]> = {
  DRAFT: ['COMMERCIAL_REVIEW', 'CLOSED'],
  COMMERCIAL_REVIEW: ['INVOICED', 'DRAFT', 'CLOSED'],
  INVOICED: ['PAYMENT_PENDING', 'DRAFT', 'CLOSED'],
  PAYMENT_PENDING: ['APPROVED', 'CLOSED'],
  APPROVED: ['CONFIGURING', 'CLOSED'],
  CONFIGURING: ['READY', 'PAUSED', 'CLOSED'],
  READY: ['ACTIVE', 'PAUSED', 'CLOSED'],
  ACTIVE: ['PAUSED', 'COMPLETING', 'CLOSED'],
  PAUSED: ['CONFIGURING', 'READY', 'ACTIVE', 'CLOSED'],
  COMPLETING: ['COMPLETED', 'PAUSED', 'CLOSED'],
  COMPLETED: ['CLOSED'],
  CLOSED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionProgramme(
  from: ProgrammeLifecycle,
  to: ProgrammeLifecycle,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertProgrammeTransition(
  from: ProgrammeLifecycle,
  to: ProgrammeLifecycle,
): void {
  if (!canTransitionProgramme(from, to)) {
    // An ApiError so the dispatcher reports this as a client-caused 409, not a 500:
    // an invalid status transition is routine bad input, not a server fault.
    throw conflict(`Invalid programme lifecycle transition: ${from} -> ${to}`);
  }
}

export function isProgrammeActive(lifecycle: ProgrammeLifecycle): boolean {
  return lifecycle === 'ACTIVE' || lifecycle === 'COMPLETING';
}

export function hasEntitlement(
  entitlements: ProgrammeEntitlement[],
  key: ProgrammeEntitlementKey,
): boolean {
  return entitlements.some((item) => item.key === key && item.limit !== false);
}

export function assertWithinEntitlement(
  entitlements: ProgrammeEntitlement[],
  key: ProgrammeEntitlementKey,
  requestedUsage: number,
): void {
  const entitlement = entitlements.find((item) => item.key === key);
  if (!entitlement) {
    throw unprocessable(`Programme entitlement is not configured: ${key}`);
  }
  if (typeof entitlement.limit !== 'number') {
    return;
  }
  if (requestedUsage > entitlement.limit) {
    throw conflict(
      `Programme entitlement exceeded: ${key} (${requestedUsage}/${entitlement.limit})`,
    );
  }
}
