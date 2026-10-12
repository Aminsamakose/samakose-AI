import type { ProgrammeWorkspaceConfigurationStatus } from '@/db/programme-workspace-configuration-schema';
import { conflict } from '@/lib/errors';

export const CONFIGURATION_WORKFLOW: Record<ProgrammeWorkspaceConfigurationStatus, readonly ProgrammeWorkspaceConfigurationStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['SUPERSEDED'],
  REJECTED: ['DRAFT'],
  SUPERSEDED: [],
};

export function canTransitionConfiguration(
  from: ProgrammeWorkspaceConfigurationStatus,
  to: ProgrammeWorkspaceConfigurationStatus,
): boolean {
  return CONFIGURATION_WORKFLOW[from].includes(to);
}

export function assertConfigurationTransition(
  from: ProgrammeWorkspaceConfigurationStatus,
  to: ProgrammeWorkspaceConfigurationStatus,
): void {
  if (!canTransitionConfiguration(from, to)) {
    // ApiError, not a plain Error: this is routine bad input (a disallowed status change),
    // and the dispatcher would otherwise report it as an opaque 500.
    throw conflict(`Invalid workspace configuration transition: ${from} -> ${to}`);
  }
}

export interface ProgrammeWorkspaceConfigurationInput {
  configuration?: Record<string, unknown>;
  objectives?: unknown[];
  eligibilityRules?: Record<string, unknown>;
  deliveryModel?: Record<string, unknown>;
  reporting?: Record<string, unknown>;
  entitlements?: unknown[];
  frameworkVersionId?: string | null;
  participantConsentRequired?: boolean;
  funderReportingEnabled?: boolean;
  changeReason?: string | null;
}

export function validateConfigurationForSubmission(input: ProgrammeWorkspaceConfigurationInput): string[] {
  const errors: string[] = [];
  if (!input.frameworkVersionId) errors.push('A framework version must be selected before submission');
  if (!input.objectives?.length) errors.push('At least one programme objective is required');
  if (!input.eligibilityRules || Object.keys(input.eligibilityRules).length === 0) errors.push('Eligibility rules must be configured');
  if (!input.deliveryModel || Object.keys(input.deliveryModel).length === 0) errors.push('Delivery model must be configured');
  if (!input.reporting || Object.keys(input.reporting).length === 0) errors.push('Reporting configuration must be configured');
  if (input.funderReportingEnabled && Object.keys(input.reporting ?? {}).length === 0) errors.push('Funder reporting requires reporting configuration');
  return errors;
}
