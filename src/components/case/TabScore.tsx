'use client';
import Link from 'next/link';
import { Async, Badge, Card, Empty, LineChart, Tile, useApi } from '@/components/ui';
import { dateFmt, dateTime } from '@/lib/client/api';
import type { TabProps } from './types';
import { CLASS_TONE, CONFIDENCE_TONE, MaturityBadge, one, pct } from './core/shared';

type Scores = {
  history: { id: string; run: number; overall: number; maturity: string; confidenceClass: string; at: string }[];
  latest: { overall: number; maturity: string; confidenceClass: string; dimensions: { dimension: string; value: number }[]; evidenceShare: Record<string, number>; at: string } | null;
  answers: { questionCode: string; dimension?: string; text?: string; value: number; evidenceClass: string; evidenceId: string | null }[];
};

export default function TabScore({ caseId }: TabProps) {
  const st = useApi<Scores>(`/cases/${caseId}/scores`);
  return <Async state={st}>{(d) => {
    const l = d.latest;
    if (!l) return <Empty title="No score yet" hint="A score is produced as soon as a diagnostic passes the data quality gate. Complete the Diagnostic tab first." />;
    const dims = Array.isArray(l.dimensions) ? [...l.dimensions] : [];
    const share = Object.entries(l.evidenceShare ?? {}).sort((a, b) => b[1] - a[1]);
    return <div className="stack">
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
          <tbody>{[...d.answers].sort((a, b) => a.questionCode.localeCompare(b.questionCode)).map((a) => <tr key={a.questionCode}><td><span className="mono">{a.questionCode}</span> {a.text}</td><td>{a.dimension ?? '-'}</td><td className="r num">{a.value}</td><td><Badge tone={CLASS_TONE[a.evidenceClass]}>{a.evidenceClass}</Badge></td></tr>)}</tbody>
        </table></div>
      </Card>}
    </div>;
  }}</Async>;
}
