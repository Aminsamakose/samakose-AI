import { describe, expect, it } from 'vitest';
import {
  assertWorkspaceConfigurationVersion,
  assertWorkspaceOperational,
  assertWorkspaceReadyForDelivery,
  canAccessWorkspace,
  canDeliverInWorkspace,
  canManageWorkspace,
  nextConfigurationVersion,
  type ProgrammeWorkspace,
  type WorkspaceMembership,
} from '@/domain/programme-workspace';

const workspace: ProgrammeWorkspace = {
  id: 'ws-1',
  programmeId: 'prog-1',
  name: 'Test Workspace',
  status: 'READY',
  providerSource: 'HYBRID',
  configurationVersion: 1,
  participantConsentRequired: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const membership: WorkspaceMembership = {
  workspaceId: 'ws-1',
  userId: 'user-1',
  role: 'PROGRAMME_MANAGER',
  active: true,
  joinedAt: new Date(),
};

describe('programme workspace', () => {
  it('allows only programme managers to manage workspace configuration', () => {
    expect(canManageWorkspace('PROGRAMME_MANAGER')).toBe(true);
    expect(canManageWorkspace('EXPERT')).toBe(false);
  });

  it('allows delivery roles without granting workspace management', () => {
    expect(canDeliverInWorkspace('EXPERT')).toBe(true);
    expect(canDeliverInWorkspace('COACH')).toBe(true);
    expect(canDeliverInWorkspace('REVIEWER')).toBe(true);
    expect(canDeliverInWorkspace('FINANCE')).toBe(false);
    expect(canManageWorkspace('COACH')).toBe(false);
  });

  it('requires an active membership for workspace access', () => {
    expect(canAccessWorkspace(membership)).toBe(true);
    expect(canAccessWorkspace({ ...membership, active: false })).toBe(false);
  });

  it('permits delivery only from READY onward', () => {
    expect(() => assertWorkspaceReadyForDelivery(workspace)).not.toThrow();
    expect(() => assertWorkspaceReadyForDelivery({ ...workspace, status: 'CONFIGURING' })).toThrow();
    expect(() => assertWorkspaceReadyForDelivery({ ...workspace, status: 'ACTIVE' })).not.toThrow();
    expect(() => assertWorkspaceReadyForDelivery({ ...workspace, status: 'COMPLETING' })).not.toThrow();
  });

  it('blocks closed and archived workspaces', () => {
    expect(() => assertWorkspaceOperational(workspace)).not.toThrow();
    expect(() => assertWorkspaceOperational({ ...workspace, status: 'CLOSED' })).toThrow();
    expect(() => assertWorkspaceOperational({ ...workspace, status: 'ARCHIVED' })).toThrow();
  });

  it('increments configuration versions without accepting invalid versions', () => {
    expect(nextConfigurationVersion(1)).toBe(2);
    expect(nextConfigurationVersion(7)).toBe(8);
    expect(() => assertWorkspaceConfigurationVersion(0)).toThrow();
    expect(() => assertWorkspaceConfigurationVersion(1.5)).toThrow();
  });
});
