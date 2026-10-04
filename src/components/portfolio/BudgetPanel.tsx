'use client';
import { useState } from 'react';
import { api, dateFmt, ghs } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, KV, useApi, useForm, useToast } from '@/components/ui';

type Line = { id: string; category: string; description: string | null; amountGhs: number; share: number | null };
type Tranche = { id: string; label: string; amountGhs: number; dueDate: string | null; status: string; receivedOn: string | null; receivedGhs: number | null; overdue: boolean };
type Overview = { position: { budget: number | null; allocated: number; unallocated: number | null; plannedTranches: number; unscheduled: number | null; received: number; outstanding: number; overdueTranches: number }; lines: Line[]; tranches: Tranche[] };

function LineForm({ programmeId, onDone, onCancel }: { programmeId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ category: '', amountGhs: '', description: '' }, (v) => api.post(`/programmes/${programmeId}/budget-lines`, { category: v.category, amountGhs: Number(v.amountGhs), description: v.description || null }), { onDone, success: 'Budget line added' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Add a budget line"><FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Category" name="category" error={f.errors.category}>{(p) => <input {...p} {...f.input('category')} placeholder="For example: Coaching and mentoring" />}</Field>
      <Field label="Amount (GHS)" name="amountGhs" error={f.errors.amountGhs}>{(p) => <input {...p} {...f.input('amountGhs')} inputMode="decimal" />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Add line</Button><Button type="button" onClick={onCancel}>Cancel</Button></div></form>;
}
function TrancheForm({ programmeId, onDone, onCancel }: { programmeId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ label: '', amountGhs: '', dueDate: '' }, (v) => api.post(`/programmes/${programmeId}/tranches`, { label: v.label, amountGhs: Number(v.amountGhs), dueDate: v.dueDate || null }), { onDone, success: 'Tranche planned' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Plan a tranche"><FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Label" name="label" error={f.errors.label}>{(p) => <input {...p} {...f.input('label')} placeholder="For example: Tranche 1 on signing" />}</Field>
      <Field label="Amount (GHS)" name="amountGhs" error={f.errors.amountGhs}>{(p) => <input {...p} {...f.input('amountGhs')} inputMode="decimal" />}</Field>
      <Field label="Due date (optional)" name="dueDate" error={f.errors.dueDate}>{(p) => <input {...p} {...f.input('dueDate')} type="date" />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Plan tranche</Button><Button type="button" onClick={onCancel}>Cancel</Button></div></form>;
}
function ReceiveForm({ t, onDone, onCancel }: { t: Tranche; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ receivedOn: new Date().toISOString().slice(0, 10), receivedGhs: String(t.amountGhs) }, (v) => api.post(`/tranches/${t.id}/receive`, { receivedOn: v.receivedOn, receivedGhs: Number(v.receivedGhs) }), { onDone, success: 'Receipt recorded' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Record receipt"><FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Date received" name="receivedOn" error={f.errors.receivedOn}>{(p) => <input {...p} {...f.input('receivedOn')} type="date" />}</Field>
      <Field label="Amount received (GHS)" name="receivedGhs" error={f.errors.receivedGhs}>{(p) => <input {...p} {...f.input('receivedGhs')} inputMode="decimal" />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Record receipt</Button><Button type="button" onClick={onCancel}>Cancel</Button></div></form>;
}

/** Programme budget: planned spend by category and the funder payment schedule. Nothing here involves personal data. */
export function BudgetPanel({ programmeId, canEdit }: { programmeId: string; canEdit: boolean }) {
  const st = useApi<Overview>(`/programmes/${programmeId}/budget`); const toast = useToast();
  const [mode, setMode] = useState<null | 'line' | 'tranche' | string>(null);
  const done = () => { setMode(null); st.reload(); };
  return <Async state={st}>{(o) => {
    const p = o.position;
    return <div className="stack">
      <Card title="Position"><KV items={[['Programme budget', ghs(p.budget)], ['Allocated to lines', ghs(p.allocated)], ['Not yet allocated', ghs(p.unallocated)], ['Payments scheduled', ghs(p.plannedTranches)], ['Not yet scheduled', ghs(p.unscheduled)], ['Received', ghs(p.received)], ['Still to receive', ghs(p.outstanding)], ['Overdue tranches', String(p.overdueTranches)]]} />
        {p.budget === null && <p className="muted small">Set the programme budget on the Overview tab to start allocating.</p>}</Card>
      <Card title="Budget lines" actions={canEdit && mode !== 'line' ? <Button onClick={() => setMode('line')}>Add line</Button> : undefined}>
        {mode === 'line' && <LineForm programmeId={programmeId} onDone={done} onCancel={() => setMode(null)} />}
        {o.lines.length === 0 ? <Empty title="No budget lines" hint={canEdit ? 'Split the budget into categories such as coaching, travel and monitoring.' : undefined} /> :
          <div className="table-wrap"><table><thead><tr><th>Category</th><th className="r">Amount</th><th className="r">Share</th>{canEdit && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>{o.lines.map((l) => <tr key={l.id}><td>{l.category}</td><td className="r num">{ghs(l.amountGhs)}</td><td className="r num">{l.share === null ? '-' : `${l.share}%`}</td>
            {canEdit && <td><ConfirmButton size="sm" label="Remove" message={`Remove the budget line "${l.category}"?`} onConfirm={async () => { await api.del(`/budget-lines/${l.id}`); toast('Budget line removed'); st.reload(); }} /></td>}</tr>)}</tbody></table></div>}
      </Card>
      <Card title="Funder payments" actions={canEdit && mode !== 'tranche' ? <Button onClick={() => setMode('tranche')}>Plan tranche</Button> : undefined}>
        {mode === 'tranche' && <TrancheForm programmeId={programmeId} onDone={done} onCancel={() => setMode(null)} />}
        {o.tranches.length === 0 ? <Empty title="No payments planned" hint={canEdit ? 'Plan each payment the funder will make, with its due date.' : undefined} /> :
          <div className="table-wrap"><table><thead><tr><th>Tranche</th><th className="r">Planned</th><th>Due</th><th>Status</th><th className="r">Received</th>{canEdit && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>{o.tranches.map((t) => <tr key={t.id}><td>{t.label}</td><td className="r num">{ghs(t.amountGhs)}</td><td>{dateFmt(t.dueDate)}</td>
            <td><Badge tone={t.status === 'Received' ? 'ok' : t.overdue ? 'bad' : ''}>{t.overdue ? 'Overdue' : t.status}</Badge></td><td className="r num">{t.status === 'Received' ? `${ghs(t.receivedGhs)} on ${dateFmt(t.receivedOn)}` : '-'}</td>
            {canEdit && <td>{t.status === 'Planned' && <>{mode === t.id ? null : <Button size="sm" onClick={() => setMode(t.id)}>Record receipt</Button>}<ConfirmButton size="sm" label="Remove" message={`Remove the tranche "${t.label}"?`} onConfirm={async () => { await api.del(`/tranches/${t.id}`); toast('Tranche removed'); st.reload(); }} /></>}</td>}</tr>)}</tbody></table></div>}
        {o.tranches.filter((t) => t.id === mode).map((t) => <ReceiveForm key={t.id} t={t} onDone={done} onCancel={() => setMode(null)} />)}
      </Card>
    </div>;
  }}</Async>;
}
