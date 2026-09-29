'use client';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';
import { checkMoney, clientFail, num } from './common';

export type Plan = { id: string; code: string; name: string; description: string | null; priceGhs: string; intervalMonths: number; active: boolean };

export function PlanForm({ plan, onDone, onCancel }: { plan?: Plan; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ name: plan?.name ?? '', description: plan?.description ?? '', priceGhs: plan ? String(Number(plan.priceGhs)) : '', intervalMonths: String(plan?.intervalMonths ?? 12) },
    async (v) => {
      const errs: Record<string, string> = { ...checkMoney(v.priceGhs, 'priceGhs') };
      if (v.name.trim().length < 2) errs.name = 'Enter at least 2 characters';
      const m = num(v.intervalMonths);
      if (!Number.isInteger(m) || m < 1 || m > 60) errs.intervalMonths = 'Enter a whole number from 1 to 60';
      if (Object.keys(errs).length) throw clientFail(errs);
      const body = { name: v.name.trim(), description: v.description.trim() || null, priceGhs: num(v.priceGhs), intervalMonths: m };
      return plan ? api.patch(`/plans/${plan.id}`, body) : api.post('/plans', body);
    }, { success: plan ? 'Plan updated' : 'Plan created', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Plan name" name="name" required error={f.errors.name}>{(p) => <input {...p} {...f.input('name')} maxLength={160} autoComplete="off" />}</Field>
      <Field label="Price (GHS)" name="priceGhs" required error={f.errors.priceGhs}>{(p) => <input {...p} {...f.input('priceGhs')} type="number" inputMode="decimal" min="0.01" step="0.01" />}</Field>
      <Field label="Billing interval (months)" name="intervalMonths" required error={f.errors.intervalMonths}>{(p) => <input {...p} {...f.input('intervalMonths')} type="number" min="1" max="60" step="1" />}</Field>
    </div>
    <Field label="Description" name="description" error={f.errors.description} hint="Optional, up to 500 characters">{(p) => <textarea {...p} {...f.input('description')} rows={3} maxLength={500} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{plan ? 'Save changes' : 'Create plan'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
