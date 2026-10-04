'use client';
import { useEffect, useState } from 'react';
import { DataTable, LinkButton, PageHead, useApi, type Col } from '@/components/ui';
import { dateFmt } from '@/lib/client/api';
import { CASE_STATE_ORDER, MaturityBadge, StateBadge, useMe, one } from '@/components/case/core/shared';

type Row = { id: string; code: string; orgName: string; region: string | null; status: string; programmeName: string | null; consultantName: string | null; score: number | null; maturity: string | null; updatedAt: string };

export default function CasesPage() {
  useEffect(() => { document.title = 'Cases | Samakose'; }, []);
  const { me, can, ready } = useMe();
  const [status, setStatus] = useState('');
  const [programmeId, setProgrammeId] = useState('');
  const [consultantId, setConsultantId] = useState('');
  const [mine, setMine] = useState(false);
  const canProgrammes = ready && can('programmes', 'read');
  const canUsers = ready && can('users', 'read');
  const progs = useApi<{ items: { id: string; name: string }[] }>(canProgrammes ? '/programmes?pageSize=100&sort=name&dir=asc' : null);
  const people = useApi<{ id: string; name: string; role: string }[]>(canUsers ? '/users/assignable' : null);
  const consultants = (people.data ?? []).filter((p) => p.role === 'EXPERT');
  const isOwner = me?.role === 'OWNER';

  const columns: Col<Row>[] = [
    { key: 'code', label: 'Case', sort: 'code', render: (r) => <span className="mono">{r.code}</span> },
    { key: 'orgName', label: 'Organisation', sort: 'org', render: (r) => r.orgName },
    { key: 'region', label: 'Region', sort: 'region', render: (r) => r.region ?? '-' },
    { key: 'status', label: 'State', sort: 'status', render: (r) => <StateBadge state={r.status} /> },
    { key: 'programmeName', label: 'Programme', render: (r) => r.programmeName ?? '-' },
    { key: 'consultantName', label: 'Consultant', render: (r) => r.consultantName ?? 'Unassigned' },
    { key: 'score', label: 'Score', sort: 'score', align: 'r', render: (r) => r.score === null ? '-' : <span className="row" style={{ justifyContent: 'flex-end' }}><span className="num">{one(r.score)}</span><MaturityBadge value={r.maturity} /></span> },
    { key: 'updatedAt', label: 'Updated', sort: 'updated', render: (r) => dateFmt(r.updatedAt) }
  ];

  const toolbar = <>
    <div className="field"><label htmlFor="f-status" className="sr">Filter by state</label>
      <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All states</option>{CASE_STATE_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
    {canProgrammes && <div className="field"><label htmlFor="f-prog" className="sr">Filter by programme</label>
      <select id="f-prog" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}><option value="">All programmes</option>{(progs.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
    {canUsers && consultants.length > 0 && <div className="field"><label htmlFor="f-cons" className="sr">Filter by consultant</label>
      <select id="f-cons" value={consultantId} disabled={mine} onChange={(e) => setConsultantId(e.target.value)}><option value="">All consultants</option>{consultants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
    {!isOwner && me && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only cases where I am the consultant</label>}
  </>;

  return <div className="stack">
    <PageHead title="Cases" sub="Every business in your scope, from first contact to graduation." actions={ready && can('cases', 'create') ? <LinkButton href="/cases/new" variant="primary">New case</LinkButton> : undefined} />
    <DataTable<Row>
      endpoint="/cases" columns={columns} rowHref={(r) => `/cases/${r.id}`} exportable={ready && can('cases', 'export')}
      params={{ status, programmeId, consultantId: mine ? me?.id : consultantId }} placeholder="Search by case code or organisation"
      empty={{ title: 'No cases yet', hint: 'Cases appear here once an organisation is registered and a case is opened.', action: ready && can('cases', 'create') ? <LinkButton href="/cases/new" variant="primary">Open the first case</LinkButton> : undefined }}
      toolbar={toolbar} defaultSort={{ key: 'updated', dir: 'desc' }} />
  </div>;
}
