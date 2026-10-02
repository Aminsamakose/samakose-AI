/**
 * Business Health Architecture v2 analysis: sub-dimensions, readiness indices, risks and priorities.
 * Pure functions, no database. Only runs for framework versions whose questions carry v2 metadata, so version 1 scores are untouched.
 * Every threshold is a rule (see DEFAULT_RULES), so a framework version can override it and the score records what was used.
 */
import type { FrameworkMeta } from '@/db/schema';
import { type QuestionLite, type ResponseLite, type Rules, DEFAULT_RULES } from './logic';

const rv = (rules: Rules, k: string) => Number(rules[k] !== undefined ? rules[k] : DEFAULT_RULES[k]);
const r1 = (n: number) => Math.round(n * 10) / 10;

export const hasBankMeta = (qs: QuestionLite[]) => qs.some((q) => q.subDimension || q.criticality || (q.readiness && q.readiness.length));

type Item = { q: QuestionLite; value: number; mult: number; strong: boolean };
function applicableItems(responses: ResponseLite[], qs: QuestionLite[], rules: Rules): Item[] {
  const by = new Map(responses.map((r) => [r.questionCode, r]));
  const out: Item[] = [];
  for (const q of qs) {
    const r = by.get(q.code);
    if (!r || r.notApplicable) continue;
    const m = rv(rules, `evidence.multiplier.${r.evidenceClass}`);
    out.push({ q, value: r.value, mult: Number.isNaN(m) ? 0.8 : m, strong: r.evidenceClass === 'Verified' || r.evidenceClass === 'Document-supported' });
  }
  return out;
}
const idx = (items: Item[]) => {
  let n = 0, d = 0;
  for (const i of items) { const w = i.q.weight || 1; n += w * (i.value / 4) * i.mult; d += w; }
  return d ? r1((n / d) * 100) : null;
};

/** A check condition such as "A>=3 and B<=1". Anything else does not parse and never fires. */
export function parseCondition(c: string): ((a: number, b: number) => boolean) | null {
  const m = /^A\s*(>=|<=|==|>|<)\s*(\d)\s+and\s+B\s*(>=|<=|==|>|<)\s*(\d)$/i.exec(c.trim());
  if (!m) return null;
  const cmp = (op: string, x: number, y: number) => (op === '>=' ? x >= y : op === '<=' ? x <= y : op === '==' ? x === y : op === '>' ? x > y : x < y);
  return (a, b) => cmp(m[1], a, Number(m[2])) && cmp(m[3], b, Number(m[4]));
}

export type ReadinessLevel = 'Not ready' | 'Emerging' | 'Conditionally ready' | 'Ready';
export function readinessLevel(index: number | null, gates: { code: string; value: number | null }[], rules: Rules): ReadinessLevel {
  const block = rv(rules, 'readiness.gate_block_below'), ready = rv(rules, 'readiness.gate_ready_min');
  if (index === null || index < rv(rules, 'readiness.not_ready_below')) return 'Not ready';
  if (gates.some((g) => g.value === null || g.value < block)) return 'Not ready';
  if (index < rv(rules, 'readiness.emerging_below')) return 'Emerging';
  if (index < rv(rules, 'readiness.conditional_below')) return 'Conditionally ready';
  return gates.every((g) => g.value === null || g.value >= ready) ? 'Ready' : 'Conditionally ready';
}

export function analyseBank(responses: ResponseLite[], qs: QuestionLite[], meta: FrameworkMeta | null | undefined, rules: Rules) {
  if (!hasBankMeta(qs)) return null;
  const items = applicableItems(responses, qs, rules);
  const answered = new Map(items.map((i) => [i.q.code, i]));
  const naCodes = responses.filter((r) => r.notApplicable).map((r) => r.questionCode);
  const naSet = new Set(naCodes);

  // Sub-dimension scores.
  const subs = new Map<string, Item[]>();
  for (const i of items) if (i.q.subDimension) subs.set(i.q.subDimension, [...(subs.get(i.q.subDimension) ?? []), i]);
  const subMeta = new Map((meta?.subDimensions ?? []).map((s) => [s.code, s]));
  const subDimensions = [...subs.entries()].map(([code, its]) => ({ code, name: subMeta.get(code)?.name ?? code, dimension: its[0].q.dimension, value: idx(its) ?? 0, answered: its.length }));

  // Readiness: a gate that does not apply counts as passed; a gate not answered blocks.
  const readiness = (meta?.readiness ?? []).map((r) => {
    const tagged = qs.filter((q) => q.readiness?.includes(r.code) && !naSet.has(q.code));
    const its = tagged.map((q) => answered.get(q.code)).filter(Boolean) as Item[];
    const gates = tagged.filter((q) => q.criticality === 'Gate').map((q) => ({ code: q.code, value: answered.get(q.code)?.value ?? null, riskTag: q.riskTag ?? q.text }));
    const index = idx(its);
    const level = readinessLevel(index, gates, rules);
    // Everything between the enterprise and Ready: gates that are unanswered or below the Ready minimum.
    const readyMin = rv(rules, 'readiness.gate_ready_min');
    const blocking = level === 'Ready' ? [] : gates.filter((g) => g.value === null || g.value < readyMin).map((g) => ({ code: g.code, value: g.value, label: g.riskTag }));
    return { code: r.code, name: r.name, index, level, questions: its.length, blocking, unlocks: r.unlocks ?? null };
  });

  // Risks.
  const risks: { rule: string; code?: string; label: string; detail?: string }[] = [];
  const wMin = rv(rules, 'risk.critical_weight_min'), sMax = rv(rules, 'risk.critical_score_max');
  const critBySub = new Map<string, number>();
  for (const i of items) {
    if ((i.q.weight || 1) >= wMin && i.value <= sMax) {
      risks.push({ rule: 'R1', code: i.q.code, label: i.q.riskTag ?? i.q.text, detail: `Rated ${i.value} of 4, weight ${i.q.weight}` });
      if (i.q.subDimension) critBySub.set(i.q.subDimension, (critBySub.get(i.q.subDimension) ?? 0) + 1);
    }
  }
  const byDomain = new Map<string, Item[]>();
  for (const i of items) byDomain.set(i.q.dimension, [...(byDomain.get(i.q.dimension) ?? []), i]);
  const crit = rv(rules, 'maturity.critical_below'), frag = rv(rules, 'maturity.fragile_below'), gap = rv(rules, 'risk.evidence_gap_share');
  for (const [d, its] of byDomain) {
    const v = idx(its) ?? 0;
    if (v < crit) risks.push({ rule: 'R2', label: `${d} is weak`, detail: `Domain score ${v}` });
    else if (v < frag) risks.push({ rule: 'R2', label: `${d} needs watching`, detail: `Domain score ${v}` });
    const tw = its.reduce((a, i) => a + (i.q.weight || 1), 0);
    const sw = its.filter((i) => i.strong).reduce((a, i) => a + (i.q.weight || 1), 0);
    if (tw && sw / tw < gap) risks.push({ rule: 'R3', label: `${d} rests on unchecked answers`, detail: `${Math.round((sw / tw) * 100)} percent of weight is verified or document backed` });
  }
  for (const c of meta?.consistencyChecks ?? []) {
    const f = parseCondition(c.condition), a = answered.get(c.itemA), b = answered.get(c.itemB);
    if (f && a && b && f(a.value, b.value)) risks.push({ rule: 'R4', code: `${c.itemA}/${c.itemB}`, label: c.rule, detail: `${c.itemA} rated ${a.value}, ${c.itemB} rated ${b.value}` });
  }
  const conc = rv(rules, 'risk.concentration_min');
  for (const [code, n] of critBySub) if (n >= conc) risks.push({ rule: 'R5', label: `${subMeta.get(code)?.name ?? code} is critical`, detail: `${n} critical items rated low` });

  // Priorities: weighted shortfall by sub-dimension, boosted by readiness reach and gates.
  const bonus = rv(rules, 'priority.readiness_bonus'), gf = rv(rules, 'priority.gate_factor');
  const pri = new Map<string, number>();
  for (const i of items) {
    if (!i.q.subDimension) continue;
    const p = (i.q.weight || 1) * ((4 - i.value) / 4) * (1 + bonus * (i.q.readiness?.length ?? 0)) * (i.q.criticality === 'Gate' ? gf : 1);
    pri.set(i.q.subDimension, (pri.get(i.q.subDimension) ?? 0) + p);
  }
  const priorities = [...pri.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, rv(rules, 'priority.top_n'))
    .map(([code, v]) => ({ code, name: subMeta.get(code)?.name ?? code, score: r1(v) }));

  return { subDimensions, readiness, risks, priorities, notApplicable: naCodes };
}
