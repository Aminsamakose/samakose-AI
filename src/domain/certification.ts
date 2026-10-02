/**
 * Business health certification rules. Pure functions, no database.
 * A business is certified on verified evidence, not on a score alone. The thresholds are rules an administrator sets in Settings.
 * The unlocks come from the framework: each readiness index states what reaching it opens.
 */
import type { Rules } from './logic';
import { DEFAULT_RULES } from './logic';

export const CERT_LEVELS = ['Foundation', 'Established', 'Investment-ready'] as const;
export type CertLevel = (typeof CERT_LEVELS)[number];

export type CertFacts = {
  hasScore: boolean; overall: number; confidence: 'Low' | 'Medium' | 'High'; frameworkPublished: boolean;
  dimensions: { dimension: string; value: number }[]; evidenceShare: Record<string, number>;
  readiness: { code: string; name: string; level: string; unlocks: string | null; blocking: { code: string; value: number | null; label: string }[] }[] | null;
  diagnosisReviewed: boolean; prescriptionApproved: boolean;
};
export type Criterion = { id: string; label: string; met: boolean; detail: string };
export type Unlock = { code: string; name: string; level: string; text: string };

const n = (r: Rules, k: string) => Number(r[k] !== undefined ? r[k] : DEFAULT_RULES[k]);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function evaluateCertification(f: CertFacts, rules: Rules) {
  const critical = n(rules, 'maturity.critical_below'), gateBlock = n(rules, 'readiness.gate_block_below'), need = n(rules, 'cert.min_evidence_share');
  const strong = (f.evidenceShare['Verified'] ?? 0) + (f.evidenceShare['Document-supported'] ?? 0);
  const criticalDomains = f.dimensions.filter((d) => d.value < critical).map((d) => d.dimension);
  const blockedGates = (f.readiness ?? []).flatMap((r) => r.blocking.filter((b) => b.value === null || b.value < gateBlock).map((b) => `${r.name}: ${b.label}`));
  const criteria: Criterion[] = [
    { id: 'score', label: 'A validated score exists', met: f.hasScore, detail: f.hasScore ? `Overall ${f.overall}` : 'No score yet' },
    { id: 'framework', label: 'Scored on a published framework version', met: f.frameworkPublished, detail: f.frameworkPublished ? 'Published version' : 'The framework version is not published' },
    { id: 'gates', label: 'Every gate question is at or above the blocking rating', met: blockedGates.length === 0, detail: f.readiness === null ? 'This framework version has no gate questions' : blockedGates.length ? `Blocking: ${blockedGates.slice(0, 3).join('; ')}` : 'No gate is blocking' },
    { id: 'domains', label: 'No domain is rated Critical', met: criticalDomains.length === 0, detail: criticalDomains.length ? `Critical: ${criticalDomains.join(', ')}` : `All domains at or above ${critical}` },
    { id: 'confidence', label: 'Score confidence is Medium or High', met: f.confidence !== 'Low', detail: `Confidence is ${f.confidence}` },
    { id: 'evidence', label: `Verified or document-supported evidence covers at least ${pct(need)} of scored answers`, met: strong >= need, detail: `${pct(strong)} covered` },
    { id: 'diagnosis', label: 'A diagnosis has been reviewed', met: f.diagnosisReviewed, detail: f.diagnosisReviewed ? 'Reviewed' : 'No reviewed diagnosis' },
    { id: 'prescription', label: 'A prescription has been approved', met: f.prescriptionApproved, detail: f.prescriptionApproved ? 'Approved' : 'No approved prescription' }
  ];
  const allMet = criteria.every((c) => c.met);
  const anyReady = (f.readiness ?? []).some((r) => r.level === 'Ready');
  let level: CertLevel | null = null;
  if (allMet) {
    if (f.overall >= n(rules, 'cert.investment_ready_min') && anyReady) level = 'Investment-ready';
    else if (f.overall >= n(rules, 'cert.established_min')) level = 'Established';
    else if (f.overall >= n(rules, 'cert.foundation_min')) level = 'Foundation';
  }
  const scoreNote = allMet && !level ? `The score ${f.overall} is below the Foundation level of ${n(rules, 'cert.foundation_min')}` : null;
  // Unlocks are the framework's own words for what each readiness index opens. Only indices at Ready or Conditionally ready count.
  const unlocks: Unlock[] = level ? (f.readiness ?? []).filter((r) => r.unlocks && (r.level === 'Ready' || r.level === 'Conditionally ready')).map((r) => ({ code: r.code, name: r.name, level: r.level, text: r.unlocks! })) : [];
  return { criteria, eligible: level !== null, level, scoreNote, unlocks, investmentReadyNote: allMet && level !== 'Investment-ready' && f.overall >= n(rules, 'cert.investment_ready_min') && !anyReady ? 'The score is high enough for Investment-ready, but no readiness index is Ready yet' : null };
}

export const validUntil = (from: Date, months: number) => { const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + months); return d; };
/** Status as seen by a reader: a certified certificate past its date is Expired. */
export const effectiveStatus = (status: string, expiresAt: Date | string | null, now = new Date()) => status === 'Certified' && expiresAt && new Date(expiresAt) < now ? 'Expired' : status;
