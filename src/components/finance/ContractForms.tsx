'use client';
import { api, ghs } from '@/lib/client/api';
import { Button, Field, FormError, useApi, useForm } from '@/components/ui';
import { OrgSelect, clientFail, num } from './common';
import type { Plan } from './PlanForm';
import { ContractLifecycle } from './ContractLifecycle';

export type Contract = { id: string; code: string; orgId: string; org: string; planId: string | null; status: string; startDate: string | null; endDate: string | null; amountGhs: string };

export function ContractCreate({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const plans = useApi<Plan[]>('/plans');
  const f = useForm({ orgId: '', planId: '', startDate: '', endDate: '', amountGhs: '' }, async (v) => {
    const errs: Record<string, string> = {};
    if (!v.orgId) errs.orgId = 'Choose an organisation';
    const amt = num(v.amountGhs);
    if (!v.planId && v.amountGhs === '') errs.amountGhs = 'Enter the contract amount or choose a plan';
    else if (v.amountGhs !== '' && (!Number.isFinite(amt) || amt < 0)) errs.amountGhs = 'Enter a valid amount';
    if (v.startDate && v.endDate && v.endDate < v.startDate) errs.endDate = 'End date must be after the start date';
    if (Object.keys(errs).length) throw clientFail(errs);
    return api.post('/contracts', { orgId: v.orgId, planId: v.planId || null, startDate: v.startDate || null, endDate: v.endDate || null, ...(v.amountGhs !== '' ? { amountGhs: amt } : {}) });
  }, { success: 'Contract created as a draft', onDone });
  const chosen = plans.data?.find((p) => p.id === f.values.planId);
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Organisation" name="orgId" required error={f.errors.orgId}>{(p) => <OrgSelect id={p.id} name="orgId" value={f.values.orgId} onChange={(v) => f.set('orgId', v)} invalid={!!p['aria-invalid']} describedBy={p['aria-describedby']} />}</Field>
    <div className="form-grid">
      <Field label="Plan" name="planId" error={f.errors.planId} hint={chosen ? `Plan price ${ghs(chosen.priceGhs)} is used when the amount is left empty` : 'Optional. Sets the default amount'}>{(p) => <select {...p} {...f.input('planId')}><option value="">No plan</option>{(plans.data ?? []).filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name} ({ghs(x.priceGhs)})</option>)}</select>}</Field>
      <Field label="Amount (GHS)" name="amountGhs" error={f.errors.amountGhs} required={!f.values.planId}>{(p) => <input {...p} {...f.input('amountGhs')} type="number" inputMode="decimal" min="0" step="0.01" />}</Field>
      <Field label="Start date" name="startDate" error={f.errors.startDate}>{(p) => <input {...p} {...f.input('startDate')} type="date" />}</Field>
      <Field label="End date" name="endDate" error={f.errors.endDate}>{(p) => <input {...p} {...f.input('endDate')} type="date" min={f.values.startDate || undefined} />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Create contract</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

const MOVES: Record<string, string[]> = { Draft: ['Active', 'Cancelled'], Active: ['Expired', 'Cancelled'], Expired: [], Cancelled: [] };

/** Edit terms (drafts only) and move the status. */
export function ContractManage({ c, canEdit, canCreate = false, onChanged = () => {}, onDone, onCancel }: { c: Contract; canEdit: boolean; canCreate?: boolean; onChanged?: () => void; onDone: () => void; onCancel: () => void }) {
  const draft = c.status === 'Draft';
  const moves = MOVES[c.status] ?? [];
  const f = useForm({ status: '', startDate: c.startDate ?? '', endDate: c.endDate ?? '', amountGhs: String(Number(c.amountGhs)) }, async (v) => {
    const errs: Record<string, string> = {};
    if (v.startDate && v.endDate && v.endDate < v.startDate) errs.endDate = 'End date must be after the start date';
    const amt = num(v.amountGhs);
    if (draft && (!Number.isFinite(amt) || amt < 0)) errs.amountGhs = 'Enter a valid amount';
    if (v.status === 'Active' && (!v.startDate || !v.endDate)) errs.startDate = 'Set start and end dates before activating';
    if (Object.keys(errs).length) throw clientFail(errs);
    const body: Record<string, unknown> = {};
    if (v.status) body.status = v.status;
    if (draft) { body.startDate = v.startDate || null; body.endDate = v.endDate || null; body.amountGhs = amt; }
    if (!Object.keys(body).length) throw clientFail({ status: 'Choose a status change or edit the terms' });
    return api.patch(`/contracts/${c.id}`, body);
  }, { success: 'Contract updated', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <ContractLifecycle id={c.id} canEdit={canEdit} canCreate={canCreate} onChanged={onChanged} />
    <p className="muted">{c.code} for {c.org}. Current status: <strong>{c.status}</strong>.{!draft && ' Terms can only be edited while the contract is a draft.'}</p>
    {draft && <div className="form-grid">
      <Field label="Amount (GHS)" name="amountGhs" required error={f.errors.amountGhs}>{(p) => <input {...p} {...f.input('amountGhs')} type="number" inputMode="decimal" min="0" step="0.01" />}</Field>
      <Field label="Start date" name="startDate" error={f.errors.startDate}>{(p) => <input {...p} {...f.input('startDate')} type="date" />}</Field>
      <Field label="End date" name="endDate" error={f.errors.endDate}>{(p) => <input {...p} {...f.input('endDate')} type="date" />}</Field>
    </div>}
    {moves.length > 0 ? <Field label="Change status" name="status" error={f.errors.status} hint="Cancelling, expiring and activating cannot be reversed">{(p) => <select {...p} {...f.input('status')}><option value="">Keep as {c.status}</option>{moves.map((m) => <option key={m} value={m}>{m}</option>)}</select>}</Field> : <p className="small muted">This contract is {c.status.toLowerCase()} and cannot change further.</p>}
    {canEdit && (draft || moves.length > 0) && <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save changes</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>}
    {!(canEdit && (draft || moves.length > 0)) && <div className="form-actions"><Button type="button" onClick={onCancel}>Close</Button></div>}
  </form>;
}
