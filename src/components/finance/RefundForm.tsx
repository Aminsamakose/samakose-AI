'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';
import { clientFail, num, PaymentSelect } from './common';

export function RefundForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [paymentId, setPaymentId] = useState('');
  const f = useForm({ amountGhs: '', reason: '' }, async (v) => {
    const errs: Record<string, string> = {};
    if (!paymentId) errs.paymentId = 'Choose the payment to refund';
    const amt = num(v.amountGhs);
    if (!Number.isFinite(amt) || amt <= 0) errs.amountGhs = 'Enter an amount above zero';
    if (v.reason.trim().length < 3) errs.reason = 'Enter a reason';
    if (Object.keys(errs).length) throw clientFail(errs);
    return api.post('/refunds', { paymentId, amountGhs: amt, reason: v.reason.trim() });
  }, { success: 'Refund requested — it needs a second person to approve it', onDone });

  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <p className="small muted">A refund must be approved by someone other than whoever requests it, and a large refund (as a share of its invoice) is routed to a more senior approver by the Approval Matrix.</p>
    <Field label="Payment" name="paymentId" required error={f.errors.paymentId}>{() => <PaymentSelect id="paymentId" name="paymentId" value={paymentId} onChange={setPaymentId} status="Succeeded" invalid={!!f.errors.paymentId} />}</Field>
    <Field label="Refund amount (GHS)" name="amountGhs" required error={f.errors.amountGhs} hint="Cannot exceed the payment amount.">{(p) => <input {...p} value={f.values.amountGhs} onChange={(e) => f.set('amountGhs', e.target.value)} type="number" min="0.01" step="0.01" inputMode="decimal" />}</Field>
    <Field label="Reason" name="reason" required error={f.errors.reason}>{(p) => <textarea {...p} value={f.values.reason} onChange={(e) => f.set('reason', e.target.value)} rows={3} maxLength={500} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Request refund</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
