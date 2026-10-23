'use client';
import { useState } from 'react';
import { api, dateTime } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, Modal, PageHead, useApi, useForm, useToast } from '@/components/ui';
import { useMe, useTitle, StatusFilter } from '@/components/finance/common';
import { UserSelect } from '@/components/portfolio/shared';

type Agreement = {
  id: string; contractId: string; assignmentId: string; professionalId: string;
  model: 'PERCENTAGE' | 'FIXED' | 'TIERED' | 'HYBRID';
  basis: 'SHARE_ON_LIST_PRICE' | 'SHARE_ON_NET_PRICE' | 'SHARE_ON_COLLECTED_AMOUNT';
  percentage: string | null; fixedAmountGhs: string | null;
  status: 'Draft' | 'Pending approval' | 'Approved' | 'Active' | 'Suspended' | 'Expired' | 'Cancelled';
  proposedBy: string; approvedBy: string | null; createdAt: string;
};
type Allocation = { id: string; allocateeRole: string; professionalId: string | null; percentOfShare: string };
type Calculation = { id: string; invoiceId: string; professionalAmountGhs: string; samakoseAmountGhs: string; createdAt: string };

const MODELS = ['PERCENTAGE', 'FIXED', 'TIERED', 'HYBRID'];
const BASES = [
  { value: 'SHARE_ON_LIST_PRICE', label: 'Share of list price' },
  { value: 'SHARE_ON_NET_PRICE', label: 'Share of net (post-discount) price' },
  { value: 'SHARE_ON_COLLECTED_AMOUNT', label: 'Share of amount collected' }
];
const ALLOCATEE_ROLES = ['SAMAKOSE', 'LEAD', 'SPECIALIST', 'COACH', 'REVIEWER'];
const STATUSES = ['Draft', 'Pending approval', 'Approved', 'Active', 'Suspended', 'Expired', 'Cancelled'];
const STATUS_TONE: Record<string, string | undefined> = { Draft: undefined, 'Pending approval': undefined, Approved: 'ok', Active: 'ok', Suspended: 'bad', Expired: 'bad', Cancelled: 'bad' };

function ProposeForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const f: any = useForm({ contractId: '', assignmentId: '', professionalId: '', model: 'PERCENTAGE', basis: 'SHARE_ON_NET_PRICE', percentage: '', fixedAmountGhs: '', tierRules: [{ upToGhs: '', percentage: '' }] },
    (v) => {
      if (!v.contractId.trim() || !v.assignmentId.trim()) throw new Error('Enter the contract and assignment ids this agreement is for');
      if (!v.professionalId) throw new Error('Choose the professional this agreement is with');
      const body: any = { contractId: v.contractId.trim(), assignmentId: v.assignmentId.trim(), professionalId: v.professionalId, model: v.model, basis: v.basis };
      if (v.model === 'PERCENTAGE' || v.model === 'HYBRID') body.percentage = Number(v.percentage);
      if (v.model === 'FIXED' || v.model === 'HYBRID') body.fixedAmountGhs = Number(v.fixedAmountGhs);
      if (v.model === 'TIERED') body.tierRules = v.tierRules.map((t) => ({ upToGhs: t.upToGhs.trim() === '' ? null : Number(t.upToGhs), percentage: Number(t.percentage) }));
      return api.post('/revenue-share/agreements', body);
    }, { onDone, success: 'Revenue-share agreement proposed as Draft' });
  const setTier = (i: number, k: 'upToGhs' | 'percentage', val: string) => { const rows = f.values.tierRules.slice(); rows[i] = { ...rows[i], [k]: val }; f.set('tierRules', rows); };
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Propose a revenue-share agreement"><FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Contract id" name="contractId">{(p) => <input {...p} {...f.input('contractId')} maxLength={200} />}</Field>
      <Field label="Assignment id" name="assignmentId">{(p) => <input {...p} {...f.input('assignmentId')} maxLength={200} />}</Field>
    </div>
    <Field label="Professional" name="professionalId">{() => <UserSelect id="rs-pro" name="professionalId" value={f.values.professionalId} onChange={(v) => f.set('professionalId', v)} />}</Field>
    <div className="form-grid">
      <Field label="Model" name="model">{() => <select value={f.values.model} onChange={(e) => f.set('model', e.target.value)}>{MODELS.map((m) => <option key={m} value={m}>{m}</option>)}</select>}</Field>
      <Field label="Basis" name="basis">{() => <select value={f.values.basis} onChange={(e) => f.set('basis', e.target.value)}>{BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select>}</Field>
    </div>
    {(f.values.model === 'PERCENTAGE' || f.values.model === 'HYBRID') && <Field label="Percentage" name="percentage">{(p) => <input {...p} {...f.input('percentage')} type="number" min="0" max="100" step="0.01" />}</Field>}
    {(f.values.model === 'FIXED' || f.values.model === 'HYBRID') && <Field label="Fixed amount (GHS)" name="fixedAmountGhs">{(p) => <input {...p} {...f.input('fixedAmountGhs')} type="number" min="0" step="0.01" />}</Field>}
    {f.values.model === 'TIERED' && <div className="stack" style={{ gap: 6 }}>
      <p className="small muted">Cumulative bands in ascending order. Leave the last tier's "up to" blank for unlimited.</p>
      {f.values.tierRules.map((t: { upToGhs: string; percentage: string }, i: number) => <div key={i} className="row" style={{ gap: 8 }}>
        <input aria-label={`Tier ${i + 1} up to (GHS)`} placeholder="Up to GHS (blank = unlimited)" type="number" min="0" step="0.01" value={t.upToGhs} onChange={(e) => setTier(i, 'upToGhs', e.target.value)} />
        <input aria-label={`Tier ${i + 1} percentage`} placeholder="Percentage" type="number" min="0" max="100" step="0.01" value={t.percentage} onChange={(e) => setTier(i, 'percentage', e.target.value)} />
        {f.values.tierRules.length > 1 && <Button type="button" size="sm" variant="danger" onClick={() => f.set('tierRules', f.values.tierRules.filter((_: unknown, j: number) => j !== i))}>Remove</Button>}
      </div>)}
      <Button type="button" size="sm" onClick={() => f.set('tierRules', [...f.values.tierRules, { upToGhs: '', percentage: '' }])}>Add tier</Button>
    </div>}
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Propose</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function AllocationsPanel({ agreement, onClose, onChanged }: { agreement: Agreement; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<{ agreement: Agreement; allocations: Allocation[]; calculations: Calculation[] }>(`/revenue-share/agreements/${agreement.id}`);
  const toast = useToast();
  const existing = detail.data?.allocations ?? [];
  const [rows, setRows] = useState<{ allocateeRole: string; professionalId: string; percentOfShare: string }[] | null>(null);
  const draft = rows ?? existing.map((a) => ({ allocateeRole: a.allocateeRole, professionalId: a.professionalId ?? '', percentOfShare: a.percentOfShare }));
  const effective = draft.length ? draft : [{ allocateeRole: 'LEAD', professionalId: '', percentOfShare: '' }];
  const [busy, setBusy] = useState(false);
  const sum = effective.reduce((s, r) => s + (Number(r.percentOfShare) || 0), 0);
  const setRow = (i: number, patch: Partial<{ allocateeRole: string; professionalId: string; percentOfShare: string }>) => {
    const next = effective.slice(); next[i] = { ...next[i], ...patch }; setRows(next);
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/revenue-share/agreements/${agreement.id}/allocations`, {
        rows: effective.map((r) => ({ allocateeRole: r.allocateeRole, professionalId: r.allocateeRole === 'SAMAKOSE' ? undefined : r.professionalId, percentOfShare: Number(r.percentOfShare) }))
      });
      toast('Allocations saved'); setRows(null); detail.reload(); onChanged();
    } catch (e: any) { toast(e?.message ?? 'Could not save allocations'); } finally { setBusy(false); }
  };
  const canEdit = ['Draft', 'Pending approval'].includes(agreement.status);
  return <Modal open onClose={onClose} title={`Allocations — ${agreement.model} agreement`}>
    <Async state={detail}>{() => <div className="stack">
      {effective.map((r, i) => <div key={i} className="row" style={{ gap: 8, alignItems: 'end' }}>
        <select aria-label="Allocatee role" value={r.allocateeRole} onChange={(e) => setRow(i, { allocateeRole: e.target.value })} disabled={!canEdit} style={{ width: 'auto' }}>
          {ALLOCATEE_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        {r.allocateeRole !== 'SAMAKOSE' && <div style={{ flex: 1 }}><UserSelect id={`alloc-user-${i}`} name="professionalId" value={r.professionalId} onChange={(v) => setRow(i, { professionalId: v })} /></div>}
        <input aria-label="Percent of share" type="number" min="0" max="100" step="0.01" value={r.percentOfShare} onChange={(e) => setRow(i, { percentOfShare: e.target.value })} disabled={!canEdit} style={{ width: 100 }} />
        {canEdit && effective.length > 1 && <Button type="button" size="sm" variant="danger" onClick={() => setRows(effective.filter((_, j) => j !== i))}>Remove</Button>}
      </div>)}
      {canEdit && <div className="row" style={{ gap: 8 }}>
        <Button type="button" size="sm" onClick={() => setRows([...effective, { allocateeRole: 'LEAD', professionalId: '', percentOfShare: '' }])}>Add row</Button>
        <span className="small muted">Total: {sum.toFixed(2)}% (must equal 100%)</span>
      </div>}
      {canEdit && <div className="form-actions"><Button variant="primary" loading={busy} onClick={save}>Save allocations</Button><Button onClick={onClose}>Close</Button></div>}
      {!canEdit && <Button onClick={onClose}>Close</Button>}
      {(detail.data?.calculations.length ?? 0) > 0 && <div className="stack" style={{ gap: 4, marginTop: 10 }}>
        <p className="small muted">Calculations</p>
        {detail.data!.calculations.map((c) => <p key={c.id} className="small">Invoice {c.invoiceId}: professional GHS {Number(c.professionalAmountGhs).toFixed(2)}, Samakose GHS {Number(c.samakoseAmountGhs).toFixed(2)} — {dateTime(c.createdAt)}</p>)}
      </div>}
    </div>}</Async>
  </Modal>;
}

function CalculateForm({ agreement, onDone, onCancel }: { agreement: Agreement; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ invoiceId: '' }, (v) => {
    if (!v.invoiceId.trim()) throw new Error('Enter the id of the paid invoice to calculate against');
    return api.post(`/revenue-share/agreements/${agreement.id}/calculate`, { invoiceId: v.invoiceId.trim() });
  }, { onDone, success: 'Revenue share calculated and payouts generated' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Calculate revenue share"><FormError message={f.formError} />
    <p className="small muted">The invoice must be fully paid, on this agreement's contract, with the assignment's deliverables complete.</p>
    <Field label="Invoice id" name="invoiceId">{(p) => <input {...p} {...f.input('invoiceId')} maxLength={200} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Calculate</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function AgreementActions({ a, meId, canEdit, canApprove, onDone, onAllocations }: { a: Agreement; meId: string | undefined; canEdit: boolean; canApprove: boolean; onDone: () => void; onAllocations: () => void }) {
  const toast = useToast();
  const [calcOpen, setCalcOpen] = useState(false);
  const act = async (path: string, method: 'POST' = 'POST') => { try { await api.post(path, {}); toast('Updated'); onDone(); } catch (e: any) { toast(e?.message ?? 'Could not update'); } };
  return <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
    {['Draft', 'Pending approval'].includes(a.status) && canEdit && <Button size="sm" onClick={onAllocations}>Allocations</Button>}
    {a.status === 'Draft' && canEdit && <ConfirmButton size="sm" label="Submit for approval" message="Submit this agreement for approval? Allocations must already sum to 100%." onConfirm={() => act(`/revenue-share/agreements/${a.id}/submit`)} />}
    {a.status === 'Pending approval' && canApprove && a.proposedBy !== meId && <ConfirmButton size="sm" label="Approve" message="Approve this agreement? You cannot approve an agreement you proposed, are the professional on, or are named in its allocations." onConfirm={() => act(`/revenue-share/agreements/${a.id}/approve`)} />}
    {a.status === 'Approved' && canEdit && <ConfirmButton size="sm" label="Activate" message="Activate this agreement? Revenue share can then be calculated against it." onConfirm={() => act(`/revenue-share/agreements/${a.id}/activate`)} />}
    {a.status === 'Active' && canEdit && <Button size="sm" onClick={() => setCalcOpen(true)}>Calculate</Button>}
    <Modal open={calcOpen} onClose={() => setCalcOpen(false)} title="Calculate revenue share">
      <CalculateForm agreement={a} onCancel={() => setCalcOpen(false)} onDone={() => { setCalcOpen(false); onDone(); }} />
    </Modal>
  </span>;
}

export default function RevenueSharePage() {
  useTitle('Revenue share');
  const me = useMe();
  const [status, setStatus] = useState('');
  const agreements = useApi<Agreement[]>('/revenue-share/agreements');
  const [proposing, setProposing] = useState(false);
  const [allocFor, setAllocFor] = useState<Agreement | null>(null);
  const canCreate = me.can('revenue_share', 'create');
  const canEdit = me.can('revenue_share', 'edit');
  const canApprove = me.can('revenue_share', 'approve');
  const rows = (agreements.data ?? []).filter((a) => !status || a.status === status);

  if (!me.data) return null;

  return <>
    <PageHead title="Revenue share" sub="Revenue-share agreements between Samakose and professionals: propose, allocate across the delivery team, approve four-eyes, activate, then calculate against a paid invoice to generate payouts." actions={canCreate ? <Button onClick={() => setProposing(true)}>Propose agreement</Button> : undefined} />
    <Card>
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <StatusFilter label="Status" value={status} onChange={setStatus} options={STATUSES} />
      </div>
      <Async state={agreements}>{() => rows.length === 0 ? <Empty title="No revenue-share agreements" hint="Propose one against a contract and assignment to split payment between Samakose and the delivery team." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Model / basis</th><th className="r">Rate</th><th>Status</th><th className="r">Proposed</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((a) => <tr key={a.id}>
            <td className="small">{a.model} &middot; {BASES.find((b) => b.value === a.basis)?.label ?? a.basis}</td>
            <td className="r num">{a.percentage ? `${Number(a.percentage).toFixed(2)}%` : a.fixedAmountGhs ? `GHS ${Number(a.fixedAmountGhs).toFixed(2)}` : '—'}</td>
            <td><Badge tone={STATUS_TONE[a.status] as any}>{a.status}</Badge></td>
            <td className="r small muted">{dateTime(a.createdAt)}</td>
            <td><AgreementActions a={a} meId={me.data?.user.id} canEdit={canEdit} canApprove={canApprove} onDone={agreements.reload} onAllocations={() => setAllocFor(a)} /></td>
          </tr>)}</tbody>
        </table></div>
      )}</Async>
    </Card>
    <Modal open={proposing} onClose={() => setProposing(false)} title="Propose a revenue-share agreement">
      <ProposeForm onCancel={() => setProposing(false)} onDone={() => { setProposing(false); agreements.reload(); }} />
    </Modal>
    {allocFor && <AllocationsPanel agreement={allocFor} onClose={() => setAllocFor(null)} onChanged={agreements.reload} />}
  </>;
}
