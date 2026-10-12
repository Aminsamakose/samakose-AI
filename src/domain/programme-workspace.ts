import { badRequest, conflict } from '@/lib/errors';
import type { ProgrammeLifecycle, ProviderSource } from './programme-operating-model';

export const WORKSPACE_ROLES = [
  'PROGRAMME_MANAGER',
  'ASSESSOR',
  'EXPERT',
  'COACH',
  'REVIEWER',
  'FINANCE',
  'MEL',
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface ProgrammeWorkspace {
  id: string;
  programmeId: string;
  name: string;
  status: ProgrammeLifecycle;
  providerSource: ProviderSource;
  configurationVersion: number;
  frameworkVersionId?: string;
  participantConsentRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  active: boolean;
  joinedAt: Date;
}

const WORKSPACE_MANAGEMENT_ROLES = new Set<WorkspaceRole>(['PROGRAMME_MANAGER']);
const DELIVERY_ROLES = new Set<WorkspaceRole>([
  'PROGRAMME_MANAGER',
  'ASSESSOR',
  'EXPERT',
  'COACH',
  'REVIEWER',
  'MEL',
]);

export function canManageWorkspace(role: WorkspaceRole): boolean {
  return WORKSPACE_MANAGEMENT_ROLES.has(role);
}

export function canDeliverInWorkspace(role: WorkspaceRole): boolean {
  return DELIVERY_ROLES.has(role);
}

export function canAccessWorkspace(membership: WorkspaceMembership): boolean {
  return membership.active;
}

export function assertWorkspaceOperational(workspace: ProgrammeWorkspace): void {
  if (workspace.status === 'CLOSED' || workspace.status === 'ARCHIVED') {
    throw conflict(`Programme workspace is not operational: ${workspace.status}`);
  }
}

export function assertWorkspaceReadyForDelivery(workspace: ProgrammeWorkspace): void {
  if (!['READY', 'ACTIVE', 'COMPLETING'].includes(workspace.status)) {
    throw conflict(`Programme workspace is not ready for delivery: ${workspace.status}`);
  }
}

export function assertWorkspaceConfigurationVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) {
    throw badRequest('Workspace configuration version must be a positive integer');
  }
}

export function nextConfigurationVersion(current: number): number {
  assertWorkspaceConfigurationVersion(current);
  return current + 1;
}
