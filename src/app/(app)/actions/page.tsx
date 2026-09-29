'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { dateFmt, titleCase } from '@/lib/client/api';
import { Badge, DataTable, Loading, PageHead, type Col } from '@/components/ui';
import { ActionStatus, canDo, useMe, useTitle } from '@/components/dash/common';

type Row = { id: string; code: string; caseId: string; caseCode: string; org: string; text: string; ownerRole: string; assignee: string | null; dueDate: string; status: string; evidenceNote: string | null; overdue: boolean };

function Inner() {
  useTitle('Actions');
  const sp = useSearchParams();
  const me = useMe();
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [mine, setMine] = useState(sp.get('mine') === 'true');
  const [overdue, setOverdue] = useState(sp.get('overdue') === 'true');
  const [tick, setTick] = useState(0);
  const role = me.data?.user.role;
  const canEdit = canDo(me.data ?? null, 'actions', 'edit');
  const cols: Col<Row>[] = [
    { key: 'code', label: 'Action', sort: 'code', render: (r) => <span className="mono">{r.code}</span> },
    { key: 'text', label: 'What to do', render: (r) => <span>{r.text}{r.evidenceNote && <span className="small muted" style={{ display: 'block' }}>Note: {r.evidenceNote}</span>}</span> },
    { key: 'case', label: 'Case', render: (r) => <Link href={`/cases/${r.caseId}?tab=actions`}>{r.caseCode}</Link> },
    { key: 'org', label: 'Organisation', sort: 'org', render: (r) => r.org },
    { key: 'owner', label: 'Owner', render: (r) => <span>{titleCase(r.ownerRole.toLowerCase())}{r.assignee && <span className="small muted" style={{ display: 'block' }}>{r.assignee}</span>}</span> },
    { key: 'due', label: 'Due', sort: 'due', render: (r) => <span>{dateFmt(r.dueDate)}{r.overdue && <> <Badge tone="warn">Overdue</Badge></>}</span> },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => canEdit && (role !== 'OWNER' || r.ownerRole === 'OWNER') ? <ActionStatus action={r} compact onChanged={() => setTick((t) => t + 1)} /> : <Badge>{r.status}</Badge> }
  ];
  return <>
    <PageHead title="Actions" sub="Every action across the cases you can see. Change a status here or open the case." />
    <DataTable<Row> endpoint="/actions" columns={cols} params={{ status: status || undefined, mine: mine ? 'true' : undefined, overdue: overdue ? 'true' : undefined }}
      exportable={canDo(me.data ?? null, 'actions', 'export')} placeholder="Search actions, cases, organisations" defaultSort={{ key: 'due', dir: 'asc' }} refreshKey={tick}
      empty={{ title: 'No actions match', hint: 'Actions are created from a case prescription.' }}
      toolbar={<>
        <div className="field" style={{ minWidth: 150 }}><label className="sr" htmlFor="af-status">Status</label>
          <select id="af-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option>Open</option><option>In progress</option><option>Done</option></select></div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only</label>
      </>} />
  </>;
}
export default function ActionsPage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
