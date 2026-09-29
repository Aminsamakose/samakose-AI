'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';

export type Programme = { id: string; code: string; name: string; funder: string | null; startDate: string | null; endDate: string | null; budgetGhs: string | null; status: string; cohortCount: number; caseCount: number };
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
  const form = useForm({ name: programme?.name ?? '', funder: programme?.funder ?? '', startDate: programme?.startDate ?? '', endDate: programme?.endDate ?? '', budgetGhs: programme?.budgetGhs ? String(Number(programme.budgetGhs)) : '', status: programme?.status ?? 'Draft' }, async (v) => {
    const body: Record<string, unknown> = { name: v.name, funder: v.funder, startDate: v.startDate || null, endDate: v.endDate || null, budgetGhs: v.budgetGhs.trim() === '' ? null : Number(v.budgetGhs) };
    if (editing) { if (v.status !== programme!.status) body.status = v.status; return api.patch(`/programmes/${programme!.id}`, body); }
    return api.post('/programmes', body);
  }, { onDone, success: editing ? 'Programme updated' : 'Programme created' });
  const e = { ...local, ...form.errors };
  const i = (k: any) => ({ ...form.input(k), onChange: (ev: React.ChangeEvent<any>) => { form.set(k, ev.target.value); setLocal((l) => { const n = { ...l }; delete n[k]; return n; }); } });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault(); const v = form.values; const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs.name = 'Enter at least 2 characters';
    if (v.budgetGhs.trim() !== '' && (!Number.isFinite(Number(v.budgetGhs)) || Number(v.budgetGhs) < 0)) errs.budgetGhs = 'Enter an amount of zero or more';
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
