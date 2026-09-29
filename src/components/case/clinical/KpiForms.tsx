'use client';
import { api, ApiFail } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';
import { today } from './common';

export type Kpi = {
  id: string; code: string; name: string; unit: string | null; baseline: number | null; target: number | null; progress: number | null;
  readings: { id: string; value: number; date: string; sourceClass: string }[]; latest: { value: number; date: string; sourceClass: string } | null;
};
const num = (s: string, label: string, e: Record<string, string>, key: string) => {
  if (s.trim() === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) { e[key] = `${label} must be a number`; return null; }
  return n;
};

export function KpiForm({ caseId, kpi, onDone, onCancel }: { caseId: string; kpi?: Kpi; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ name: kpi?.name ?? '', unit: kpi?.unit ?? '', baseline: kpi?.baseline?.toString() ?? '', target: kpi?.target?.toString() ?? '' }, async (v) => {
    const e: Record<string, string> = {};
    if (v.name.trim().length < 2) e.name = 'Enter a name of at least 2 characters';
    const baseline = num(v.baseline, 'Baseline', e, 'baseline'), target = num(v.target, 'Target', e, 'target');
    if (Object.keys(e).length) throw new ApiFail(400, 'validation_failed', 'Please fix the highlighted fields', e);
    const body = { name: v.name.trim(), unit: v.unit.trim() || null, baseline, target };
    return kpi ? api.patch(`/kpis/${kpi.id}`, body) : api.post(`/cases/${caseId}/kpis`, body);
  }, { success: kpi ? 'Indicator updated' : 'Indicator added', onDone });
  return <form className="stack" onSubmit={f.onSubmit} noValidate>
    <FormError message={f.formError} />
    <Field label="Indicator name" name="name" required error={f.errors.name}>{(p) => <input {...p} {...f.input('name')} />}</Field>
    <div className="form-grid">
      <Field label="Unit" name="unit" error={f.errors.unit} hint="For example GHS, %, kg">{(p) => <input {...p} {...f.input('unit')} />}</Field>
      <Field label="Baseline" name="baseline" error={f.errors.baseline}>{(p) => <input {...p} inputMode="decimal" {...f.input('baseline')} />}</Field>
      <Field label="Target" name="target" error={f.errors.target}>{(p) => <input {...p} inputMode="decimal" {...f.input('target')} />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{kpi ? 'Save' : 'Add indicator'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

const CLASSES = ['Self-reported', 'Document-supported', 'Verified', 'Unverified'];
export function ReadingForm({ kpi, staff, onDone, onCancel }: { kpi: Kpi; staff: boolean; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ value: '', readingDate: today(), sourceClass: 'Self-reported' }, async (v) => {
    const e: Record<string, string> = {};
    const value = num(v.value, 'Value', e, 'value');
    if (v.value.trim() === '') e.value = 'Enter the value';
    if (!v.readingDate) e.readingDate = 'Choose the date'; else if (v.readingDate > today()) e.readingDate = 'A reading cannot be dated in the future';
    if (Object.keys(e).length) throw new ApiFail(400, 'validation_failed', 'Please fix the highlighted fields', e);
    return api.post(`/kpis/${kpi.id}/readings`, { value, readingDate: v.readingDate, ...(staff ? { sourceClass: v.sourceClass } : {}) });
  }, { success: 'Reading recorded', onDone });
  return <form className="stack" onSubmit={f.onSubmit} noValidate>
    <FormError message={f.formError} />
    <p className="small muted">Readings cannot be edited once saved. Check the value before you save.</p>
    <div className="form-grid">
      <Field label={`Value${kpi.unit ? ` (${kpi.unit})` : ''}`} name="value" required error={f.errors.value}>{(p) => <input {...p} inputMode="decimal" {...f.input('value')} />}</Field>
      <Field label="Date of reading" name="readingDate" required error={f.errors.readingDate}>{(p) => <input {...p} type="date" max={today()} {...f.input('readingDate')} />}</Field>
      {staff ? <Field label="Source" name="sourceClass" error={f.errors.sourceClass}>{(p) => <select {...p} {...f.input('sourceClass')}>{CLASSES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
        : <Field label="Source" name="src" hint="Readings you enter are recorded as self-reported.">{(p) => <input {...p} value="Self-reported" readOnly />}</Field>}
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save reading</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
