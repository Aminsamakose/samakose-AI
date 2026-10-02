/**
 * Controlled live AI test. Runs the synthetic cases against the real model and applies the same governance checks.
 * Needs CLAUDE_API_KEY. Spends real money, so it never runs in CI and prints the token use.
 *   CLAUDE_API_KEY=... npx tsx scripts/ai-eval.ts [--runs 3]
 * Output: docs/quality/ai-eval-latest.md
 */
import fs from 'node:fs';
import { AI_CASES } from '../tests/ai/cases';
import { checkDiagnosis } from '../tests/ai/checks';
import { extractJson } from '../src/domain/logic';
import { SYSTEM } from '../src/services/ai';

const key = process.env.CLAUDE_API_KEY, model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-5-5';
if (!key) { console.error('Set CLAUDE_API_KEY to run the live evaluation. Nothing was sent.'); process.exit(1); }
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 1;

async function ask(user: string) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 1500, temperature: 0.2, system: SYSTEM.diagnosis, messages: [{ role: 'user', content: user }] }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j: any = await r.json();
  return { text: (j.content ?? []).map((b: any) => b.text ?? '').join(''), inTok: j.usage?.input_tokens ?? 0, outTok: j.usage?.output_tokens ?? 0 };
}

(async () => {
  let pass = 0, total = 0, inT = 0, outT = 0; const rows: string[] = [];
  for (const c of AI_CASES) for (let i = 1; i <= runs; i++) {
    total++;
    try {
      const r = await ask(JSON.stringify(c.context)); inT += r.inTok; outT += r.outTok;
      const out = extractJson(r.text); const problems = out ? checkDiagnosis(c, out) : ['Reply was not valid JSON'];
      if (!problems.length) pass++;
      rows.push(`| ${c.name} | ${i} | ${problems.length ? 'FAIL' : 'pass'} | ${problems.join('; ') || ''} |`);
    } catch (e) { rows.push(`| ${c.name} | ${i} | ERROR | ${(e as Error).message} |`); }
  }
  const md = `# Live AI evaluation\n\nModel: ${model}. Run on ${new Date().toISOString().slice(0, 10)}. Synthetic cases only.\n\nResult: ${pass} of ${total} passed. Tokens: ${inT} in, ${outT} out.\n\n| Case | Run | Result | Problems |\n|---|---|---|---|\n${rows.join('\n')}\n`;
  fs.writeFileSync('docs/quality/ai-eval-latest.md', md); console.log(md);
})();
