import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RULES, scoreDiagnostic } from '@/domain/logic';
import { CASES, QUESTIONS } from './cases';

const file = path.resolve(__dirname, 'golden.json');
const run = () => Object.fromEntries(CASES.map((c) => {
  const responses = QUESTIONS.map((q, i) => ({ questionCode: q.code, value: c.value(q.code, i, q.dimension), evidenceClass: c.evidence(q.code, i) }));
  const s = scoreDiagnostic(responses, QUESTIONS, DEFAULT_RULES);
  return [c.name, { overall: s.overall, dimensions: Object.fromEntries(s.dimensions.map((d: any) => [d.dimension, d.value])) }];
}));

/** Score regression set. A failure prints which case moved, by how much and in which dimension.
 *  If the change is intended (a rule or framework change Amin has approved), run:  UPDATE_GOLDEN=1 npx vitest run tests/regression */
describe('score regression set', () => {
  it('matches the approved golden scores for every synthetic case', () => {
    const now = run();
    if (process.env.UPDATE_GOLDEN || !fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify(now, null, 2) + '\n'); return; }
    const gold = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diffs: string[] = [];
    for (const c of CASES) {
      const g = gold[c.name], n = (now as any)[c.name];
      if (!g) { diffs.push(`${c.name}: no golden value yet`); continue; }
      if (g.overall !== n.overall) diffs.push(`${c.name}: overall ${g.overall} -> ${n.overall} (${c.why})`);
      for (const d of Object.keys(n.dimensions)) if (g.dimensions[d] !== n.dimensions[d]) diffs.push(`${c.name}: ${d} ${g.dimensions[d]} -> ${n.dimensions[d]}`);
    }
    expect(diffs, diffs.join('\n')).toEqual([]);
  });
  it('keeps the invariants that never change', () => {
    const r = run() as any;
    expect(r['all-top-verified'].overall).toBe(100); expect(r['all-zero'].overall).toBe(0);
    expect(r['mid-verified'].overall).toBeGreaterThan(r['mid-self-reported'].overall);
    expect(r['strong-finance-weak-records'].dimensions['Finance']).toBeGreaterThan(r['strong-finance-weak-records'].dimensions['Records and systems']);
  });
});
