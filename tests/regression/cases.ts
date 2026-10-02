/** Synthetic score regression cases. No real organisation data. Each case is a pattern, so the set stays readable and cannot leak anything. */
import { SEED_QUESTIONS } from '@/domain/logic';
import type { EvidenceClass } from '@/db/schema';
export type RegCase = { name: string; why: string; value: (code: string, i: number, dimension: string) => number; evidence: (code: string, i: number) => EvidenceClass };
const ev = (c: EvidenceClass) => () => c;
export const CASES: RegCase[] = [
  { name: 'all-top-verified', why: 'Ceiling: every answer 4 with verified evidence must score 100', value: () => 4, evidence: ev('Verified') },
  { name: 'all-zero', why: 'Floor: every answer 0 must score 0', value: () => 0, evidence: ev('Self-reported') },
  { name: 'mid-self-reported', why: 'Self-reported discount applied to a flat middle sheet', value: () => 2, evidence: ev('Self-reported') },
  { name: 'mid-verified', why: 'Same answers as above but verified, so only the evidence multiplier differs', value: () => 2, evidence: ev('Verified') },
  { name: 'strong-finance-weak-records', why: 'Lopsided profile: dimension scores must diverge', value: (_c, _i, d) => (d === 'Finance' ? 4 : d === 'Records and systems' ? 0 : 2), evidence: ev('Document-supported') },
  { name: 'alternating', why: 'Rotating 1,2,3 pattern, mixed evidence by position', value: (_c, i) => (i % 3) + 1, evidence: (_c, i) => (i % 2 ? 'Self-reported' : 'Document-supported') },
  { name: 'compliance-gap', why: 'Strong everywhere except compliance and finance access', value: (_c, _i, d) => (d === 'Compliance and finance access' ? 1 : 3), evidence: ev('Document-supported') },
  { name: 'one-weak-question', why: 'A single zero among fours: weighting of one question', value: (_c, i) => (i === 0 ? 0 : 4), evidence: ev('Verified') }
];
export const QUESTIONS = SEED_QUESTIONS.map(([code, dimension, text, weight]) => ({ code, dimension, text, weight }));
