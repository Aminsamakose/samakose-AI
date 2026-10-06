import { describe, expect, it } from 'vitest';
import { can } from '@/lib/rbac';
import { assertProgrammeTransition } from '@/domain/programme-operating-model';
import { canManageWorkspace, canDeliverInWorkspace } from '@/domain/programme-workspace';
import { assertCapacity, getParticipantCapacity, getRoleCapacity, readWorkspaceEntitlements } from '@/domain/programme-entitlements';

describe('programme workspace access contract', () => {
  it('grants workspace management only to programme managers and administrators', () => {
    expect(can('PROGRAMME_MANAGER', 'programme_workspaces', 'read')).toBe(true);
    expect(can('PROGRAMME_MANAGER', 'programme_workspaces', 'create')).toBe(true);
    expect(can('PROGRAMME_MANAGER', 'programme_workspaces', 'edit')).toBe(true);
    expect(can('EXPERT', 'programme_workspaces', 'read')).toBe(true);
    expect(can('EXPERT', 'programme_workspaces', 'edit')).toBe(false);
    expect(can('OWNER', 'programme_workspaces', 'read')).toBe(false);
    expect(canManageWorkspace('PROGRAMME_MANAGER')).toBe(true);
    expect(canManageWorkspace('EXPERT')).toBe(false);
  });

  it('keeps delivery roles separate from workspace management', () => {
    for (const role of ['PROGRAMME_MANAGER', 'ASSESSOR', 'EXPERT', 'COACH', 'REVIEWER', 'MEL'] as const) {
      expect(canDeliverInWorkspace(role)).toBe(true);
    }
    expect(canDeliverInWorkspace('FINANCE')).toBe(false);
  });

  it('uses the governed programme lifecycle transitions', () => {
    expect(() => assertProgrammeTransition('DRAFT', 'COMMERCIAL_REVIEW')).not.toThrow();
    expect(() => assertProgrammeTransition('READY', 'ACTIVE')).not.toThrow();
    expect(() => assertProgrammeTransition('ARCHIVED', 'ACTIVE')).toThrow();
  });
});

describe('programme workspace entitlements', () => {
  const configuration = {
    entitlements: [
      { key: 'participant_capacity', limit: 100 },
      { key: 'expert_capacity', limit: 5 },
      { key: 'coach_capacity', limit: 10 },
      { key: 'funder_reporting', limit: true },
    ],
  };

  it('reads valid entitlement definitions and ignores malformed entries', () => {
    const entitlements = readWorkspaceEntitlements({
      ...configuration,
      entitlements: [...configuration.entitlements, { key: 'bad' }, 'invalid'],
    });
    expect(entitlements).toHaveLength(4);
    expect(getParticipantCapacity(entitlements)).toBe(100);
  });

  it('resolves role-specific team capacity without imposing a default limit', () => {
    const entitlements = readWorkspaceEntitlements(configuration);
    expect(getRoleCapacity(entitlements, 'EXPERT')).toBe(5);
    expect(getRoleCapacity(entitlements, 'COACH')).toBe(10);
    expect(getRoleCapacity(entitlements, 'ASSESSOR')).toBeNull();
  });

  it('blocks capacity exhaustion and permits usage below the limit', () => {
    expect(() => assertCapacity(5, 4, 'Expert team')).not.toThrow();
    expect(() => assertCapacity(5, 5, 'Expert team')).toThrow('Expert team capacity reached (5)');
    expect(() => assertCapacity(null, 999, 'Expert team')).not.toThrow();
  });
});
