'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, useApi, useForm, useToast } from '@/components/ui';
import type { Indicator } from './ProgrammeDashboard';

const METRICS: [string, string][] = [['enrolled', 'Businesses enrolled'], ['scored', 'Businesses scored'], ['rescored', 'Businesses re-scored'], ['avg_score', 'Average health score (0 to 100)'], ['avg_change', 'Average score change (points)'], ['pct_improved', 'Re-scored businesses that improved (%)']];

const LEVELS: [string, string][] = [['impact', 'Impact (the long-term change)'], ['outcome', 'Outcome (the change you expect)'], ['output', 'Output (what the programme delivers)']];
const PARENT_OF: Record<string, string | null> = { impact: null, outcome: 'impact', output: 'outcome' };

function AddForm({ programmeId, rows, onDone, onCancel }: { programmeId: string; rows: Indicator[]; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ name: '', metric: 'avg_change', target: '', dueDate: '', note: '', level: 'output', parentId: '' },
    (v) => api.post(`/programmes/${programmeId}/indicators`, { name: v.name, metric: v.metric, target: Number(v.target), dueDate: v.dueDate || null, note: v.note || null, level: v.level, parentId: v.parentId || null }), { onDone, success: 'Target added' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Add a target">
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Name" name="name" error={f.errors.name}>{(p) => <input {...p} {...f.input('name')} placeholder="For example: Businesses improving their score" />}</Field>
      <Field label="Level" name="level" error={f.errors.level}>{(p) => <select {...p} value={f.values.level} onChange={(e) => { f.set('level', e.target.value); f.set('parentId', ''); }}>{LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
      {PARENT_OF[f.values.level] && <Field label={`Sits under (${PARENT_OF[f.values.level]})`} name="parentId" error={f.errors.parentId}>{(p) => <select {...p} {...f.input('parentId')}><option value="">Not linked yet</option>{rows.filter((r) => r.level === PARENT_OF[f.values.level]).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}</Field>}
      <Field label="Measure" name="metric" error={f.errors.metric}>{(p) => <select {...p} {...f.input('metric')}>{METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
      <Field label="Target" name="target" error={f.errors.target}>{(p) => <input {...p} {...f.input('target')} inputMode="decimal" />}</Field>
      <Field label="Due date (optional)" name="dueDate" error={f.errors.dueDate}>{(p) => <input {...p} {...f.input('dueDate')} type="date" />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Add target</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

/** Impact first, then each outcome under it, then each output under that. Anything not linked yet follows its level. */
function ordered(rows: Indicator[]) {
  const rank: Record<string, number> = { impact: 0, outcome: 1, output: 2 };
  const out: Indicator[] = []; const seen = new Set<string>();
  const add = (r: Indicator) => { if (seen.has(r.id)) return; seen.add(r.id); out.push(r); rows.filter((c) => c.parentId === r.id).forEach(add); };
  [...rows].sort((a, b) => (rank[a.level ?? 'output'] - rank[b.level ?? 'output'])).filter((r) => !r.parentId || !rows.some((p) => p.id === r.parentId)).forEach(add);
  return out;
}

/** Targets for one programme. Anyone who can edit the programme can add and remove them. Progress is worked out live from scores. */
export function IndicatorsPanel({ programmeId, canEdit }: { programmeId: string; canEdit: boolean }) {
  const st = useApi<Indicator[]>(`/programmes/${programmeId}/indicators`); const toast = useToast(); const [adding, setAdding] = useState(false);
  return <Card title="Targets" actions={canEdit && !adding ? <Button variant="primary" onClick={() => setAdding(true)}>Add target</Button> : undefined}>
    {adding && <AddForm programmeId={programmeId} rows={st.data ?? []} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); st.reload(); }} />}
    <Async state={st}>{(rows) => rows.length === 0 ? <Empty title="No targets yet" hint={canEdit ? 'Set a target such as "60% of re-scored businesses improve". Progress is worked out from scores.' : undefined} /> :
      <div className="table-wrap"><table><thead><tr><th>Target</th><th className="r">Now</th><th className="r">Goal</th><th className="r">Progress</th><th>Status</th>{canEdit && <th><span className="sr">Actions</span></th>}</tr></thead>
        <tbody>{ordered(rows).map((x) => <tr key={x.id}><td style={{ paddingLeft: x.level === 'output' ? 24 : x.level === 'outcome' ? 12 : undefined }}><Badge>{x.level ?? 'output'}</Badge> {x.name}<div className="small muted">{x.metricLabel}{x.dueDate ? ` · due ${x.dueDate}` : ''}</div></td><td className="r num">{x.value ?? '-'}</td><td className="r num">{x.target}{x.unit === '%' ? '%' : ''}</td><td className="r num">{x.pct === null ? '-' : `${x.pct}%`}</td>
          <td><Badge tone={x.status === 'Achieved' ? 'ok' : x.status === 'Missed' ? 'bad' : ''}>{x.status}</Badge></td>
          {canEdit && <td><ConfirmButton size="sm" label="Remove" message={`Remove the target "${x.name}"?`} onConfirm={async () => { await api.del(`/indicators/${x.id}`); toast('Target removed'); st.reload(); }} /></td>}</tr>)}</tbody></table></div>}</Async>
  </Card>;
}
