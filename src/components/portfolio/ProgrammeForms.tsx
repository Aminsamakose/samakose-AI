'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';

export type Programme = { id: string; code: string; name: string; funder: string | null; startDate: string | null; endDate: string | null; budgetGhs: string | null; status: string; cohortCount: number; caseCount: number;
  summary?: string | null; objective?: string | null; eligibility?: string | null; sectors?: string[]; regions?: string[]; targetGroups?: string[]; targetBusinesses?: number | null; partners?: string | null; contactName?: string | null; contactEmail?: string | null; website?: string | null; logoMediaId?: string | null };
const list = (a?: string[]) => (a ?? []).join(', ');
const split = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);
export type Cohort = { id: string; code: string; name: string; startDate: string | null; endDate: string | null; capacity: number; status: string; enrolled: number };
const PROG_MOVES: Record<string, string[]> = { Draft: ['Active', 'Cancelled'], Active: ['Completed', 'Cancelled'], Completed: [], Cancelled: [] };
const COHORT_MOVES: Record<string, string[]> = { Draft: ['Open', 'Closed'], Open: ['Closed'], Closed: [] };

function useLocal() {
  const [local, setLocal] = useState<Record<string, string>>({});
  return { local, setLocal };
}

export function ProgrammeForm({ programme, onDone, onCancel }: { programme?: Programme; onDone: (r: any) => void; onCancel?: () => void }) {
  const editing = !!programme;
  const { local, setLocal } = useLocal();
  const form = useForm({ name: programme?.name ?? '', funder: programme?.funder ?? '', startDate: programme?.startDate ?? '', endDate: programme?.endDate ?? '', budgetGhs: programme?.budgetGhs ? String(Number(programme.budgetGhs)) : '', summary: programme?.summary ?? '', objective: programme?.objective ?? '', eligibility: programme?.eligibility ?? '', sectors: list(programme?.sectors), regions: list(programme?.regions), targetGroups: list(programme?.targetGroups), targetBusinesses: programme?.targetBusinesses == null ? '' : String(programme.targetBusinesses), partners: programme?.partners ?? '', contactName: programme?.contactName ?? '', contactEmail: programme?.contactEmail ?? '', website: programme?.website ?? '', status: programme?.status ?? 'Draft' }, async (v) => {
    const body: Record<string, unknown> = { name: v.name, funder: v.funder, startDate: v.startDate || null, endDate: v.endDate || null, budgetGhs: v.budgetGhs.trim() === '' ? null : Number(v.budgetGhs),
      summary: v.summary, objective: v.objective, eligibility: v.eligibility, sectors: split(v.sectors), regions: split(v.regions), targetGroups: split(v.targetGroups), targetBusinesses: v.targetBusinesses.trim() === '' ? null : Number(v.targetBusinesses), partners: v.partners, contactName: v.contactName, contactEmail: v.contactEmail, website: v.website };
    if (editing) { if (v.status !== programme!.status) body.status = v.status; return api.patch(`/programmes/${programme!.id}`, body); }
    return api.post('/programmes', body);
  }, { onDone, success: editing ? 'Programme updated' : 'Programme created' });
  const e = { ...local, ...form.errors };
  const i = (k: any) => ({ ...form.input(k), onChange: (ev: React.ChangeEvent<any>) => { form.set(k, ev.target.value); setLocal((l) => { const n = { ...l }; delete n[k]; return n; }); } });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault(); const v = form.values; const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs.name = 'Enter at least 2 characters';
    if (v.budgetGhs.trim() !== '' && (!Number.isFinite(Number(v.budgetGhs)) || Number(v.budgetGhs) < 0)) errs.budgetGhs = 'Enter an amount of zero or more';
    if (v.targetBusinesses.trim() !== '' && (!Number.isInteger(Number(v.targetBusinesses)) || Number(v.targetBusinesses) < 0)) errs.targetBusinesses = 'Enter a whole number of zero or more';
    if (v.website.trim() && !/^https:\/\//i.test(v.website.trim())) errs.website = 'Start with https://';
    if (v.startDate && v.endDate && v.endDate < v.startDate) errs.endDate = 'End date must be after the start date';
    setLocal(errs); if (Object.keys(errs).length) return; return form.onSubmit(ev);
  };
  const moves = editing ? PROG_MOVES[programme!.status] ?? [] : [];
  return <form onSubmit={submit} noValidate className="stack">
    <FormError message={form.formError} />
    <div className="form-grid">
      <Field label="Programme name" name="name" required error={e.name}>{(p) => <input {...p} {...i('name')} maxLength={160} />}</Field>
      <Field label="Funder" name="funder" error={e.funder}>{(p) => <input {...p} {...i('funder')} maxLength={200} />}</Field>
      <Field label="Start date" name="startDate" error={e.startDate}>{(p) => <input {...p} {...i('startDate')} type="date" />}</Field>
      <Field label="End date" name="endDate" error={e.endDate}>{(p) => <input {...p} {...i('endDate')} type="date" />}</Field>
      <Field label="Budget (GHS)" name="budgetGhs" error={e.budgetGhs}>{(p) => <input {...p} {...i('budgetGhs')} type="number" min={0} step="0.01" inputMode="decimal" />}</Field>
      <Field label="Target number of businesses" name="targetBusinesses" error={e.targetBusinesses} hint="How many businesses the programme aims to reach.">{(p) => <input {...p} {...i('targetBusinesses')} type="number" min={0} step="1" inputMode="numeric" />}</Field>
      <Field label="Website" name="website" error={e.website}>{(p) => <input {...p} {...i('website')} maxLength={300} placeholder="https://" />}</Field>
      <Field label="Contact person" name="contactName" error={e.contactName}>{(p) => <input {...p} {...i('contactName')} maxLength={120} />}</Field>
      <Field label="Contact email" name="contactEmail" error={e.contactEmail}>{(p) => <input {...p} {...i('contactEmail')} type="email" maxLength={200} />}</Field>
      <Field label="Sectors" name="sectors" hint="Separate with commas, for example Shea, Maize, Agro-processing.">{(p) => <input {...p} {...i('sectors')} />}</Field>
      <Field label="Regions or districts" name="regions" hint="Separate with commas, for example Northern, Savannah, Upper East.">{(p) => <input {...p} {...i('regions')} />}</Field>
      <Field label="Target groups" name="targetGroups" hint="Separate with commas, for example Women, Youth, Cooperatives.">{(p) => <input {...p} {...i('targetGroups')} />}</Field>
      <Field label="Implementing partners" name="partners" error={e.partners}>{(p) => <input {...p} {...i('partners')} maxLength={500} />}</Field>
    </div>
    <div className="stack">
      <Field label="Short summary" name="summary" error={e.summary} hint="One or two sentences shown in lists. Up to 300 characters.">{(p) => <textarea {...p} {...i('summary')} rows={2} maxLength={300} />}</Field>
      <Field label="Objective" name="objective" error={e.objective} hint="What the programme sets out to change.">{(p) => <textarea {...p} {...i('objective')} rows={4} maxLength={2000} />}</Field>
      <Field label="Who can take part" name="eligibility" error={e.eligibility} hint="Eligibility and selection rules.">{(p) => <textarea {...p} {...i('eligibility')} rows={3} maxLength={1500} />}</Field>
    </div>
    <div className="form-grid">
      {editing && <Field label="Status" name="status" error={e.status} hint={moves.length ? undefined : 'This status is final'}>{(p) => <select {...p} {...i('status')} disabled={!moves.length}><option>{programme!.status}</option>{moves.map((m) => <option key={m}>{m}</option>)}</select>}</Field>}
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={form.busy}>{editing ? 'Save changes' : 'Create programme'}</Button>{onCancel && <Button type="button" onClick={onCancel}>Cancel</Button>}</div>
  </form>;
}

export function CohortForm({ programmeId, cohort, onDone, onCancel }: { programmeId: string; cohort?: Cohort; onDone: (r: any) => void; onCancel?: () => void }) {
  const editing = !!cohort;
  const { local, setLocal } = useLocal();
  const form = useForm({ name: cohort?.name ?? '', startDate: cohort?.startDate ?? '', endDate: cohort?.endDate ?? '', capacity: cohort ? String(cohort.capacity) : '', status: cohort?.status ?? 'Draft' }, async (v) => {
    const body: Record<string, unknown> = { name: v.name, startDate: v.startDate || null, endDate: v.endDate || null, capacity: Number(v.capacity) };
    if (editing) { if (v.status !== cohort!.status) body.status = v.status; return api.patch(`/cohorts/${cohort!.id}`, body); }
    return api.post(`/programmes/${programmeId}/cohorts`, body);
  }, { onDone, success: editing ? 'Cohort updated' : 'Cohort added' });
  const e = { ...local, ...form.errors };
  const i = (k: any) => ({ ...form.input(k), onChange: (ev: React.ChangeEvent<any>) => { form.set(k, ev.target.value); setLocal((l) => { const n = { ...l }; delete n[k]; return n; }); } });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault(); const v = form.values; const errs: Record<string, string> = {}; const cap = Number(v.capacity);
    if (v.name.trim().length < 2) errs.name = 'Enter at least 2 characters';
    if (!Number.isInteger(cap) || cap < 1 || cap > 5000) errs.capacity = 'Enter a whole number from 1 to 5000';
    else if (cohort && cap < cohort.enrolled) errs.capacity = `${cohort.enrolled} businesses are already enrolled`;
    if (v.startDate && v.endDate && v.endDate < v.startDate) errs.endDate = 'End date must be after the start date';
    setLocal(errs); if (Object.keys(errs).length) return; return form.onSubmit(ev);
  };
  const moves = editing ? COHORT_MOVES[cohort!.status] ?? [] : [];
  return <form onSubmit={submit} noValidate className="stack">
    <FormError message={form.formError} />
    <div className="form-grid">
      <Field label="Cohort name" name="name" required error={e.name}>{(p) => <input {...p} {...i('name')} maxLength={160} />}</Field>
      <Field label="Capacity (businesses)" name="capacity" required error={e.capacity}>{(p) => <input {...p} {...i('capacity')} type="number" min={1} max={5000} step={1} inputMode="numeric" />}</Field>
      <Field label="Start date" name="startDate" error={e.startDate}>{(p) => <input {...p} {...i('startDate')} type="date" />}</Field>
      <Field label="End date" name="endDate" error={e.endDate}>{(p) => <input {...p} {...i('endDate')} type="date" />}</Field>
      {editing && <Field label="Status" name="status" error={e.status} hint={moves.length ? undefined : 'This status is final'}>{(p) => <select {...p} {...i('status')} disabled={!moves.length}><option>{cohort!.status}</option>{moves.map((m) => <option key={m}>{m}</option>)}</select>}</Field>}
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={form.busy}>{editing ? 'Save cohort' : 'Add cohort'}</Button>{onCancel && <Button type="button" onClick={onCancel}>Cancel</Button>}</div>
  </form>;
}


/** Shows the programme logo, or its initials when there is none. */
export function ProgrammeLogo({ programme, size = 48 }: { programme: Pick<Programme, 'name' | 'logoMediaId'>; size?: number }) {
  const initials = programme.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  if (programme.logoMediaId) return <img src={`/media/${programme.logoMediaId}`} alt={`${programme.name} logo`} width={size} height={size} style={{ objectFit: 'contain', borderRadius: 8, background: 'var(--surface, #fff)' }} />;
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2, #eef2f0)', fontWeight: 700, fontSize: size / 2.6 }}>{initials}</span>;
}

/** Upload or remove the logo. */
export function LogoEditor({ programme, onDone }: { programme: Programme; onDone: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const pick = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]; if (!f) return; setBusy(true); setErr(null);
    const fd = new FormData(); fd.set('file', f);
    try { await api.put(`/programmes/${programme.id}/logo`, fd); onDone(); } catch (e: any) { setErr(e?.message ?? 'Could not upload the logo'); } finally { setBusy(false); ev.target.value = ''; }
  };
  const remove = async () => { setBusy(true); setErr(null); try { await api.del(`/programmes/${programme.id}/logo`); onDone(); } catch (e: any) { setErr(e?.message ?? 'Could not remove the logo'); } finally { setBusy(false); } };
  return <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
    <ProgrammeLogo programme={programme} size={64} />
    <div className="stack" style={{ gap: 6 }}>
      <label className="small" htmlFor="logo-file">Logo (PNG, JPG or WebP, up to 8 MB)</label>
      <input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} disabled={busy} />
      {programme.logoMediaId && <div><Button size="sm" variant="ghost" onClick={remove} loading={busy}>Remove logo</Button></div>}
      {err && <div className="small" role="alert" style={{ color: 'var(--bad, #b00020)' }}>{err}</div>}
    </div>
  </div>;
}
