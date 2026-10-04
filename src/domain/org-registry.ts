/** Pure rules for the organisation registry: how complete a record is, and which records look like the same business. */

export type OrgFacts = {
  name?: string | null; type?: string | null; sector?: string | null; region?: string | null; district?: string | null; size?: string | null;
  registrationNumber?: string | null; tin?: string | null; contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null;
  yearsOperating?: number | null; ownershipStructure?: string | null; geoUnitId?: string | null; consentAt?: Date | string | null;
};

/** Weights sum to 100. Identity and contact fields count most because they decide whether two records can be matched and a person reached. */
export const COMPLETENESS_FIELDS: { key: keyof OrgFacts; label: string; weight: number }[] = [
  { key: 'name', label: 'Name', weight: 10 }, { key: 'type', label: 'Type', weight: 5 }, { key: 'sector', label: 'Sector', weight: 8 },
  { key: 'region', label: 'Region', weight: 6 }, { key: 'district', label: 'District', weight: 6 }, { key: 'size', label: 'Size', weight: 6 },
  { key: 'registrationNumber', label: 'Registration number', weight: 10 }, { key: 'tin', label: 'Tax identification number', weight: 10 },
  { key: 'contactName', label: 'Contact person', weight: 6 }, { key: 'contactEmail', label: 'Contact email', weight: 6 }, { key: 'contactPhone', label: 'Contact phone', weight: 6 },
  { key: 'yearsOperating', label: 'Years operating', weight: 5 }, { key: 'ownershipStructure', label: 'Ownership structure', weight: 5 },
  { key: 'geoUnitId', label: 'Location on the map', weight: 3 }, { key: 'consentAt', label: 'Consent recorded', weight: 8 }
];

const filled = (v: unknown) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');

export function completeness(o: OrgFacts) {
  let got = 0; const missing: string[] = [];
  for (const f of COMPLETENESS_FIELDS) { if (filled(o[f.key])) got += f.weight; else missing.push(f.label); }
  const score = Math.round(got);
  return { score, band: score >= 80 ? 'Complete' : score >= 50 ? 'Partial' : 'Thin', missing };
}

const SUFFIX = /\b(ltd|limited|llc|inc|incorporated|co|company|enterprise|enterprises|ent|gh|ghana|coop|cooperative|society)\b/g;
/** Lowercase, drop punctuation and legal suffixes, collapse spaces. "Tamale Shea Enterprise Ltd." and "tamale shea" match. */
export function normaliseName(n: string) {
  return n.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}
export const normaliseId = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const normalisePhone = (v: string | null | undefined) => { const d = (v ?? '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };

export type DupRow = { id: string; code: string; name: string; region: string | null; tin: string | null; registrationNumber: string | null; contactEmail: string | null; contactPhone: string | null; caseCount: number };
export type DupGroup = { reason: 'tin' | 'registration' | 'name' | 'email' | 'phone'; strength: 'certain' | 'likely' | 'possible'; ids: string[]; rows: DupRow[] };

/** Groups records that share an identifier. Shared TIN or registration number is certain; a shared normalised name in the same region is likely; shared contact is only possible. */
export function findDuplicates(rows: DupRow[]): DupGroup[] {
  const rules: { reason: DupGroup['reason']; strength: DupGroup['strength']; key: (r: DupRow) => string }[] = [
    { reason: 'tin', strength: 'certain', key: (r) => normaliseId(r.tin) },
    { reason: 'registration', strength: 'certain', key: (r) => normaliseId(r.registrationNumber) },
    { reason: 'name', strength: 'likely', key: (r) => { const n = normaliseName(r.name); return n.length >= 3 ? `${n}|${(r.region ?? '').toLowerCase()}` : ''; } },
    { reason: 'email', strength: 'possible', key: (r) => (r.contactEmail ?? '').trim().toLowerCase() },
    { reason: 'phone', strength: 'possible', key: (r) => normalisePhone(r.contactPhone) }
  ];
  const out: DupGroup[] = []; const seen = new Set<string>();
  for (const rule of rules) {
    const m = new Map<string, DupRow[]>();
    for (const r of rows) { const k = rule.key(r); if (!k) continue; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    for (const g of m.values()) {
      if (g.length < 2) continue;
      const ids = g.map((r) => r.id).sort();
      const sig = ids.join(',');
      if (seen.has(sig)) continue; // a stronger rule already reported this exact set
      seen.add(sig);
      out.push({ reason: rule.reason, strength: rule.strength, ids, rows: g });
    }
  }
  return out;
}
