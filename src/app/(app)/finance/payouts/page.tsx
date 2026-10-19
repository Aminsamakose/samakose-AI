'use client';
import { useState } from 'react';
import { api, ghs, dateTime } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, Modal, PageHead, useApi, useForm, FormError, useToast } from '@/components/ui';
import { useMe, useTitle, StatusFilter } from '@/components/finance/common';

type Payout = {
  id: string; code: string; professionalId: string; amountGhs: string; currency: string;
  status: 'Earned' | 'Reviewed' | 'Approved' | 'Payable' | 'Payment initiated' | 'Paid' | 'Reconciled';
  payoutMethod: string | null; paymentReference: string | null; createdAt: string;
};
type Hold = { id: string; reason: string; createdAt: string; resolvedAt: string | null; resolutionNote: string | null };

const STATUS_TONE: Record<string, string> = { Earned: undefined as any, Reviewed: undefined as any, Approved: 'ok', Payable: 'ok', 'Payment initiated': 'ok', Paid: 'ok', Reconciled: 'ok' };
const STATUSES = ['Earned', 'Reviewed', 'Approved', 'Payable', 'Payment initiated', 'Paid', 'Reconciled'];

function HoldForm({ payoutId, onDone, onCancel }: { payoutId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ reason: '' }, async (v) => {
    if (v.reason.trim().length < 3) throw new Error('Enter a reason for the hold');
    return api.post(`/payouts/${payoutId}/hold`, { reason: v.reason.trim() });
  }, { success: 'Hold placed — this payout cannot be initiated until it is resolved', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Reason for the hold" name="reason" required>{(p) => <textarea {...p} value={f.values.reason} onChange={(e) => f.set('reason', e.target.value)} rows={3} maxLength={500} />}</Field>
    <div className="form-actions"><Button variant="danger" type="submit" loading={f.busy}>Place hold</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function HoldsPanel({ payout, onClose, onChanged }: { payout: Payout; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const holds = useApi<Hold[]>(`/payouts/${payout.id}/holds`);
  const [placing, setPlacing] = useState(false);
  const open = (holds.data ?? []).filter((h) => !h.resolvedAt);
  const resolved = (holds.data ?? []).filter((h) => h.resolvedAt);
  return <Modal open onClose={onClose} title={`Holds on ${payout.code}`}>
    <Async state={holds}>{() => <div className="stack">
      {open.length === 0 && resolved.length === 0 && <p className="small muted">No holds have ever been placed on this payout.</p>}
      {open.map((h) => <div key={h.id} className="card" style={{ padding: 10 }}>
        <p>{h.reason}</p>
        <p className="small muted">Placed {dateTime(h.createdAt)}</p>
        <ConfirmButton label="Resolve hold" size="sm" message="Resolve this hold? The payout can then move to Payment initiated."
          onConfirm={async () => { await api.post(`/payout-holds/${h.id}/resolve`, {}); toast('Hold resolved'); holds.reload(); onChanged(); }} />
      </div>)}
      {resolved.map((h) => <div key={h.id} className="card" style={{ padding: 10, opacity: 0.7 }}>
        <p className="small">{h.reason}</p>
        <p className="small muted">Resolved {dateTime(h.resolvedAt)}{h.resolutionNote ? ` — ${h.resolutionNote}` : ''}</p>
      </div>)}
    </div>}</Async>
    {!placing && <div className="form-actions"><Button variant="danger" onClick={() => setPlacing(true)}>Place a new hold</Button><Button onClick={onClose}>Close</Button></div>}
    {placing && <HoldForm payoutId={payout.id} onCancel={() => setPlacing(false)} onDone={() => { setPlacing(false); holds.reload(); onChanged(); }} />}
  </Modal>;
}

function InitiateForm({ payout, onDone, onCancel }: { payout: Payout; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ payoutMethod: 'bank_transfer' }, async (v) => api.post(`/payouts/${payout.id}/initiate`, { payoutMethod: v.payoutMethod }), { success: 'Payment initiated', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Payout method" name="payoutMethod">{() => <select value={f.values.payoutMethod} onChange={(e) => f.set('payoutMethod', e.target.value)}>
      <option value="bank_transfer">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="paystack">Paystack transfer</option>
    </select>}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Initiate payment</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function MarkPaidForm({ payout, onDone, onCancel }: { payout: Payout; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ paymentReference: '' }, async (v) => api.post(`/payouts/${payout.id}/paid`, { paymentReference: v.paymentReference.trim() || undefined }), { success: 'Payout marked paid', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Payment reference" name="paymentReference" hint="Optional — the provider or bank transaction reference.">{(p) => <input {...p} value={f.values.paymentReference} onChange={(e) => f.set('paymentReference', e.target.value)} maxLength={120} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Mark paid</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function PayoutActions({ p, onDone, onManageHolds }: { p: Payout; onDone: () => void; onManageHolds: () => void }) {
  const toast = useToast();
  const [modal, setModal] = useState<'initiate' | 'paid' | null>(null);
  const act = async (path: string) => { await api.post(path, {}); toast('Updated'); onDone(); };
  return <>
    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {p.status === 'Earned' && <ConfirmButton label="Review" size="sm" message="Confirm this payout's deliverables and amount? You cannot review your own payout." onConfirm={() => act(`/payouts/${p.id}/review`)} />}
      {p.status === 'Reviewed' && <ConfirmButton label="Approve" size="sm" message="Approve this payout (four-eyes)? You cannot approve your own payout or one you reviewed yourself." onConfirm={() => act(`/payouts/${p.id}/approve`)} />}
      {p.status === 'Approved' && <ConfirmButton label="Move to Payable" size="sm" message="Move this approved payout to Payable?" onConfirm={() => act(`/payouts/${p.id}/payable`)} />}
      {(p.status === 'Approved' || p.status === 'Payable') && <Button size="sm" variant="danger" onClick={onManageHolds}>Holds</Button>}
      {p.status === 'Payable' && <Button size="sm" onClick={() => setModal('initiate')}>Initiate payment</Button>}
      {p.status === 'Payment initiated' && <Button size="sm" onClick={() => setModal('paid')}>Mark paid</Button>}
      {p.status === 'Paid' && <ConfirmButton label="Reconcile" size="sm" message="Reconcile this payout against the provider transaction?" onConfirm={() => act(`/payouts/${p.id}/reconcile`)} />}
    </span>
    <Modal open={modal === 'initiate'} onClose={() => setModal(null)} title="Initiate payment">
      <InitiateForm payout={p} onCancel={() => setModal(null)} onDone={() => { setModal(null); onDone(); }} />
    </Modal>
    <Modal open={modal === 'paid'} onClose={() => setModal(null)} title="Mark payout paid">
      <MarkPaidForm payout={p} onCancel={() => setModal(null)} onDone={() => { setModal(null); onDone(); }} />
    </Modal>
  </>;
}

export default function PayoutsPage() {
  useTitle('Payouts');
  const me = useMe();
  const [status, setStatus] = useState('');
  const payouts = useApi<Payout[]>('/payouts');
  const [holdsFor, setHoldsFor] = useState<Payout | null>(null);
  const canEdit = me.can('payouts', 'edit');
  const isExpert = me.role === 'EXPERT';
  const rows = (payouts.data ?? []).filter((p) => !status || p.status === status);

  return <>
    <PageHead title={isExpert ? 'My payouts' : 'Professional payouts'} sub={isExpert ? 'Your earnings from revenue-share calculations, and where each payout stands on its way to payment.' : 'Every professional payout from Earned through to Reconciled. Review and approval are four-eyes: a professional can never review, approve, or hold their own payout.'} />
    <Card>
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <StatusFilter label="Status" value={status} onChange={setStatus} options={STATUSES} />
      </div>
      <Async state={payouts}>{() => rows.length === 0 ? <Empty title="No payouts yet" hint="Payouts appear here once a revenue-share agreement is calculated against a paid invoice." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Payout</th><th className="r">Amount</th><th>Status</th><th>Method / reference</th><th className="r">Created</th>{canEdit && <th>Actions</th>}</tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id}>
            <td className="mono">{p.code}</td>
            <td className="r num">{ghs(p.amountGhs)}</td>
            <td><Badge tone={STATUS_TONE[p.status] as any}>{p.status}</Badge></td>
            <td className="small muted">{p.payoutMethod ?? '—'}{p.paymentReference ? ` · ${p.paymentReference}` : ''}</td>
            <td className="r small muted">{dateTime(p.createdAt)}</td>
            {canEdit && <td><PayoutActions p={p} onDone={payouts.reload} onManageHolds={() => setHoldsFor(p)} /></td>}
          </tr>)}</tbody>
        </table></div>
      )}</Async>
    </Card>
    {holdsFor && <HoldsPanel payout={holdsFor} onClose={() => setHoldsFor(null)} onChanged={payouts.reload} />}
  </>;
}
