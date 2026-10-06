import { describe, expect, it } from 'vitest';
import {
  CONFIGURATION_WORKFLOW,
  canTransitionConfiguration,
  validateConfigurationForSubmission,
} from '@/domain/programme-workspace-configuration';

describe('programme workspace configuration governance', () => {
  it('uses Draft -> Submitted -> Approved/Rejected -> Draft governance', () => {
    expect(CONFIGURATION_WORKFLOW.DRAFT).toEqual(['SUBMITTED']);
    expect(canTransitionConfiguration('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransitionConfiguration('SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransitionConfiguration('SUBMITTED', 'REJECTED')).toBe(true);
    expect(canTransitionConfiguration('REJECTED', 'DRAFT')).toBe(true);
    expect(canTransitionConfiguration('APPROVED', 'DRAFT')).toBe(false);
  });

  it('requires the minimum authoritative configuration before submission', () => {
    expect(validateConfigurationForSubmission({
      frameworkVersionId: null,
      objectives: [],
      eligibilityRules: {},
      deliveryModel: {},
      reporting: {},
    })).toHaveLength(5);

    expect(validateConfigurationForSubmission({
      frameworkVersionId: 'framework-1',
      objectives: [{ code: 'OBJ-1', title: 'Improve business health' }],
      eligibilityRules: { criteria: ['registered_business'] },
      deliveryModel: { providerSource: 'SAMAKOSE_NETWORK' },
      reporting: { indicators: ['participants', 'health_score_change'] },
    })).toEqual([]);
  });
});
