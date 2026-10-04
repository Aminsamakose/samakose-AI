/**
 * Practitioner profile rules. Pure functions: no database, no permissions.
 * One profile per expert or coach. The profile says who the person is and what they can take on.
 * It never says how well they perform: that comes from ratings and delivery evidence (domain/ratings.ts).
 */
export const PLATFORM_CODES = ['SME360', 'AGRIFOOD360', 'ESO360'] as const;
export const DELIVERY_MODES = ['In person', 'Remote', 'Hybrid'] as const;
/** Suggested specialisations. Administrators can accept others; a profile may list any value of up to 60 characters. */
export const SPECIALISATION_SUGGESTIONS = [
  'Business strategy', 'Financial management', 'Investment readiness', 'Marketing and sales', 'Operations', 'People and HR',
  'Governance', 'Digitalisation', 'Legal and compliance', 'Business planning', 'Market research', 'Grant and proposal development',
  'Agribusiness', 'Agricultural value chains', 'Climate resilience', 'ESG and sustainability', 'Process and SOP development',
  'Organisational development', 'Leadership and management coaching', 'Execution and accountability coaching', 'Founder development',
  'Women and youth enterprise development'
] as const;
export const CONDUCT_VERSION = '2026-10';
export const CONDUCT_TEXT = [
  'I will keep every business\'s information confidential and use it only for the work I am assigned.',
  'I will declare any conflict of interest before I accept an assignment and will not work with businesses I have a conflict with.',
  'I will not change a score, an approved prescription or a certificate decision. I will raise concerns through the platform.',
  'I understand that my work is rated by the business, the reviewer and the programme manager, and that I can appeal a rating I believe is unfair.',
  'I understand that my profile, photo and ratings are personal data handled under the Data Protection Act, 2012 (Act 843).'
] as const;

export type ProfileFacts = {
  headline: string | null; bio: string | null; functions: string[]; specialisations: string[]; strengths: string[]; sectors: string[]; platforms: string[];
  languages: string[]; regions: string[]; deliveryModes: string[]; yearsExperience: number | null; credentials: unknown[]; conductAcceptedAt: Date | string | null;
};

/** What is still needed before a profile can be submitted. Weighted so the percentage means something. */
export function completeness(p: ProfileFacts, hasPhoto: boolean): { percent: number; missing: string[]; canSubmit: boolean } {
  const checks: { ok: boolean; label: string; weight: number; required: boolean }[] = [
    { ok: !!p.headline?.trim(), label: 'A one-line headline', weight: 8, required: true },
    { ok: (p.bio?.trim().length ?? 0) >= 40, label: 'A short biography (at least 40 characters)', weight: 14, required: true },
    { ok: p.functions.length > 0, label: 'Whether you work as an expert, a coach or both', weight: 6, required: true },
    { ok: p.specialisations.length > 0, label: 'At least one specialisation', weight: 14, required: true },
    { ok: p.strengths.length > 0, label: 'At least one assessment dimension you are strong in', weight: 8, required: false },
    { ok: p.sectors.length > 0, label: 'At least one sector', weight: 8, required: true },
    { ok: p.platforms.length > 0, label: 'At least one platform (SME360, AgriFood360, ESO360)', weight: 8, required: true },
    { ok: p.languages.length > 0, label: 'At least one language', weight: 5, required: true },
    { ok: p.regions.length > 0, label: 'At least one region you can serve', weight: 5, required: true },
    { ok: p.deliveryModes.length > 0, label: 'How you deliver (in person, remote or hybrid)', weight: 3, required: false },
    { ok: p.yearsExperience != null && p.yearsExperience >= 0, label: 'Years of experience', weight: 5, required: true },
    { ok: p.credentials.length > 0, label: 'At least one qualification or certification', weight: 8, required: false },
    { ok: hasPhoto, label: 'A profile photo', weight: 4, required: false },
    { ok: !!p.conductAcceptedAt, label: 'Acceptance of the code of conduct', weight: 4, required: true }
  ];
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const done = checks.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0);
  const missing = checks.filter((c) => !c.ok).map((c) => c.label);
  return { percent: Math.round((done / total) * 100), missing, canSubmit: checks.every((c) => c.ok || !c.required) };
}

export type VettingStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Suspended';
/** Vetting moves only along these steps. A person who is Rejected or Suspended must be re-submitted. */
export const VETTING_TRANSITIONS: Record<VettingStatus, VettingStatus[]> = {
  Draft: ['Submitted'], Submitted: ['Approved', 'Rejected', 'Draft'], Approved: ['Suspended', 'Draft'], Rejected: ['Draft', 'Submitted'], Suspended: ['Approved', 'Draft']
};
export const canMoveVetting = (from: VettingStatus, to: VettingStatus) => VETTING_TRANSITIONS[from]?.includes(to) ?? false;

/** Only an approved, available practitioner can take new work. */
export function assignability(p: { vettingStatus: string; availability: string; functions: string[] } | null, fn: 'lead' | 'specialist' | 'coach' | 'reviewer'): { ok: boolean; reason?: string } {
  if (fn === 'reviewer') return { ok: true };
  if (!p) return { ok: false, reason: 'This person has no practitioner profile yet' };
  if (p.vettingStatus !== 'Approved') return { ok: false, reason: `This person's profile is ${p.vettingStatus.toLowerCase()}, not approved` };
  if (fn === 'coach' ? !p.functions.includes('coach') : !p.functions.includes('expert')) return { ok: false, reason: `This person is not set up to work as ${fn === 'coach' ? 'a coach' : 'an expert'}` };
  return { ok: true };
}

/** Normalises a list entered by a person: trims, drops blanks and duplicates, caps length and count. */
export function cleanList(v: unknown, max = 20, len = 60): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of v) {
    const t = String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, len);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
    if (out.length >= max) break;
  }
  return out;
}
