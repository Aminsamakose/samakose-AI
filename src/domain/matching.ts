/**
 * Practitioner matching. A recommendation, never an appointment: a person decides.
 * Pure and explainable. Every point comes from a named factor, and every exclusion says why.
 * Performance is deliberately not part of the score until there is enough rated history (see domain/ratings.ts).
 */
export type MatchProfile = {
  userId: string; name: string; functions: string[]; specialisations: string[]; strengths: string[]; sectors: string[]; platforms: string[];
  businessSizes: string[]; regions: string[]; languages: string[]; yearsExperience: number | null; availability: string; maxActive: number; vettingStatus: string;
};
export type MatchNeed = {
  fn: 'lead' | 'specialist' | 'coach'; platform: string; sector?: string | null; size?: string | null; region?: string | null;
  weakDimensions: string[]; specialisation?: string | null;
};
export type MatchLoad = { active: number; conflict: boolean; onCase: boolean };
export type Factor = { key: string; label: string; points: number; max: number; note: string };
export type Match = { userId: string; name: string; eligible: boolean; exclusions: string[]; score: number; factors: Factor[]; active: number; maxActive: number; evidence: string };

export const MATCH_WEIGHTS = { expertise: 35, sector: 15, platform: 10, size: 5, region: 10, capacity: 15, experience: 10 } as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const has = (list: string[], v: string | null | undefined) => !!v && list.some((x) => norm(x) === norm(v) || norm(x).includes(norm(v)) || norm(v).includes(norm(x)));

export function exclusions(p: MatchProfile, need: MatchNeed, load: MatchLoad): string[] {
  const out: string[] = [];
  if (p.vettingStatus !== 'Approved') out.push('Profile is not approved');
  if (need.fn === 'coach' ? !p.functions.includes('coach') : !p.functions.includes('expert')) out.push(need.fn === 'coach' ? 'Not set up as a coach' : 'Not set up as an expert');
  if (p.availability === 'Unavailable') out.push('Marked unavailable');
  if (load.active >= p.maxActive) out.push(`At capacity (${load.active} of ${p.maxActive} active cases)`);
  if (load.conflict) out.push('Declared conflict with this business');
  if (load.onCase) out.push('Already on this case');
  return out;
}

export function scoreMatch(p: MatchProfile, need: MatchNeed, load: MatchLoad): Match {
  const W = MATCH_WEIGHTS;
  const factors: Factor[] = [];
  const add = (key: string, label: string, ratio: number | null, max: number, note: string) => {
    // Nothing specified on the need side earns half marks and says so, so a missing detail neither rewards nor punishes.
    const r = ratio == null ? 0.5 : ratio;
    factors.push({ key, label, points: Math.round(r * max * 10) / 10, max, note: ratio == null ? `${note} (not specified, half marks)` : note });
  };
  // Expertise: the weak dimensions the person is strong in, plus a direct specialisation match.
  const weak = need.weakDimensions.filter(Boolean);
  const covered = weak.filter((d) => has(p.strengths, d));
  const dimRatio = weak.length ? covered.length / weak.length : null;
  const specHit = need.specialisation ? has(p.specialisations, need.specialisation) : null;
  const parts: [number, number][] = [];
  if (dimRatio != null) parts.push([dimRatio, 0.7]);
  if (specHit != null) parts.push([specHit ? 1 : 0, 0.3]);
  const expertise = parts.length ? parts.reduce((s, [r, w]) => s + r * w, 0) / parts.reduce((s, [, w]) => s + w, 0) : null;
  add('expertise', 'Fit with the weakest areas', expertise, W.expertise, weak.length ? `${covered.length} of ${weak.length} weak areas covered${need.specialisation ? `; specialisation ${specHit ? 'matches' : 'does not match'}` : ''}` : 'No weak areas yet');
  add('sector', 'Sector experience', need.sector ? (has(p.sectors, need.sector) ? 1 : 0) : null, W.sector, need.sector ? (has(p.sectors, need.sector) ? `Works in ${need.sector}` : `No ${need.sector} experience listed`) : 'Sector');
  add('platform', 'Platform experience', has(p.platforms, need.platform) ? 1 : 0, W.platform, has(p.platforms, need.platform) ? `Serves ${need.platform}` : `Not listed for ${need.platform}`);
  add('size', 'Business size', need.size ? (has(p.businessSizes, need.size) ? 1 : 0) : null, W.size, need.size ? `${need.size} businesses` : 'Size');
  add('region', 'Region', need.region ? (has(p.regions, need.region) ? 1 : 0) : null, W.region, need.region ? (has(p.regions, need.region) ? `Covers ${need.region}` : `Does not list ${need.region}`) : 'Region');
  const headroom = p.maxActive > 0 ? Math.max(0, (p.maxActive - load.active) / p.maxActive) : 0;
  const avail = p.availability === 'Available' ? 1 : p.availability === 'Limited' ? 0.6 : 0;
  add('capacity', 'Availability and capacity', avail * (0.4 + 0.6 * headroom), W.capacity, `${p.availability}; ${load.active} of ${p.maxActive} active cases`);
  const yrs = p.yearsExperience ?? 0;
  add('experience', 'Years of experience', Math.min(yrs, 10) / 10, W.experience, `${yrs} years`);
  const total = factors.reduce((s, f) => s + f.points, 0);
  const ex = exclusions(p, need, load);
  return { userId: p.userId, name: p.name, eligible: ex.length === 0, exclusions: ex, score: Math.round(total), factors, active: load.active, maxActive: p.maxActive, evidence: 'No engagement history yet, so performance is not part of this score' };
}

/** Eligible people first, best match first, then by lighter workload. Ineligible people are kept in the list so a human can see why. */
export const rankMatches = (ms: Match[]) => [...ms].sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.active - b.active || a.name.localeCompare(b.name));
