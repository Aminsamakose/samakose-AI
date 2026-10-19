'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';
import { clientFail, num, PaymentSelect } from './common';

const PROVIDERS = [{ value: 'paystack', label: 'Paystack' }, { value: 'manual', label: 'Manual / bank' }];

export function ChargebackForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [paymentId, setPaymentId] = useState('');
  const f = useForm({ provider: 'paystack', providerReference: '', amountGhs: '' }, async (v) => {
    const errs: Record<string, string> = {};
    if (!paymentId) errs.paymentId = 'Choose the disputed payment';
    const amt = num(v.amountGhs);
    if (!Number.isFinite(amt) || amt <= 0) errs.amountGhs = 'Enter an amount above zero';
    if (Object.keys(errs).length) throw clientFail(errs);
    return api.post('/chargebacks', { paymentId, amountGhs: amt, provider: v.provider, providerReference: v.providerReference.trim() || undefined });
  }, { success: 'Chargeback recorded — the ledger entry has been posted', onDone });

  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <p className="small muted">Unlike a refund, a chargeback is money the provider has already pulled back, so its ledger entry posts immediately on receipt. Resolve the dispute afterwards as Won or Lost.</p>
    <Field label="Disputed payment" name="paymentId" required error={f.errors.paymentId}>{() => <PaymentSelect id="paymentId" name="paymentId" value={paymentId} onChange={setPaymentId} invalid={!!f.errors.paymentId} />}</Field>
    <Field label="Amount (GHS)" name="amountGhs" required error={f.errors.amountGhs}>{(p) => <input {...p} value={f.values.amountGhs} onChange={(e) => f.set('amountGhs', e.target.value)} type="number" min="0.01" step="0.01" inputMode="decimal" />}</Field>
    <Field label="Provider" name="provider">{() => <select value={f.values.provider} onChange={(e) => f.set('provider', e.target.value)}>
      {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
    </select>}</Field>
    <Field label="Provider reference" name="providerReference" hint="Optional dispute/case reference from the provider.">{(p) => <input {...p} value={f.values.providerReference} onChange={(e) => f.set('providerReference', e.target.value)} maxLength={120} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Record chargeback</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
