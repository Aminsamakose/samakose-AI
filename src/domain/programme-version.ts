import type { ProgrammeVersionStatus } from '@/db/programme-version-schema';
import { conflict } from '@/lib/errors';

export const PROGRAMME_VERSION_WORKFLOW: Record<ProgrammeVersionStatus, readonly ProgrammeVersionStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['SUPERSEDED'],
  REJECTED: ['DRAFT'],
  SUPERSEDED: [],
};

export function canTransitionProgrammeVersion(from: ProgrammeVersionStatus, to: ProgrammeVersionStatus): boolean {
  return PROGRAMME_VERSION_WORKFLOW[from].includes(to);
}

export function assertProgrammeVersionTransition(from: ProgrammeVersionStatus, to: ProgrammeVersionStatus): void {
  if (!canTransitionProgrammeVersion(from, to)) throw conflict(`Invalid programme version transition: ${from} -> ${to}`);
}

export interface ProgrammeVersionInput {
  name?: string;
  funder?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  budgetGhs?: number | null;
  changeReason?: string | null;
}

export function validateProgrammeVersionForSubmission(input: ProgrammeVersionInput): string[] {
  const errors: string[] = [];
  if (!input.name?.trim()) errors.push('A programme name is required');
  if (input.startDate && input.endDate && input.endDate < input.startDate) errors.push('End date must be after the start date');
  return errors;
}
