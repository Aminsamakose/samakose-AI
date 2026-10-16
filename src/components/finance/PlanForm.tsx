'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, Tabs, useForm } from '@/components/ui';
import { checkMoney, clientFail, num } from './common';
import { PLAN_SERVICE_TIERS, PLAN_PLATFORMS, PLAN_ENTITLEMENTS } from '@/domain/plan-catalog';

export type PlanEntitlement = { key: string; enabled: boolean; limit?: number | string };
export type Plan = {
  id: string; code: string; name: string; description: string | null; audience: string | null;
  serviceTier: string | null; platforms: string[]; entitlements: PlanEntitlement[];
  durationDays: number | null; pricingModel: 'free' | 'fixed' | 'custom';
  priceGhs: string; intervalMonths: number; priceConfirmed: boolean; publicationStatus: 'draft' | 'published' | 'inactive' | 'archived'; active: boolean;
};

const TIERS = [{ value: '', label: 'No tier (legacy plan)' }, ...PLAN_SERVICE_TIERS.map((t) => ({ value: t.value, label: `${t.label} — ${t.who}` }))];
const PLATFORMS = PLAN_PLATFORMS;
const DURATIONS = [{ value: '', label: 'No fixed duration (one-off / standalone)' }, { value: '30', label: '30 days — fast start' }, { value: '180', label: '180 days — build the systems' }, { value: '360', label: '360 days — full year, investment readiness' }, { value: 'custom', label: 'Custom number of days' }];
/** Each key's label and whether it supports a limit/quantity (coaching sessions, participant cap). Only
 *  keys the product actually implements belong here - adding one here is a claim the system can enforce it. */
const ENTITLEMENTS = PLAN_ENTITLEMENTS;

type FormValues = {
  name: string; description: string; audience: string; serviceTier: string; platforms: string[];
  entitlementMap: Record<string, { enabled: boolean; limit: string }>;
  durationChoice: string; customDays: string;
  pricingModel: 'free' | 'fixed' | 'custom'; priceGhs: string; intervalMonths: string; priceConfirmed: boolean;
};

function toEntitlementMap(list: PlanEntitlement[]): Record<string, { enabled: boolean; limit: string }> {
  const m: Record<string, { enabled: boolean; limit: string }> = {};
  for (const e of ENTITLEMENTS) m[e.key] = { enabled: false, limit: '' };
  for (const row of list ?? []) if (m[row.key]) m[row.key] = { enabled: row.enabled, limit: row.limit === undefined ? '' : String(row.limit) };
  return m;
}

export function PlanForm({ plan, onDone, onCancel }: { plan?: Plan; onDone: () => void; onCancel: () => void }) {
  const [tab, setTab] = useState('basic');
  const initialDuration = plan?.durationDays == null ? '' : [30, 180, 360].includes(plan.durationDays) ? String(plan.durationDays) : 'custom';
  const f = useForm<FormValues>({
    name: plan?.name ?? '', description: plan?.description ?? '', audience: plan?.audience ?? '',
    serviceTier: plan?.serviceTier ?? '', platforms: plan?.platforms ?? [],
    entitlementMap: toEntitlementMap(plan?.entitlements ?? []),
    durationChoice: initialDuration, customDays: initialDuration === 'custom' ? String(plan?.durationDays ?? '') : '',
    pricingModel: plan?.pricingModel ?? 'fixed', priceGhs: plan ? String(Number(plan.priceGhs)) : '', intervalMonths: String(plan?.intervalMonths ?? 12),
    priceConfirmed: plan?.priceConfirmed ?? false
  }, async (v) => {
    const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs.name = 'Enter at least 2 characters';
    if (v.pricingModel === 'fixed') Object.assign(errs, checkMoney(v.priceGhs, 'priceGhs'));
    const m = num(v.intervalMonths);
    if (!Number.isInteger(m) || m < 1 || m > 60) errs.intervalMonths = 'Enter a whole number from 1 to 60';
    let durationDays: number | null = null;
    if (v.durationChoice === 'custom') {
      const d = num(v.customDays);
      if (!Number.isInteger(d) || d < 1 || d > 3650) errs.customDays = 'Enter a whole number of days from 1 to 3650';
      else durationDays = d;
    } else if (v.durationChoice) durationDays = Number(v.durationChoice);
    if (Object.keys(errs).length) { setTab(errs.name || errs.priceGhs || errs.intervalMonths ? 'pricing' in errs ? 'pricing' : 'basic' : 'duration'); throw clientFail(errs); }
    const entitlements = Object.entries(v.entitlementMap).filter(([, e]) => e.enabled).map(([key, e]) => ({ key, enabled: true, ...(e.limit.trim() ? { limit: Number.isFinite(Number(e.limit)) ? Number(e.limit) : e.limit.trim() } : {}) }));
    const body = {
      name: v.name.trim(), description: v.description.trim() || null, audience: v.audience.trim() || null,
      serviceTier: v.serviceTier || null, platforms: v.platforms, entitlements, durationDays,
      pricingModel: v.pricingModel, priceGhs: v.pricingModel === 'free' ? 0 : num(v.priceGhs), intervalMonths: m,
      priceConfirmed: v.pricingModel === 'fixed' ? v.priceConfirmed : false
    };
    return plan ? api.patch(`/plans/${plan.id}`, body) : api.post('/plans', body);
  }, { success: plan ? 'Plan updated' : 'Plan saved as a draft', onDone });

  const setEntitlement = (key: string, patch: Partial<{ enabled: boolean; limit: string }>) =>
    f.set('entitlementMap', { ...f.values.entitlementMap, [key]: { ...f.values.entitlementMap[key], ...patch } });
  const togglePlatform = (code: string) => f.set('platforms', f.values.platforms.includes(code) ? f.values.platforms.filter((p) => p !== code) : [...f.values.platforms, code]);

  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Tabs tabs={[{ id: 'basic', label: '1. Basic information' }, { id: 'features', label: '2. Features & entitlements' }, { id: 'duration', label: '3. Duration' }, { id: 'pricing', label: '4. Pricing' }, { id: 'review', label: '5. Review & publish' }]} active={tab} onChange={setTab} />

    {tab === 'basic' && <div className="stack">
      <Field label="Plan name" name="name" required error={f.errors.name}>{(p) => <input {...p} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} maxLength={160} autoComplete="off" placeholder="e.g. Diagnostic" />}</Field>
      <Field label="Short description" name="description" error={f.errors.description} hint="Shown to administrators building contracts. Optional, up to 500 characters.">{(p) => <textarea {...p} value={f.values.description} onChange={(e) => f.set('description', e.target.value)} rows={2} maxLength={500} />}</Field>
      <Field label="Who it's for" name="audience" error={f.errors.audience} hint="One sentence shown publicly, e.g. “Owners who want a full picture and clear priorities.”">{(p) => <input {...p} value={f.values.audience} onChange={(e) => f.set('audience', e.target.value)} maxLength={160} />}</Field>
      <Field label="Service tier" name="serviceTier" hint="What the customer receives. Separate from how long support lasts (set on the Duration tab).">{(p) => <select {...p} value={f.values.serviceTier} onChange={(e) => f.set('serviceTier', e.target.value)}>{TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>}</Field>
      <Field label="Platforms" name="platforms" hint="Leave all unchecked to make this plan available on every platform.">{() => <div className="row" style={{ gap: 14 }}>{PLATFORMS.map((p) => <label key={p.value} className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.platforms.includes(p.value)} onChange={() => togglePlatform(p.value)} />{p.label}</label>)}</div>}</Field>
    </div>}

    {tab === 'features' && <div className="stack">
      <p className="small muted">Only turn on a feature the product actually delivers today. A feature left off here will not be shown on the public pricing page or claimed as included, even if the plan name suggests it.</p>
      {ENTITLEMENTS.map((e) => {
        const row = f.values.entitlementMap[e.key];
        return <div key={e.key} className="row" style={{ gap: 10, alignItems: 'center' }}>
          <label className="row" style={{ gap: 6, flex: 1 }}><input type="checkbox" checked={row.enabled} onChange={(ev) => setEntitlement(e.key, { enabled: ev.target.checked })} />{e.label}</label>
          {e.limited && row.enabled && <input aria-label={e.limited} placeholder={e.limited} value={row.limit} onChange={(ev) => setEntitlement(e.key, { limit: ev.target.value })} style={{ width: 160 }} />}
        </div>;
      })}
    </div>}

    {tab === 'duration' && <div className="stack">
      <p className="small muted">Duration is how long the Samakose support arrangement lasts — not the service tier. A Diagnostic plan can be sold with no fixed horizon, or bundled with any of the horizons below.</p>
      <Field label="Support duration" name="durationChoice" error={f.errors.customDays}>{() => <select value={f.values.durationChoice} onChange={(e) => f.set('durationChoice', e.target.value)}>{DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select>}</Field>
      {f.values.durationChoice === 'custom' && <Field label="Number of days" name="customDays" error={f.errors.customDays}>{(p) => <input {...p} type="number" min={1} max={3650} value={f.values.customDays} onChange={(e) => f.set('customDays', e.target.value)} />}</Field>}
    </div>}

    {tab === 'pricing' && <div className="stack">
      <Field label="Pricing model" name="pricingModel">{() => <select value={f.values.pricingModel} onChange={(e) => f.set('pricingModel', e.target.value as any)}>
        <option value="free">Free</option><option value="fixed">Fixed price</option><option value="custom">Custom programme agreement (priced per contract)</option>
      </select>}</Field>
      {f.values.pricingModel === 'fixed' && <Field label="Price (GHS)" name="priceGhs" required error={f.errors.priceGhs}>{(p) => <input {...p} value={f.values.priceGhs} onChange={(e) => f.set('priceGhs', e.target.value)} type="number" inputMode="decimal" min="0.01" step="0.01" />}</Field>}
      {f.values.pricingModel === 'custom' && <p className="small muted">The actual agreed amount is recorded on each contract, not here. This plan will show as “Priced by agreement” until a contract sets a figure.</p>}
      {f.values.pricingModel === 'fixed' && <Field label="Price confirmed for visitors" name="priceConfirmed" hint="While off, this plan's price shows publicly as “Pricing pending confirmation” instead of a figure — even if the plan is published. Turn this on only once the price above is approved to be seen.">{() => <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.priceConfirmed} onChange={(e) => f.set('priceConfirmed', e.target.checked)} />{f.values.priceConfirmed ? 'Confirmed — this price will show to visitors' : 'Not yet confirmed'}</label>}</Field>}
      <Field label="Billing interval (months)" name="intervalMonths" required error={f.errors.intervalMonths} hint="How often this plan is billed — independent of the support duration above.">{(p) => <input {...p} value={f.values.intervalMonths} onChange={(e) => f.set('intervalMonths', e.target.value)} type="number" min="1" max="60" step="1" />}</Field>
    </div>}

    {tab === 'review' && <div className="stack">
      <dl className="kv">
        <dt>Plan name</dt><dd>{f.values.name || '—'}</dd>
        <dt>Service tier</dt><dd>{TIERS.find((t) => t.value === f.values.serviceTier)?.label ?? '—'}</dd>
        <dt>Platforms</dt><dd>{f.values.platforms.length ? f.values.platforms.join(', ') : 'All platforms'}</dd>
        <dt>Features included</dt><dd>{Object.entries(f.values.entitlementMap).filter(([, e]) => e.enabled).map(([k]) => ENTITLEMENTS.find((e) => e.key === k)?.label).join(', ') || 'None selected yet'}</dd>
        <dt>Duration</dt><dd>{f.values.durationChoice ? `${f.values.durationChoice === 'custom' ? f.values.customDays : f.values.durationChoice} days` : 'No fixed duration'}</dd>
        <dt>Price</dt><dd>{f.values.pricingModel === 'free' ? 'Free' : f.values.pricingModel === 'custom' ? 'Priced by agreement' : (f.values.priceGhs ? `GHS ${f.values.priceGhs}` : '—')} every {f.values.intervalMonths} month(s)</dd>
        {f.values.pricingModel === 'fixed' && <><dt>Shown to visitors as</dt><dd>{f.values.priceConfirmed ? `GHS ${f.values.priceGhs || '—'}` : 'Pricing pending confirmation'}</dd></>}
      </dl>
      {!f.values.serviceTier && <p className="small" style={{ color: 'var(--warn)' }}>No service tier selected — this plan will be treated as legacy and won't appear grouped with the five tiers.</p>}
      {Object.values(f.values.entitlementMap).every((e) => !e.enabled) && <p className="small" style={{ color: 'var(--warn)' }}>No features are turned on yet — the plan will publish with an empty feature list.</p>}
      <p className="small muted">Saving here always keeps the plan a <strong>draft</strong> (new plan) or its current status (existing plan). Publish it from the plans list once you're ready for customers to see it.</p>
      <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{plan ? 'Save changes' : 'Save as draft'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
    </div>}

    {tab !== 'review' && <div className="form-actions"><Button type="button" onClick={() => setTab(['basic', 'features', 'duration', 'pricing', 'review'][['basic', 'features', 'duration', 'pricing', 'review'].indexOf(tab) + 1])}>Next</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>}
  </form>;
}
