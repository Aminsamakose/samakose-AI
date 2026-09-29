'use client';
import { api, dateFmt, ghs, qs } from '@/lib/client/api';
import { Button, Field, FormError, useApi, useForm } from '@/components/ui';
import { OrgSelect, checkMoney, clientFail, num, today } from './common';

type ContractOpt = { id: string; code: string; status: string; amountGhs: string; endDate: string | null };

export function InvoiceCreate({ onDone, onCancel }: { onDone: (r: { id: string; code: string }) => void; onCancel: () => void }) {
  const f = useForm({ orgId: '', contractId: '', amountGhs: '', dueDate: '' }, async (v) => {
    const errs: Record<string, string> = { ...checkMoney(v.amountGhs, 'amountGhs') };
    if (!v.orgId) errs.orgId = 'Choose an organisation';
    if (!v.dueDate) errs.dueDate = 'Choose a due date';
    if (Object.keys(errs).length) throw clientFail(errs);
    return api.post('/invoices', { orgId: v.orgId, contractId: v.contractId || null, amountGhs: num(v.amountGhs), dueDate: v.dueDate });
  }, { success: 'Draft invoice created', onDone });
  const contracts = useApi<{ items: ContractOpt[] }>(f.values.orgId ? '/contracts' + qs({ orgId: f.values.orgId, pageSize: 100, sort: 'end', dir: 'desc' }) : null);
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Organisation" name="orgId" required error={f.errors.orgId}>{(p) => <OrgSelect id={p.id} name="orgId" value={f.values.orgId} onChange={(v) => { f.set('orgId', v); f.set('contractId', ''); }} invalid={!!p['aria-invalid']} describedBy={p['aria-describedby']} />}</Field>
    <Field label="Contract" name="contractId" error={f.errors.contractId} hint={f.values.orgId ? 'Optional. Link the invoice to one of this organisation\'s contracts' : 'Choose an organisation first'}>
      {(p) => <select {...p} {...f.input('contractId')} disabled={!f.values.orgId}>
        <option value="">{contracts.loading ? 'Loading contracts' : 'Not linked to a contract'}</option>
        {(contracts.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} ({c.status}, {ghs(c.amountGhs)})</option>)}
      </select>}
    </Field>
    <div className="form-grid">
      <Field label="Amount (GHS)" name="amountGhs" required error={f.errors.amountGhs}>{(p) => <input {...p} {...f.input('amountGhs')} type="number" inputMode="decimal" min="0.01" step="0.01" />}</Field>
      <Field label="Due date" name="dueDate" required error={f.errors.dueDate}>{(p) => <input {...p} {...f.input('dueDate')} type="date" min={today()} />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Create draft invoice</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

export function InvoiceEditDraft({ id, amountGhs, dueDate, onDone, onCancel }: { id: string; amountGhs: string; dueDate: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ amountGhs: String(Number(amountGhs)), dueDate }, async (v) => {
    const errs: Record<string, string> = { ...checkMoney(v.amountGhs, 'amountGhs') };
    if (!v.dueDate) errs.dueDate = 'Choose a due date';
    if (Object.keys(errs).length) throw clientFail(errs);
    return api.patch(`/invoices/${id}`, { amountGhs: num(v.amountGhs), dueDate: v.dueDate });
  }, { success: 'Invoice updated', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Amount (GHS)" name="amountGhs" required error={f.errors.amountGhs}>{(p) => <input {...p} {...f.input('amountGhs')} type="number" inputMode="decimal" min="0.01" step="0.01" />}</Field>
      <Field label="Due date" name="dueDate" required error={f.errors.dueDate}>{(p) => <input {...p} {...f.input('dueDate')} type="date" />}</Field>
    </div>
    <p className="small muted">Currently due {dateFmt(dueDate)}. The amount can only change while the invoice is a draft.</p>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save changes</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

export function ManualPayment({ id, amountGhs, onDone, onCancel }: { id: string; amountGhs: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ reference: '', amountGhs: String(Number(amountGhs)), note: '' }, async (v) => {
    const errs: Record<string, string> = { ...checkMoney(v.amountGhs, 'amountGhs') };
    if (v.reference.trim().length < 3) errs.reference = 'Enter at least 3 characters, such as a bank slip or receipt number';
    if (!errs.amountGhs && Math.abs(num(v.amountGhs) - Number(amountGhs)) > 0.001) errs.amountGhs = `Must equal the invoice amount of ${ghs(amountGhs)}. Part payments are not supported.`;
    if (Object.keys(errs).length) throw clientFail(errs);
    return api.post(`/invoices/${id}/manual-payment`, { reference: v.reference.trim(), amountGhs: num(v.amountGhs), note: v.note.trim() || undefined });
  }, { success: 'Payment recorded and invoice marked as paid', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <p className="muted">Record a bank transfer, cash or mobile money payment received outside the platform. The full invoice amount is required and the invoice is marked as paid immediately.</p>
    <div className="form-grid">
      <Field label="Payment reference" name="reference" required error={f.errors.reference} hint="Bank slip, transfer or receipt number">{(p) => <input {...p} {...f.input('reference')} maxLength={80} autoComplete="off" />}</Field>
      <Field label="Amount received (GHS)" name="amountGhs" required error={f.errors.amountGhs}>{(p) => <input {...p} {...f.input('amountGhs')} type="number" inputMode="decimal" step="0.01" />}</Field>
    </div>
    <Field label="Note" name="note" error={f.errors.note} hint="Optional, up to 300 characters">{(p) => <textarea {...p} {...f.input('note')} rows={2} maxLength={300} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Record payment</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
