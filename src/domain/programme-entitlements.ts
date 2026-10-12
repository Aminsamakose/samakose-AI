import type { WorkspaceRole } from './programme-workspace';
import { conflict } from '@/lib/errors';

export type EntitlementValue = number | boolean | string;

export interface WorkspaceEntitlement {
  key: string;
  limit: EntitlementValue;
}

export interface WorkspaceEntitlementSnapshot {
  entitlements: WorkspaceEntitlement[];
}

const ROLE_ENTITLEMENT_KEYS: Record<WorkspaceRole, string> = {
  PROGRAMME_MANAGER: 'programme_manager_capacity',
  ASSESSOR: 'assessor_capacity',
  EXPERT: 'expert_capacity',
  COACH: 'coach_capacity',
  REVIEWER: 'reviewer_capacity',
  FINANCE: 'finance_capacity',
  MEL: 'mel_capacity',
};

export function readWorkspaceEntitlements(configuration: unknown): WorkspaceEntitlement[] {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return [];
  const value = (configuration as Record<string, unknown>).entitlements;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.key !== 'string') return [];
    if (!['number', 'boolean', 'string'].includes(typeof row.limit)) return [];
    return [{ key: row.key, limit: row.limit as EntitlementValue }];
  });
}

export function getEntitlement(entitlements: WorkspaceEntitlement[], key: string): WorkspaceEntitlement | undefined {
  return entitlements.find((item) => item.key === key);
}

export function getRoleCapacity(entitlements: WorkspaceEntitlement[], role: WorkspaceRole): number | null {
  const item = getEntitlement(entitlements, ROLE_ENTITLEMENT_KEYS[role]);
  return item && typeof item.limit === 'number' ? item.limit : null;
}

export function getParticipantCapacity(entitlements: WorkspaceEntitlement[]): number | null {
  const item = getEntitlement(entitlements, 'participant_capacity');
  return item && typeof item.limit === 'number' ? item.limit : null;
}

export function isFeatureEnabled(entitlements: WorkspaceEntitlement[], key: string, defaultValue = false): boolean {
  const item = getEntitlement(entitlements, key);
  if (!item) return defaultValue;
  return typeof item.limit === 'boolean' ? item.limit : defaultValue;
}

export function assertCapacity(capacity: number | null, usage: number, label: string): void {
  if (capacity !== null && usage >= capacity) {
    // ApiError, not a plain Error: hitting an entitlement cap is routine, expected
    // behaviour under normal use, not a server fault -- the dispatcher must report it
    // as a 409, not an opaque 500.
    throw conflict(`${label} capacity reached (${capacity})`);
  }
}
