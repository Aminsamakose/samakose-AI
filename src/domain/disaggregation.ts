/** Funder breakdowns by gender, youth and disability. Pure functions only: the database work is in services/disaggregation.ts.
 *  Rules: only businesses whose lead owner agreed to anonymous totals AND answered the question are counted by group;
 *  everyone else is "Not reported". A group under the minimum is hidden, and so is the next smallest when a single hidden
 *  group could be worked out by subtraction. Averages are hidden when fewer than the minimum have a score. */
export type Row = { gender: string | null; ageBand: string | null; disability: string | null; overall: number | null; change: number | null };
export type OutGroup = { key: string; n: number | null; avgScore: number | null; avgChange: number | null };
export type Attribute = { key: 'gender' | 'youth' | 'disability'; label: string; groups: OutGroup[] };

export const NOT_REPORTED = 'Not reported';
export const genderOf = (r: Row) => r.gender === 'Female' || r.gender === 'Male' ? r.gender : null;
export const youthOf = (r: Row) => ['18-24', '25-35'].includes(r.ageBand ?? '') ? 'Youth (35 and under)' : ['36-45', '46-55', '56+'].includes(r.ageBand ?? '') ? 'Over 35' : null;
export const disabilityOf = (r: Row) => r.disability === 'Yes' ? 'Person with a disability' : r.disability === 'No' ? 'No disability' : null;

const avg = (xs: number[]) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

export function breakdown(rows: Row[], pick: (r: Row) => string | null, min: number, order: string[]): OutGroup[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) { const k = pick(r) ?? NOT_REPORTED; by.set(k, [...(by.get(k) ?? []), r]); }
  const keys = [...order, NOT_REPORTED].filter((k) => by.has(k));
  const groups: OutGroup[] = keys.map((k) => {
    const rs = by.get(k)!; const scored = rs.filter((r) => r.overall !== null).map((r) => r.overall as number); const ch = rs.filter((r) => r.change !== null).map((r) => r.change as number);
    const reported = k !== NOT_REPORTED;
    return { key: k, n: rs.length >= min ? rs.length : null, avgScore: reported && rs.length >= min && scored.length >= min ? avg(scored) : null, avgChange: reported && rs.length >= min && ch.length >= min ? avg(ch) : null };
  });
  const hidden = groups.filter((g) => g.n === null);
  if (hidden.length === 1) {
    const visible = groups.filter((g) => g.n !== null).sort((a, b) => a.n! - b.n!);
    if (visible[0]) { visible[0].n = null; visible[0].avgScore = null; visible[0].avgChange = null; }
  }
  return groups;
}

export function disaggregate(rows: Row[], min: number): Attribute[] {
  if (rows.length < min) return [];
  return [
    { key: 'gender', label: 'Gender', groups: breakdown(rows, genderOf, min, ['Female', 'Male']) },
    { key: 'youth', label: 'Youth', groups: breakdown(rows, youthOf, min, ['Youth (35 and under)', 'Over 35']) },
    { key: 'disability', label: 'Disability', groups: breakdown(rows, disabilityOf, min, ['Person with a disability', 'No disability']) }
  ];
}
