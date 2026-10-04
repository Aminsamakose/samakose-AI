'use client';
import { useState } from 'react';
import { api, dateFmt, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Field, FormError, Modal, PageHead, Tile, useApi, useToast } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { Person } from '@/components/Avatar';

const STATUSES = ['Draft', 'Submitted', 'Approved', 'Rejected', 'Suspended'];
const tone = (s: string) => s === 'Approved' ? 'ok' : s === 'Submitted' ? 'info' : s === 'Rejected' || s === 'Suspended' ? 'bad' : 'warn';
const NEXT: Record<string, { to: string; label: string; note?: boolean; danger?: boolean }[]> = {
  Submitted: [{ to: 'Approved', label: 'Approve' }, { to: 'Rejected', label: 'Reject', note: true, danger: true }, { to: 'Draft', label: 'Return for changes', note: true }],
  Approved: [{ to: 'Suspended', label: 'Suspend', note: true, danger: true }],
  Suspended: [{ to: 'Approved', label: 'Reinstate' }],
  Rejected: [{ to: 'Draft', label: 'Reopen', note: true }], Draft: []
};

export default function PractitionersPage() {
  const [status, setStatus] = useState(''); const [q, setQ] = useState('');
  const st = useApi<any>(`/practitioners?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) })}`);
  const [open, setOpen] = useState<any>(null); const [decision, setDecision] = useState<{ p: any; to: string; label: string; note: boolean } | null>(null);
  return <Guard resource="practitioners" action="read" title="Experts and coaches">{() => <>
    <PageHead title="Experts and coaches" sub="Vet profiles before anyone can be assigned to a business. Approval is a human decision and is recorded." />
    <div className="stack">
      <Async state={st}>{(d) => <div className="grid">
        <Tile label="Awaiting review" value={d.counts.Submitted ?? 0} hint="Submitted, not yet decided" tone={d.counts.Submitted ? 'warn' : undefined} />
        <Tile label="Approved" value={d.counts.Approved ?? 0} hint="Can be assigned work" />
        <Tile label="Draft" value={d.counts.Draft ?? 0} hint="Started, not submitted" />
        <Tile label="Suspended or rejected" value={(d.counts.Suspended ?? 0) + (d.counts.Rejected ?? 0)} hint="Cannot be assigned" />
      </div>}</Async>
      <Card>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="field"><label className="sr" htmlFor="pq">Search name or specialisation</label><input id="pq" type="search" placeholder="Search name or specialisation" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="field"><label className="sr" htmlFor="ps">Status</label><select id="ps" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
        </div>
        <Async state={st} empty={(d) => !d.items.length}>{(d) => <div className="table-wrap"><table>
          <caption className="sr">Experts and coaches</caption>
          <thead><tr><th>Person</th><th>Works as</th><th>Status</th><th>Profile</th><th>Cases</th><th>Availability</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>{d.items.map((p: any) => <tr key={p.userId}>
            <td><Person name={p.name} src={p.photoUrl} sub={p.headline ?? p.email} /></td>
            <td>{p.functions.join(' and ') || '-'}</td>
            <td><Badge tone={tone(p.vettingStatus)}>{p.vettingStatus}</Badge></td>
            <td>{p.completeness?.percent ?? 0}%</td>
            <td className="num">{p.load} of {p.maxActive}</td>
            <td>{p.availability}</td>
            <td><Button size="sm" aria-label={`Open profile of ${p.name}`} onClick={() => setOpen(p)}>Open</Button></td>
          </tr>)}</tbody></table></div>}</Async>
        {!st.loading && st.data && !st.data.items.length && <p className="muted">No experts match. People appear here when they register with the Expert role or an administrator creates them.</p>}
      </Card>
    </div>
    <Modal open={!!open} onClose={() => setOpen(null)} title={open ? open.name : ''}>{open && <Detail id={open.userId} onDecide={(p, o) => { setOpen(null); setDecision({ p, ...o }); }} />}</Modal>
    {decision && <Decide d={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); st.reload(); }} />}
  </>}</Guard>;
}

function Detail({ id, onDecide }: { id: string; onDecide: (p: any, o: { to: string; label: string; note: boolean }) => void }) {
  const st = useApi<any>(`/practitioners/${id}`); const conf = useApi<any>(`/practitioners/${id}/conflicts`);
  const list = (a: string[]) => a?.length ? a.join(', ') : <span className="muted">None</span>;
  return <Async state={st}>{(p) => <div className="stack">
    <Person name={p.name} src={p.photoUrl} sub={p.email} size={56} />
    <p><Badge tone={tone(p.vettingStatus)}>{p.vettingStatus}</Badge> {p.submittedAt && <span className="small muted">Submitted {dateFmt(p.submittedAt)}</span>} {p.vettingNote && <span className="small"> · {p.vettingNote}</span>}</p>
    <dl className="kv">
      <dt>Headline</dt><dd>{p.headline ?? <span className="muted">Missing</span>}</dd>
      <dt>Biography</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.bio ?? <span className="muted">Missing</span>}</dd>
      <dt>Specialisations</dt><dd>{list(p.specialisations)}</dd><dt>Strong areas</dt><dd>{list(p.strengths)}</dd>
      <dt>Platforms</dt><dd>{list(p.platforms)}</dd><dt>Sectors</dt><dd>{list(p.sectors)}</dd><dt>Regions</dt><dd>{list(p.regions)}</dd><dt>Languages</dt><dd>{list(p.languages)}</dd>
      <dt>Experience</dt><dd>{p.yearsExperience ?? '-'} years</dd>
      <dt>Qualifications</dt><dd>{p.credentials?.length ? <ul>{p.credentials.map((c: any, i: number) => <li key={i}>{c.title}{c.issuer ? `, ${c.issuer}` : ''}{c.year ? ` (${c.year})` : ''}</li>)}</ul> : <span className="muted">None listed</span>}</dd>
      <dt>Code of conduct</dt><dd>{p.conductAcceptedAt ? `Accepted ${dateFmt(p.conductAcceptedAt)}` : <span className="muted">Not accepted</span>}</dd>
      <dt>Profile complete</dt><dd>{p.completeness?.percent}%{p.completeness?.missing?.length ? ` (missing: ${p.completeness.missing.join('; ')})` : ''}</dd>
    </dl>
    <Async state={conf}>{(c) => c.items.length ? <div><strong>Declared conflicts</strong><ul>{c.items.map((x: any) => <li key={x.id}>{x.org}: {x.reason}</li>)}</ul></div> : <p className="small muted">No conflicts declared.</p>}</Async>
    <Caseload id={id} name={p.name} />
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{(NEXT[p.vettingStatus] ?? []).map((o) => <Button key={o.to} variant={o.danger ? 'danger' : o.to === 'Approved' ? 'primary' : undefined} onClick={() => onDecide(p, { to: o.to, label: o.label, note: !!o.note })}>{o.label}</Button>)}
      {p.vettingStatus === 'Draft' && <span className="small muted">The person has not submitted yet.</span>}</div>
  </div>}</Async>;
}

function Decide({ d, onClose, onDone }: { d: { p: any; to: string; label: string; note: boolean }; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const [note, setNote] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async () => {
    if (d.note && note.trim().length < 5) { setErr('Give the person a short reason'); return; }
    setBusy(true); try { await api.post(`/practitioners/${d.p.userId}/decision`, { decision: d.to, note: note.trim() || null }); toast(`${d.p.name}: ${d.to.toLowerCase()}`); onDone(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} title={`${d.label}: ${d.p.name}`}>
    <div className="stack"><FormError message={err} />
      <Field label={d.note ? 'Reason (the person will see this)' : 'Note (optional)'} name="dnote">{(q) => <textarea {...q} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <div className="form-actions row" style={{ gap: 8 }}><Button variant={d.to === 'Approved' ? 'primary' : 'danger'} loading={busy} onClick={go}>{d.label}</Button><Button onClick={onClose}>Cancel</Button></div></div>
  </Modal>;
}

function Caseload({ id, name }: { id: string; name: string }) {
  const st = useApi<any>(`/practitioners/${id}/caseload`); const list = useApi<any>('/practitioners?status=Approved');
  const toast = useToast(); const [to, setTo] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [res, setRes] = useState<any>(null);
  const go = async () => {
    if (!to) { setErr('Choose who takes the cases'); return; } if (reason.trim().length < 5) { setErr('Say why the cases are moving'); return; }
    setBusy(true); setErr(null);
    try { const r = await api.post(`/practitioners/${id}/transfer-caseload`, { toUserId: to, reason: reason.trim() }); setRes(r); toast(`${r.moved.length} case${r.moved.length === 1 ? '' : 's'} moved`); st.reload(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <Async state={st}>{(d) => <div className="stack">
    <strong>Active cases ({d.items.length})</strong>
    {d.items.length === 0 ? <p className="small muted">{name} has no active cases.</p> : <>
      <ul className="small">{d.items.map((c: any) => <li key={c.id}>{c.code}, {c.org}: {c.fn}</li>)}</ul>
      <FormError message={err} />
      <div className="form-grid" style={{ alignItems: 'end' }}>
        <Field label="Move all of these cases to" name="tt">{(q) => <select {...q} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose</option>{(list.data?.items ?? []).filter((x: any) => x.userId !== id).map((x: any) => <option key={x.userId} value={x.userId}>{x.name} ({x.load} of {x.maxActive})</option>)}</select>}</Field>
        <Field label="Reason" name="tr">{(q) => <input {...q} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}</Field>
        <Button loading={busy} onClick={go}>Move cases</Button>
      </div></>}
    {res && res.skipped.length > 0 && <div className="alert warn" role="status"><strong>{res.skipped.length} could not move:</strong><ul>{res.skipped.map((s: any) => <li key={s.code}>{s.code}: {s.why}</li>)}</ul></div>}
  </div>}</Async>;
}
