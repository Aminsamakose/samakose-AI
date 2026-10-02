'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Badge, Button, Card, Field, FormError, Modal, useApi, useForm } from '@/components/ui';
import type { CaseData } from '../types';
import { CASE_STATE_ORDER, FACT_LABEL } from './shared';

/** Stepper over the case lifecycle, what happens next, and the manual moves this person may make. */
export function Lifecycle({ c, role, canEdit, reload }: { c: CaseData; role: string; canEdit: boolean; reload: () => void }) {
  const idx = CASE_STATE_ORDER.indexOf(c.status);
  const internal = role !== 'OWNER' && role !== 'FUNDER';
  return <Card title="Lifecycle">
    <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} aria-label="Case lifecycle">
      {CASE_STATE_ORDER.map((s, i) => {
        const st = i < idx ? 'Done' : i === idx ? 'Current' : 'Upcoming';
        return <li key={s} aria-current={st === 'Current' ? 'step' : undefined} style={{ display: 'flex' }}>
          <span className={`badge ${st === 'Current' ? 'brand' : st === 'Done' ? 'ok' : ''}`} style={st === 'Current' ? { outline: '2px solid var(--brand)', outlineOffset: 1 } : st === 'Upcoming' ? { opacity: 0.75 } : undefined}>
            {s}<span className="sr"> ({st.toLowerCase()})</span>{st === 'Done' && <span aria-hidden> ✓</span>}{st === 'Current' && <span aria-hidden> ●</span>}
          </span></li>;
      })}
    </ol>
    <div className="grid two" style={{ marginTop: 14 }}>
      <div className="stack">
        <h3 style={{ fontSize: '1rem' }}>What the system does next</h3>
        {!internal ? <p className="muted">Your consultant moves the case forward as each step is completed.</p>
          : c.automaticNext.length === 0 ? <p className="muted">{c.nextManualSteps.length ? 'The next step is a manual one, shown alongside.' : 'There are no further steps from this state.'}</p>
          : c.automaticNext.map((a) => <div key={a.to} className="stack" style={{ gap: 6 }}>
            <p><strong>Moves to {a.to}</strong> automatically ({a.trigger.toLowerCase()}).</p>
            {a.needs.length === 0 ? <p className="small muted">No conditions. It happens as soon as work starts.</p>
              : <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{a.needs.map((n) => {
                const missing = a.missing.includes(n);
                return <li key={n}>{FACT_LABEL[n] ?? n}: <Badge tone={missing ? 'warn' : 'ok'}>{missing ? 'Missing' : 'Met'}</Badge></li>;
              })}</ul>}
          </div>)}
      </div>
      <div className="stack">
        <h3 style={{ fontSize: '1rem' }}>Manual steps</h3>
        {c.nextManualSteps.length === 0 ? <p className="muted">{internal ? 'No manual step is available from this state.' : 'Manual steps are handled by your consultant.'}</p>
          : c.nextManualSteps.map((m) => <ManualStep key={m.to} caseId={c.id} from={c.status} step={m} allowed={canEdit} reload={reload} />)}
      </div>
    </div>
  </Card>;
}

function ManualStep({ caseId, from, step, allowed, reload }: { caseId: string; from: string; step: { to: string; trigger: string }; allowed: boolean; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const f = useForm({ reason: '' }, (v) => api.post(`/cases/${caseId}/transition`, { to: step.to, reason: v.reason.trim() || null }), { success: `Case moved to ${step.to}`, onDone: () => { setOpen(false); reload(); } });
  return <div className="row">
    <span>{step.trigger}</span>
    {allowed ? <Button variant="primary" size="sm" onClick={() => setOpen(true)}>Move to {step.to}</Button> : <span className="small muted">Your role cannot make this move.</span>}
    <Modal open={open} onClose={() => setOpen(false)} title={`Move to ${step.to}`}>
      <form className="stack" onSubmit={f.onSubmit} noValidate>
        <p>This moves the case from <strong>{from}</strong> to <strong>{step.to}</strong> ({step.trigger.toLowerCase()}). The change is recorded in the activity trail.</p>
        <FormError message={f.formError} />
        <Field label="Reason (optional)" name="reason" error={f.errors.reason}>{(p) => <textarea {...p} maxLength={500} {...f.input('reason')} />}</Field>
        <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Confirm move</Button><Button type="button" onClick={() => setOpen(false)}>Cancel</Button></div>
      </form>
    </Modal>
  </div>;
}

/** Assign consultant, coach and reviewer. Only administrators and programme managers can do this. */
export function AssignPanel({ c, reload }: { c: CaseData; reload: () => void }) {
  const people = useApi<{ id: string; name: string; role: string }[]>('/users/assignable');
  const f = useForm({ consultantId: c.consultantId ?? '', coachId: c.coachId ?? '', reviewerId: c.reviewerId ?? '' },
    (v) => api.post(`/cases/${c.id}/assign`, { consultantId: v.consultantId || null, coachId: v.coachId || null, reviewerId: v.reviewerId || null }),
    { success: 'Assignments saved', onDone: reload });
  const by = (r: string) => (people.data ?? []).filter((p) => p.role === r);
  const sel = (k: 'consultantId' | 'coachId' | 'reviewerId', label: string, role: string) => (
    <Field label={label} name={k} error={f.errors[k]}>{(p) => <select {...p} {...f.input(k)}><option value="">Unassigned</option>{by(role).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}</Field>);
  return <Card title="Assign people">
    {people.error ? <div className="alert bad" role="alert">{people.error}</div> : null}
    <form className="stack" onSubmit={f.onSubmit} noValidate>
      <FormError message={f.formError} />
      <div className="form-grid">{sel('consultantId', 'Consultant', 'CONSULTANT')}{sel('coachId', 'Coach', 'COACH')}{sel('reviewerId', 'Reviewer', 'REVIEWER')}</div>
      <p className="small muted">The reviewer must be a different person from the consultant. People are notified when newly assigned.</p>
      <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy} disabled={people.loading && !people.data}>Save assignments</Button></div>
    </form>
  </Card>;
}
