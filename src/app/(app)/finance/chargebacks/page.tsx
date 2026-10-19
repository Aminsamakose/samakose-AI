'use client';
import { useState } from 'react';
import { api, ghs, dateTime, titleCase } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Modal, PageHead, useApi, useToast } from '@/components/ui';
import { useMe, useTitle, StatusFilter } from '@/components/finance/common';
import { ChargebackForm } from '@/components/finance/ChargebackForm';

type Chargeback = { id: string; paymentId: string; amountGhs: string; provider: string; providerReference: string | null; status: 'Received' | 'Recovered' | 'Lost'; receivedAt: string; resolvedAt: string | null };

const STATUS_TONE: Record<string, string> = { Received: undefined as any, Recovered: 'ok', Lost: 'bad' };

function ResolveChargeback({ c, onDone }: { c: Chargeback; onDone: () => void }) {
  const toast = useToast();
  return <span className="row" style={{ gap: 6 }}>
    <ConfirmButton label="Mark Won" size="sm" message="Mark this chargeback Won — the funds were recovered from the provider? This posts a reversing ledger entry putting the revenue and cash back."
      onConfirm={async () => { await api.post(`/chargebacks/${c.id}/resolve`, { outcome: 'Won' }); toast('Chargeback resolved as Won'); onDone(); }} />
    <ConfirmButton label="Mark Lost" variant="danger" size="sm" message="Mark this chargeback Lost? Samakose absorbs the amount; no further ledger entry is posted."
      onConfirm={async () => { await api.post(`/chargebacks/${c.id}/resolve`, { outcome: 'Lost' }); toast('Chargeback resolved as Lost'); onDone(); }} />
  </span>;
}

export default function ChargebacksPage() {
  useTitle('Chargebacks');
  const me = useMe();
  const [status, setStatus] = useState('');
  const chargebacks = useApi<Chargeback[]>('/chargebacks' + (status ? `?status=${status}` : ''));
  const [creating, setCreating] = useState(false);
  const canCreate = me.can('refunds', 'create'), canResolve = me.can('refunds', 'approve');
  const rows = (chargebacks.data ?? []);

  return <>
    <PageHead title="Chargebacks" sub="Disputed payments the provider has already pulled back. Recording one posts the ledger entry immediately; resolving it as Won or Lost closes the dispute out." actions={canCreate ? <Button variant="primary" onClick={() => setCreating(true)}>Record chargeback</Button> : undefined} />
    <Card>
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <StatusFilter label="Status" value={status} onChange={setStatus} options={['Received', 'Recovered', 'Lost']} />
      </div>
      <Async state={chargebacks}>{() => rows.length === 0 ? <Empty title="No chargebacks on record" hint={canCreate ? 'Record one when a provider notifies Samakose of a dispute.' : undefined} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th className="r">Amount</th><th>Provider</th><th>Reference</th><th>Status</th><th className="r">Received</th>{canResolve && <th>Actions</th>}</tr></thead>
          <tbody>{rows.map((c) => <tr key={c.id}>
            <td className="r num">{ghs(c.amountGhs)}</td>
            <td>{c.provider === 'manual' ? 'Manual' : titleCase(c.provider)}</td>
            <td className="small mono">{c.providerReference ?? '—'}</td>
            <td><Badge tone={STATUS_TONE[c.status] as any}>{c.status}</Badge></td>
            <td className="r small muted">{dateTime(c.receivedAt)}</td>
            {canResolve && <td>{c.status === 'Received' && <ResolveChargeback c={c} onDone={chargebacks.reload} />}</td>}
          </tr>)}</tbody>
        </table></div>
      )}</Async>
    </Card>
    <Modal open={creating} onClose={() => setCreating(false)} title="Record a chargeback">
      <ChargebackForm onCancel={() => setCreating(false)} onDone={() => { setCreating(false); chargebacks.reload(); }} />
    </Modal>
  </>;
}
