'use client';
import { useState } from 'react';
import { dateFmt, ghs } from '@/lib/client/api';
import { Badge, Button, Card, DataTable, Modal, PageHead, type Col } from '@/components/ui';
import { StatusFilter, daysUntil, useMe, useTitle } from '@/components/finance/common';
import { ContractCreate, ContractManage, type Contract } from '@/components/finance/ContractForms';

const STATUSES = ['Draft', 'Active', 'Expired', 'Cancelled'];

export default function ContractsPage() {
  useTitle('Contracts');
  const me = useMe();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<Contract | null>(null);
  const [tick, setTick] = useState(0);
  const canCreate = me.can('contracts', 'create'), canEdit = me.can('contracts', 'edit');

  const cols: Col<Contract>[] = [
    { key: 'code', label: 'Contract', sort: 'code', render: (r) => <span className="mono">{r.code}</span> },
    { key: 'org', label: 'Organisation', sort: 'org' },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <span className="row" style={{ gap: 6 }}><Badge>{r.status}</Badge>{r.status === 'Active' && (daysUntil(r.endDate) ?? 999) <= 30 && <Badge tone="warn">{(daysUntil(r.endDate) ?? 0) < 0 ? 'Past end date' : `Expiring in ${daysUntil(r.endDate)} day${daysUntil(r.endDate) === 1 ? '' : 's'}`}</Badge>}</span> },
    { key: 'startDate', label: 'Start', render: (r) => dateFmt(r.startDate) },
    { key: 'endDate', label: 'End', sort: 'end', render: (r) => dateFmt(r.endDate) },
    { key: 'amountGhs', label: 'Amount', sort: 'amount', align: 'r', render: (r) => <span className="num">{ghs(r.amountGhs)}</span> },
    { key: 'actions', label: 'Actions', render: (r) => <Button size="sm" onClick={() => setManaging(r)} aria-label={`${canEdit ? 'Manage' : 'View'} contract ${r.code}`}>{canEdit ? 'Manage' : 'View'}</Button> }
  ];
  return <>
    <PageHead title="Contracts" sub="Agreements between Samakose and organisations. Active contracts ending within 30 days are flagged." actions={canCreate ? <Button variant="primary" onClick={() => setCreating(true)}>New contract</Button> : undefined} />
    <Card>
      <DataTable<Contract> endpoint="/contracts" columns={cols} params={{ status }} exportable={me.can('contracts', 'export')} placeholder="Search by contract or organisation"
        defaultSort={{ key: 'end', dir: 'asc' }} refreshKey={tick} toolbar={<StatusFilter label="Status" value={status} onChange={setStatus} options={STATUSES} />}
        empty={{ title: 'No contracts yet', hint: canCreate ? 'Create a contract to start billing an organisation.' : undefined, action: canCreate ? <Button size="sm" variant="primary" onClick={() => setCreating(true)}>New contract</Button> : undefined }} />
    </Card>
    <Modal open={creating} onClose={() => setCreating(false)} title="New contract">
      {creating && <ContractCreate onCancel={() => setCreating(false)} onDone={() => { setCreating(false); setTick((t) => t + 1); }} />}
    </Modal>
    <Modal open={!!managing} onClose={() => setManaging(null)} title={managing ? `Contract ${managing.code}` : 'Contract'}>
      {managing && <ContractManage c={managing} canEdit={canEdit} onCancel={() => setManaging(null)} onDone={() => { setManaging(null); setTick((t) => t + 1); }} />}
    </Modal>
  </>;
}
