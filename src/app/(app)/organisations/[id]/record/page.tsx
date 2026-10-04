'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { dateFmt } from '@/lib/client/api';
import { Async, Badge, Card, Empty, PageHead, useApi } from '@/components/ui';
import { typeLabel, useTitle } from '@/components/portfolio/shared';
import { TrendChart } from '@/components/TrendChart';

type Dim = { dimension: string; value: number };
type Score = { id: string; run: number; at: string; overall: number; maturity: string; confidence: string; framework: string; dimensions: Dim[]; change: { delta: number | null; comparable?: boolean; dimensions: { dimension: string; delta: number }[]; reason: string } };
type CaseRec = {
  id: string; code: string; status: string; openedAt: string;
  diagnostics: { id: string; code: string; at: string; status: string; version: number; completion: number; framework: string }[];
  scores: Score[];
  diagnoses: { id: string; code: string; at: string; status: string; priority: string; summary: string }[];
  prescriptions: { id: string; code: string; at: string; status: string; items: number }[];
  interventions: { id: string; code: string; library: string; status: string }[];
  kpis: { id: string; name: string; unit: string | null; baseline: number | null; target: number | null }[];
  sessions: { id: string; at: string; status: string }[];
  approvals: { id: string; at: string; type: string; decision: string; reason: string | null }[];
  reports: { id: string; code: string; title: string; status: string; releasedAt: string | null }[];
};
type Rec = { organisation: { id: string; code: string; name: string; type: string }; cases: CaseRec[] };

const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

function CaseBlock({ c }: { c: CaseRec }) {
  return <Card title={<><Link href={`/cases/${c.id}`} className="mono">{c.code}</Link> <Badge>{c.status}</Badge></>}>
    <div className="stack">
      <section aria-labelledby={`sc-${c.id}`}>
        <h3 id={`sc-${c.id}`} className="small">Score history</h3>
        {c.scores.length === 0 ? <p className="muted small">No score yet.</p> :
          <div className="table-wrap"><table><thead><tr><th>Date</th><th>Overall</th><th>Change</th><th>Maturity</th><th>Confidence</th><th>Framework</th><th>Why it changed</th></tr></thead>
            <tbody>{c.scores.map((s) => <tr key={s.id}><td>{dateFmt(s.at)}</td><td>{s.overall}</td><td>{s.change.delta === null ? 'n/a' : sign(s.change.delta)}</td><td>{s.maturity}</td><td>{s.confidence}</td><td className="mono">{s.framework}</td><td>{s.change.reason}</td></tr>)}</tbody></table></div>}
      </section>
      <section><h3 className="small">Diagnostics ({c.diagnostics.length})</h3>
        {c.diagnostics.length === 0 ? <p className="muted small">None.</p> : <ul className="small">{c.diagnostics.map((d) => <li key={d.id}><span className="mono">{d.code}</span> · {dateFmt(d.at)} · {d.status} · version {d.version} · {Math.round(d.completion * 100)}% complete · <span className="mono">{d.framework}</span></li>)}</ul>}
      </section>
      <section><h3 className="small">Diagnoses and prescriptions</h3>
        {c.diagnoses.length + c.prescriptions.length === 0 ? <p className="muted small">None.</p> : <ul className="small">
          {c.diagnoses.map((d) => <li key={d.id}><span className="mono">{d.code}</span> · {dateFmt(d.at)} · {d.status} · priority {d.priority}: {d.summary}</li>)}
          {c.prescriptions.map((r) => <li key={r.id}><span className="mono">{r.code}</span> · {dateFmt(r.at)} · {r.status} · {r.items} item{r.items === 1 ? '' : 's'}</li>)}</ul>}
      </section>
      <section><h3 className="small">Interventions and KPIs</h3>
        {c.interventions.length + c.kpis.length === 0 ? <p className="muted small">None.</p> : <ul className="small">
          {c.interventions.map((i) => <li key={i.id}><span className="mono">{i.code}</span> · {i.library} · {i.status}</li>)}
          {c.kpis.map((k) => <li key={k.id}>{k.name}: baseline {k.baseline ?? 'not set'}, target {k.target ?? 'not set'}{k.unit ? ` ${k.unit}` : ''}</li>)}</ul>}
      </section>
      {c.sessions.length > 0 && <section><h3 className="small">Coaching sessions</h3><ul className="small">{c.sessions.map((s) => <li key={s.id}>{dateFmt(s.at)} · {s.status}</li>)}</ul></section>}
      {c.approvals.length > 0 && <section><h3 className="small">Approvals</h3><ul className="small">{c.approvals.map((a) => <li key={a.id}>{dateFmt(a.at)} · {a.type} · {a.decision}{a.reason ? `: ${a.reason}` : ''}</li>)}</ul></section>}
      {c.reports.length > 0 && <section><h3 className="small">Reports</h3><ul className="small">{c.reports.map((r) => <li key={r.id}><span className="mono">{r.code}</span> · {r.title} · {r.status}{r.releasedAt ? ` · ${dateFmt(r.releasedAt)}` : ''}</li>)}</ul></section>}
    </div>
  </Card>;
}

export default function RecordPage() {
  const { id } = useParams<{ id: string }>();
  const st = useApi<Rec>(`/organisations/${id}/record`);
  useTitle(st.data ? `${st.data.organisation.name}: Business Health Record` : 'Business Health Record');
  return <Async state={st}>{(r) => <div className="stack">
    <PageHead crumbs={<Link href={`/organisations/${r.organisation.id}`}>{r.organisation.name}</Link>} title="Business Health Record" sub={<><span className="mono">{r.organisation.code}</span> · {typeLabel(r.organisation.type)}</>} />
    <p className="muted small">Read-only history of every case for this organisation. Each score shows the framework version it was produced under, so a change can be traced to the business or to the framework.</p>
    {r.cases.length > 0 && <Card title="Health trend"><TrendChart cases={r.cases} /></Card>}
    {r.cases.length === 0 ? <Empty title="No cases in your view" hint="Cases you are allowed to see appear here." /> : r.cases.map((c) => <CaseBlock key={c.id} c={c} />)}
  </div>}</Async>;
}
