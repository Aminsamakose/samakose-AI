'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiFail, dateTime } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Field, FormError, KV, PageHead, useApi, useForm, useToast } from '@/components/ui';
import { useMe } from '@/components/case/clinical/common';
import ReasonModal from '@/components/case/clinical/ReasonModal';

type Report = {
  id: string; code: string; caseId: string; status: string; title: string; content: { heading: string; body: string }[];
  basis: { verified: number; unverified: number } | null; aiRequestId: string | null; createdBy: string | null; createdAt: string; releasedAt: string | null;
  caseCode: string; org: { name: string; code: string };
};
type CaseLite = { reviewerId: string | null; consultantId: string | null };

const PRINT_CSS = `
@media print {
  .nav, .topbar, .skip, .toasts, .no-print, .scrim { display: none !important; }
  .shell { display: block !important; }
  .content, .main { padding: 0 !important; margin: 0 !important; }
  body { background: #fff !important; color: #000 !important; font-size: 11pt; }
  .card { box-shadow: none !important; border: none !important; padding: 0 !important; background: #fff !important; }
  .print-section { break-inside: avoid; margin-bottom: 14pt; }
  a { color: inherit; text-decoration: none; }
  .badge { border: 1px solid #000; background: none !important; color: #000 !important; }
}
`;

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const st = useApi<Report>(`/reports/${id}`);
  const { me, can } = useMe();
  const canApprove = can('reports', 'approve');
  const caseSt = useApi<CaseLite>(canApprove && st.data ? `/cases/${st.data.caseId}` : null);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (st.data) document.title = `${st.data.title} | Business Doctor by Samakose`; }, [st.data]);

  return <div className="stack">
    <style>{PRINT_CSS}</style>
    <Async state={st}>{(r) => {
      const draft = r.status === 'Draft';
      const canEdit = draft && can('reports', 'create');
      let block: string | null = null;
      if (draft && canApprove && me && caseSt.data) {
        if (caseSt.data.reviewerId !== me.id) block = 'Only the reviewer assigned to this case can release or return a report.';
        else if (r.createdBy === me.id || caseSt.data.consultantId === me.id) block = 'You wrote this report or are responsible for the case, so someone else must release it (four-eyes rule).';
      }
      const refresh = () => { st.reload(); };
      return <>
        <div className="no-print"><PageHead title={r.title} crumbs={<><Link href="/cases">Cases</Link> / <Link href={`/cases/${r.caseId}`}>{r.caseCode}</Link> / Report</>}
          sub={<>{r.org.name} <Badge tone={draft ? '' : 'ok'}>{draft ? 'Draft' : 'Released'}</Badge></>}
          actions={<>{!draft && <><a className="btn" href={`/api/v1/reports/${r.id}/export?format=pdf`} download>Download PDF</a> <a className="btn" href={`/api/v1/reports/${r.id}/export?format=docx`} download>Download Word</a> </>}<Button onClick={() => window.print()}>Print</Button></>} /></div>

        {draft && <div className="alert warn no-print">This is a draft. It is not visible to the business owner until the reviewer releases it.</div>}

        {canApprove && draft && <Card title="Review" className="no-print">
          {block ? <p>{block}</p> : !caseSt.data && caseSt.loading ? <p className="muted">Checking your role on this case</p> : <>
            <p className="muted" style={{ marginBottom: 10 }}>Read the report, then release it to the business owner or return it to the author with a reason.</p>
            <div className="form-actions">
              <ConfirmButton variant="primary" size="sm" label="Release report" message="Releasing shares this report with the business owner and notifies them. It cannot be edited afterwards. Continue?" onConfirm={async () => { await api.post(`/reports/${r.id}/release`); toast('Report released'); refresh(); }} />
              <ReasonModal label="Return to author" prompt="Say what must change before this can be released." fieldLabel="What must change" submit={(reason) => api.post(`/reports/${r.id}/return`, { reason })} onDone={() => { toast('Report returned to the author'); refresh(); }} />
            </div></>}
        </Card>}
        {draft && can('reports', 'create') && !canApprove && !editing && <div className="no-print"><Button variant="primary" onClick={() => setEditing(true)}>Edit draft</Button></div>}
        {draft && can('reports', 'create') && canApprove && !editing && <div className="no-print"><Button onClick={() => setEditing(true)}>Edit draft</Button></div>}

        {editing && canEdit ? <EditForm r={r} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); refresh(); }} /> :
          <article className="card stack" aria-label={r.title}>
            <header className="print-section">
              <h1 style={{ display: 'none' }} className="print-title">{r.title}</h1>
              <KV items={[['Business', r.org.name], ['Case', r.caseCode], ['Report', r.code], ['Status', draft ? 'Draft' : 'Released'], ['Prepared', dateTime(r.createdAt)], ['Released', r.releasedAt ? dateTime(r.releasedAt) : '-']]} />
              {r.basis && <p className="small muted" style={{ marginTop: 8 }}>Evidence basis: {r.basis.verified} verified and {r.basis.unverified} unverified or self-reported item{r.basis.unverified === 1 ? '' : 's'}.</p>}
            </header>
            {r.content.map((s, i) => <section key={i} className="print-section"><h2 style={{ fontSize: '1.15rem', marginBottom: 6 }}>{s.heading}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{s.body}</p></section>)}
          </article>}
        <style>{`@media print { .print-title { display: block !important; font-size: 18pt; margin-bottom: 8pt; } }`}</style>
      </>;
    }}</Async>
  </div>;
}

function EditForm({ r, onDone, onCancel }: { r: Report; onDone: () => void; onCancel: () => void }) {
  const f = useForm<{ title: string; content: { heading: string; body: string }[] }>({ title: r.title, content: r.content.map((c) => ({ ...c })) }, async (v) => {
    const e: Record<string, string> = {};
    if (v.title.trim().length < 3) e.title = 'Enter a title of at least 3 characters';
    if (!v.content.length) e.content = 'A report needs at least one section';
    v.content.forEach((c, i) => {
      if (!c.heading.trim()) e[`h${i}`] = 'Enter a heading';
      if (!c.body.trim()) e[`b${i}`] = 'Enter the text';
      else if (c.body.length > 6000) e[`b${i}`] = 'Keep this section under 6000 characters';
    });
    if (Object.keys(e).length) throw new ApiFail(400, 'validation_failed', 'Please fix the highlighted fields', e);
    return api.patch(`/reports/${r.id}`, { title: v.title.trim(), content: v.content.map((c) => ({ heading: c.heading.trim(), body: c.body.trim() })) });
  }, { success: 'Draft saved', onDone });
  const c = f.values.content;
  const setC = (i: number, p: Partial<{ heading: string; body: string }>) => f.set('content', c.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => { const n = [...c]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); f.set('content', n); };
  return <form className="card stack no-print" onSubmit={f.onSubmit} noValidate aria-label="Edit report draft">
    <FormError message={f.formError} />
    <Field label="Report title" name="title" required error={f.errors.title}>{(p) => <input {...p} value={f.values.title} onChange={(e) => f.set('title', e.target.value)} />}</Field>
    {f.errors.content && <div className="alert bad" role="alert">{f.errors.content}</div>}
    {c.map((s, i) => <fieldset key={i} className="card stack" style={{ padding: 12, margin: 0 }}>
      <legend><strong>Section {i + 1}</strong></legend>
      <Field label="Heading" name={`h${i}`} required error={f.errors[`h${i}`]}>{(p) => <input {...p} value={s.heading} onChange={(e) => setC(i, { heading: e.target.value })} />}</Field>
      <Field label="Text" name={`b${i}`} required error={f.errors[`b${i}`]}>{(p) => <textarea {...p} rows={6} value={s.body} onChange={(e) => setC(i, { body: e.target.value })} />}</Field>
      <div className="row">
        <Button size="sm" type="button" disabled={i === 0} onClick={() => move(i, -1)}>Move up</Button>
        <Button size="sm" type="button" disabled={i === c.length - 1} onClick={() => move(i, 1)}>Move down</Button>
        {c.length > 1 && <Button size="sm" type="button" onClick={() => f.set('content', c.filter((_, j) => j !== i))}>Remove section {i + 1}</Button>}
      </div>
    </fieldset>)}
    {c.length < 20 && <div><Button size="sm" type="button" onClick={() => f.set('content', [...c, { heading: '', body: '' }])}>Add a section</Button></div>}
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save draft</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
