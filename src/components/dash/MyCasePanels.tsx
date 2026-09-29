'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { api, dateFmt, dateTime, errText, ghs } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, FormError, useApi, useForm, useToast } from '@/components/ui';
import { ActionStatus, BarsWithTable } from './common';

export const STATES = ['PROSPECT', 'ONBOARDING', 'PROFILED', 'DIAGNOSTIC', 'DIAGNOSED', 'PRESCRIBED', 'APPROVAL', 'IN EXECUTION', 'COACHING', 'MONITORING', 'MIDLINE', 'ENDLINE', 'FOLLOW-UP', 'GRADUATED'];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function Lifecycle({ status }: { status: string }) {
  const idx = STATES.indexOf(status);
  return <div className="stack">
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }} aria-label="Progress through the programme">
      {STATES.map((s, i) => {
        const state = idx === -1 ? 'later' : i < idx ? 'done' : i === idx ? 'current' : 'later';
        return <li key={s} aria-current={state === 'current' ? 'step' : undefined}
          style={{ padding: '4px 10px', borderRadius: 99, border: `1px solid ${state === 'later' ? 'var(--line)' : 'var(--brand)'}`, background: state === 'current' ? 'var(--brand)' : 'transparent', color: state === 'current' ? '#fff' : state === 'done' ? 'var(--brand)' : 'var(--muted)', fontWeight: state === 'current' ? 700 : 500, fontSize: '.85rem' }}>
          {state === 'done' ? 'Done: ' : state === 'current' ? 'Now: ' : ''}{label(s)}
        </li>;
      })}
    </ol>
    <p className="small muted">Step {idx === -1 ? '-' : idx + 1} of {STATES.length}. {idx === -1 ? `Your case is in the ${label(status)} state.` : ''}</p>
  </div>;
}

export function ScorePanel({ score }: { score: { overall: number; maturity: string; confidenceClass: string; dimensions: { dimension: string; value: number }[]; at: string } | null }) {
  if (!score) return <Empty title="No score yet" hint="Your score appears after your diagnostic has been completed and scored." />;
  return <div className="stack">
    <div className="grid">
      <div className="tile"><span className="l">Overall score</span><span className="v">{score.overall.toFixed(1)}</span><span className="small muted">Out of 100. Scored {dateFmt(score.at)}</span></div>
      <div className="tile"><span className="l">Maturity</span><span className="v" style={{ fontSize: '1.2rem' }}>{score.maturity}</span><span className="small muted">Band for the overall score</span></div>
      <div className="tile"><span className="l">Evidence strength</span><span className="v" style={{ fontSize: '1.2rem' }}>{score.confidenceClass}</span><span className="small muted">How well your answers are backed by proof</span></div>
    </div>
    <h3>Score by area</h3>
    <BarsWithTable label="score by area" data={(score.dimensions ?? []).map((d) => ({ label: d.dimension, value: d.value }))} format={(n) => n.toFixed(1)} />
  </div>;
}

export function ActionsPanel({ caseId }: { caseId: string }) {
  const st = useApi<{ items: any[] }>(`/actions?caseId=${caseId}&pageSize=100&sort=due&dir=asc`);
  return <Async state={st}>{(d) => d.items.length === 0 ? <Empty title="No actions yet" hint="Your adviser will add actions after your prescription is approved." /> :
    <div className="table-wrap"><table><caption className="sr">Actions for your business</caption>
      <thead><tr><th>What to do</th><th>Who</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>{d.items.map((a) => <tr key={a.id}>
        <td>{a.text}{a.evidenceNote && <span className="small muted" style={{ display: 'block' }}>Note: {a.evidenceNote}</span>}</td>
        <td>{a.ownerRole === 'OWNER' ? 'You' : a.ownerRole === 'COACH' ? 'Your coach' : 'Your consultant'}</td>
        <td>{dateFmt(a.dueDate)}{a.overdue && <> <Badge tone="warn">Overdue</Badge></>}</td>
        <td>{a.ownerRole === 'OWNER' ? <ActionStatus action={a} compact onChanged={st.reload} /> : <Badge>{a.status}</Badge>}</td></tr>)}</tbody></table></div>}</Async>;
}

export function ReportsPanel({ caseId }: { caseId: string }) {
  const st = useApi<any[]>(`/cases/${caseId}/reports`);
  return <Async state={st} empty={(d) => d.length === 0}>{(d) => <ul className="timeline">{d.map((r) => <li key={r.id}><div><Link href={`/reports/${r.id}`}><strong>{r.title}</strong></Link><div className="small muted">Released {dateFmt(r.releasedAt)}</div></div></li>)}</ul>}</Async>;
}

export function InvoicesPanel() {
  const st = useApi<{ items: any[] }>('/invoices?pageSize=50&sort=due&dir=asc');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const pay = async (id: string) => {
    setBusy(id);
    try {
      const r = await api.post<{ authorizationUrl: string }>(`/invoices/${id}/pay`);
      if (!r.authorizationUrl) throw new Error('missing');
      window.location.href = r.authorizationUrl;
    } catch (e) { toast(e instanceof Error && e.message === 'missing' ? 'The payment page could not be opened. Please try again.' : errText(e), 'bad'); setBusy(null); }
  };
  return <Async state={st}>{(d) => d.items.length === 0 ? <Empty title="No invoices" hint="Invoices from Samakose appear here." /> :
    <div className="table-wrap"><table><caption className="sr">Your invoices</caption>
      <thead><tr><th>Invoice</th><th className="r">Amount</th><th>Due</th><th>Status</th><th><span className="sr">Pay</span></th></tr></thead>
      <tbody>{d.items.map((i) => <tr key={i.id}><td className="mono">{i.code}</td><td className="r num">{ghs(i.amountGhs)}</td><td>{dateFmt(i.dueDate)}</td><td><Badge>{i.status}</Badge></td>
        <td>{['Sent', 'Overdue'].includes(i.status) && <Button size="sm" variant="primary" loading={busy === i.id} aria-label={`Pay invoice ${i.code}, ${ghs(i.amountGhs)}`} onClick={() => pay(i.id)}>Pay now</Button>}</td></tr>)}</tbody></table></div>}</Async>;
}

function ReadingForm({ kpi, onDone }: { kpi: any; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [loc, setLoc] = useState<Record<string, string>>({});
  const f = useForm({ value: '', readingDate: today }, (v) => api.post(`/kpis/${kpi.id}/readings`, { value: Number(v.value), readingDate: v.readingDate }), { success: 'Reading saved', onDone: () => { f.setValues({ value: '', readingDate: today }); onDone(); } });
  return <form className="form-grid" noValidate onSubmit={(e) => {
    e.preventDefault(); const err: Record<string, string> = {};
    if (f.values.value === '' || Number.isNaN(Number(f.values.value))) err.value = 'Enter a number';
    if (!f.values.readingDate) err.readingDate = 'Choose a date'; else if (f.values.readingDate > today) err.readingDate = 'The date cannot be in the future';
    setLoc(err); if (!Object.keys(err).length) f.onSubmit();
  }}>
    <div style={{ gridColumn: '1 / -1' }}><FormError message={f.formError} /></div>
    <Field label={`New reading${kpi.unit ? ` (${kpi.unit})` : ''}`} name="value" required error={loc.value ?? f.errors.value}>{(p) => <input {...p} {...f.input('value')} type="number" step="any" inputMode="decimal" />}</Field>
    <Field label="Date of reading" name="readingDate" required error={loc.readingDate ?? f.errors.readingDate}>{(p) => <input {...p} {...f.input('readingDate')} type="date" max={today} />}</Field>
    <div className="form-actions"><Button type="submit" variant="primary" loading={f.busy}>Save reading</Button></div>
  </form>;
}
export function KpiPanel({ caseId }: { caseId: string }) {
  const st = useApi<any[]>(`/cases/${caseId}/kpis`);
  return <Async state={st} empty={(d) => d.length === 0}>{(d) => <div className="stack">{d.map((k) => <section key={k.id} className="card" aria-label={k.name}>
    <div className="card-head"><h3>{k.name}</h3><span className="small muted mono">{k.code}</span></div>
    <div className="grid">
      <div className="tile"><span className="l">Baseline</span><span className="v" style={{ fontSize: '1.2rem' }}>{k.baseline ?? '-'}</span></div>
      <div className="tile"><span className="l">Latest</span><span className="v" style={{ fontSize: '1.2rem' }}>{k.latest ? k.latest.value : '-'}</span><span className="small muted">{k.latest ? dateFmt(k.latest.date) : 'No reading yet'}</span></div>
      <div className="tile"><span className="l">Target</span><span className="v" style={{ fontSize: '1.2rem' }}>{k.target ?? '-'}</span><span className="small muted">{k.progress === null ? 'Progress shown once baseline, target and a reading exist' : `${Math.round(k.progress * 100)}% of the way`}</span></div>
    </div>
    {k.readings.length > 0 && <details className="small muted"><summary>Earlier readings ({k.readings.length})</summary><div className="table-wrap"><table><thead><tr><th>Date</th><th className="r">Value</th><th>Source</th></tr></thead><tbody>{[...k.readings].reverse().map((r: any) => <tr key={r.id}><td>{dateFmt(r.date)}</td><td className="r num">{r.value}</td><td>{r.sourceClass}</td></tr>)}</tbody></table></div></details>}
    <ReadingForm kpi={k} onDone={st.reload} />
  </section>)}</div>}</Async>;
}

export function EvidencePanel({ caseId }: { caseId: string }) {
  const docs = useApi<any[]>(`/documents?caseId=${caseId}`);
  const ev = useApi<any[]>(`/cases/${caseId}/evidence`);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loc, setLoc] = useState<Record<string, string>>({});
  const f = useForm({ description: '', link: '' }, async (v) => {
    const file = fileRef.current?.files?.[0];
    let documentId: string | null = null;
    if (file) { const fd = new FormData(); fd.append('file', file); fd.append('caseId', caseId); documentId = (await api.upload<{ id: string }>('/documents', fd)).id; }
    return api.post(`/cases/${caseId}/evidence`, { description: v.description.trim(), documentId, link: v.link.trim() || null });
  }, { success: 'Evidence added', onDone: () => { f.setValues({ description: '', link: '' }); if (fileRef.current) fileRef.current.value = ''; docs.reload(); ev.reload(); } });
  return <div className="stack">
    <form className="stack" noValidate onSubmit={(e) => {
      e.preventDefault(); const err: Record<string, string> = {};
      if (f.values.description.trim().length < 3) err.description = 'Describe what this shows (at least 3 characters)';
      if (!fileRef.current?.files?.[0] && !f.values.link.trim()) err.file = 'Attach a file or add a link';
      setLoc(err); if (!Object.keys(err).length) f.onSubmit();
    }}>
      <FormError message={f.formError} />
      <Field label="What does this show?" name="description" required error={loc.description ?? f.errors.description} hint="For example: Bank statement for June, or Photo of my stock room.">{(p) => <textarea {...p} {...f.input('description')} maxLength={500} />}</Field>
      <div className="form-grid">
        <Field label="File" name="file" error={loc.file ?? f.errors.file} hint="PDF, image, Word, Excel, CSV or text.">{(p) => <input {...p} ref={fileRef} type="file" />}</Field>
        <Field label="Or a web link" name="link" error={f.errors.link}>{(p) => <input {...p} {...f.input('link')} type="url" maxLength={500} placeholder="https://" />}</Field>
      </div>
      <div className="form-actions"><Button type="submit" variant="primary" loading={f.busy}>Add evidence</Button></div>
    </form>
    <h3>Evidence you have shared</h3>
    <Async state={ev} empty={(d) => d.length === 0}>{(d) => <div className="table-wrap"><table><caption className="sr">Evidence shared</caption><thead><tr><th>Description</th><th>Status</th><th>Added</th></tr></thead>
      <tbody>{d.map((e) => <tr key={e.id}><td>{e.description}{e.link && <span className="small" style={{ display: 'block' }}><a href={e.link} target="_blank" rel="noopener noreferrer">Open link</a></span>}{e.documentId && <span className="small" style={{ display: 'block' }}><a href={`/api/v1/documents/${e.documentId}/download`}>Download file</a></span>}</td><td><Badge>{e.class}</Badge></td><td>{dateFmt(e.createdAt)}</td></tr>)}</tbody></table></div>}</Async>
    <h3>Documents</h3>
    <Async state={docs} empty={(d) => d.length === 0}>{(d) => <ul className="timeline">{d.map((x) => <li key={x.id}><div><a href={`/api/v1/documents/${x.id}/download`}>{x.filename}</a><div className="small muted">{(x.size / 1024).toFixed(0)} KB, added {dateTime(x.createdAt)}</div></div></li>)}</ul>}</Async>
  </div>;
}

export function SessionsPanel({ caseId }: { caseId: string }) {
  const st = useApi<any[]>(`/sessions?caseId=${caseId}&upcoming=true`);
  return <Async state={st} empty={(d) => d.length === 0}>{(d) => <ul className="timeline">{d.map((s) => <li key={s.id}><div><strong>{dateTime(s.scheduledAt)}</strong><div className="small muted">Coaching session</div></div></li>)}</ul>}</Async>;
}
export { Card };
