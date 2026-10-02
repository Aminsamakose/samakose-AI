import { describe, expect, it } from 'vitest';
import { mockDiagnosis } from '@/domain/mockai';
import { AI_CASES } from './cases';
import { checkDiagnosis } from './checks';

describe('AI evaluation library (mock model)', () => {
  for (const c of AI_CASES) it(`mock diagnosis passes the governance checks: ${c.name}`, () => expect(checkDiagnosis(c, mockDiagnosis(c.context)), c.why).toEqual([]));
  it('the checks themselves catch invented figures, certification claims and bad evidence ids', () => {
    const c = AI_CASES[0], good = mockDiagnosis(c.context);
    expect(checkDiagnosis(c, { ...good, summary: good.summary + ' Revenue fell 47 percent.' }).join()).toMatch(/47/);
    expect(checkDiagnosis(c, { ...good, summary: good.summary + ' We certify this business.' }).join()).toMatch(/certification/);
    expect(checkDiagnosis(c, { ...good, root_causes: [{ cause: 'Records and systems gap', evidence_ids: ['ev-FAKE'] }] }).join()).toMatch(/Unknown evidence id/);
    expect(checkDiagnosis(AI_CASES[2], { ...mockDiagnosis(AI_CASES[2].context), summary: 'Finance is weak and we are certain of it.' }).join()).toMatch(/certain|Overstates/);
  });
});
