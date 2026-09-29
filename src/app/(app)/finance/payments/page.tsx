'use client';
import { useState } from 'react';
import Link from 'next/link';
import { dateTime, ghs, titleCase } from '@/lib/client/api';
import { Badge, Card, DataTable, PageHead, type Col } from '@/components/ui';
import { StatusFilter, useMe, useTitle } from '@/components/finance/common';

type Pay = { id: string; code: string; invoice: string; invoiceId: string; org: string; provider: string; reference: string; amountGhs: string; status: string; createdAt: string };

export default function PaymentsPage() {
  useTitle('Payments');
  const me = useMe();
  const [status, setStatus] = useState('');
  const cols: Col<Pay>[] = [
    { key: 'code', label: 'Payment', sort: 'code', render: (r) => <span className="mono">{r.code}</span> },
    { key: 'invoice', label: 'Invoice', render: (r) => <Link href={`/finance/invoices/${r.invoiceId}`} className="mono">{r.invoice}</Link> },
    { key: 'org', label: 'Organisation' },
    { key: 'provider', label: 'Method', render: (r) => r.provider === 'manual' ? 'Manual' : titleCase(r.provider) },
    { key: 'reference', label: 'Reference', render: (r) => <span className="mono small">{r.reference}</span> },
    { key: 'amountGhs', label: 'Amount', sort: 'amount', align: 'r', render: (r) => <span className="num">{ghs(r.amountGhs)}</span> },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge>{r.status}</Badge> },
    { key: 'createdAt', label: 'Date', sort: 'created', render: (r) => dateTime(r.createdAt) }
  ];
  return <>
    <PageHead title="Payments" sub="Every payment attempt against an invoice, including online payments still waiting for confirmation." />
    <Card>
      <DataTable<Pay> endpoint="/payments" columns={cols} params={{ status }} exportable={me.can('payments', 'export')} placeholder="Search by payment, reference, invoice or organisation"
        toolbar={<StatusFilter label="Status" value={status} onChange={setStatus} options={['Pending', 'Succeeded', 'Failed']} />}
        empty={{ title: 'No payments yet', hint: 'Payments appear here once an invoice is paid or a payment is started.' }} />
    </Card>
  </>;
}
