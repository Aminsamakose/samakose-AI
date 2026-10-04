'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';
import { ORG_TYPES, REGIONS, SECTORS, SIZES } from './shared';

export type OrgRow = { id: string; name: string; type: string; sector: string | null; region: string | null; district: string | null; size: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null; status: string; registrationNumber?: string | null; tin?: string | null };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create (no org) or edit (org given). Owners can only change contact details, as the API enforces. */
export function OrgForm({ org, ownerOnly, onDone, onCancel }: { org?: OrgRow; ownerOnly?: boolean; onDone: (r: any) => void; onCancel?: () => void }) {
  const editing = !!org;
  const form = useForm({
    name: org?.name ?? '', type: org?.type ?? 'SME', sector: org?.sector ?? '', region: org?.region ?? '', district: org?.district ?? '', size: org?.size ?? '',
    contactName: org?.contactName ?? '', contactEmail: org?.contactEmail ?? '', contactPhone: org?.contactPhone ?? '', registrationNumber: org?.registrationNumber ?? '', tin: org?.tin ?? '', status: org?.status ?? 'Active', consent: false, consentBy: ''
  }, async (v) => {
    const contact = { contactName: v.contactName, contactEmail: v.contactEmail, contactPhone: v.contactPhone };
    if (editing) return api.patch(`/organisations/${org!.id}`, ownerOnly ? contact : { name: v.name, type: v.type, sector: v.sector, region: v.region, district: v.district, size: v.size, registrationNumber: v.registrationNumber, tin: v.tin, ...contact, ...(org!.status === 'Archived' ? {} : { status: v.status }) });
    return api.post('/organisations', { name: v.name, type: v.type, sector: v.sector, region: v.region, district: v.district, size: v.size, registrationNumber: v.registrationNumber, tin: v.tin, ...contact, consent: v.consent, consentBy: v.consentBy });
  }, { onDone, success: editing ? 'Organisation updated' : 'Organisation registered' });
  const [local, setLocal] = useState<Record<string, string>>({});
  const e = { ...local, ...form.errors };
  const i = (k: any) => ({ value: String(form.values[k as keyof typeof form.values] ?? ''), onChange: (ev: React.ChangeEvent<any>) => { form.set(k, ev.target.value); setLocal((l) => { const n = { ...l }; delete n[k]; return n; }); } });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const v = form.values; const errs: Record<string, string> = {};
    if (!ownerOnly && v.name.trim().length < 2) errs.name = 'Enter at least 2 characters';
    if (v.contactEmail && !EMAIL.test(v.contactEmail.trim())) errs.contactEmail = 'Enter a valid email';
    if (!editing) { if (!v.consent) errs.consent = 'Consent to process the organisation’s data must be recorded'; if (v.consentBy.trim().length < 2) errs.consentBy = 'Enter the name of the person who gave consent'; }
    setLocal(errs);
    if (Object.keys(errs).length) return;
    return form.onSubmit(ev);
  };
  const dis = ownerOnly;
  return <form onSubmit={submit} noValidate className="stack">
    <FormError message={form.formError} />
    <div className="form-grid">
      <Field label="Organisation name" name="name" required error={e.name}>{(p) => <input {...p} {...i('name')} disabled={dis} maxLength={160} autoComplete="organization" />}</Field>
      <Field label="Type" name="type" error={e.type}>{(p) => <select {...p} {...i('type')} disabled={dis}>{ORG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>}</Field>
      <Field label="Sector" name="sector" error={e.sector} hint="Choose a suggestion or type your own">{(p) => <><input {...p} {...i('sector')} disabled={dis} list="sector-list" maxLength={200} /><datalist id="sector-list">{SECTORS.map((s) => <option key={s} value={s} />)}</datalist></>}</Field>
      <Field label="Region" name="region" error={e.region}>{(p) => <select {...p} {...i('region')} disabled={dis}><option value="">Not set</option>{org?.region && !REGIONS.includes(org.region) && <option value={org.region}>{org.region}</option>}{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>}</Field>
      <Field label="District" name="district" error={e.district}>{(p) => <input {...p} {...i('district')} disabled={dis} maxLength={200} />}</Field>
      <Field label="Size (number of people)" name="size" error={e.size}>{(p) => <select {...p} {...i('size')} disabled={dis}><option value="">Not set</option>{org?.size && !SIZES.includes(org.size) && <option value={org.size}>{org.size}</option>}{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select>}</Field>
      <Field label="Registration number" name="registrationNumber" error={e.registrationNumber} hint="Registrar General or cooperative number">{(p) => <input {...p} {...i('registrationNumber')} disabled={dis} maxLength={40} autoComplete="off" />}</Field>
      <Field label="Tax identification number (TIN)" name="tin" error={e.tin} hint="5 to 20 characters. Used to spot duplicates">{(p) => <input {...p} {...i('tin')} disabled={dis} maxLength={20} autoComplete="off" />}</Field>
      <Field label="Contact person" name="contactName" error={e.contactName}>{(p) => <input {...p} {...i('contactName')} maxLength={200} autoComplete="off" />}</Field>
      <Field label="Contact email" name="contactEmail" error={e.contactEmail}>{(p) => <input {...p} {...i('contactEmail')} type="email" maxLength={200} autoComplete="off" />}</Field>
      <Field label="Contact phone" name="contactPhone" error={e.contactPhone}>{(p) => <input {...p} {...i('contactPhone')} type="tel" maxLength={40} autoComplete="off" />}</Field>
      {editing && !ownerOnly && org!.status !== 'Archived' && <Field label="Status" name="status" error={e.status}>{(p) => <select {...p} {...i('status')}><option>Active</option><option>Inactive</option></select>}</Field>}
    </div>
    {!editing && <fieldset className="stack" style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 12 }}>
      <legend>Consent</legend>
      <Field label="Consent given by" name="consentBy" required error={e.consentBy} hint="Full name of the person who agreed on behalf of the organisation">{(p) => <input {...p} {...i('consentBy')} maxLength={160} />}</Field>
      <div className="field"><label><input type="checkbox" name="consent" checked={form.values.consent} onChange={(ev) => { form.set('consent', ev.target.checked); setLocal((l) => { const n = { ...l }; delete n.consent; return n; }); }} aria-invalid={e.consent ? true : undefined} aria-describedby={e.consent ? 'consent-err' : undefined} /> The organisation has agreed to Samakose Accelerator Lab processing its business data for diagnostics and programme reporting.</label>
        {e.consent && <span className="err" id="consent-err" role="alert">{e.consent}</span>}</div>
    </fieldset>}
    <div className="form-actions"><Button variant="primary" type="submit" loading={form.busy}>{editing ? 'Save changes' : 'Register organisation'}</Button>{onCancel && <Button type="button" onClick={onCancel}>Cancel</Button>}</div>
  </form>;
}
