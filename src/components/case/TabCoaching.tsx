'use client';
import { useState } from 'react';
import { api, ApiFail, dateTime } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, FormError, Modal, Tile, useApi, useForm } from '@/components/ui';
import type { TabProps } from './types';
import { JobStatus, useJob, useMe } from './clinical/common';

type Sess = { id: string; code: string; scheduledAt: string; status: string; notes: string | null; brief: string | null };
const tone = (s: string) => (s === 'Held' ? 'ok' : s === 'Scheduled' ? 'info' : s === 'Missed' ? 'warn' : 'bad');
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function TabCoaching({ caseId, caseData, reload }: TabProps) {
  const list = useApi<Sess[]>(`/sessions?caseId=${caseId}`);
  const { ready, can } = useMe();
  const rules = useApi<{ key: string; value: number }[]>(ready && can('settings', 'read') ? '/settings/rules' : null);
  const [modal, setModal] = useState<{ kind: 'schedule' } | { kind: 'outcome' | 'move'; s: Sess } | null>(null);
  const done = () => { setModal(null); list.reload(); reload(); };
  const min = rules.data?.find((r) => r.key === 'session.min_for_monitoring')?.value ?? null;
  const held = list.data?.filter((s) => s.status === 'Held').length ?? 0;
  const met = min !== null ? held >= min : caseData.facts?.three_sessions;
  const canEdit = can('sessions', 'edit');
  return <div className="stack">
    <Card title="Coaching progress" actions={can('sessions', 'create') && <Button variant="primary" size="sm" onClick={() => setModal({ kind: 'schedule' })}>Schedule session</Button>}>
      <div className="grid">
        <Tile label="Sessions held" value={min !== null ? `${held} of ${min}` : held} hint={min !== null ? 'Needed before the case moves to monitoring' : undefined} />
        <Tile label="Monitoring requirement" value={met === undefined ? '-' : met ? 'Met' : 'Not yet met'} tone={met ? 'ok' : undefined} hint="Rule: session.min_for_monitoring" />
      </div>
      {min !== null && <div style={{ marginTop: 10 }} role="progressbar" aria-valuemin={0} aria-valuemax={min} aria-valuenow={Math.min(held, min)} aria-label="Held sessions toward the monitoring requirement"><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (held / (min || 1)) * 100)}%` }} /></div></div>}
    </Card>
    <Async state={list}>{(rows) => rows.length === 0 ? <Empty title="No sessions yet" hint="Schedule the first coaching session." /> :
      <div className="stack">{rows.map((s) => <SessionCard key={s.id} s={s} canEdit={canEdit} onOutcome={() => setModal({ kind: 'outcome', s })} onMove={() => setModal({ kind: 'move', s })} refresh={() => { list.reload(); reload(); }} />)}</div>}</Async>
    <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.kind === 'schedule' ? 'Schedule a session' : modal?.kind === 'move' ? 'Move session' : modal ? 'Record session outcome' : ''}>
      {modal?.kind === 'schedule' && <ScheduleForm caseId={caseId} onDone={done} onCancel={() => setModal(null)} />}
      {modal?.kind === 'move' && <ScheduleForm session={modal.s} onDone={done} onCancel={() => setModal(null)} />}
      {modal?.kind === 'outcome' && <OutcomeForm s={modal.s} onDone={done} onCancel={() => setModal(null)} />}
    </Modal>
  </div>;
}

function SessionCard({ s, canEdit, onOutcome, onMove, refresh }: { s: Sess; canEdit: boolean; onOutcome: () => void; onMove: () => void; refresh: () => void }) {
  const job = useJob(refresh);
  const run = () => job.start(`/sessions/${s.id}/brief`);
  return <Card title={<>{dateTime(s.scheduledAt)} <Badge tone={tone(s.status)}>{s.status}</Badge></>} actions={canEdit && s.status === 'Scheduled' && <>
    <Button size="sm" onClick={run} loading={job.running}>{s.brief ? 'Refresh brief' : 'Prepare brief'}</Button>
    <Button size="sm" onClick={onMove}>Move</Button>
    <Button size="sm" variant="primary" onClick={onOutcome}>Record outcome</Button></>}>
    <p className="small muted mono">{s.code}</p>
    <JobStatus job={job} label="The session brief" retry={run} />
    {s.brief && <details open={s.status === 'Scheduled'}><summary>Session brief</summary><p style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{s.brief}</p></details>}
    {s.notes && <div style={{ marginTop: 8 }}><strong>Notes</strong><p style={{ whiteSpace: 'pre-wrap' }}>{s.notes}</p></div>}
  </Card>;
}

function ScheduleForm({ caseId, session, onDone, onCancel }: { caseId?: string; session?: Sess; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ when: session ? localInput(new Date(session.scheduledAt)) : '' }, async (v) => {
    if (!v.when) throw new ApiFail(400, 'validation_failed', 'Choose a date and time', { when: 'Choose a date and time' });
    const at = new Date(v.when);
    if (at.getTime() < Date.now() - 60000) throw new ApiFail(400, 'validation_failed', 'Choose a time in the future', { when: 'Choose a time in the future' });
    return session ? api.patch(`/sessions/${session.id}`, { scheduledAt: at.toISOString() }) : api.post(`/cases/${caseId}/sessions`, { scheduledAt: at.toISOString() });
  }, { success: session ? 'Session moved' : 'Session scheduled', onDone });
  return <form className="stack" onSubmit={f.onSubmit} noValidate>
    <FormError message={f.formError && !f.errors.when && !f.errors.scheduledAt ? f.formError : null} />
    <Field label="Date and time" name="when" required error={f.errors.when ?? f.errors.scheduledAt}>{(p) => <input {...p} type="datetime-local" min={localInput(new Date())} {...f.input('when')} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{session ? 'Move session' : 'Schedule'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function OutcomeForm({ s, onDone, onCancel }: { s: Sess; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ status: 'Held', notes: s.notes ?? '' }, async (v) => {
    if (v.status === 'Held' && v.notes.trim().length < 5) throw new ApiFail(400, 'validation_failed', 'Please fix the highlighted fields', { notes: 'Record what was discussed and agreed' });
    return api.patch(`/sessions/${s.id}`, { status: v.status, ...(v.notes.trim() ? { notes: v.notes.trim() } : {}) });
  }, { success: 'Session updated', onDone });
  return <form className="stack" onSubmit={f.onSubmit} noValidate>
    <FormError message={f.formError} />
    <Field label="Outcome" name="status" error={f.errors.status}>{(p) => <select {...p} {...f.input('status')}><option value="Held">Held</option><option value="Missed">Missed</option><option value="Cancelled">Cancelled</option></select>}</Field>
    <Field label="Notes" name="notes" required={f.values.status === 'Held'} error={f.errors.notes} hint={f.values.status === 'Held' ? 'Required. What was discussed and what was agreed.' : 'Optional'}>{(p) => <textarea {...p} rows={5} {...f.input('notes')} />}</Field>
    <p className="small muted">An outcome cannot be changed after it is saved.</p>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save outcome</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
