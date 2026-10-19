'use client';
import { useState } from 'react';
import { api, ghs, dateTime } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Modal, PageHead, useApi, useToast } from '@/components/ui';
import { useMe, useTitle, StatusFilter } from '@/components/finance/common';
import { RefundForm } from '@/components/finance/RefundForm';

type Refund = { id: string; code: string; invoiceId: string; amountGhs: string; reason: string; status: 'Requested' | 'Approved' | 'Processed' | 'Rejected'; requestedBy: string | null; approvedBy: string | null; createdAt: string };

const STATUS_TONE: Record<string, string> = { Requested: undefined as any, Approved: 'ok', Processed: 'ok', Rejected: 'bad' };

function RefundActions({ r, onDone }: { r: Refund; onDone: () => void }) {
  const toast = useToast();
  const me = useMe();
  if (r.status === 'Requested') return <span className="row" style={{ gap: 6 }}>
    <ConfirmButton label="Approve" size="sm" message={`Approve this refund of ${ghs(r.amountGhs)}? You cannot approve a refund you requested yourself, and a large refund may require a more senior approver.`}
      onConfirm={async () => { await api.post(`/refunds/${r.id}/approve`); toast('Refund approved'); onDone(); }} />
    <ConfirmButton label="Reject" variant="danger" size="sm" message="Reject this refund request?"
      onConfirm={async () => { await api.post(`/refunds/${r.id}/reject`, {}); toast('Refund rejected'); onDone(); }} />
  </span>;
  if (r.status === 'Approved' && me.can('refunds', 'approve')) return <ConfirmButton label="Process" size="sm"
    message="Process this refund? This posts the ledger entry and, if the professional was already paid on this invoice, opens a payout clawback for approval."
    onConfirm={async () => { await api.post(`/refunds/${r.id}/process`); toast('Refund processed'); onDone(); }} />;
  return null;
}

export default function RefundsPage() {
  useTitle('Refunds');
  const me = useMe();
  const [status, setStatus] = useState('');
  const refunds = useApi<Refund[]>('/refunds' + (status ? `?status=${status}` : ''));
  const [creating, setCreating] = useState(false);
  const canCreate = me.can('refunds', 'create');
  const rows = (refunds.data ?? []);

  return <>
    <PageHead title="Refunds" sub="Refunds on succeeded payments. Every refund needs a second person's approval before it is processed, and processing posts the ledger entry and may open a payout clawback if the professional was already paid." actions={canCreate ? <Button variant="primary" onClick={() => setCreating(true)}>Request refund</Button> : undefined} />
    <Card>
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <StatusFilter label="Status" value={status} onChange={setStatus} options={['Requested', 'Approved', 'Processed', 'Rejected']} />
      </div>
      <Async state={refunds}>{() => rows.length === 0 ? <Empty title="No refunds yet" hint={canCreate ? 'Request a refund against a succeeded payment.' : undefined} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Refund</th><th className="r">Amount</th><th>Reason</th><th>Status</th><th className="r">Requested</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}>
            <td className="mono">{r.code}</td>
            <td className="r num">{ghs(r.amountGhs)}</td>
            <td className="small">{r.reason}</td>
            <td><Badge tone={STATUS_TONE[r.status] as any}>{r.status}</Badge></td>
            <td className="r small muted">{dateTime(r.createdAt)}</td>
            <td><RefundActions r={r} onDone={refunds.reload} /></td>
          </tr>)}</tbody>
        </table></div>
      )}</Async>
    </Card>
    <Modal open={creating} onClose={() => setCreating(false)} title="Request a refund">
      <RefundForm onCancel={() => setCreating(false)} onDone={() => { setCreating(false); refunds.reload(); }} />
    </Modal>
  </>;
}
