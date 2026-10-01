'use client';
import { useState } from 'react';
import { api, dateTime } from '@/lib/client/api';
import { Badge, Button, DataTable, PageHead, useToast, type Col } from '@/components/ui';
import { Guard, roleLabel } from '@/components/admin/common';

type Row = { id: string; name: string; email: string; role: string; signupOrgName: string | null; signupNote: string | null; createdAt: string };

export default function RegistrationsPage() {
  const [tick, setTick] = useState(0); const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const act = async (r: Row, kind: 'approve' | 'reject') => {
    setBusy(r.id);
    try { await api.post(`/users/${r.id}/${kind}`, {}); toast(kind === 'approve' ? `${r.name} approved` : `${r.name} rejected`); setTick((t) => t + 1); }
    catch (e: any) { toast(e.message, 'bad'); }
    finally { setBusy(null); }
  };
  const cols: Col<Row>[] = [
    { key: 'name', label: 'Name', render: (r) => <div>{r.name}<div className="small muted">{r.email}</div></div> },
    { key: 'role', label: 'Requested role', render: (r) => <Badge>{roleLabel(r.role)}</Badge> },
    { key: 'org', label: 'Organisation', render: (r) => <div>{r.signupOrgName ?? '-'}{r.signupNote && <div className="small muted">{r.signupNote}</div>}</div> },
    { key: 'createdAt', label: 'Registered', render: (r) => <span className="num">{dateTime(r.createdAt)}</span> },
    { key: 'act', label: 'Decision', render: (r) => <span className="row" style={{ gap: 6 }}><Button size="sm" variant="primary" loading={busy === r.id} onClick={() => act(r, 'approve')} aria-label={`Approve ${r.name}`}>Approve</Button><Button size="sm" disabled={busy === r.id} onClick={() => act(r, 'reject')} aria-label={`Reject ${r.name}`}>Reject</Button></span> }
  ];
  return <Guard resource="users" action="edit" title="Pending approvals">{() => <>
    <PageHead title="Pending approvals" sub="People who registered themselves and confirmed their email. Approving a consultant, coach, programme manager or partner gives the role only. Link them to work separately. Business owners are approved when they confirm their email and only see their own organisation." />
    <div className="card"><DataTable<Row> endpoint="/users" params={{ approval: 'pending' }} columns={cols} refreshKey={tick} placeholder="Search name or email" empty={{ title: 'Nothing waiting', hint: 'New registrations that need a decision appear here.' }} /></div>
  </>}</Guard>;
}
