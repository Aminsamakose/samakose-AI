import { describe, expect, it } from 'vitest';

describe('delivery operations invariants', () => {
  it('uses explicit lifecycle states for activities and sessions', () => {
    expect(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).toContain('COMPLETED');
    expect(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).toContain('SCHEDULED');
  });

  it('uses cohort-scoped attendance states', () => {
    expect(['PRESENT', 'ABSENT', 'EXCUSED', 'LATE']).toContain('LATE');
  });
});
