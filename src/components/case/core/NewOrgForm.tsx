'use client';
import { api, ApiFail } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';
import { GHANA_REGIONS } from './shared';

type Created = { id: string; code: string; name: string };
const ORG_TYPE_LABEL: Record<string, string> = { SME: 'SME', AGRIFOOD: 'Agribusiness or food business', ESO: 'Enterprise support organisation' };

/** Register an organisation with recorded consent (POST /organisations). */
export function NewOrgForm({ onCreated, onCancel }: { onCreated: (o: Created) => void; onCancel: () => void }) {
  const f = useForm({ name: '', type: 'SME', sector: '', region: '', district: '', size: '', contactName: '', contactEmail: '', contactPhone: '', consent: false, consentBy: '' }, async (v) => {
    const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs.name = 'Enter at least 2 characters';
    if (!v.consent) errs.consent = 'Consent must be recorded before the organisation can be registered';
    if (v.consentBy.trim().length < 2) errs.consentBy = 'Enter the name of the person who gave consent';
    if (v.contactEmail && !/^\S+@\S+\.\S+$/.test(v.contactEmail)) errs.contactEmail = 'Enter a valid email';
    if (Object.keys(errs).length) throw new ApiFail(422, 'validation', 'Please correct the highlighted fields', errs);
    const body = { name: v.name.trim(), type: v.type, sector: v.sector, region: v.region, district: v.district, size: v.size, contactName: v.contactName, contactEmail: v.contactEmail, contactPhone: v.contactPhone, consent: v.consent, consentBy: v.consentBy.trim() };
    const r = await api.post<{ id: string; code: string }>('/organisations', body);
    return { ...r, name: v.name.trim() };
  }, { onDone: (r) => onCreated(r), success: 'Organisation registered' });
  const e = f.errors;
  const txt = (k: keyof typeof f.values) => ({ value: String(f.values[k] ?? ''), onChange: (ev: React.ChangeEvent<any>) => f.set(k, ev.target.value) });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Organisation name" name="name" required error={e.name}>{(p) => <input {...p} {...txt('name')} autoComplete="organization" />}</Field>
      <Field label="Type" name="type" error={e.type}>{(p) => <select {...p} {...txt('type')}>{Object.entries(ORG_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
      <Field label="Sector" name="sector" error={e.sector}>{(p) => <input {...p} {...txt('sector')} />}</Field>
      <Field label="Region" name="region" error={e.region}>{(p) => <select {...p} {...txt('region')}><option value="">Choose a region</option>{GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</select>}</Field>
      <Field label="District" name="district" error={e.district}>{(p) => <input {...p} {...txt('district')} />}</Field>
      <Field label="Size (number of staff)" name="size" error={e.size} hint="For example 1-10 or 11-50">{(p) => <input {...p} {...txt('size')} />}</Field>
      <Field label="Contact person" name="contactName" error={e.contactName}>{(p) => <input {...p} {...txt('contactName')} autoComplete="name" />}</Field>
      <Field label="Contact email" name="contactEmail" error={e.contactEmail}>{(p) => <input type="email" {...p} {...txt('contactEmail')} autoComplete="email" />}</Field>
      <Field label="Contact phone" name="contactPhone" error={e.contactPhone}>{(p) => <input type="tel" {...p} {...txt('contactPhone')} autoComplete="tel" />}</Field>
      <Field label="Consent given by" name="consentBy" required error={e.consentBy}>{(p) => <input {...p} {...txt('consentBy')} />}</Field>
    </div>
    <Field label="Consent" name="consent" required error={e.consent}>{(p) => <label className="row" style={{ gap: 8 }}><input type="checkbox" {...p} checked={f.values.consent} onChange={(ev) => f.set('consent', ev.target.checked)} />The organisation has agreed to the processing of its business data for diagnostics and reporting.</label>}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Register organisation</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
