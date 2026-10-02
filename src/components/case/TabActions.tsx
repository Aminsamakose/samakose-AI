'use client';
import { useState } from 'react';
import { api, ApiFail, dateFmt } from '@/lib/client/api';
import { Badge, Button, Card, DataTable, Field, FormError, Modal, useForm, type Col } from '@/components/ui';
import type { TabProps } from './types';
import { today, useMe } from './clinical/common';

type Row = { id: string; code: string; text: string; ownerRole: string; assignee: string | null; dueDate: string; status: string; evidenceNote: string | null; overdue: boolean; horizon?: number };
const OWNER: Record<string, string> = { OWNER: 'Business owner', COACH: 'Coaching expert', CONSULTANT: 'Lead expert' };
const NEXT: Record<string, string[]> = { Open: ['Open', 'In progress', 'Done'], 'In progress': ['In progress', 'Open', 'Done'], Done: ['Done'] };

export default function TabActions({ caseId, role, reload }: TabProps) {
  const { can } = useMe();
  const [edit, setEdit] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(0);
  const [horizon, setHorizon] = useState('');
  const done = () => { setEdit(null); setAdding(false); setKey((k) => k + 1); reload(); };
  const mayEdit = (r: Row) => can('actions', 'edit') && r.status !== 'Done' && !(role === 'OWNER' && r.ownerRole !== 'OWNER');
  const cols: Col<Row>[] = [
    { key: 'code', label: 'Code', sort: 'code', render: (r) => <span className="mono">{r.code}</span> },
    { key: 'text', label: 'Action', render: (r) => <div>{r.text}{r.evidenceNote && <div className="small muted">Done: {r.evidenceNote}</div>}</div> },
    { key: 'ownerRole', label: 'Owner role', render: (r) => <div>{OWNER[r.ownerRole] ?? r.ownerRole}{r.assignee && <div className="small muted">{r.assignee}</div>}</div> },
    { key: 'due', label: 'Due', sort: 'due', render: (r) => <span className="num" style={r.overdue ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{dateFmt(r.dueDate)}</span> },
    { key: 'horizon', label: 'Plan', render: (r) => <Badge>{r.horizon ? `${r.horizon} day` : '-'}</Badge> },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <span className="row" style={{ gap: 6 }}><Badge>{r.status}</Badge>{r.overdue && <Badge tone="bad">Overdue</Badge>}</span> },
    { key: 'edit', label: 'Update', render: (r) => mayEdit(r) ? <Button size="sm" onClick={() => setEdit(r)} aria-label={`Update ${r.code}`}>Update</Button> : <span className="muted small">-</span> }
  ];
  return <Card title="Actions" actions={can('actions', 'create') && <Button variant="primary" size="sm" onClick={() => setAdding(true)}>Add action</Button>}>
    <p className="muted small" style={{ marginBottom: 10 }}>Overdue actions show a red date and an Overdue label. Marking an action done needs a note saying what was done.</p>
    <div className="row" style={{ marginBottom: 10, gap: 8 }}>
      <label className="small muted" htmlFor="horizon">Plan horizon</label>
      <select id="horizon" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
        <option value="">All</option><option value="30">30 day plan</option><option value="90">90 day plan</option><option value="180">180 day plan</option><option value="360">360 day plan</option>
      </select>
    </div>
    <DataTable<Row> endpoint="/actions" params={{ caseId, ...(horizon ? { horizon } : {}) }} columns={cols} exportable={can('actions', 'export')} placeholder="Search actions" refreshKey={key} defaultSort={{ key: 'due', dir: 'asc' }}
      empty={{ title: 'No actions yet', hint: 'Actions appear here when a prescription is approved, or you can add one.' }} />
    <Modal open={adding} onClose={() => setAdding(false)} title="Add an action">{adding && <AddForm caseId={caseId} onDone={done} onCancel={() => setAdding(false)} />}</Modal>
    <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Update ${edit.code}` : 'Update action'}>{edit && <EditForm row={edit} role={role} onDone={done} onCancel={() => setEdit(null)} />}</Modal>
  </Card>;
}

function AddForm({ caseId, onDone, onCancel }: { caseId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ text: '', ownerRole: 'OWNER', dueDate: '' }, async (v) => {
    const e: Record<string, string> = {};
    if (v.text.trim().length < 3) e.text = 'Describe the action';
    if (!v.dueDate) e.dueDate = 'Choose a due date'; else if (v.dueDate < today()) e.dueDate = 'The due date cannot be in the past';
    if (Object.keys(e).length) throw new ApiFail(400, 'validation_failed', 'Please fix the highlighted fields', e);
    return api.post(`/cases/${caseId}/actions`, { text: v.text.trim(), ownerRole: v.ownerRole, dueDate: v.dueDate });
  }, { success: 'Action added', onDone });
  return <form className="stack" onSubmit={f.onSubmit} noValidate>
    <FormError message={f.formError} />
    <Field label="Action" name="text" required error={f.errors.text}>{(p) => <textarea {...p} rows={3} {...f.input('text')} />}</Field>
    <div className="form-grid">
      <Field label="Owner role" name="ownerRole" required error={f.errors.ownerRole}>{(p) => <select {...p} {...f.input('ownerRole')}>{Object.entries(OWNER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
      <Field label="Due date" name="dueDate" required error={f.errors.dueDate}>{(p) => <input {...p} type="date" min={today()} {...f.input('dueDate')} />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Add action</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function EditForm({ row, role, onDone, onCancel }: { row: Row; role: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ status: row.status, dueDate: row.dueDate?.slice(0, 10) ?? '', evidenceNote: row.evidenceNote ?? '' }, async (v) => {
    const e: Record<string, string> = {};
    if (v.status === 'Done' && v.evidenceNote.trim().length < 3) e.evidenceNote = 'Say what was done before marking this complete';
    if (v.dueDate !== row.dueDate?.slice(0, 10) && v.dueDate < today()) e.dueDate = 'The due date cannot be in the past';
    if (Object.keys(e).length) throw new ApiFail(400, 'validation_failed', 'Please fix the highlighted fields', e);
    const body: Record<string, unknown> = {};
    if (v.status !== row.status) body.status = v.status;
    if (v.evidenceNote.trim() !== (row.evidenceNote ?? '')) body.evidenceNote = v.evidenceNote.trim();
    if (role !== 'OWNER' && v.dueDate && v.dueDate !== row.dueDate?.slice(0, 10)) body.dueDate = v.dueDate;
    if (!Object.keys(body).length) throw new ApiFail(400, 'nothing', 'Nothing has changed');
    return api.patch(`/actions/${row.id}`, body);
  }, { success: 'Action updated', onDone });
  return <form className="stack" onSubmit={f.onSubmit} noValidate>
    <p>{row.text}</p>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Status" name="status" error={f.errors.status}>{(p) => <select {...p} {...f.input('status')}>{NEXT[row.status].map((s) => <option key={s}>{s}</option>)}</select>}</Field>
      {role !== 'OWNER' && <Field label="Due date" name="dueDate" error={f.errors.dueDate}>{(p) => <input {...p} type="date" {...f.input('dueDate')} />}</Field>}
    </div>
    <Field label="Notes and evidence of what was done" name="evidenceNote" required={f.values.status === 'Done'} error={f.errors.evidenceNote} hint="Required when the action is marked Done.">{(p) => <textarea {...p} rows={3} {...f.input('evidenceNote')} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
