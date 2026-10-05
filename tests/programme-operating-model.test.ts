import { describe, expect, it } from 'vitest';
import {
  assertProgrammeTransition,
  assertWithinEntitlement,
  canTransitionProgramme,
  hasEntitlement,
} from '../src/domain/programme-operating-model';

describe('Programme Operating Model', () => {
  it('allows the commercial-to-delivery lifecycle', () => {
    expect(canTransitionProgramme('DRAFT', 'COMMERCIAL_REVIEW')).toBe(true);
    expect(canTransitionProgramme('PAYMENT_PENDING', 'APPROVED')).toBe(true);
    expect(canTransitionProgramme('APPROVED', 'CONFIGURING')).toBe(true);
    expect(canTransitionProgramme('READY', 'ACTIVE')).toBe(true);
    expect(canTransitionProgramme('ACTIVE', 'COMPLETING')).toBe(true);
    expect(canTransitionProgramme('COMPLETING', 'COMPLETED')).toBe(true);
    expect(canTransitionProgramme('COMPLETED', 'CLOSED')).toBe(true);
    expect(canTransitionProgramme('CLOSED', 'ARCHIVED')).toBe(true);
  });

  it('rejects unsafe lifecycle jumps', () => {
    expect(canTransitionProgramme('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransitionProgramme('ARCHIVED', 'ACTIVE')).toBe(false);
    expect(() => assertProgrammeTransition('DRAFT', 'ACTIVE')).toThrow(
      'Invalid programme lifecycle transition',
    );
  });

  it('enforces numeric programme entitlements', () => {
    const entitlements = [
      { key: 'participant_capacity' as const, limit: 100, used: 90 },
      { key: 'mel' as const, limit: true },
    ];

    expect(hasEntitlement(entitlements, 'participant_capacity')).toBe(true);
    expect(hasEntitlement(entitlements, 'mel')).toBe(true);
    expect(() =>
      assertWithinEntitlement(entitlements, 'participant_capacity', 100),
    ).not.toThrow();
    expect(() =>
      assertWithinEntitlement(entitlements, 'participant_capacity', 101),
    ).toThrow('Programme entitlement exceeded');
  });

  it('fails closed when an entitlement is missing', () => {
    expect(() =>
      assertWithinEntitlement([], 'coaches', 1),
    ).toThrow('Programme entitlement is not configured');
  });
});
