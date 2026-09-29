'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { dateFmt, ghs } from '@/lib/client/api';
import { Badge, Button, Card, DataTable, Modal, PageHead, type Col } from '@/components/ui';
import { StatusFilter, useMe, useTitle } from '@/components/finance/common';
import { InvoiceCreate } from '@/components/finance/InvoiceForms';

type Inv = { id: string; code: string; org: string; amountGhs: string; status: string; dueDate: string; issuedAt: string | null; paidAt: string | null; daysOverdue: number };
const STATUSES = ['Draft', 'Sent', 'Overdue', 'Paid', 'Void'];

export default function InvoicesPage() {
  useTitle('Invoices');
  const me = useMe(); const router = useRouter();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const canCreate = me.can('invoices', 'create');
  const owner = me.role === 'OWNER';
  const late = (r: Inv) => r.daysOverdue > 0 && (r.status === 'Sent' || r.status === 'Overdue');

  const cols: Col<Inv>[] = [
    { key: 'code', label: 'Invoice', sort: 'code', render: (r) => <span className="mono">{r.code}</span> },
    ...(owner ? [] : [{ key: 'org', label: 'Organisation', sort: 'org' } as Col<Inv>]),
    { key: 'amountGhs', label: 'Amount', sort: 'amount', align: 'r', render: (r) => <span className="num">{ghs(r.amountGhs)}</span> },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <span className="row" style={{ gap: 6 }}><Badge>{r.status}</Badge>{late(r) && r.status !== 'Overdue' && <Badge tone="warn">Past due</Badge>}</span> },
    { key: 'dueDate', label: 'Due', sort: 'due', render: (r) => <span>{dateFmt(r.dueDate)}{late(r) && <span className="small" style={{ color: 'var(--bad)', fontWeight: 600 }}> ({r.daysOverdue} day{r.daysOverdue === 1 ? '' : 's'} overdue)</span>}</span> },
    { key: 'paidAt', label: 'Paid', render: (r) => dateFmt(r.paidAt) }
  ];
  return <>
    <PageHead title="Invoices" sub={owner ? 'Invoices issued to your organisation.' : 'Draft, send and collect payment for invoices. Overdue invoices show how many days late they are.'} actions={canCreate ? <Button variant="primary" onClick={() => setCreating(true)}>New invoice</Button> : undefined} />
    <Card>
      <DataTable<Inv> endpoint="/invoices" columns={cols} params={{ status }} rowHref={(r) => `/finance/invoices/${r.id}`} exportable={me.can('invoices', 'export')}
        placeholder={owner ? 'Search by invoice number' : 'Search by invoice or organisation'} defaultSort={{ key: 'due', dir: 'desc' }}
        toolbar={<StatusFilter label="Status" value={status} onChange={setStatus} options={owner ? STATUSES.filter((s) => s !== 'Draft') : STATUSES} />}
        empty={{ title: 'No invoices yet', hint: canCreate ? 'Create a draft invoice, then send it to the organisation.' : undefined, action: canCreate ? <Button size="sm" variant="primary" onClick={() => setCreating(true)}>New invoice</Button> : undefined }} />
    </Card>
    <Modal open={creating} onClose={() => setCreating(false)} title="New invoice">
      {creating && <InvoiceCreate onCancel={() => setCreating(false)} onDone={(r) => { setCreating(false); router.push(`/finance/invoices/${r.id}`); }} />}
    </Modal>
  </>;
}
