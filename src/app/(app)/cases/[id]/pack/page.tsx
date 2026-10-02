'use client';
import { use } from 'react';
import { Async, Badge, Button, Card, Empty, PageHead, useApi } from '@/components/ui';
import { dateFmt } from '@/lib/client/api';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const st = useApi<any>(`/cases/${id}/investment-pack`);
  return <Async state={st}>{(d) => <div className="stack">
    <PageHead title="Investment readiness pack" sub={`${d.organisation.name}${d.organisation.region ? `, ${d.organisation.region}` : ''}`} actions={<Button onClick={() => window.print()}>Print or save as PDF</Button>} />
    <Card title="Certificate"><p><Badge tone="ok">{d.certificate.level}</Badge> Issued {dateFmt(d.certificate.issuedAt)}, valid until {dateFmt(d.certificate.expiresAt)}.</p></Card>
    {d.score && <Card title="Business health"><p>Overall score <b>{d.score.overall}</b> out of 100 ({d.score.maturity}). Confidence {d.score.confidence}. Scored {dateFmt(d.score.scoredAt)}.</p>
      <div className="table-wrap"><table><caption className="sr">Score by dimension</caption><thead><tr><th>Dimension</th><th className="r">Score</th></tr></thead><tbody>{d.score.dimensions.map((x: any) => <tr key={x.dimension}><td>{x.dimension}</td><td className="r num">{Math.round(x.value * 10) / 10}</td></tr>)}</tbody></table></div>
      <p className="small muted" style={{ marginTop: 8 }}>Evidence behind the answers: {Object.entries(d.score.evidenceShare).map(([k, v]: any) => `${k} ${Math.round(v * 100)}%`).join(', ')}.</p></Card>}
    <Card title="Readiness">{d.readiness.length === 0 ? <Empty title="No readiness indices for this framework version" /> : <ul>{d.readiness.map((r: any) => <li key={r.code}><b>{r.name}</b>: {r.level}{r.unlocks ? `. ${r.unlocks}` : ''}</li>)}</ul>}</Card>
    <Card title="Approved action plan">{d.plan.length === 0 ? <Empty title="No approved plan" /> : d.plan.map((i: any) => <div key={i.title} style={{ marginBottom: 10 }}><b>{i.title}</b><ul>{i.actions.map((a: any, n: number) => <li key={n}>{a.text} <span className="small muted">(within {a.days} days)</span></li>)}</ul></div>)}</Card>
    <p className="small muted">{d.note}</p>
  </div>}</Async>;
}
