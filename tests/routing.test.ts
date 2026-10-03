import { describe, expect, it } from 'vitest';
import { DRAFT_MAPPING as M, PLATFORMS, MODES, defaultRespondent, isKnownRole, platformForOrgType, suggest } from '@/domain/routing';

describe('registration routing (pure rules)', () => {
  it('maps organisation type to platform', () => {
    expect(platformForOrgType('SME')).toBe('SME360'); expect(platformForOrgType('AGRIFOOD')).toBe('AGRIFOOD360'); expect(platformForOrgType('ESO')).toBe('ESO360'); expect(platformForOrgType(undefined)).toBe('SME360');
  });

  for (const p of PLATFORMS) {
    const subs = Object.keys(M.map[p]);
    it(`${p}: every role, every mode, no area lost and none answered twice`, () => {
      for (const role of Object.keys(M.roles[p])) for (const mode of MODES) {
        const s = suggest(M, p, role, mode);
        const covered = [...s.mine, ...s.others.map((o) => o.subDimension)].sort();
        expect(covered, `${role}/${mode}`).toEqual([...subs].sort());
        expect(new Set(covered).size).toBe(covered.length);
        expect(s.needsConfirmation).toBe(false);
      }
    });
    it(`${p}: self routes everything to the registrant`, () => {
      const s = suggest(M, p, Object.keys(M.roles[p])[0], 'self'); expect(s.mine.length).toBe(subs.length); expect(s.others).toEqual([]);
    });
    it(`${p}: hybrid hands every area to the expert for the owner to confirm`, () => {
      const s = suggest(M, p, Object.keys(M.roles[p])[0], 'hybrid'); expect(s.mine).toEqual([]); expect(s.others.every((o) => o.suggestedRole === 'EXPERT')).toBe(true);
    });
    it(`${p}: with no team, the owner or executive role answers every area (the fallback)`, () => {
      const s = suggest(M, p, M.fallback[p], 'team'); expect(s.mine.length).toBe(subs.length);
    });
    it(`${p}: a non-owner alone in team mode gets only the areas where they are the first primary, the rest fall to the fallback role`, () => {
      const role = Object.keys(M.roles[p]).find((r) => r !== M.fallback[p])!;
      const s = suggest(M, p, role, 'team');
      for (const sub of s.mine) expect(M.map[p][sub].primary.find((r) => [role].includes(r)) ?? M.fallback[p]).toBe(role);
      for (const o of s.others) expect(o.suggestedRole).toBe(M.fallback[p]);
    });
  }

  it('picks the first primary role present, else the fallback', () => {
    expect(defaultRespondent(M, 'SME360', '1.2', ['MARKETING_SALES', 'OWNER'])).toBe('MARKETING_SALES');
    expect(defaultRespondent(M, 'SME360', '1.2', ['OWNER'])).toBe('OWNER');
    expect(defaultRespondent(M, 'SME360', '1.2', ['FINANCE'])).toBe('OWNER');
    expect(defaultRespondent(M, 'SME360', 'nope', ['FINANCE'])).toBe('OWNER');
  });

  it('Other, or a role from the wrong platform, is low confidence and always asks', () => {
    expect(suggest(M, 'SME360', 'OTHER', 'team').needsConfirmation).toBe(true);
    expect(isKnownRole(M, 'SME360', 'PRODUCTION')).toBe(false);
    expect(suggest(M, 'SME360', 'PRODUCTION', 'self').needsConfirmation).toBe(true);
  });
});
