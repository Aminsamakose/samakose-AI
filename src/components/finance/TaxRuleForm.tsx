'use client';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';
import { clientFail, num, today } from './common';

const TYPES = ['VAT', 'WITHHOLDING', 'OTHER'] as const;
const TYPE_LABEL: Record<string, string> = { VAT: 'VAT', WITHHOLDING: 'Withholding tax', OTHER: 'Other' };

export function TaxRuleForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const f = useForm({ type: 'VAT' as typeof TYPES[number], rate: '', jurisdiction: 'GH', inclusiveOfPrice: false, effectiveFrom: today() }, async (v) => {
    const errs: Record<string, string> = {};
    const rate = num(v.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) errs.rate = 'Enter a rate between 0 and 100';
    if (!v.jurisdiction.trim()) errs.jurisdiction = 'Required';
    if (!v.effectiveFrom) errs.effectiveFrom = 'Required';
    if (Object.keys(errs).length) throw clientFail(errs);
    return api.post('/tax-rules', { type: v.type, rate, jurisdiction: v.jurisdiction.trim().toUpperCase(), inclusiveOfPrice: v.inclusiveOfPrice, effectiveFrom: v.effectiveFrom });
  }, { success: 'Tax rule opened', onDone });

  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <p className="small muted">A rate change is always a new, versioned rule — it never edits history. Every past tax line keeps pointing at the exact rule version it used.</p>
    <Field label="Type" name="type">{() => <select value={f.values.type} onChange={(e) => f.set('type', e.target.value as any)}>
      {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
    </select>}</Field>
    <Field label="Jurisdiction" name="jurisdiction" required error={f.errors.jurisdiction} hint="A short code, e.g. GH.">{(p) => <input {...p} value={f.values.jurisdiction} onChange={(e) => f.set('jurisdiction', e.target.value.toUpperCase())} maxLength={40} />}</Field>
    <Field label="Rate (%)" name="rate" required error={f.errors.rate}>{(p) => <input {...p} value={f.values.rate} onChange={(e) => f.set('rate', e.target.value)} type="number" min="0" max="100" step="0.01" inputMode="decimal" />}</Field>
    <Field label="Price basis" name="inclusiveOfPrice" hint="Inclusive means the amount already contains this tax, and the tax is extracted from it. Exclusive means it is added on top.">{() => <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.inclusiveOfPrice} onChange={(e) => f.set('inclusiveOfPrice', e.target.checked)} />{f.values.inclusiveOfPrice ? 'Inclusive of price' : 'Added on top of price (exclusive)'}</label>}</Field>
    <Field label="Effective from" name="effectiveFrom" required error={f.errors.effectiveFrom}>{(p) => <input {...p} type="date" value={f.values.effectiveFrom} onChange={(e) => f.set('effectiveFrom', e.target.value)} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Open rule</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
