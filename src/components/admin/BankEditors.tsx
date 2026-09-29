'use client';
import { useMemo, useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Async, Badge, Button, ConfirmButton, Empty, Field, FormError, Modal, useApi, useForm, useToast } from '@/components/ui';
import { DIMENSIONS, fieldFail } from './common';

const tx = (f: { values: Record<string, any>; set: (k: any, v: any) => void }, k: string) => ({ value: String(f.values[k] ?? ''), onChange: (e: React.ChangeEvent<any>) => f.set(k, e.target.value) });
const intIn = (s: string, lo: number, hi: number) => /^-?\d+$/.test(s.trim()) && Number(s) >= lo && Number(s) <= hi;
const DimSelect = ({ p, value, onChange }: { p: any; value: string; onChange: (v: string) => void }) => <select {...p} value={value} onChange={(e) => onChange(e.target.value)}>{DIMENSIONS.map((d) => <option key={d}>{d}</option>)}</select>;

function useSetActive(base: string, reload: () => void) {
  const toast = useToast();
  return async (id: string, active: boolean) => {
    try { await api.patch(`${base}/${id}`, { active }); toast(active ? 'Restored' : 'Retired'); reload(); } catch (e) { toast(errText(e), 'bad'); }
  };
}

/* ------------------------------- questions ------------------------------ */
type Q = { id: string; code: string; dimension: string; text: string; weight: number; sort: number; active: boolean };

function QuestionForm({ q, onDone }: { q: Q | null; onDone: () => void }) {
  const f = useForm({ code: q?.code ?? '', dimension: q?.dimension ?? DIMENSIONS[0], text: q?.text ?? '', weight: String(q?.weight ?? 1), sort: String(q?.sort ?? 0), active: q?.active ?? true }, async (v) => {
    const e: Record<string, string> = {};
    if (!q && !/^Q\d{2,3}$/i.test(v.code.trim())) e.code = 'Use a code like Q19';
    if (v.text.trim().length < 5) e.text = 'Enter at least 5 characters'; else if (v.text.trim().length > 300) e.text = 'Use 300 characters or fewer';
    if (!intIn(v.weight, 1, 5)) e.weight = 'Use a whole number from 1 to 5';
    if (!intIn(v.sort, -100000, 100000)) e.sort = 'Use a whole number';
    if (Object.keys(e).length) throw fieldFail(e);
    const body = { dimension: v.dimension, text: v.text.trim(), weight: Number(v.weight), sort: Number(v.sort) };
    return q ? api.patch(`/settings/questions/${q.id}`, { ...body, active: v.active }) : api.post('/settings/questions', { ...body, code: v.code.trim().toUpperCase() });
  }, { success: q ? 'Question saved' : 'Question added', onDone });
  return <form onSubmit={f.onSubmit} noValidate className="stack">
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Code" name="code" error={f.errors.code} required hint={q ? 'The code cannot be changed.' : 'For example Q19. Codes must be unique.'}>{(p) => <input {...p} {...tx(f, 'code')} disabled={!!q} />}</Field>
      <Field label="Dimension" name="dimension" error={f.errors.dimension} required>{(p) => <DimSelect p={p} value={f.values.dimension} onChange={(v) => f.set('dimension', v)} />}</Field>
      <Field label="Weight" name="weight" error={f.errors.weight} required hint="1 (low) to 5 (high). Sets how much this question moves the dimension score.">{(p) => <input {...p} inputMode="numeric" {...tx(f, 'weight')} />}</Field>
      <Field label="Display order" name="sort" error={f.errors.sort} hint="Lower numbers appear first.">{(p) => <input {...p} inputMode="numeric" {...tx(f, 'sort')} />}</Field>
    </div>
    <Field label="Question text" name="text" error={f.errors.text} required hint="5 to 300 characters.">{(p) => <textarea {...p} {...tx(f, 'text')} />}</Field>
    {q && <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.values.active} onChange={(e) => f.set('active', e.target.checked)} />Active (shown in new diagnostics)</label>}
    <div className="form-actions"><Button type="submit" variant="primary" loading={f.busy}>{q ? 'Save question' : 'Add question'}</Button></div>
  </form>;
}

export function QuestionsEditor({ canCreate, canEdit }: { canCreate: boolean; canEdit: boolean }) {
  const st = useApi<Q[]>('/settings/questions');
  const setActive = useSetActive('/settings/questions', st.reload);
  const [edit, setEdit] = useState<Q | 'new' | null>(null);
  const [dim, setDim] = useState(''); const [state, setState] = useState(''); const [term, setTerm] = useState('');
  const rows = useMemo(() => (st.data ?? []).filter((r) => (!dim || r.dimension === dim) && (!state || String(r.active) === state) && (!term || `${r.code} ${r.text}`.toLowerCase().includes(term.toLowerCase()))), [st.data, dim, state, term]);
  const done = () => { setEdit(null); st.reload(); };
  return <div className="stack">
    <div className="toolbar">
      <div className="search-box"><label className="sr" htmlFor="qs">Search questions</label><input id="qs" type="search" placeholder="Search code or text" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
      <div className="field"><label htmlFor="qd">Dimension</label><select id="qd" value={dim} onChange={(e) => setDim(e.target.value)}><option value="">All dimensions</option>{DIMENSIONS.map((d) => <option key={d}>{d}</option>)}</select></div>
      <div className="field"><label htmlFor="qa">Status</label><select id="qa" value={state} onChange={(e) => setState(e.target.value)}><option value="">Active and retired</option><option value="true">Active</option><option value="false">Retired</option></select></div>
      {canCreate && <Button className="right" variant="primary" onClick={() => setEdit('new')}>Add question</Button>}
    </div>
    <Async state={st} empty={(d) => d.length === 0}>{() => rows.length === 0 ? <Empty title="No questions match" hint="Clear the search or filters." /> :
      <div className="table-wrap"><table>
        <thead><tr><th>Code</th><th>Dimension</th><th>Question</th><th className="r">Weight</th><th>Order</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td className="mono">{r.code}</td><td>{r.dimension}</td><td style={{ minWidth: 220 }}>{r.text}</td><td className="r num">{r.weight}</td><td className="num">{r.sort}</td>
          <td><Badge tone={r.active ? 'ok' : 'bad'}>{r.active ? 'Active' : 'Retired'}</Badge></td>
          {canEdit && <td><span className="row"><Button size="sm" onClick={() => setEdit(r)}>Edit</Button>
            {r.active ? <ConfirmButton size="sm" label="Retire" variant="danger" message={`Retire ${r.code}? It will no longer appear in new diagnostics. Existing answers are kept.`} onConfirm={() => api.patch(`/settings/questions/${r.id}`, { active: false }).then(st.reload)} />
              : <Button size="sm" onClick={() => setActive(r.id, true)}>Restore</Button>}</span></td>}
        </tr>)}</tbody></table></div>}</Async>
    <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add a question' : `Edit ${edit?.code ?? ''}`}>{edit !== null && <QuestionForm q={edit === 'new' ? null : edit} onDone={done} />}</Modal>
  </div>;
}

/* -------------------------------- library ------------------------------- */
type L = { id: string; code: string; title: string; dimension: string; description: string; typicalDays: number; kpiHint: string | null; active: boolean };

function LibraryForm({ item, onDone }: { item: L | null; onDone: () => void }) {
  const f = useForm({ code: item?.code ?? '', title: item?.title ?? '', dimension: item?.dimension ?? DIMENSIONS[0], description: item?.description ?? '', typicalDays: String(item?.typicalDays ?? 30), kpiHint: item?.kpiHint ?? '', active: item?.active ?? true }, async (v) => {
    const e: Record<string, string> = {};
    if (!item && !/^IVL-\d{3}$/i.test(v.code.trim())) e.code = 'Use a code like IVL-011';
    if (v.title.trim().length < 3 || v.title.trim().length > 120) e.title = 'Use 3 to 120 characters';
    if (v.description.trim().length < 10 || v.description.trim().length > 500) e.description = 'Use 10 to 500 characters';
    if (!intIn(v.typicalDays, 1, 365)) e.typicalDays = 'Use whole days from 1 to 365';
    if (v.kpiHint.trim().length > 120) e.kpiHint = 'Use 120 characters or fewer';
    if (Object.keys(e).length) throw fieldFail(e);
    const body = { title: v.title.trim(), dimension: v.dimension, description: v.description.trim(), typicalDays: Number(v.typicalDays), kpiHint: v.kpiHint.trim() };
    return item ? api.patch(`/settings/library/${item.id}`, { ...body, active: v.active }) : api.post('/settings/library', { ...body, code: v.code.trim().toUpperCase() });
  }, { success: item ? 'Intervention saved' : 'Intervention added', onDone });
  return <form onSubmit={f.onSubmit} noValidate className="stack">
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Code" name="code" error={f.errors.code} required hint={item ? 'The code cannot be changed.' : 'For example IVL-011. Codes must be unique.'}>{(p) => <input {...p} {...tx(f, 'code')} disabled={!!item} />}</Field>
      <Field label="Dimension" name="dimension" error={f.errors.dimension} required>{(p) => <DimSelect p={p} value={f.values.dimension} onChange={(v) => f.set('dimension', v)} />}</Field>
      <Field label="Typical duration (days)" name="typicalDays" error={f.errors.typicalDays} required>{(p) => <input {...p} inputMode="numeric" {...tx(f, 'typicalDays')} />}</Field>
      <Field label="KPI hint" name="kpiHint" error={f.errors.kpiHint} hint="Optional. The measure that shows this intervention worked.">{(p) => <input {...p} {...tx(f, 'kpiHint')} />}</Field>
    </div>
    <Field label="Title" name="title" error={f.errors.title} required>{(p) => <input {...p} {...tx(f, 'title')} />}</Field>
    <Field label="Description" name="description" error={f.errors.description} required hint="10 to 500 characters. Shown when a prescription is built.">{(p) => <textarea {...p} {...tx(f, 'description')} />}</Field>
    {item && <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.values.active} onChange={(e) => f.set('active', e.target.checked)} />Active (available for new prescriptions)</label>}
    <div className="form-actions"><Button type="submit" variant="primary" loading={f.busy}>{item ? 'Save intervention' : 'Add intervention'}</Button></div>
  </form>;
}

export function LibraryEditor({ canCreate, canEdit }: { canCreate: boolean; canEdit: boolean }) {
  const st = useApi<L[]>('/settings/library');
  const setActive = useSetActive('/settings/library', st.reload);
  const [edit, setEdit] = useState<L | 'new' | null>(null);
  const [dim, setDim] = useState(''); const [state, setState] = useState(''); const [term, setTerm] = useState('');
  const rows = useMemo(() => (st.data ?? []).filter((r) => (!dim || r.dimension === dim) && (!state || String(r.active) === state) && (!term || `${r.code} ${r.title} ${r.description}`.toLowerCase().includes(term.toLowerCase()))), [st.data, dim, state, term]);
  const done = () => { setEdit(null); st.reload(); };
  return <div className="stack">
    <div className="toolbar">
      <div className="search-box"><label className="sr" htmlFor="ls">Search library</label><input id="ls" type="search" placeholder="Search code, title or description" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
      <div className="field"><label htmlFor="ld">Dimension</label><select id="ld" value={dim} onChange={(e) => setDim(e.target.value)}><option value="">All dimensions</option>{DIMENSIONS.map((d) => <option key={d}>{d}</option>)}</select></div>
      <div className="field"><label htmlFor="la">Status</label><select id="la" value={state} onChange={(e) => setState(e.target.value)}><option value="">Active and retired</option><option value="true">Active</option><option value="false">Retired</option></select></div>
      {canCreate && <Button className="right" variant="primary" onClick={() => setEdit('new')}>Add intervention</Button>}
    </div>
    <Async state={st} empty={(d) => d.length === 0}>{() => rows.length === 0 ? <Empty title="No interventions match" hint="Clear the search or filters." /> :
      <div className="table-wrap"><table>
        <thead><tr><th>Code</th><th>Title</th><th>Dimension</th><th className="r">Days</th><th>KPI hint</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td className="mono">{r.code}</td><td style={{ minWidth: 220 }}><strong>{r.title}</strong><div className="small muted">{r.description}</div></td><td>{r.dimension}</td><td className="r num">{r.typicalDays}</td><td>{r.kpiHint ?? '-'}</td>
          <td><Badge tone={r.active ? 'ok' : 'bad'}>{r.active ? 'Active' : 'Retired'}</Badge></td>
          {canEdit && <td><span className="row"><Button size="sm" onClick={() => setEdit(r)}>Edit</Button>
            {r.active ? <ConfirmButton size="sm" label="Retire" variant="danger" message={`Retire ${r.code}? It will no longer be offered in new prescriptions. Existing prescriptions keep it.`} onConfirm={() => api.patch(`/settings/library/${r.id}`, { active: false }).then(st.reload)} />
              : <Button size="sm" onClick={() => setActive(r.id, true)}>Restore</Button>}</span></td>}
        </tr>)}</tbody></table></div>}</Async>
    <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add an intervention' : `Edit ${edit?.code ?? ''}`}>{edit !== null && <LibraryForm item={edit === 'new' ? null : edit} onDone={done} />}</Modal>
  </div>;
}
