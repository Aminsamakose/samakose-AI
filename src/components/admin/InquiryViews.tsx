'use client';
import { useState } from 'react';
import { api, dateTime, errText } from '@/lib/client/api';
import { Badge, Button, useToast } from '@/components/ui';
import { LogTable } from './common';

export type InquiryRow = { id: string; kind: string; name: string | null; email: string; organisation: string | null; phone: string | null; interest: string | null; message: string | null; status: string; createdAt: string };
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
      <div style={{ display: 'contents' }}><dt>Message</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.message ?? '-'}</dd></div>
    </dl>
    <div className="row">
      {r.status !== 'Handled' && <Button size="sm" variant="primary" loading={busy} onClick={() => set('Handled')}>Mark handled</Button>}
      {r.status !== 'Spam' && <Button size="sm" loading={busy} onClick={() => set('Spam')}>Mark as spam</Button>}
      {r.status !== 'New' && <Button size="sm" loading={busy} onClick={() => set('New')}>Reopen</Button>}
    </div>
  </div>;
}

export function InquiryTable({ exportable }: { exportable?: boolean }) {
  const [status, setStatus] = useState(''); const [tick, setTick] = useState(0);
  const cols = [
    { key: 'at', label: 'Received', sort: 'createdAt', render: (r: InquiryRow) => <span className="num">{dateTime(r.createdAt)}</span> },
    { key: 'kind', label: 'Type', render: (r: InquiryRow) => <span className="badge">{r.kind}</span> },
    { key: 'who', label: 'From', sort: 'name', render: (r: InquiryRow) => <span>{r.name ?? r.email}{r.organisation ? <span className="muted small"> · {r.organisation}</span> : null}</span> },
    { key: 'status', label: 'Status', sort: 'status', render: (r: InquiryRow) => <Badge tone={tone(r.status)}>{r.status}</Badge> }
  ];
  return <div className="stack">
    <div className="field" style={{ maxWidth: 220 }}><label htmlFor="inq-status">Status</label>
      <select id="inq-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option>New</option><option>Handled</option><option>Spam</option></select></div>
    <LogTable<InquiryRow> key={tick} endpoint="/inquiries" columns={cols} params={{ status }} detail={(r) => <Detail r={r} onChanged={() => setTick((t) => t + 1)} />} exportable={exportable} placeholder="Search name, email, organisation or message" emptyTitle="No enquiries yet" defaultSort={{ key: 'createdAt', dir: 'desc' }} />
  </div>;
}
