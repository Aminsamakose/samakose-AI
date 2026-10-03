import draftMapping from '../../docs/frameworks/role-mapping/role-mapping-v1.json';

/** Registration routing. Pure functions: no database, no permissions.
 *  Job role is not permission. Routing only suggests who answers which assessment area; the owner confirms. */

export type Platform = 'SME360' | 'AGRIFOOD360' | 'ESO360';
export type AssessmentMode = 'self' | 'team' | 'hybrid';
export const PLATFORMS: Platform[] = ['SME360', 'AGRIFOOD360', 'ESO360'];
export const MODES: AssessmentMode[] = ['self', 'team', 'hybrid'];
export const OTHER_ROLE = 'OTHER';

export type RoleMapping = {
  fallback: Record<string, string>;
  roles: Record<string, Record<string, string>>;
  map: Record<string, Record<string, { primary: string[]; contributor: string[] }>>;
};

/** The reviewed draft that ships with the code. A Published mapping from the database replaces it. */
export const DRAFT_MAPPING = draftMapping as unknown as RoleMapping;

export function platformForOrgType(t: 'SME' | 'AGRIFOOD' | 'ESO' | undefined | null): Platform {
  return t === 'AGRIFOOD' ? 'AGRIFOOD360' : t === 'ESO' ? 'ESO360' : 'SME360';
}

export const rolesFor = (m: RoleMapping, p: Platform): string[] => Object.keys(m.roles[p] ?? {});
export const isKnownRole = (m: RoleMapping, p: Platform, role: string) => role === OTHER_ROLE || rolesFor(m, p).includes(role);

/** Who answers an area by default: the first primary role present in the team, else the assessment owner (the fallback role). */
export function defaultRespondent(m: RoleMapping, p: Platform, subDimension: string, present: string[]): string {
  const fallback = m.fallback[p];
  const e = m.map[p]?.[subDimension];
  if (!e) return fallback;
  return e.primary.find((r) => present.includes(r)) ?? fallback;
}

export type Suggestion = {
  platform: Platform; mode: AssessmentMode; jobRole: string;
  /** Areas this person would answer first. */
  mine: string[];
  /** Areas that would need someone else (team mode) or an expert (hybrid). */
  others: { subDimension: string; suggestedRole: string }[];
  /** Low confidence always asks the person. */
  needsConfirmation: boolean;
  source: 'rule';
};

/** Suggests, never decides. `team` lists other job roles the owner says are available; the registrant's own role is always present. */
export function suggest(m: RoleMapping, p: Platform, jobRole: string, mode: AssessmentMode, team: string[] = []): Suggestion {
  const subs = Object.keys(m.map[p] ?? {});
  const fallback = m.fallback[p];
  const known = jobRole !== OTHER_ROLE && isKnownRole(m, p, jobRole);
  if (mode === 'self' || mode === 'hybrid') {
    // One person answers everything (self), or an expert helps (hybrid) and the owner confirms. No splitting by role.
    return { platform: p, mode, jobRole, mine: mode === 'self' ? subs : [], others: mode === 'self' ? [] : subs.map((s) => ({ subDimension: s, suggestedRole: 'EXPERT' })), needsConfirmation: !known, source: 'rule' };
  }
  const present = Array.from(new Set([jobRole, ...team].filter((r) => r !== OTHER_ROLE)));
  const mine: string[] = []; const others: Suggestion['others'] = [];
  for (const s of subs) {
    const r = defaultRespondent(m, p, s, present);
    if (r === jobRole || (!known && r === fallback)) mine.push(s); else others.push({ subDimension: s, suggestedRole: r });
  }
  return { platform: p, mode, jobRole, mine, others, needsConfirmation: !known, source: 'rule' };
}
