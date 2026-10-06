import { describe, expect, it } from 'vitest';
import { PARTICIPANT_LIFECYCLE, canTransitionParticipant } from '@/services/programme-participant-lifecycle';

describe('programme participant lifecycle', () => {
  it('defines the governed lifecycle in order', () => {
    expect(PARTICIPANT_LIFECYCLE).toEqual([
      'APPLICATION', 'ELIGIBILITY', 'SELECTED', 'INVITED', 'CONSENTED', 'ONBOARDED',
      'COHORT_ASSIGNED', 'ACTIVE', 'COMPLETING', 'COMPLETED', 'WITHDRAWN', 'REJECTED',
    ]);
  });

  it('allows only governed forward and exit transitions', () => {
    expect(canTransitionParticipant('APPLICATION', 'ELIGIBILITY')).toBe(true);
    expect(canTransitionParticipant('INVITED', 'CONSENTED')).toBe(true);
    expect(canTransitionParticipant('ONBOARDED', 'COHORT_ASSIGNED')).toBe(true);
    expect(canTransitionParticipant('ACTIVE', 'WITHDRAWN')).toBe(true);
    expect(canTransitionParticipant('COMPLETED', 'ACTIVE')).toBe(false);
    expect(canTransitionParticipant('APPLICATION', 'ACTIVE')).toBe(false);
  });
});
