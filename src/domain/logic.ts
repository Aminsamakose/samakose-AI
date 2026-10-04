/**
 * Pure business logic. No database, no network. Everything here is unit tested.
 * Rules first, AI second: validation, scoring, maturity, confidence and state moves are deterministic.
 */
import type { CaseState, EvidenceClass, Role } from '@/db/schema';

export const DIMENSIONS = ['Finance', 'Market and sales', 'Operations', 'People and governance', 'Records and systems', 'Compliance and finance access'] as const;

export type Rules = Record<string, string | number>;
export const DEFAULT_RULES: Rules = {
  'evidence.multiplier.Verified': 1,
  'evidence.multiplier.Document-supported': 0.95,
  'evidence.multiplier.Self-reported': 0.8,
  'evidence.multiplier.Unverified': 0.6,
  'evidence.multiplier.Missing': 0.5,
  'validation.min_completion': 0.9,
  'maturity.critical_below': 40,
  'maturity.fragile_below': 60,
  'maturity.developing_below': 75,
  'confidence.high_share': 0.6,
  'confidence.medium_share': 0.35,
  'prescription.min_days': 5,
  'prescription.max_days': 400,
  'session.min_for_monitoring': 3,
  'sla.session_reminder_hours': 24,
  'sla.session_outcome_hours': 24,
  'sla.stalled_days': 14,
  'messaging.retention_months': 12,
  'privacy.min_cell_size': 5,
  'readiness.not_ready_below': 45,
  'readiness.emerging_below': 60,
  'readiness.conditional_below': 75,
  'readiness.gate_block_below': 2,
  'readiness.gate_ready_min': 3,
  'risk.critical_weight_min': 4,
  'risk.critical_score_max': 1,
  'risk.evidence_gap_share': 0.35,
  'risk.concentration_min': 3,
  'priority.readiness_bonus': 0.25,
  'priority.gate_factor': 1.25,
  'priority.top_n': 5,
  'compare.min_unchanged_weight': 0.7,
  'cert.foundation_min': 60,
  'cert.established_min': 75,
  'cert.investment_ready_min': 85,
  'cert.min_evidence_share': 0.6,
  'cert.valid_months': 12,
  'ai.monthly_cost_cap_usd': 25,
  'ai.usd_per_million_input_tokens': 3,
  'ai.usd_per_million_output_tokens': 15
};
export const RULE_NOTES: Record<string, string> = {
  'sla.session_reminder_hours': 'Coaching sessions: remind the coach and the owner this many hours ahead (checked daily, so the reminder lands within 12 hours either side)',
  'sla.session_outcome_hours': 'Coaching sessions: flag a session whose outcome is still not recorded this many hours after it was due',
  'sla.stalled_days': 'Cases: flag a case to the programme manager when nobody has acted on it for this many days',
  'messaging.retention_months': 'Case messages on a graduated case are deleted this many months after they were sent',
  'evidence.multiplier.Verified': 'Share of a stated answer that counts when the evidence is verified',
  'evidence.multiplier.Document-supported': 'Share that counts when a document supports the answer',
  'evidence.multiplier.Self-reported': 'Share that counts when the owner states it without evidence',
  'evidence.multiplier.Unverified': 'Share that counts when evidence was offered but not checked',
  'evidence.multiplier.Missing': 'Share that counts when evidence is missing',
  'validation.min_completion': 'Data quality gate: minimum share of questions answered',
  'maturity.critical_below': 'Scores below this are Critical',
  'maturity.fragile_below': 'Scores below this are Fragile',
  'maturity.developing_below': 'Scores below this are Developing, otherwise Strong',
  'confidence.high_share': 'Share of weight backed by Verified or Document-supported evidence for High confidence',
  'confidence.medium_share': 'Same share for Medium confidence',
  'prescription.min_days': 'Shortest allowed action deadline',
  'prescription.max_days': 'Longest allowed action deadline',
  'session.min_for_monitoring': 'Held coaching sessions needed before a case moves to MONITORING',
  'privacy.min_cell_size': 'Funder views hide any group smaller than this',
  'readiness.not_ready_below': 'Readiness index below this is Not ready',
  'readiness.emerging_below': 'Readiness index below this is Emerging',
  'readiness.conditional_below': 'Readiness index below this is Conditionally ready, otherwise Ready',
  'readiness.gate_block_below': 'A tagged gate question rated below this blocks readiness',
  'readiness.gate_ready_min': 'Every tagged gate must reach this rating for Ready',
  'risk.critical_weight_min': 'A question at or above this weight is a critical item when rated low',
  'risk.critical_score_max': 'A critical item rated at or below this is a risk',
  'risk.evidence_gap_share': 'A domain whose verified or document backed weight share is below this has an evidence gap',
  'risk.concentration_min': 'This many critical items in one sub-dimension mark it Critical',
  'priority.readiness_bonus': 'Extra priority per readiness index a question feeds',
  'priority.gate_factor': 'Priority multiplier for a gate question',
  'priority.top_n': 'Number of priority sub-dimensions reported',
  'compare.min_unchanged_weight': 'Scores from two framework versions are compared only if at least this share of weight sits in questions that did not change',
  'cert.foundation_min': 'Lowest overall score for a Foundation certificate (all other criteria must also be met)',
  'cert.established_min': 'Lowest overall score for an Established certificate',
  'cert.investment_ready_min': 'Lowest overall score for an Investment-ready certificate. At least one readiness index must also be Ready',
  'cert.min_evidence_share': 'Share of scored answers that must be verified or document-supported before a certificate can be proposed',
  'cert.valid_months': 'How long a certificate stays valid, in months',
  'ai.monthly_cost_cap_usd': 'Most the live AI may cost in a calendar month, in US dollars, across all agents. New live tasks are refused once it is reached. 0 means no cap. The starting figure is a placeholder',
  'ai.usd_per_million_input_tokens': 'Estimated price per million input tokens, used only to estimate spend. Check it against your Anthropic invoice',
  'ai.usd_per_million_output_tokens': 'Estimated price per million output tokens, used only to estimate spend. Check it against your Anthropic invoice'
};
const rv = (rules: Rules, k: string) => (rules[k] !== undefined ? rules[k] : DEFAULT_RULES[k]);
const num = (rules: Rules, k: string) => Number(rv(rules, k));

export type QuestionLite = {
  code: string; dimension: string; text: string; weight: number;
  subDimension?: string; criticality?: 'Gate' | 'Core' | 'Standard'; readiness?: string[]; applies?: string; riskTag?: string;
};
export type ResponseLite = { questionCode: string; value: number; evidenceClass: EvidenceClass; notApplicable?: boolean };
/** Marker the answer map uses for "does not apply". Only conditional questions accept it. */
export const NOT_APPLICABLE = 'NA';
export const isConditional = (q: Pick<QuestionLite, 'applies'>) => !!q.applies && q.applies.trim().toLowerCase() !== 'all';

/* ----------------------- data quality gate ----------------------- */
export function validateSubmission(answers: Record<string, unknown>, questions: QuestionLite[], rules: Rules, seenUuids: string[] = [], uuid?: string) {
  const problems: string[] = [];
  let answered = 0, na = 0;
  for (const q of questions) {
    const v = answers[q.code];
    if (v === undefined || v === null || v === '') continue;
    if (v === NOT_APPLICABLE) {
      if (isConditional(q)) na++; else problems.push(`${q.code} cannot be marked not applicable`);
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 4) problems.push(`Value out of range for ${q.code}`);
    else answered++;
  }
  const applicable = questions.length - na;
  const completion = applicable > 0 ? answered / applicable : 0;
  const min = num(rules, 'validation.min_completion');
  if (completion < min) problems.push(`Completion ${Math.round(completion * 100)} percent is below ${Math.round(min * 100)} percent`);
  if (uuid && seenUuids.includes(uuid)) problems.push('Duplicate submission');
  return { ok: problems.length === 0, completion: Math.round(completion * 1000) / 1000, problems };
}

/* --------------------------- scoring ----------------------------- */
export function maturityBand(score: number, rules: Rules): 'Critical' | 'Fragile' | 'Developing' | 'Strong' {
  if (score < num(rules, 'maturity.critical_below')) return 'Critical';
  if (score < num(rules, 'maturity.fragile_below')) return 'Fragile';
  if (score < num(rules, 'maturity.developing_below')) return 'Developing';
  return 'Strong';
}

export function scoreDiagnostic(responses: ResponseLite[], questions: QuestionLite[], rules: Rules) {
  const byQ = new Map(responses.map((r) => [r.questionCode, r]));
  const dims = new Map<string, { num: number; den: number }>();
  const share: Record<string, number> = {};
  let totalW = 0;
  for (const q of questions) {
    const r = byQ.get(q.code);
    if (!r || r.notApplicable) continue;
    const mult = Number(rv(rules, `evidence.multiplier.${r.evidenceClass}`));
    const w = q.weight || 1;
    const d = dims.get(q.dimension) ?? { num: 0, den: 0 };
    d.num += w * (r.value / 4) * (Number.isNaN(mult) ? 0.8 : mult);
    d.den += w;
    dims.set(q.dimension, d);
    share[r.evidenceClass] = (share[r.evidenceClass] ?? 0) + w;
    totalW += w;
  }
  let sn = 0, sd = 0;
  const dimensions = [...dims.entries()].map(([dimension, d]) => {
    sn += d.num; sd += d.den;
    return { dimension, value: Math.round((d.num / d.den) * 1000) / 10 };
  });
  const overall = sd ? Math.round((sn / sd) * 1000) / 10 : 0;
  for (const k of Object.keys(share)) share[k] = totalW ? share[k] / totalW : 0;
  return { dimensions, overall, maturity: maturityBand(overall, rules), evidenceShare: share };
}

/** Confidence is computed from evidence, rule checks and validation. The model never states it. */
export function confidenceClass(evidenceShare: Record<string, number>, ruleChecksPassed: boolean, validationOk: boolean, rules: Rules): 'Low' | 'Medium' | 'High' {
  if (!validationOk) return 'Low';
  const strong = (evidenceShare['Verified'] ?? 0) + (evidenceShare['Document-supported'] ?? 0);
  let level = strong >= num(rules, 'confidence.high_share') ? 2 : strong >= num(rules, 'confidence.medium_share') ? 1 : 0;
  if (!ruleChecksPassed) level = Math.max(0, level - 1);
  return (['Low', 'Medium', 'High'] as const)[level];
}

/* ------------------------- state machines ------------------------ */
export type CaseFact = 'validation_ok' | 'scored' | 'diagnosis_approved' | 'prescription_in_review' | 'prescription_approved' | 'action_started' | 'three_sessions' | 'confirmed';
export const CASE_TRANSITIONS: { from: CaseState; to: CaseState; trigger: string; needs: CaseFact[]; manual?: boolean }[] = [
  { from: 'PROSPECT', to: 'ONBOARDING', trigger: 'Registration accepted', needs: ['confirmed'], manual: true },
  { from: 'ONBOARDING', to: 'PROFILED', trigger: 'Profile submitted', needs: ['confirmed'], manual: true },
  { from: 'PROFILED', to: 'DIAGNOSTIC', trigger: 'Diagnostic opened', needs: [] },
  { from: 'DIAGNOSTIC', to: 'DIAGNOSED', trigger: 'Diagnostic completed', needs: ['validation_ok', 'scored'] },
  { from: 'DIAGNOSED', to: 'PRESCRIBED', trigger: 'Diagnosis reviewed', needs: ['diagnosis_approved'] },
  { from: 'PRESCRIBED', to: 'APPROVAL', trigger: 'Prescription drafted', needs: ['prescription_in_review'] },
  { from: 'APPROVAL', to: 'IN EXECUTION', trigger: 'Prescription approved', needs: ['prescription_approved'] },
  { from: 'IN EXECUTION', to: 'COACHING', trigger: 'First action started', needs: ['action_started'] },
  { from: 'COACHING', to: 'MONITORING', trigger: 'Coaching sessions completed', needs: ['three_sessions'] },
  { from: 'MONITORING', to: 'MIDLINE', trigger: 'Midline date reached', needs: ['confirmed'], manual: true },
  { from: 'MIDLINE', to: 'ENDLINE', trigger: 'Endline date reached', needs: ['confirmed'], manual: true },
  { from: 'ENDLINE', to: 'FOLLOW-UP', trigger: 'Endline approved', needs: ['confirmed'], manual: true },
  { from: 'FOLLOW-UP', to: 'GRADUATED', trigger: 'Follow-up complete', needs: ['confirmed'], manual: true },
  { from: 'GRADUATED', to: 'RE-ENTRY', trigger: 'Re-entry trigger fires', needs: ['confirmed'], manual: true }
];
export type Facts = Partial<Record<CaseFact, boolean>>;
export function canTransitionCase(from: CaseState, to: CaseState, facts: Facts) {
  const t = CASE_TRANSITIONS.find((x) => x.from === from && x.to === to);
  if (!t) return { ok: false as const, reason: `No transition from ${from} to ${to}` };
  const missing = t.needs.filter((n) => !facts[n]);
  if (missing.length) return { ok: false as const, reason: `Condition not met: ${missing.join(', ')}` };
  return { ok: true as const, trigger: t.trigger };
}

export type RxStatus = 'DRAFT' | 'IN REVIEW' | 'APPROVED' | 'RETURNED' | 'SUPERSEDED';
export type Actor = Role | 'AI';
export const PRESCRIPTION_TRANSITIONS: { from: RxStatus; to: RxStatus; actors: Actor[] }[] = [
  { from: 'DRAFT', to: 'IN REVIEW', actors: ['AI', 'EXPERT', 'ADMIN'] },
  { from: 'IN REVIEW', to: 'APPROVED', actors: ['REVIEWER'] },
  { from: 'IN REVIEW', to: 'RETURNED', actors: ['REVIEWER'] },
  { from: 'APPROVED', to: 'SUPERSEDED', actors: ['REVIEWER'] },
  { from: 'RETURNED', to: 'IN REVIEW', actors: ['EXPERT', 'ADMIN'] }
];
export function canTransitionPrescription(from: RxStatus, to: RxStatus, actor: Actor) {
  const t = PRESCRIPTION_TRANSITIONS.find((x) => x.from === from && x.to === to);
  if (!t) return { ok: false as const, reason: `No transition from ${from} to ${to}` };
  if (!t.actors.includes(actor)) return { ok: false as const, reason: `${actor} may not make this move` };
  return { ok: true as const };
}

export const ACTION_TRANSITIONS: Record<string, string[]> = { 'Open': ['In progress', 'Done'], 'In progress': ['Open', 'Done'], 'Done': [] };
export const INVOICE_TRANSITIONS: Record<string, string[]> = { 'Draft': ['Sent', 'Void'], 'Sent': ['Paid', 'Overdue', 'Void'], 'Overdue': ['Paid', 'Void'], 'Paid': [], 'Void': [] };

/* ---------------------------- AI output -------------------------- */
export function extractJson(text: string | null | undefined): any | null {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

/** Claims an AI draft may never make. Certification and consequential decisions need a human governance gate. */
export const FORBIDDEN_AI_CLAIMS = [/\bcertif(y|ied|ies|ication)\b/i, /investment[- ]ready/i, /official score/i, /guarantee/i, /approved for funding/i];
export const hasForbiddenClaim = (t: string) => FORBIDDEN_AI_CLAIMS.some((re) => re.test(t));

export function validateDiagnosis(o: any, evidenceIds: string[]): string[] {
  const p: string[] = [];
  if (!o || typeof o !== 'object') return ['Not an object'];
  if (typeof o.summary !== 'string' || o.summary.length < 20) p.push('summary missing');
  if (!Array.isArray(o.root_causes) || !o.root_causes.length) p.push('root_causes missing');
  else o.root_causes.forEach((rc: any, i: number) => {
    if (!rc || !rc.cause) p.push(`root_causes[${i}].cause missing`);
    if (!Array.isArray(rc?.evidence_ids) || !rc.evidence_ids.length) p.push(`root_causes[${i}] has no evidence_ids`);
    else rc.evidence_ids.forEach((id: string) => { if (!evidenceIds.includes(id)) p.push(`Unknown evidence id ${id}`); });
  });
  if (!['High', 'Medium', 'Low'].includes(o.priority)) p.push('priority must be High, Medium or Low');
  if (!Array.isArray(o.risks)) p.push('risks must be a list');
  else o.risks.forEach((r: any, i: number) => { if (!r?.text || !['High', 'Medium', 'Low'].includes(r.severity)) p.push(`risks[${i}] invalid`); });
  if (o.model_confidence !== undefined && (typeof o.model_confidence !== 'number' || o.model_confidence < 0 || o.model_confidence > 1)) p.push('model_confidence must be 0 to 1');
  const all = [o.summary, ...(Array.isArray(o.root_causes) ? o.root_causes.map((r: any) => r?.cause) : []), ...(Array.isArray(o.risks) ? o.risks.map((r: any) => r?.text) : [])].filter((x) => typeof x === 'string').join(' ');
  if (hasForbiddenClaim(all)) p.push('The draft makes a certification, guarantee or readiness claim. Drafts may analyse and recommend only');
  return p;
}

export function validatePrescription(o: any, libraryIds: string[], rules: Rules): string[] {
  const p: string[] = [];
  if (!o || !Array.isArray(o.items) || !o.items.length) return ['items missing'];
  const min = num(rules, 'prescription.min_days'), max = num(rules, 'prescription.max_days');
  o.items.forEach((it: any, i: number) => {
    if (!libraryIds.includes(it?.library_id)) p.push(`items[${i}] library_id not in the approved library: ${it?.library_id}`);
    if (!Array.isArray(it?.actions) || !it.actions.length) p.push(`items[${i}] has no actions`);
    else it.actions.forEach((a: any, j: number) => {
      if (!a?.text) p.push(`items[${i}].actions[${j}] text missing`);
      const d = Number(a?.deadline_days);
      if (!Number.isInteger(d) || d < min || d > max) p.push(`items[${i}].actions[${j}] deadline_days outside ${min} to ${max}`);
      if (!['OWNER', 'COACH', 'CONSULTANT'].includes(a?.owner_role)) p.push(`items[${i}].actions[${j}] owner_role invalid`);
    });
  });
  return p;
}

export const addDays = (d: Date, n: number) => { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; };
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/* -------- privacy: small group suppression for funder views -------- */
export function suppress(n: number, rules: Rules): number | null {
  return n < num(rules, 'privacy.min_cell_size') ? null : n;
}

/* ---------------------------- seed data -------------------------- */
export const SEED_QUESTIONS: [string, string, string, number][] = [
  ['Q01', 'Finance', 'Cash inflows and outflows are recorded every week', 3],
  ['Q02', 'Finance', 'Debtor days are tracked and below 45', 3],
  ['Q03', 'Finance', 'Gross margin is known for each product line', 2],
  ['Q04', 'Market and sales', 'No single buyer is more than 30 percent of sales', 3],
  ['Q05', 'Market and sales', 'Prices are set from costs and market checks', 2],
  ['Q06', 'Market and sales', 'There is a written plan to find new buyers', 2],
  ['Q07', 'Operations', 'Post-harvest or production losses are measured', 3],
  ['Q08', 'Operations', 'Stock is counted at least monthly', 2],
  ['Q09', 'Operations', 'Quality checks are done before every sale', 2],
  ['Q10', 'People and governance', 'Roles and responsibilities are written down', 2],
  ['Q11', 'People and governance', 'The owner reviews results with the team monthly', 2],
  ['Q12', 'People and governance', 'Business and household money are separate', 3],
  ['Q13', 'Records and systems', 'Sales and purchases are recorded in a ledger', 3],
  ['Q14', 'Records and systems', 'Records can be shown to a lender within a day', 3],
  ['Q15', 'Records and systems', 'Mobile money or bank is used for most receipts', 2],
  ['Q16', 'Compliance and finance access', 'The business is registered and tax compliant', 2],
  ['Q17', 'Compliance and finance access', 'Loan or grant applications have been prepared before', 1],
  ['Q18', 'Compliance and finance access', 'A repayment plan for any debt exists', 2]
];
export const SEED_LIBRARY: [string, string, string, string, number, string][] = [
  ['IVL-001', 'Weekly cash review routine', 'Finance', 'Set a weekly cash review with a simple cash book.', 30, 'Cash cover in weeks'],
  ['IVL-002', 'Debtor collection routine', 'Finance', 'Agree terms, follow up late payers on a fixed rhythm.', 45, 'Debtor days'],
  ['IVL-003', 'Costing and pricing sheet', 'Market and sales', 'Cost every product line and set prices from cost plus market.', 30, 'Gross margin percent'],
  ['IVL-004', 'Buyer diversification plan', 'Market and sales', 'Identify and approach five new buyers.', 60, 'Top buyer share of sales'],
  ['IVL-005', 'Loss measurement and reduction', 'Operations', 'Measure losses at each stage and fix the largest.', 60, 'Loss percent'],
  ['IVL-006', 'Monthly stock count', 'Operations', 'Count and reconcile stock monthly.', 30, 'Stock variance percent'],
  ['IVL-007', 'Roles and monthly review', 'People and governance', 'Write roles and hold a monthly review.', 45, 'Reviews held'],
  ['IVL-008', 'Simple ledger and records', 'Records and systems', 'Set up a ledger for sales and purchases.', 30, 'Months with complete records'],
  ['IVL-009', 'Registration and compliance', 'Compliance and finance access', 'Complete registration and tax filings.', 90, 'Compliance items complete'],
  ['IVL-010', 'Investment readiness pack', 'Compliance and finance access', 'Prepare records and a summary for lenders.', 90, 'Pack complete'],
  // Longer horizons: 180 and 360 day interventions.
  ['IVL-011', 'Working capital facility preparation', 'Finance', 'Prepare a financing request, secure a facility and agree a repayment plan.', 180, 'Facility secured in GHS'],
  ['IVL-012', 'Second market development', 'Market and sales', 'Open and serve a second market zone or buyer group.', 180, 'Share of sales from new buyers'],
  ['IVL-013', 'Storage and handling upgrade', 'Operations', 'Improve storage or handling to cut losses and hold stock for better prices.', 180, 'Loss percent'],
  ['IVL-014', 'Annual plan and budget cycle', 'People and governance', 'Set a yearly plan and budget with a quarterly review calendar.', 360, 'Quarterly reviews held'],
  ['IVL-015', 'Governance and accountability structure', 'People and governance', 'Set up an advisory group and written policies for the business.', 360, 'Policies in force'],
  ['IVL-016', 'Reviewed annual accounts', 'Compliance and finance access', 'Produce a full year of management accounts and prepare for external review.', 360, 'Months of reviewed accounts']
];
