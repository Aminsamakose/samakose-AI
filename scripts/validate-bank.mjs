// Validates a Business Health bank file against docs/frameworks/banks/plan.json and SPEC.md
import fs from 'node:fs';
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/validate-bank.mjs <bank.json>'); process.exit(2); }
const plan = JSON.parse(fs.readFileSync(new URL('../docs/frameworks/banks/plan.json', import.meta.url)));
const b = JSON.parse(fs.readFileSync(file, 'utf8'));
const P = plan.platforms[b.framework];
const errs = [], warns = [];
const E = (m) => errs.push(m), W = (m) => warns.push(m);
if (!P) { console.error('unknown framework ' + b.framework); process.exit(1); }
const Q = b.questions || [];
if (Q.length !== 100) E(`question count ${Q.length}, need 100`);
const subs = {}; for (const [d, arr] of Object.entries(P.sub)) for (const [c, n, k] of arr) subs[c] = { d, n, k };
const codes = new Set(), cnt = {}, ids = new Set(Q.map((q) => q.code));
const rdy = Object.fromEntries(P.readiness.map(([c]) => [c, { n: 0, gates: 0, doms: new Set() }]));
const srcs = b.sources || {};
const tok = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
const toks = [];
let w5 = 0, w1 = 0, gate = 0, core = 0, cond = 0, design = 0; const dw = {}; let tw = 0;
const wdist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
Q.forEach((q, i) => {
  const at = `${q.code || '#' + i}`;
  if (!new RegExp(`^${P.prefix}-\\d{3}$`).test(q.code || '')) E(`${at}: bad code`);
  if (codes.has(q.code)) E(`${at}: duplicate code`); codes.add(q.code);
  const s = subs[q.subDimension];
  if (!s) E(`${at}: unknown subDimension ${q.subDimension}`);
  else { if (s.d !== q.domain) E(`${at}: domain ${q.domain} does not match subDimension ${q.subDimension}`); cnt[q.subDimension] = (cnt[q.subDimension] || 0) + 1; }
  const t = q.text || '';
  if (t.length < 20 || t.length > 280) E(`${at}: text length ${t.length}`);
  if (/[—–]/.test(JSON.stringify(q))) E(`${at}: contains em or en dash`);
  if (!['ANCHORED', 'BANDED', 'YNP', 'FREQ'].includes(q.responseType)) E(`${at}: responseType`);
  const a = q.anchors;
  if (!Array.isArray(a) || a.length !== 5) E(`${at}: anchors need 5 entries`);
  else a.forEach((x, k) => {
    const nullOk = q.responseType === 'YNP' && (k === 1 || k === 3);
    if (x === null) { if (!nullOk) E(`${at}: anchor ${k} null`); }
    else { if (nullOk) E(`${at}: YNP anchor ${k} must be null`); if (/^As \d/.test(x)) E(`${at}: anchor ${k} refers to another anchor`); if (typeof x !== 'string' || x.length < 3 || x.length > 220) E(`${at}: anchor ${k} length`); }
  });
  if (a && new Set(a.filter(Boolean)).size !== a.filter(Boolean).length) E(`${at}: duplicate anchors`);
  const ev = q.evidence || {};
  if (!ev.requirement || ev.requirement.length < 10) E(`${at}: evidence.requirement`);
  if (!['Document', 'Observation', 'Digital record', 'Third party', 'Interview'].includes(ev.method)) E(`${at}: evidence.method`);
  if (!Array.isArray(ev.examples) || !ev.examples.length) E(`${at}: evidence.examples`);
  if (!Number.isInteger(q.weight) || q.weight < 1 || q.weight > 5) E(`${at}: weight`); else { wdist[q.weight]++; if (q.weight === 5) w5++; if (q.weight === 1) w1++; }
  if (!['Gate', 'Core', 'Standard'].includes(q.criticality)) E(`${at}: criticality`); else { if (q.criticality === 'Gate') gate++; if (q.criticality === 'Core') core++; }
  if (q.criticality === 'Gate' && q.weight < 4) W(`${at}: Gate with weight below 4`);
  if (!Array.isArray(q.readiness)) E(`${at}: readiness array`);
  else q.readiness.forEach((r) => { if (!rdy[r]) E(`${at}: unknown readiness ${r}`); else { rdy[r].n++; rdy[r].doms.add(q.domain); if (q.criticality === 'Gate') rdy[r].gates++; } });
  if ((q.readiness || []).length > 3) E(`${at}: more than 3 readiness tags`);
  if (!q.applies) E(`${at}: applies`); else if (q.applies !== 'All') cond++;
  if (!['Sourced', 'Partly sourced', 'Design judgement'].includes(q.basis)) E(`${at}: basis`); else if (q.basis === 'Design judgement') design++;
  if (['Sourced', 'Partly sourced'].includes(q.basis) && !(q.sources || []).length) E(`${at}: ${q.basis} needs sources`);
  for (const sid of q.sources || []) { if (!srcs[sid]) E(`${at}: unknown source ${sid}`); else if (q.basis === 'Sourced' && srcs[sid].opened === false && (q.sources || []).every((x) => srcs[x]?.opened === false)) W(`${at}: Sourced only by unopened sources`); }
  if (!q.riskTag || q.riskTag.length < 4) E(`${at}: riskTag`);
  if (q.weight) { tw += q.weight; dw[q.domain] = (dw[q.domain] || 0) + q.weight; }
  toks.push([q.code, tok(t)]);
});
for (const [c, s] of Object.entries(subs)) if ((cnt[c] || 0) !== s.k) E(`subDimension ${c} has ${cnt[c] || 0}, expected ${s.k}`);
if (w5 > 12) E(`weight 5 items ${w5} > 12`); if (w1 > 6) E(`weight 1 items ${w1} > 6`);
if (gate < 10 || gate > 16) E(`Gate items ${gate}, need 10 to 16`); if (core < 25 || core > 45) E(`Core items ${core}, need 25 to 45`);
if (cond > 8) E(`conditional items ${cond} > 8`); if (design > 25) E(`design-judgement items ${design} > 25`);
for (const [c, r] of Object.entries(rdy)) { if (r.n < 10) E(`readiness ${c}: ${r.n} items, need 10`); if (r.gates < 2) E(`readiness ${c}: ${r.gates} gates, need 2`); if (r.doms.size < 4) E(`readiness ${c}: ${r.doms.size} domains, need 4`); }
for (const [d, w] of Object.entries(dw)) { const sh = w / tw; if (sh < 0.08 || sh > 0.18) W(`domain ${d} weight share ${(sh * 100).toFixed(1)}%`); }
for (let i = 0; i < toks.length; i++) for (let j = i + 1; j < toks.length; j++) { const [a, A] = toks[i], [c, C] = toks[j]; let inter = 0; for (const x of A) if (C.has(x)) inter++; const jac = inter / (A.size + C.size - inter || 1); if (jac > 0.7) E(`near-duplicate ${a} and ${c} (${jac.toFixed(2)})`); }
// mapping
for (const [c, s] of Object.entries(subs)) {
  const sd = (b.subDimensions || []).find((x) => x.code === c);
  if (!sd) { E(`missing subDimension record ${c}`); continue; }
  const m = sd.mapping || {};
  for (const k of ['gapPattern', 'diagnosis', 'prescription']) if (!m[k] || m[k].length < 15) E(`mapping ${c}.${k}`);
  const iv = m.intervention || {}; if (!iv.type || !['COACH', 'CONSULTANT'].includes(iv.ownerRole) || !Number.isInteger(iv.typicalDays) || iv.typicalDays < 5 || iv.typicalDays > 120 || !iv.resources) E(`mapping ${c}.intervention`);
  const me = m.measurement || {}; for (const k of ['kpi', 'baselineMethod', 'provisionalTarget', 'dataSource', 'frequency']) if (!me[k]) E(`mapping ${c}.measurement.${k}`);
}
const CC = b.consistencyChecks || []; if (CC.length < 6 || CC.length > 10) E(`consistencyChecks ${CC.length}, need 6 to 10`);
for (const c of CC) { if (!ids.has(c.itemA) || !ids.has(c.itemB)) E(`consistency ${c.id}: unknown item`); if (!c.rule || !c.condition) E(`consistency ${c.id}: rule/condition`); }
for (const [id, s] of Object.entries(srcs)) for (const k of ['title', 'publisher', 'year', 'url', 'confidence']) if (!s[k]) E(`source ${id}.${k}`);
for (const k of ['version', 'status', 'generated']) if (!b[k]) E(`missing ${k}`);
console.log(`${b.framework}: ${Q.length} questions; weights ${JSON.stringify(wdist)}; gates ${gate}, core ${core}, conditional ${cond}, design judgement ${design}`);
console.log('domain weight share: ' + Object.entries(dw).map(([d, w]) => `${d} ${(100 * w / tw).toFixed(1)}%`).join(', '));
console.log('readiness: ' + Object.entries(rdy).map(([c, r]) => `${c} n=${r.n} gates=${r.gates} doms=${r.doms.size}`).join('; '));
warns.forEach((w) => console.log('WARN ' + w)); errs.forEach((e) => console.log('ERROR ' + e));
console.log(errs.length ? `${errs.length} errors` : 'PASS');
process.exit(errs.length ? 1 : 0);
