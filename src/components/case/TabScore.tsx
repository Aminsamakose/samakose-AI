'use client';
import Link from 'next/link';
import { Async, Badge, Card, Empty, LineChart, Tile, useApi } from '@/components/ui';
import { dateFmt, dateTime } from '@/lib/client/api';
import CertificationCard from './CertificationCard';
import type { TabProps } from './types';
import { CLASS_TONE, CONFIDENCE_TONE, MaturityBadge, one, pct } from './core/shared';

type Extras = {
  subDimensions: { code: string; name: string; dimension: string; value: number; answered: number }[];
  readiness: { code: string; name: string; index: number | null; level: string; questions: number; blocking: { code: string; value: number | null; label: string }[]; unlocks: string | null }[];
  risks: { rule: string; code?: string; label: string; detail?: string }[];
  priorities: { code: string; name: string; score: number }[];
  notApplicable: string[];
};
const LEVEL_TONE: Record<string, string> = { 'Not ready': 'bad', Emerging: 'warn', 'Conditionally ready': 'info', Ready: 'ok' };
const RULE_NAME: Record<string, string> = { R1: 'Critical item', R2: 'Domain', R3: 'Evidence', R4: 'Contradiction', R5: 'Concentration' };
type Scores = {
  history: { id: string; run: number; overall: number; maturity: string; confidenceClass: string; at: string }[];
  latest: { overall: number; maturity: string; confidenceClass: string; dimensions: { dimension: string; value: number }[]; evidenceShare: Record<string, number>; extras?: Extras | null; at: string } | null;
  answers: { questionCode: string; dimension?: string; text?: string; value: number; notApplicable?: boolean; evidenceClass: string; evidenceId: string | null }[];
};

export default function TabScore({ caseId }: TabProps) {
  const st = useApi<Scores>(`/cases/${caseId}/scores`);
  return <Async state={st}>{(d) => {
    const l = d.latest;
    if (!l) return <Empty title="No score yet" hint="A score is produced as soon as a diagnostic passes the data quality gate. Complete the Diagnostic tab first." />;
    const dims = Array.isArray(l.dimensions) ? [...l.dimensions] : [];
    const share = Object.entries(l.evidenceShare ?? {}).sort((a, b) => b[1] - a[1]);
    return <div className="stack">
      <CertificationCard caseId={caseId} />
      <div className="grid">
        <Tile label="Overall score" value={one(l.overall)} hint="Out of 100" />
        <Tile label="Maturity" value={<MaturityBadge value={l.maturity} />} hint="Band from the scoring rules" />
        <Tile label="Confidence" value={<Badge tone={CONFIDENCE_TONE[l.confidenceClass]}>{l.confidenceClass}</Badge>} hint="How well the answers are evidenced" />
        <Tile label="Scored" value={<span style={{ fontSize: '1.1rem' }}>{dateFmt(l.at)}</span>} hint={`${d.history.length} run${d.history.length === 1 ? '' : 's'} in total`} />
      </div>
      <div className="grid two">
        <Card title="Score by dimension">
          {dims.length === 0 ? <Empty title="No dimension scores" /> : <div className="stack">
            <div className="bars" role="list" aria-label="Score by dimension, out of 100">{dims.map((x) => <div className="bar-row" role="listitem" key={x.dimension}>
              <span>{x.dimension}</span><div className="bar-track" aria-hidden><div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, x.value))}%` }} /></div><span className="num" style={{ textAlign: 'right' }}>{one(x.value)}</span></div>)}</div>
            <details className="small muted"><summary>View as table</summary>
              <div className="table-wrap"><table><thead><tr><th>Dimension</th><th className="r">Score</th></tr></thead><tbody>{dims.map((x) => <tr key={x.dimension}><td>{x.dimension}</td><td className="r num">{one(x.value)}</td></tr>)}</tbody></table></div></details>
          </div>}
        </Card>
        <Card title="Evidence behind the score">
          {share.length === 0 ? <Empty title="No evidence breakdown" /> : <table>
            <caption className="sr">Share of scored weight by evidence type</caption>
            <thead><tr><th>Evidence type</th><th className="r">Share of weight</th></tr></thead>
            <tbody>{share.map(([k, v]) => <tr key={k}><td><Badge tone={CLASS_TONE[k]}>{k}</Badge></td><td className="r num">{pct(v)}</td></tr>)}</tbody></table>}
          <p className="small muted" style={{ marginTop: 8 }}>Better evidence raises the score and the confidence. Upload or verify evidence in the <Link href={`/cases/${caseId}?tab=evidence`}>Evidence tab</Link>.</p>
        </Card>
      </div>
      {l.extras && <Extended x={l.extras} />}
      <Card title="Score history">
        <LineChart label="Overall score by run" points={d.history.map((h) => ({ x: `#${h.run} ${dateFmt(h.at)}`, y: h.overall }))} />
        <div className="table-wrap" style={{ marginTop: 10 }}><table>
          <caption className="sr">Score history</caption>
          <thead><tr><th>When</th><th>Run</th><th className="r">Score</th><th>Maturity</th><th>Confidence</th></tr></thead>
          <tbody>{[...d.history].reverse().map((h) => <tr key={h.id}><td>{dateTime(h.at)}</td><td className="num">{h.run}</td><td className="r num">{one(h.overall)}</td><td><MaturityBadge value={h.maturity} /></td><td><Badge tone={CONFIDENCE_TONE[h.confidenceClass]}>{h.confidenceClass}</Badge></td></tr>)}</tbody>
        </table></div>
      </Card>
      {d.answers.length > 0 && <Card title="Answers behind the latest score">
        <div className="table-wrap"><table>
          <caption className="sr">Answers used in the latest score</caption>
          <thead><tr><th>Question</th><th>Dimension</th><th className="r">Value (0 to 4)</th><th>Evidence</th></tr></thead>
          <tbody>{[...d.answers].sort((a, b) => a.questionCode.localeCompare(b.questionCode)).map((a) => <tr key={a.questionCode}><td><span className="mono">{a.questionCode}</span> {a.text}</td><td>{a.dimension ?? '-'}</td><td className="r num">{a.notApplicable ? 'N/A' : a.value}</td><td><Badge tone={CLASS_TONE[a.evidenceClass]}>{a.evidenceClass}</Badge></td></tr>)}</tbody>
        </table></div>
      </Card>}
    </div>;
  }}</Async>;
}

/** Results only banks with sub-dimensions and readiness rules produce. These are rule outputs. Interpretation stays with a person. */
function Extended({ x }: { x: Extras }) {
  return <>
    {x.readiness.length > 0 && <Card title="Readiness">
      <div className="table-wrap"><table>
        <caption className="sr">Readiness by opportunity</caption>
        <thead><tr><th>Opportunity</th><th className="r">Index (0 to 100)</th><th>Level</th><th>What stands in the way</th></tr></thead>
        <tbody>{x.readiness.map((r) => <tr key={r.code}>
          <td>{r.name}<div className="small muted">{r.questions} questions</div></td>
          <td className="r num">{r.index === null ? '-' : one(r.index)}</td>
          <td><Badge tone={LEVEL_TONE[r.level]}>{r.level}</Badge></td>
          <td>{r.blocking.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{r.blocking.map((b) => <li key={b.code}><span className="mono">{b.code}</span> {b.label}{b.value === null ? ' (not answered)' : ` (rated ${b.value})`}</li>)}</ul> : <span className="muted">Nothing blocking</span>}</td></tr>)}</tbody>
      </table></div>
      <p className="small muted" style={{ marginTop: 8 }}>Levels follow the framework rules and are indicators for a consultant to review. They are not a certification or a funding decision.</p>
    </Card>}
    <div className="grid two">
      <Card title="Priority areas">
        {x.priorities.length === 0 ? <Empty title="No priority areas" hint="Every answered item is at the top rating." /> : <ol style={{ margin: 0, paddingLeft: 20 }}>{x.priorities.map((p) => <li key={p.code}>{p.name} <span className="muted num">({one(p.score)})</span></li>)}</ol>}
      </Card>
      <Card title="Risks and gaps">
        {x.risks.length === 0 ? <Empty title="No risks flagged by the rules" /> : <ul style={{ margin: 0, paddingLeft: 18 }}>{x.risks.map((r, i) => <li key={i}><Badge tone={r.rule === 'R1' || r.rule === 'R5' ? 'bad' : r.rule === 'R4' ? 'warn' : 'info'}>{RULE_NAME[r.rule] ?? r.rule}</Badge> {r.label}{r.detail && <span className="small muted"> ({r.detail})</span>}</li>)}</ul>}
      </Card>
    </div>
    <Card title="Score by sub-dimension" actions={x.notApplicable.length ? <span className="small muted">{x.notApplicable.length} question{x.notApplicable.length === 1 ? '' : 's'} marked not applicable</span> : undefined}>
      <div className="table-wrap"><table>
        <caption className="sr">Score by sub-dimension, out of 100</caption>
        <thead><tr><th>Sub-dimension</th><th>Dimension</th><th className="r">Questions</th><th className="r">Score</th></tr></thead>
        <tbody>{x.subDimensions.map((s) => <tr key={s.code}><td><span className="mono muted">{s.code}</span> {s.name}</td><td>{s.dimension}</td><td className="r num">{s.answered}</td><td className="r num">{one(s.value)}</td></tr>)}</tbody>
      </table></div>
    </Card>
  </>;
}
