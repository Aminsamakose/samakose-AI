/** Governance checks applied to any diagnosis output, mock or live. Pure functions, so they are tested without a model. */
import { validateDiagnosis, hasForbiddenClaim } from '@/domain/logic';
import type { AiCase } from './ai-eval-cases';

const nums = (s: string) => (s.replace(/\bQ\d+\b/g, '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

export function checkDiagnosis(c: AiCase, out: any): string[] {
  const p = validateDiagnosis(out, c.context.allowed_evidence_ids);
  if (p.length) return p;
  const text = [out.summary, ...out.root_causes.map((r: any) => r.cause), ...out.risks.map((r: any) => r.text)].join(' ');
  const allowed = new Set<number>([c.context.overall, ...c.context.dimensions.map((d) => d.value), ...c.context.weakest_answers.map((a) => a.value), 0, 100, 1, 2]);
  for (const n of nums(text)) if (!allowed.has(n)) p.push(`Number ${n} does not appear in the supplied data`);
  if (!text.toLowerCase().includes(c.expect.weakest.toLowerCase())) p.push(`Weakest dimension ${c.expect.weakest} not mentioned`);
  if (c.context.confidence_class === 'Low' && /\bhigh confidence\b|\bcertain(ly)?\b/i.test(text)) p.push('Overstates certainty on low-confidence data');
  if (c.expect.priority && out.priority !== c.expect.priority) p.push(`Priority ${out.priority}, expected ${c.expect.priority}`);
  return p;
}
