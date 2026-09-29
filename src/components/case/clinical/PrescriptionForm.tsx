'use client';
import { ApiFail, api } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';
import { ErrorList } from './common';

export type Lib = { code: string; title: string; dimension: string; description: string; typicalDays: number; kpiHint: string | null; active: boolean };
export type RxItem = { library_id: string; title?: string; dimension?: string; kpi_ids?: string[]; actions: { text: string; owner_role: string; deadline_days: number }[] };
export type Rx = {
  id: string; code: string; version: number; status: string; current: boolean; aiDrafted: boolean; createdAt: string; createdBy: string | null;
  reviewerNote: string | null; items: RxItem[];
};
type Draft = { library_id: string; title: string; kpi_ids?: string[]; actions: { text: string; owner_role: string; deadline_days: string }[] };
const blank = (l?: Lib): Draft => ({ library_id: l?.code ?? '', title: l?.title ?? '', actions: [{ text: '', owner_role: 'OWNER', deadline_days: String(l?.typicalDays ?? 14) }] });

/** Write a prescription by hand, or save an edited copy of one as a new version. Items must come from the approved library. */
export default function PrescriptionForm({ caseId, from, library, onDone, onCancel }: { caseId: string; from?: Rx; library: Lib[] | null; onDone: () => void; onCancel: () => void }) {
  const active = (library ?? []).filter((l) => l.active);
  const f = useForm<{ items: Draft[] }>({
    items: from ? from.items.map((i) => ({ library_id: i.library_id, title: i.title ?? i.library_id, kpi_ids: i.kpi_ids, actions: i.actions.map((a) => ({ ...a, deadline_days: String(a.deadline_days) })) })) : [blank(active[0])]
  }, async (v) => {
    const e: Record<string, string> = {};
    if (!v.items.length) e.items = 'Add at least one intervention';
    v.items.forEach((it, i) => {
      if (!it.library_id) e[`lib${i}`] = 'Choose an intervention';
      it.actions.forEach((a, j) => {
        if (a.text.trim().length < 3) e[`text${i}-${j}`] = 'Describe the action';
        const d = Number(a.deadline_days);
        if (!Number.isInteger(d) || d < 1) e[`days${i}-${j}`] = 'Enter a whole number of days';
      });
    });
    if (Object.keys(e).length) throw new ApiFail(400, 'validation_failed', 'Please fix the highlighted fields', e);
    const items = v.items.map((it) => ({ library_id: it.library_id, ...(it.kpi_ids?.length ? { kpi_ids: it.kpi_ids } : {}), actions: it.actions.map((a) => ({ text: a.text.trim(), owner_role: a.owner_role, deadline_days: Number(a.deadline_days) })) }));
    return from ? api.post(`/prescriptions/${from.id}/revise`, { items }) : api.post(`/cases/${caseId}/prescriptions`, { items });
  }, { success: from ? 'New version saved' : 'Prescription saved', onDone });
  const items = f.values.items;
  const setItem = (i: number, p: Partial<Draft>) => f.set('items', items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setAct = (i: number, j: number, p: Partial<Draft['actions'][number]>) => setItem(i, { actions: items[i].actions.map((a, k) => (k === j ? { ...a, ...p } : a)) });
  const used = new Set(items.map((i) => i.library_id));
  const canAdd = active.some((l) => !used.has(l.code)) && items.length < 12;
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    {items.map((it, i) => <fieldset key={i} className="card stack" style={{ padding: 12, margin: 0 }}>
      <legend><strong>Intervention {i + 1}</strong></legend>
      {library ? <Field label="Intervention from the approved library" name={`lib${i}`} required error={f.errors[`lib${i}`]}>{(p) =>
        <select {...p} value={it.library_id} onChange={(e) => { const l = active.find((x) => x.code === e.target.value); setItem(i, { library_id: e.target.value, title: l?.title ?? '' }); }}>
          <option value="">Choose</option>
          {active.filter((l) => l.code === it.library_id || !used.has(l.code)).map((l) => <option key={l.code} value={l.code}>{l.code} {l.title} ({l.dimension})</option>)}
          {it.library_id && !active.some((l) => l.code === it.library_id) && <option value={it.library_id}>{it.library_id} {it.title}</option>}
        </select>}</Field>
        : <p><span className="mono">{it.library_id}</span> {it.title}</p>}
      {it.actions.map((a, j) => <div key={j} className="form-grid" style={{ alignItems: 'end' }}>
        <Field label={`Action ${j + 1}`} name={`text${i}-${j}`} required error={f.errors[`text${i}-${j}`]}>{(p) => <input {...p} value={a.text} onChange={(e) => setAct(i, j, { text: e.target.value })} />}</Field>
        <Field label="Owner" name={`own${i}-${j}`}>{(p) => <select {...p} value={a.owner_role} onChange={(e) => setAct(i, j, { owner_role: e.target.value })}><option value="OWNER">Business owner</option><option value="COACH">Coach</option><option value="CONSULTANT">Consultant</option></select>}</Field>
        <Field label="Days to complete" name={`days${i}-${j}`} required error={f.errors[`days${i}-${j}`]}>{(p) => <input {...p} type="number" min={1} step={1} inputMode="numeric" value={a.deadline_days} onChange={(e) => setAct(i, j, { deadline_days: e.target.value })} />}</Field>
        {it.actions.length > 1 && <div><Button size="sm" type="button" onClick={() => setItem(i, { actions: it.actions.filter((_, k) => k !== j) })}>Remove action {j + 1}</Button></div>}
      </div>)}
      <div className="row">
        {it.actions.length < 10 && <Button size="sm" type="button" onClick={() => setItem(i, { actions: [...it.actions, { text: '', owner_role: 'OWNER', deadline_days: '14' }] })}>Add an action</Button>}
        {items.length > 1 && <Button size="sm" type="button" onClick={() => f.set('items', items.filter((_, k) => k !== i))}>Remove intervention {i + 1}</Button>}
      </div>
    </fieldset>)}
    {canAdd && <div><Button size="sm" type="button" onClick={() => f.set('items', [...items, blank(active.find((l) => !used.has(l.code)))])}>Add an intervention</Button></div>}
    <ErrorList errors={f.errors} skip={items.flatMap((it, i) => [`lib${i}`, ...it.actions.flatMap((_, j) => [`text${i}-${j}`, `days${i}-${j}`])])} />
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{from ? 'Save as new version' : 'Save prescription'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
