'use client';
import { useState } from 'react';
import { api, dateTime } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, Modal, PageHead, useApi, useForm, useToast } from '@/components/ui';
import { useMe, useTitle, StatusFilter } from '@/components/finance/common';
import { UserSelect } from '@/components/portfolio/shared';

type ApprovalRequest = {
  id: string; actionType: string; referenceId: string; requestedBy: string;
  amountGhs: string | null; requiredApproverRole: string | null; status: 'Pending' | 'Approved' | 'Rejected'; createdAt: string;
};

const ACTION_TYPES = ['DISCOUNT_EXCEPTION', 'REVENUE_SHARE_OVERRIDE', 'PAYOUT', 'REFUND', 'LEDGER_ADJUSTMENT', 'CONTRACT'];
const CONTEXT_TYPES = ['REVENUE_SHARE_APPROVAL', 'PAYOUT_APPROVAL', 'REVIEW', 'COMMERCIAL_EXCEPTION'];
const STATUSES = ['Pending', 'Approved', 'Rejected'];
const STATUS_TONE: Record<string, string | undefined> = { Pending: undefined, Approved: 'ok', Rejected: 'bad' };

function RequestForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const f = useForm({ actionType: ACTION_TYPES[0], referenceId: '', amountGhs: '', metric: '' },
    (v) => {
      if (!v.referenceId.trim()) throw new Error('Enter the id of the record this approval is for');
      return api.post('/approvals', {
        actionType: v.actionType,
        referenceId: v.referenceId.trim(),
        amountGhs: v.amountGhs.trim() === '' ? undefined : Number(v.amountGhs),
        metric: v.metric.trim() === '' ? undefined : Number(v.metric)
      });
    }, { onDone, success: 'Approval request opened' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Open an approval request"><FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Action type" name="actionType">{() => <select value={f.values.actionType} onChange={(e) => f.set('actionType', e.target.value)}>
        {ACTION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
      </select>}</Field>
      <Field label="Reference id" name="referenceId" hint="The id of the record this approval governs (discount, agreement, payout, etc.).">{(p) => <input {...p} {...f.input('referenceId')} maxLength={200} />}</Field>
      <Field label="Amount (GHS, optional)" name="amountGhs">{(p) => <input {...p} {...f.input('amountGhs')} type="number" min="0" step="0.01" />}</Field>
      <Field label="Metric (%, optional)" name="metric" hint="Percentage the Approval Matrix thresholds are evaluated against, where applicable.">{(p) => <input {...p} {...f.input('metric')} type="number" min="0" step="0.01" />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Open request</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function DecideForm({ req, decision, onDone, onCancel }: { req: ApprovalRequest; decision: 'Approved' | 'Rejected'; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ reason: '' }, (v) => api.post(`/approvals/${req.id}/decide`, { decision, reason: v.reason.trim() || undefined }),
    { onDone, success: decision === 'Approved' ? 'Request approved' : 'Request rejected' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label={`${decision} this approval request`}><FormError message={f.formError} />
    <p className="small muted">Four-eyes applies: you cannot decide a request you opened yourself, and if a tier is required you must hold that role (or be an admin).</p>
    <Field label="Reason (optional)" name="reason">{(p) => <textarea {...p} value={f.values.reason} onChange={(e) => f.set('reason', e.target.value)} rows={3} maxLength={500} />}</Field>
    <div className="form-actions"><Button variant={decision === 'Approved' ? 'primary' : 'danger'} type="submit" loading={f.busy}>{decision === 'Approved' ? 'Approve' : 'Reject'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function ConflictCheckForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const f = useForm({ userId: '', contextType: CONTEXT_TYPES[0], referenceId: '', result: 'CLEAR' as 'CLEAR' | 'BLOCKED', reason: '' },
    (v) => {
      if (!v.userId) throw new Error('Choose the person this conflict check is for');
      if (!v.referenceId.trim()) throw new Error('Enter the id of the record being checked');
      return api.post('/conflict-checks', { userId: v.userId, contextType: v.contextType, referenceId: v.referenceId.trim(), result: v.result, reason: v.reason.trim() || undefined });
    }, { onDone, success: 'Conflict check recorded' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Record a conflict-of-interest check"><FormError message={f.formError} />
    <Field label="Person" name="userId">{() => <UserSelect id="cc-user" name="userId" value={f.values.userId} onChange={(v) => f.set('userId', v)} />}</Field>
    <div className="form-grid">
      <Field label="Context" name="contextType">{() => <select value={f.values.contextType} onChange={(e) => f.set('contextType', e.target.value)}>
        {CONTEXT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
      </select>}</Field>
      <Field label="Reference id" name="referenceId" hint="The id of the record being checked (agreement, payout, review, etc.).">{(p) => <input {...p} {...f.input('referenceId')} maxLength={200} />}</Field>
      <Field label="Result" name="result">{() => <select value={f.values.result} onChange={(e) => f.set('result', e.target.value as 'CLEAR' | 'BLOCKED')}>
        <option value="CLEAR">Clear — no conflict</option><option value="BLOCKED">Blocked — conflict found</option>
      </select>}</Field>
    </div>
    <Field label="Reason (optional)" name="reason">{(p) => <textarea {...p} value={f.values.reason} onChange={(e) => f.set('reason', e.target.value)} rows={2} maxLength={500} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Record check</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function RequestActions({ r, meId, canDecide, onDone }: { r: ApprovalRequest; meId: string | undefined; canDecide: boolean; onDone: () => void }) {
  const [modal, setModal] = useState<'Approved' | 'Rejected' | null>(null);
  if (r.status !== 'Pending' || !canDecide) return null;
  const isOwn = r.requestedBy === meId;
  if (isOwn) return <span className="small muted">Awaiting another approver (four-eyes)</span>;
  return <>
    <span className="row" style={{ gap: 6 }}>
      <Button size="sm" variant="primary" onClick={() => setModal('Approved')}>Approve</Button>
      <Button size="sm" variant="danger" onClick={() => setModal('Rejected')}>Reject</Button>
    </span>
    <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'Approved' ? 'Approve request' : 'Reject request'}>
      {modal && <DecideForm req={r} decision={modal} onCancel={() => setModal(null)} onDone={() => { setModal(null); onDone(); }} />}
    </Modal>
  </>;
}

export default function ApprovalsPage() {
  useTitle('Approvals');
  const me = useMe();
  const toast = useToast();
  const [status, setStatus] = useState('Pending');
  const requests = useApi<ApprovalRequest[]>('/approvals');
  const [newOpen, setNewOpen] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const canCreate = me.can('approvals', 'create');
  const canDecide = me.can('approvals', 'approve');
  const rows = (requests.data ?? []).filter((r) => !status || r.status === status);

  if (!me.data) return null;

  return <>
    <PageHead title="Approvals" sub="The Approval Matrix queue: high-risk commercial and financial actions routed to the right approver tier, decided four-eyes. Also records conflict-of-interest checks." />
    <Card actions={<span className="row" style={{ gap: 8 }}>
      {canCreate && <Button onClick={() => setNewOpen(true)}>Open request</Button>}
      {canCreate && <Button onClick={() => setCcOpen(true)}>Record conflict check</Button>}
    </span>}>
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <StatusFilter label="Status" value={status} onChange={setStatus} options={STATUSES} />
      </div>
      <Async state={requests}>{() => rows.length === 0 ? <Empty title="No approval requests" hint="Requests appear here once a feature routes a high-risk action through the Approval Matrix, or one is opened directly." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Action</th><th>Reference</th><th className="r">Amount</th><th>Required tier</th><th>Status</th><th className="r">Opened</th><th>Decide</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}>
            <td>{r.actionType.replace(/_/g, ' ')}</td>
            <td className="mono small">{r.referenceId}</td>
            <td className="r num">{r.amountGhs ? `GHS ${Number(r.amountGhs).toFixed(2)}` : '—'}</td>
            <td className="small muted">{r.requiredApproverRole ?? 'Standard'}</td>
            <td><Badge tone={STATUS_TONE[r.status] as any}>{r.status}</Badge></td>
            <td className="r small muted">{dateTime(r.createdAt)}</td>
            <td><RequestActions r={r} meId={me.data?.user.id} canDecide={canDecide} onDone={requests.reload} /></td>
          </tr>)}</tbody>
        </table></div>
      )}</Async>
    </Card>
    <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Open an approval request">
      <RequestForm onCancel={() => setNewOpen(false)} onDone={() => { setNewOpen(false); requests.reload(); }} />
    </Modal>
    <Modal open={ccOpen} onClose={() => setCcOpen(false)} title="Record a conflict-of-interest check">
      <ConflictCheckForm onCancel={() => setCcOpen(false)} onDone={() => { setCcOpen(false); toast('Conflict check recorded'); }} />
    </Modal>
  </>;
}
