'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, DataTable, Modal, PageHead, type Col } from '@/components/ui';
import { ghs, dateFmt } from '@/lib/client/api';
import { ProgrammeForm, type Programme } from '@/components/portfolio/ProgrammeForms';
import { usePerms, useTitle } from '@/components/portfolio/shared';

export default function ProgrammesPage() {
  useTitle('Programmes');
  const router = useRouter();
  const { can, ready, role } = usePerms();
  const [status, setStatus] = useState(''); const [open, setOpen] = useState(false);
  const funder = role === 'FUNDER';
  const cols: Col<Programme>[] = [
    { key: 'name', label: 'Programme', sort: 'name', render: (r) => <>{r.name}</> },
    { key: 'code', label: 'Code', sort: 'code', render: (r) => <span className="mono">{r.code}</span> },
    { key: 'funder', label: 'Funder' },
    { key: 'startDate', label: 'Dates', sort: 'start', render: (r) => <>{dateFmt(r.startDate)} to {dateFmt(r.endDate)}</> },
    { key: 'budgetGhs', label: 'Budget', align: 'r', render: (r) => <span className="num">{ghs(r.budgetGhs)}</span> },
    { key: 'cohortCount', label: 'Cohorts', align: 'r', render: (r) => <span className="num">{r.cohortCount}</span> },
    ...(funder ? [] : [{ key: 'caseCount', label: 'Cases', align: 'r' as const, render: (r: Programme) => <span className="num">{r.caseCount}</span> }]),
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge>{r.status}</Badge> }
  ];
  const canCreate = can('programmes', 'create');
  return <div className="stack">
    <PageHead title="Programmes" sub="Funded programmes, their cohorts and results." actions={canCreate ? <Button variant="primary" onClick={() => setOpen(true)}>New programme</Button> : undefined} />
    <DataTable<Programme> endpoint="/programmes" columns={cols} rowHref={(r) => `/programmes/${r.id}`} params={{ status }} exportable={ready && can('programmes', 'export')} placeholder="Search name, code or funder"
      toolbar={<div><label className="sr" htmlFor="f-pstatus">Status</label><select id="f-pstatus" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['Draft', 'Active', 'Completed', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}</select></div>}
      empty={{ title: 'No programmes yet', hint: canCreate ? 'Create the first programme to group cohorts and cases.' : 'Programmes you have been given access to will appear here.', action: canCreate ? <Button variant="primary" size="sm" onClick={() => setOpen(true)}>New programme</Button> : undefined }} />
    <Modal open={open} onClose={() => setOpen(false)} title="New programme"><ProgrammeForm onCancel={() => setOpen(false)} onDone={(r) => { setOpen(false); router.push(`/programmes/${r.id}`); }} /></Modal>
  </div>;
}
