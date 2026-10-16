'use client';
import { useState } from 'react';
import { api, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, useApi, useToast } from '@/components/ui';
import { LogTable } from './common';

const KINDS = ['contact', 'demo', 'newsletter', 'assessment'] as const;

export type InquiryRow = { id: string; kind: string; name: string | null; email: string; organisation: string | null; phone: string | null; interest: string | null; message: string | null; status: string; createdAt: string; platform?: string | null; overallScore?: number | null; classification?: string | null };
const tone = (s: string) => (s === 'New' ? 'info' : s === 'Spam' ? 'bad' : 'ok');

function Detail({ r, onChanged }: { r: InquiryRow; onChanged: () => void }) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const set = async (status: string) => {
    setBusy(true);
    try { await api.patch(`/inquiries/${r.id}`, { status }); toast?.('Enquiry updated'); onChanged(); } catch (e) { toast?.(errText(e), 'bad'); } finally { setBusy(false); }
  };
  return <div className="stack" style={{ padding: '6px 0' }}>
    <dl className="kv">
      <div style={{ display: 'contents' }}><dt>Email</dt><dd><a href={`mailto:${r.email}`}>{r.email}</a></dd></div>
      <div style={{ display: 'contents' }}><dt>Phone</dt><dd>{r.phone ?? '-'}</dd></div>
      <div style={{ display: 'contents' }}><dt>Organisation</dt><dd>{r.organisation ?? '-'}</dd></div>
      <div style={{ display: 'contents' }}><dt>Interest</dt><dd>{r.interest ?? '-'}</dd></div>
      {r.kind === 'assessment' && <>
        <div style={{ display: 'contents' }}><dt>Platform</dt><dd>{r.platform ?? '-'}</dd></div>
        <div style={{ display: 'contents' }}><dt>Preliminary score</dt><dd>{r.overallScore != null ? `${r.overallScore}/100 (${r.classification ?? '-'})` : '-'}</dd></div>
      </>}
      <div style={{ display: 'contents' }}><dt>Message</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.message ?? '-'}</dd></div>
    </dl>
    <div className="row">
      {r.status !== 'Handled' && <Button size="sm" variant="primary" loading={busy} onClick={() => set('Handled')}>Mark handled</Button>}
      {r.status !== 'Spam' && <Button size="sm" loading={busy} onClick={() => set('Spam')}>Mark as spam</Button>}
      {r.status !== 'New' && <Button size="sm" loading={busy} onClick={() => set('New')}>Reopen</Button>}
    </div>
  </div>;
}

export function InquiryTable({ exportable, canManageOwners }: { exportable?: boolean; canManageOwners?: boolean }) {
  const [status, setStatus] = useState(''); const [kind, setKind] = useState(''); const [tick, setTick] = useState(0);
  const cols = [
    { key: 'at', label: 'Received', sort: 'createdAt', render: (r: InquiryRow) => <span className="num">{dateTime(r.createdAt)}</span> },
    { key: 'kind', label: 'Type', render: (r: InquiryRow) => <span className="badge">{r.kind === 'assessment' ? (r.platform ?? 'assessment') : r.kind}</span> },
    { key: 'who', label: 'From', sort: 'name', render: (r: InquiryRow) => <span>{r.name ?? r.email}{r.organisation ? <span className="muted small"> · {r.organisation}</span> : null}{r.kind === 'assessment' && r.overallScore != null ? <span className="muted small"> · {r.overallScore}/100</span> : null}</span> },
    { key: 'status', label: 'Status', sort: 'status', render: (r: InquiryRow) => <Badge tone={tone(r.status)}>{r.status}</Badge> }
  ];
  return <div className="stack">
    {canManageOwners && <FreeAssessmentOwners />}
    <div className="row" style={{ gap: 12 }}>
      <div className="field" style={{ maxWidth: 220 }}><label htmlFor="inq-status">Status</label>
        <select id="inq-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option>New</option><option>Handled</option><option>Spam</option></select></div>
      <div className="field" style={{ maxWidth: 220 }}><label htmlFor="inq-kind">Type</label>
        <select id="inq-kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All</option>{KINDS.map((k) => <option key={k} value={k}>{k === 'assessment' ? 'Free assessment' : k[0].toUpperCase() + k.slice(1)}</option>)}</select></div>
    </div>
    <LogTable<InquiryRow> key={tick} endpoint="/inquiries" columns={cols} params={{ status, kind }} detail={(r) => <Detail r={r} onChanged={() => setTick((t) => t + 1)} />} exportable={exportable} placeholder="Search name, email, organisation or message" emptyTitle="No enquiries yet" defaultSort={{ key: 'createdAt', dir: 'desc' }} />
  </div>;
}

/** #129: lets an administrator decide who owns triaging newly completed free-assessment leads. */
function FreeAssessmentOwners() {
  const st = useApi<{ userId: string; name: string; email: string }[]>('/admin/free-assessment-owners');
  const usersSt = useApi<{ items: { id: string; name: string; email: string }[] }>('/users?limit=200');
  const toast = useToast(); const [busy, setBusy] = useState(false); const [pick, setPick] = useState('');
  const save = async (userIds: string[]) => {
    setBusy(true);
    try { await api.put('/admin/free-assessment-owners', { userIds }); toast?.('Owners updated'); st.reload(); } catch (e) { toast?.(errText(e), 'bad'); } finally { setBusy(false); }
  };
  return <Card title="Free assessment lead owners" actions={<span className="muted small">Who triages new free SME360 assessment leads</span>}>
    <Async state={st}>{(owners) => <div className="stack">
      {owners.length === 0 ? <p className="muted small">No owner set yet. New assessment leads aren't routed to anyone until you add one.</p> :
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{owners.map((o) => <li key={o.userId}>{o.name} ({o.email}) <Button size="sm" loading={busy} onClick={() => save(owners.filter((x) => x.userId !== o.userId).map((x) => x.userId))}>Remove</Button></li>)}</ul>}
      <Async state={usersSt}>{(u) => {
        const available = u.items.filter((x) => !owners.some((o) => o.userId === x.id));
        return available.length === 0 ? null : <div className="row" style={{ gap: 8 }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 280 }}>
            <option value="">Add an owner…</option>
            {available.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.email})</option>)}
          </select>
          <Button size="sm" variant="primary" disabled={!pick} loading={busy} onClick={() => { save([...owners.map((o) => o.userId), pick]); setPick(''); }}>Add</Button>
        </div>;
      }}</Async>
    </div>}</Async>
  </Card>;
}
