import { describe, expect, it } from 'vitest';
import { can } from '@/lib/rbac';
import { assertProgrammeTransition } from '@/domain/programme-operating-model';
import { canManageWorkspace, canDeliverInWorkspace } from '@/domain/programme-workspace';

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
