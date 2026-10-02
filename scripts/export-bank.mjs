// Exports a Business Health bank to the Draft format the Frameworks tab loads (questions, dimensions, rules, sources).
import fs from 'node:fs';
const [file, out] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(new URL('../docs/frameworks/banks/plan.json', import.meta.url)));
const b = JSON.parse(fs.readFileSync(file, 'utf8'));
const P = plan.platforms[b.framework];
const dimOf = (d) => P.domainNames[d];
const dimensions = Object.keys(P.domainNames).map(dimOf);
const questions = b.questions.map((q) => ({ code: q.code, dimension: dimOf(q.domain), text: q.text, weight: q.weight }));
const used = [...new Set(b.questions.flatMap((q) => q.sources || []))].sort((a, c) => Number(a.slice(1)) - Number(c.slice(1)));
const sources = used.map((id) => {
  const s = b.sources[id];
  const qs = b.questions.filter((q) => (q.sources || []).includes(id)).map((q) => q.code);
  return {
    component: `Evidence ${P.prefix}-${id}: ${s.title}`.slice(0, 120),
    source: `${s.title}. ${s.publisher}, ${s.year}. ${s.url}`.slice(0, 400),
    rationale: `Relevance confidence: ${s.confidence}${s.opened === false ? ' (not opened, search result only)' : ''}. Used for questions ${qs.join(', ')}.`.slice(0, 500),
    adaptation: 'Bank v1 draft. Questions are rewritten as rated statements with five behavioural anchors. Not yet reviewed by the owner.',
    approval: 'Proposed'
  };
});
fs.writeFileSync(out, JSON.stringify({ questions, dimensions, rules: null, sources, note: `DRAFT ${b.version}. ${b.status}` }, null, 1));
console.log(`${b.framework}: ${questions.length} questions, ${dimensions.length} dimensions, ${sources.length} sources -> ${out}`);
