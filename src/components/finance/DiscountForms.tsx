'use client';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';
import { clientFail, num } from './common';

export type DiscountRule = {
  id: string; kind: 'PERCENTAGE' | 'FIXED' | 'PROMOTIONAL_PRICE'; value: string;
  active: boolean; createdBy: string | null; approvedBy: string | null; createdAt: string;
};
export type PromoCampaign = {
  id: string; name: string; discountRuleId: string; startDate: string | null; endDate: string | null;
  active: boolean; createdAt: string;
};
export type PromoCode = {
  id: string; campaignId: string; code: string; maxRedemptions: number | null; perCustomerLimit: number | null;
  minPurchaseGhs: string | null; maxDiscountGhs: string | null; expiresAt: string | null; active: boolean;
  createdAt: string; redemptions: number;
};

const KIND_LABEL: Record<string, string> = { PERCENTAGE: 'Percentage off', FIXED: 'Fixed amount off', PROMOTIONAL_PRICE: 'New promotional price' };

export function DiscountRuleForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const f = useForm({ kind: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED' | 'PROMOTIONAL_PRICE', value: '' }, async (v) => {
    const n = num(v.value);
    if (!Number.isFinite(n) || n <= 0) throw clientFail({ value: 'Enter an amount above zero' });
    if (v.kind === 'PERCENTAGE' && n > 100) throw clientFail({ value: 'A percentage discount cannot exceed 100' });
    return api.post('/discount-rules', { kind: v.kind, value: n });
  }, { success: 'Discount rule proposed — it needs a second person to approve it before use', onDone });

  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <p className="small muted">A discount rule must be approved by someone other than whoever creates it (four-eyes) before any campaign built on it can be used.</p>
    <Field label="Discount type" name="kind">{() => <select value={f.values.kind} onChange={(e) => f.set('kind', e.target.value as any)}>
      {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>}</Field>
    <Field
      label={f.values.kind === 'PERCENTAGE' ? 'Percentage off' : f.values.kind === 'FIXED' ? 'Amount off (GHS)' : 'New total price (GHS)'}
      name="value" required error={f.errors.value}
      hint={f.values.kind === 'PERCENTAGE' ? 'A whole or decimal percentage, up to 100.' : f.values.kind === 'FIXED' ? 'Subtracted from the invoice amount.' : 'The invoice amount is replaced with this figure.'}
    >{(p) => <input {...p} value={f.values.value} onChange={(e) => f.set('value', e.target.value)} type="number" min="0.01" step="0.01" inputMode="decimal" />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Propose rule</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

export function PromoCampaignForm({ rules, onDone, onCancel }: { rules: DiscountRule[]; onDone: () => void; onCancel: () => void }) {
  const approved = rules.filter((r) => r.approvedBy && r.active);
  const f = useForm({ name: '', discountRuleId: approved[0]?.id ?? '', startDate: '', endDate: '' }, async (v) => {
    const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs.name = 'Enter at least 2 characters';
    if (!v.discountRuleId) errs.discountRuleId = 'Choose an approved discount rule';
    if (v.startDate && v.endDate && v.endDate < v.startDate) errs.endDate = 'Must be after the start date';
    if (Object.keys(errs).length) throw clientFail(errs);
    return api.post('/promo-campaigns', { name: v.name.trim(), discountRuleId: v.discountRuleId, startDate: v.startDate || null, endDate: v.endDate || null });
  }, { success: 'Campaign created', onDone });

  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    {approved.length === 0 && <p className="small" style={{ color: 'var(--warn)' }}>No discount rules are approved yet. Propose and approve one first.</p>}
    <Field label="Campaign name" name="name" required error={f.errors.name}>{(p) => <input {...p} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} maxLength={160} placeholder="e.g. Launch week" />}</Field>
    <Field label="Discount rule" name="discountRuleId" required error={f.errors.discountRuleId} hint="Only approved, active rules can be used.">{(p) => <select {...p} value={f.values.discountRuleId} onChange={(e) => f.set('discountRuleId', e.target.value)}>
      <option value="">Choose a rule</option>
      {approved.map((r) => <option key={r.id} value={r.id}>{KIND_LABEL[r.kind]} — {r.kind === 'PERCENTAGE' ? `${Number(r.value)}%` : `GHS ${Number(r.value)}`}</option>)}
    </select>}</Field>
    <Field label="Start date" name="startDate" hint="Optional — leave blank to start immediately.">{(p) => <input {...p} type="date" value={f.values.startDate} onChange={(e) => f.set('startDate', e.target.value)} />}</Field>
    <Field label="End date" name="endDate" error={f.errors.endDate} hint="Optional — leave blank for no end date.">{(p) => <input {...p} type="date" value={f.values.endDate} onChange={(e) => f.set('endDate', e.target.value)} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Create campaign</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

export function PromoCodeForm({ campaigns, onDone, onCancel }: { campaigns: PromoCampaign[]; onDone: () => void; onCancel: () => void }) {
  const active = campaigns.filter((c) => c.active);
  const f = useForm({
    campaignId: active[0]?.id ?? '', prefix: '', maxRedemptions: '', perCustomerLimit: '1', minPurchaseGhs: '', maxDiscountGhs: '', expiresAt: ''
  }, async (v) => {
    const errs: Record<string, string> = {};
    if (!v.campaignId) errs.campaignId = 'Choose a campaign';
    if (v.maxRedemptions && (!Number.isInteger(num(v.maxRedemptions)) || num(v.maxRedemptions) < 1)) errs.maxRedemptions = 'Enter a positive whole number';
    if (v.perCustomerLimit && (!Number.isInteger(num(v.perCustomerLimit)) || num(v.perCustomerLimit) < 1)) errs.perCustomerLimit = 'Enter a positive whole number';
    if (Object.keys(errs).length) throw clientFail(errs);
    return api.post('/promo-codes', {
      campaignId: v.campaignId, prefix: v.prefix.trim() || undefined,
      maxRedemptions: v.maxRedemptions ? Number(v.maxRedemptions) : null,
      perCustomerLimit: v.perCustomerLimit ? Number(v.perCustomerLimit) : null,
      minPurchaseGhs: v.minPurchaseGhs ? num(v.minPurchaseGhs) : null,
      maxDiscountGhs: v.maxDiscountGhs ? num(v.maxDiscountGhs) : null,
      expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null
    });
  }, { success: 'Promo code generated', onDone });

  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    {active.length === 0 && <p className="small" style={{ color: 'var(--warn)' }}>No active campaigns yet. Create one first.</p>}
    <Field label="Campaign" name="campaignId" required error={f.errors.campaignId}>{(p) => <select {...p} value={f.values.campaignId} onChange={(e) => f.set('campaignId', e.target.value)}>
      <option value="">Choose a campaign</option>
      {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>}</Field>
    <Field label="Code prefix" name="prefix" hint="Optional, up to 12 characters, e.g. LAUNCH. The actual code is generated randomly and cannot be guessed.">{(p) => <input {...p} value={f.values.prefix} onChange={(e) => f.set('prefix', e.target.value.toUpperCase())} maxLength={12} placeholder="PROMO" />}</Field>
    <Field label="Maximum redemptions" name="maxRedemptions" error={f.errors.maxRedemptions} hint="Total uses across all customers. Leave blank for unlimited.">{(p) => <input {...p} value={f.values.maxRedemptions} onChange={(e) => f.set('maxRedemptions', e.target.value)} type="number" min="1" step="1" />}</Field>
    <Field label="Per-customer limit" name="perCustomerLimit" error={f.errors.perCustomerLimit} hint="How many times one customer may use this code.">{(p) => <input {...p} value={f.values.perCustomerLimit} onChange={(e) => f.set('perCustomerLimit', e.target.value)} type="number" min="1" step="1" />}</Field>
    <Field label="Minimum purchase (GHS)" name="minPurchaseGhs" hint="Optional — the invoice must be at least this amount.">{(p) => <input {...p} value={f.values.minPurchaseGhs} onChange={(e) => f.set('minPurchaseGhs', e.target.value)} type="number" min="0" step="0.01" />}</Field>
    <Field label="Maximum discount (GHS)" name="maxDiscountGhs" hint="Optional cap on the discount this code can apply.">{(p) => <input {...p} value={f.values.maxDiscountGhs} onChange={(e) => f.set('maxDiscountGhs', e.target.value)} type="number" min="0" step="0.01" />}</Field>
    <Field label="Expires at" name="expiresAt" hint="Optional.">{(p) => <input {...p} value={f.values.expiresAt} onChange={(e) => f.set('expiresAt', e.target.value)} type="datetime-local" />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Generate code</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
