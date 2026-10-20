'use client';
import { Fragment, useState } from 'react';
import { api, ApiFail, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, FormError, KV, useApi, useForm, useToast } from '@/components/ui';
import { usePerms, UserSelect } from '@/components/portfolio/shared';
import { OrgNameCell } from '@/components/portfolio/ParticipantsPanel';

type Workspace = { id: string };
type CohortLite = { id: string; name: string; code: string };

type CohortConfig = {
  id: string; cohortId: string; version: number; status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  deliveryMode: string; schedule: Record<string, unknown>; milestones: unknown[]; serviceLevels: Record<string, unknown>;
  providerPlan: Record<string, unknown>; sessionPlan: Record<string, unknown>; changeReason: string | null; rejectionReason: string | null; updatedAt: string;
};
type Task = { id: string; cohortId: string; title: string; description: string | null; status: string; priority: string; assignedTo: string | null; dueAt: string | null };
type Milestone = { id: string; cohortId: string; name: string; description: string | null; status: string; dueAt: string; ownerUserId: string | null };
type Exception = { id: string; cohortId: string; title: string; description: string | null; severity: string; status: string; ownerUserId: string | null; resolution: string | null };
type Coordination = { tasks: Task[]; milestones: Milestone[]; exceptions: Exception[]; counts: { openTasks: number; overdueTasks: number; openExceptions: number; atRiskMilestones: number } };
type Activity = { id: string; cohortId: string; name: string; activityType: string; description: string | null; sequence: number; scheduledStart: string | null; scheduledEnd: string | null; status: string };
type SessionRow = { session: { id: string; activityId: string; facilitatorUserId: string | null; mode: string; startsAt: string; endsAt: string; location: string | null; meetingUrl: string | null; status: string; capacity: number | null }; activity: Activity };
type AttendanceRow = { attendance: { id: string; sessionId: string; participantId: string; status: string; arrivedAt: string | null; note: string | null }; participant: { id: string; organisationId: string; cohortId: string | null } };

const CONFIG_TONE: Record<string, string> = { DRAFT: '', SUBMITTED: 'pending', APPROVED: 'ok', REJECTED: 'bad', SUPERSEDED: '' };
const DELIVERY_MODES = ['IN_PERSON', 'REMOTE', 'HYBRID', 'SELF_PACED'];
const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'];
const MILESTONE_STATUSES = ['PLANNED', 'AT_RISK', 'ACHIEVED', 'MISSED', 'CANCELLED'];
const EXCEPTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const ACTIVITY_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const SESSION_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const STATUS_TONE: Record<string, string> = { DONE: 'ok', ACHIEVED: 'ok', COMPLETED: 'ok', RESOLVED: 'ok', CLOSED: '', CANCELLED: '', BLOCKED: 'bad', AT_RISK: 'bad', MISSED: 'bad', OPEN: 'pending', TODO: '', PLANNED: '', IN_PROGRESS: 'pending', SCHEDULED: '', NO_SHOW: 'bad' };

/** Status buttons for an entity whose only server rule is "locked when it reaches its terminal/complete state". */
function StatusButtons({ all, current, locked, busy, onMove }: { all: string[]; current: string; locked: string; busy: boolean; onMove: (next: string) => void }) {
  if (current === locked) return null;
  return <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{all.filter((s) => s !== current).map((s) => <Button key={s} size="sm" loading={busy} onClick={() => onMove(s)}>{s.replace('_', ' ')}</Button>)}</div>;
}

function jsonField(v: unknown) { return JSON.stringify(v ?? {}, null, 2); }
function parseJson(raw: string, field: string, errs: Record<string, string>, fallback: unknown) {
  if (!raw.trim()) return fallback;
  try { return JSON.parse(raw); } catch { errs[field] = 'Must be valid JSON'; return fallback; }
}

function CohortConfigForm({ cohortId, initial, onDone, onCancel }: { cohortId: string; initial?: CohortConfig; onDone: () => void; onCancel: () => void }) {
  const f = useForm({
    deliveryMode: initial?.deliveryMode ?? 'HYBRID', schedule: initial ? jsonField(initial.schedule) : '', milestones: initial ? jsonField(initial.milestones) : '',
    serviceLevels: initial ? jsonField(initial.serviceLevels) : '', providerPlan: initial ? jsonField(initial.providerPlan) : '', sessionPlan: initial ? jsonField(initial.sessionPlan) : '', changeReason: ''
  }, async (v) => {
    const errs: Record<string, string> = {};
    const schedule = parseJson(v.schedule, 'schedule', errs, {});
    const milestones = parseJson(v.milestones, 'milestones', errs, []);
    const serviceLevels = parseJson(v.serviceLevels, 'serviceLevels', errs, {});
    const providerPlan = parseJson(v.providerPlan, 'providerPlan', errs, {});
    const sessionPlan = parseJson(v.sessionPlan, 'sessionPlan', errs, {});
    if (Object.keys(errs).length) throw new ApiFail(422, 'validation', 'Check the highlighted fields and try again.', errs);
    return api.post(`/cohorts/${cohortId}/configurations`, { deliveryMode: v.deliveryMode, schedule, milestones, serviceLevels, providerPlan, sessionPlan, changeReason: v.changeReason.trim() || undefined });
  }, { success: 'Configuration draft created', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Delivery mode" name="deliveryMode">{() => <select value={f.values.deliveryMode} onChange={(e) => f.set('deliveryMode', e.target.value)}>
      {DELIVERY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>}</Field>
    <Field label="Schedule (JSON)" name="schedule" error={f.errors.schedule}>{(p) => <textarea {...p} value={f.values.schedule} onChange={(e) => f.set('schedule', e.target.value)} rows={3} className="mono" placeholder="{}" />}</Field>
    <Field label="Milestones (JSON list)" name="milestones" error={f.errors.milestones}>{(p) => <textarea {...p} value={f.values.milestones} onChange={(e) => f.set('milestones', e.target.value)} rows={3} className="mono" placeholder="[]" />}</Field>
    <Field label="Service levels (JSON)" name="serviceLevels" error={f.errors.serviceLevels}>{(p) => <textarea {...p} value={f.values.serviceLevels} onChange={(e) => f.set('serviceLevels', e.target.value)} rows={3} className="mono" placeholder="{}" />}</Field>
    <Field label="Provider plan (JSON)" name="providerPlan" error={f.errors.providerPlan}>{(p) => <textarea {...p} value={f.values.providerPlan} onChange={(e) => f.set('providerPlan', e.target.value)} rows={3} className="mono" placeholder="{}" />}</Field>
    <Field label="Session plan (JSON)" name="sessionPlan" error={f.errors.sessionPlan}>{(p) => <textarea {...p} value={f.values.sessionPlan} onChange={(e) => f.set('sessionPlan', e.target.value)} rows={3} className="mono" placeholder="{}" />}</Field>
    <Field label="Reason for this change" name="changeReason" hint="Optional.">{(p) => <textarea {...p} value={f.values.changeReason} onChange={(e) => f.set('changeReason', e.target.value)} rows={2} maxLength={1000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save draft</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function CohortConfigSection({ cohortId, canManage }: { cohortId: string; canManage: boolean }) {
  const toast = useToast();
  const [drafting, setDrafting] = useState<false | 'new' | CohortConfig>(false);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const configs = useApi<CohortConfig[]>(`/cohorts/${cohortId}/configurations`);
  const run = async (version: number, action: 'submit' | 'approve' | 'revise', body?: unknown) => {
    setBusy(version);
    try { await api.post(`/cohorts/${cohortId}/configurations/${version}/${action}`, body ?? {}); toast('Updated'); configs.reload(); }
    catch (e) { toast(errText(e)); } finally { setBusy(null); }
  };
  const reject = async (version: number, reason: string) => {
    setBusy(version);
    try { await api.post(`/cohorts/${cohortId}/configurations/${version}/reject`, { reason }); toast('Configuration rejected'); setRejecting(null); configs.reload(); }
    catch (e) { toast(errText(e)); } finally { setBusy(null); }
  };
  return <Card title="Delivery configuration" actions={canManage && !drafting ? <Button size="sm" onClick={() => setDrafting('new')}>New draft</Button> : undefined}>
    <p className="small muted">Approval requires an administrator or reviewer, not just workspace-manager access.</p>
    {drafting === 'new' && <CohortConfigForm cohortId={cohortId} onDone={() => { setDrafting(false); configs.reload(); }} onCancel={() => setDrafting(false)} />}
    {drafting && drafting !== 'new' && <CohortConfigForm cohortId={cohortId} initial={drafting} onDone={() => { setDrafting(false); configs.reload(); }} onCancel={() => setDrafting(false)} />}
    <Async state={configs}>{(items) => items.length === 0 ? <Empty title="No configuration drafts yet" /> :
      <div className="table-wrap"><table><thead><tr><th>Version</th><th>Mode</th><th>Status</th><th>Change reason</th>{canManage && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
        {items.map((c) => <tr key={c.id}>
          <td>v{c.version}</td><td>{c.deliveryMode}</td><td><Badge tone={CONFIG_TONE[c.status] ?? ''}>{c.status}</Badge></td>
          <td className="small">{c.status === 'REJECTED' && c.rejectionReason ? c.rejectionReason : c.changeReason ?? '-'}</td>
          {canManage && <td className="row" style={{ gap: 6 }}>
            {c.status === 'DRAFT' && <Button size="sm" loading={busy === c.version} onClick={() => run(c.version, 'submit')}>Submit</Button>}
            {c.status === 'SUBMITTED' && <>
              <Button size="sm" loading={busy === c.version} onClick={() => run(c.version, 'approve')}>Approve</Button>
              {rejecting === c.version ? null : <Button size="sm" variant="danger" onClick={() => setRejecting(c.version)}>Reject</Button>}
            </>}
            {c.status === 'REJECTED' && <Button size="sm" onClick={() => setDrafting(c)}>Revise</Button>}
          </td>}
        </tr>)}
      </tbody></table></div>}
    </Async>
    {rejecting !== null && <RejectForm busy={busy === rejecting} onCancel={() => setRejecting(null)} onSubmit={(reason) => reject(rejecting, reason)} />}
  </Card>;
}

function RejectForm({ onSubmit, onCancel, busy }: { onSubmit: (reason: string) => void; onCancel: () => void; busy: boolean }) {
  const [reason, setReason] = useState('');
  return <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(reason); }}>
    <Field label="Reason for rejection" name="reason" required>{(p) => <textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} required />}</Field>
    <div className="form-actions"><Button variant="danger" type="submit" loading={busy}>Reject</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function TaskForm({ cohortId, onDone, onCancel }: { cohortId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ title: '', description: '', priority: 'NORMAL', assignedTo: '', dueAt: '' },
    (v) => api.post(`/cohorts/${cohortId}/delivery-tasks`, { title: v.title, description: v.description || null, priority: v.priority, assignedTo: v.assignedTo || null, dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null }),
    { success: 'Task created', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Title" name="title" error={f.errors.title} required>{(p) => <input {...p} value={f.values.title} onChange={(e) => f.set('title', e.target.value)} maxLength={200} />}</Field>
      <Field label="Priority" name="priority">{() => <select value={f.values.priority} onChange={(e) => f.set('priority', e.target.value)}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p}</option>)}</select>}</Field>
      <Field label="Due" name="dueAt" hint="Optional.">{(p) => <input {...p} type="date" value={f.values.dueAt} onChange={(e) => f.set('dueAt', e.target.value)} />}</Field>
      <Field label="Assignee" name="assignedTo" hint="Optional.">{(p) => <UserSelect {...p} value={f.values.assignedTo} onChange={(v) => f.set('assignedTo', v)} />}</Field>
    </div>
    <Field label="Description" name="description" hint="Optional.">{(p) => <textarea {...p} value={f.values.description} onChange={(e) => f.set('description', e.target.value)} rows={2} maxLength={5000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Create task</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function MilestoneForm({ cohortId, onDone, onCancel }: { cohortId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ name: '', description: '', dueAt: '', ownerUserId: '' },
    (v) => api.post(`/cohorts/${cohortId}/delivery-milestones`, { name: v.name, description: v.description || null, dueAt: new Date(v.dueAt).toISOString(), ownerUserId: v.ownerUserId || null }),
    { success: 'Milestone created', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Name" name="name" error={f.errors.name} required>{(p) => <input {...p} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} maxLength={200} />}</Field>
      <Field label="Due" name="dueAt" error={f.errors.dueAt} required>{(p) => <input {...p} type="date" value={f.values.dueAt} onChange={(e) => f.set('dueAt', e.target.value)} />}</Field>
      <Field label="Owner" name="ownerUserId" hint="Optional.">{(p) => <UserSelect {...p} value={f.values.ownerUserId} onChange={(v) => f.set('ownerUserId', v)} />}</Field>
    </div>
    <Field label="Description" name="description" hint="Optional.">{(p) => <textarea {...p} value={f.values.description} onChange={(e) => f.set('description', e.target.value)} rows={2} maxLength={5000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Create milestone</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function ExceptionForm({ cohortId, onDone, onCancel }: { cohortId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ title: '', description: '', severity: 'MEDIUM', ownerUserId: '' },
    (v) => api.post(`/cohorts/${cohortId}/delivery-exceptions`, { title: v.title, description: v.description || null, severity: v.severity, ownerUserId: v.ownerUserId || null }),
    { success: 'Exception logged', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Title" name="title" error={f.errors.title} required>{(p) => <input {...p} value={f.values.title} onChange={(e) => f.set('title', e.target.value)} maxLength={200} />}</Field>
      <Field label="Severity" name="severity">{() => <select value={f.values.severity} onChange={(e) => f.set('severity', e.target.value)}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => <option key={s} value={s}>{s}</option>)}</select>}</Field>
      <Field label="Owner" name="ownerUserId" hint="Optional.">{(p) => <UserSelect {...p} value={f.values.ownerUserId} onChange={(v) => f.set('ownerUserId', v)} />}</Field>
    </div>
    <Field label="Description" name="description" hint="Optional.">{(p) => <textarea {...p} value={f.values.description} onChange={(e) => f.set('description', e.target.value)} rows={2} maxLength={5000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Log exception</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function ResolutionMoveForm({ exceptionId, next, onDone, onCancel }: { exceptionId: string; next: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ resolution: '' }, (v) => api.post(`/delivery-exceptions/${exceptionId}/status`, { status: next, resolution: v.resolution.trim() || undefined }), { success: 'Exception updated', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Resolution notes" name="resolution" hint="Optional.">{(p) => <textarea {...p} value={f.values.resolution} onChange={(e) => f.set('resolution', e.target.value)} rows={2} maxLength={5000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{next === 'CLOSED' ? 'Close' : 'Mark resolved'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function CoordinationSection({ cohortId, canManage }: { cohortId: string; canManage: boolean }) {
  const toast = useToast();
  const [adding, setAdding] = useState<'' | 'task' | 'milestone' | 'exception'>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [resolving, setResolving] = useState<{ id: string; next: string } | null>(null);
  const summary = useApi<Coordination>(`/cohorts/${cohortId}/coordination`);
  const moveTask = async (id: string, status: string) => { setBusy(id); try { await api.post(`/delivery-tasks/${id}/status`, { status }); toast('Task updated'); summary.reload(); } catch (e) { toast(errText(e)); } finally { setBusy(null); } };
  const moveMilestone = async (id: string, status: string) => { setBusy(id); try { await api.post(`/delivery-milestones/${id}/status`, { status }); toast('Milestone updated'); summary.reload(); } catch (e) { toast(errText(e)); } finally { setBusy(null); } };
  const moveException = async (id: string, status: string) => {
    if (status === 'RESOLVED' || status === 'CLOSED') { setResolving({ id, next: status }); return; }
    setBusy(id); try { await api.post(`/delivery-exceptions/${id}/status`, { status }); toast('Exception updated'); summary.reload(); } catch (e) { toast(errText(e)); } finally { setBusy(null); }
  };
  return <Async state={summary}>{(s) => <div className="stack">
    <Card title="Coordination at a glance">
      <KV items={[['Open tasks', String(s.counts.openTasks)], ['Overdue tasks', String(s.counts.overdueTasks)], ['Open exceptions', String(s.counts.openExceptions)], ['At-risk milestones', String(s.counts.atRiskMilestones)]]} />
    </Card>
    <Card title="Tasks" actions={canManage && adding !== 'task' ? <Button size="sm" onClick={() => setAdding('task')}>Add task</Button> : undefined}>
      {adding === 'task' && <TaskForm cohortId={cohortId} onDone={() => { setAdding(''); summary.reload(); }} onCancel={() => setAdding('')} />}
      {s.tasks.length === 0 ? <Empty title="No tasks yet" /> :
        <div className="table-wrap"><table><thead><tr><th>Title</th><th>Priority</th><th>Due</th><th>Status</th>{canManage && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
          {s.tasks.map((t) => <tr key={t.id}>
            <td>{t.title}</td><td>{t.priority}</td><td>{t.dueAt ? new Date(t.dueAt).toLocaleDateString() : '-'}</td>
            <td><Badge tone={STATUS_TONE[t.status] ?? ''}>{t.status.replace('_', ' ')}</Badge></td>
            {canManage && <td><StatusButtons all={TASK_STATUSES} current={t.status} locked="DONE" busy={busy === t.id} onMove={(s2) => moveTask(t.id, s2)} /></td>}
          </tr>)}
        </tbody></table></div>}
    </Card>
    <Card title="Milestones" actions={canManage && adding !== 'milestone' ? <Button size="sm" onClick={() => setAdding('milestone')}>Add milestone</Button> : undefined}>
      {adding === 'milestone' && <MilestoneForm cohortId={cohortId} onDone={() => { setAdding(''); summary.reload(); }} onCancel={() => setAdding('')} />}
      {s.milestones.length === 0 ? <Empty title="No milestones yet" /> :
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Due</th><th>Status</th>{canManage && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
          {s.milestones.map((m) => <tr key={m.id}>
            <td>{m.name}</td><td>{new Date(m.dueAt).toLocaleDateString()}</td>
            <td><Badge tone={STATUS_TONE[m.status] ?? ''}>{m.status.replace('_', ' ')}</Badge></td>
            {canManage && <td><StatusButtons all={MILESTONE_STATUSES} current={m.status} locked="ACHIEVED" busy={busy === m.id} onMove={(s2) => moveMilestone(m.id, s2)} /></td>}
          </tr>)}
        </tbody></table></div>}
    </Card>
    <Card title="Exceptions" actions={canManage && adding !== 'exception' ? <Button size="sm" onClick={() => setAdding('exception')}>Log exception</Button> : undefined}>
      {adding === 'exception' && <ExceptionForm cohortId={cohortId} onDone={() => { setAdding(''); summary.reload(); }} onCancel={() => setAdding('')} />}
      {s.exceptions.length === 0 ? <Empty title="No exceptions logged" /> :
        <div className="table-wrap"><table><thead><tr><th>Title</th><th>Severity</th><th>Status</th>{canManage && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
          {s.exceptions.map((x) => <tr key={x.id}>
            <td>{x.title}{x.resolution && <div className="small muted">{x.resolution}</div>}</td>
            <td><Badge tone={x.severity === 'CRITICAL' || x.severity === 'HIGH' ? 'bad' : ''}>{x.severity}</Badge></td>
            <td><Badge tone={STATUS_TONE[x.status] ?? ''}>{x.status.replace('_', ' ')}</Badge></td>
            {canManage && <td>{resolving?.id === x.id ? null : <StatusButtons all={EXCEPTION_STATUSES} current={x.status} locked="CLOSED" busy={busy === x.id} onMove={(s2) => moveException(x.id, s2)} />}</td>}
          </tr>)}
          {s.exceptions.filter((x) => resolving?.id === x.id).map((x) => <tr key={`${x.id}-resolve`}><td colSpan={canManage ? 4 : 3}>
            <ResolutionMoveForm exceptionId={x.id} next={resolving!.next} onDone={() => { setResolving(null); summary.reload(); }} onCancel={() => setResolving(null)} />
          </td></tr>)}
        </tbody></table></div>}
    </Card>
  </div>}</Async>;
}

function ActivityForm({ cohortId, onDone, onCancel }: { cohortId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ name: '', activityType: 'GENERAL', sequence: '1', scheduledStart: '', scheduledEnd: '', ownerUserId: '' },
    (v) => api.post(`/cohorts/${cohortId}/activities`, { name: v.name, activityType: v.activityType, sequence: Number(v.sequence), scheduledStart: v.scheduledStart ? new Date(v.scheduledStart).toISOString() : null, scheduledEnd: v.scheduledEnd ? new Date(v.scheduledEnd).toISOString() : null, ownerUserId: v.ownerUserId || null }),
    { success: 'Activity created', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Name" name="name" error={f.errors.name} required>{(p) => <input {...p} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} maxLength={200} />}</Field>
      <Field label="Type" name="activityType">{(p) => <input {...p} value={f.values.activityType} onChange={(e) => f.set('activityType', e.target.value)} maxLength={100} />}</Field>
      <Field label="Sequence" name="sequence">{(p) => <input {...p} type="number" min={1} value={f.values.sequence} onChange={(e) => f.set('sequence', e.target.value)} />}</Field>
      <Field label="Owner" name="ownerUserId" hint="Optional.">{(p) => <UserSelect {...p} value={f.values.ownerUserId} onChange={(v) => f.set('ownerUserId', v)} />}</Field>
      <Field label="Scheduled start" name="scheduledStart" hint="Optional.">{(p) => <input {...p} type="date" value={f.values.scheduledStart} onChange={(e) => f.set('scheduledStart', e.target.value)} />}</Field>
      <Field label="Scheduled end" name="scheduledEnd" hint="Optional.">{(p) => <input {...p} type="date" value={f.values.scheduledEnd} onChange={(e) => f.set('scheduledEnd', e.target.value)} />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Create activity</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function SessionForm({ activityId, onDone, onCancel }: { activityId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ facilitatorUserId: '', mode: 'HYBRID', startsAt: '', endsAt: '', location: '', meetingUrl: '', capacity: '', notes: '' },
    (v) => api.post(`/delivery-activities/${activityId}/sessions`, {
      facilitatorUserId: v.facilitatorUserId || null, mode: v.mode, startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString(),
      location: v.location || null, meetingUrl: v.meetingUrl || null, capacity: v.capacity.trim() ? Number(v.capacity) : null, notes: v.notes || null
    }), { success: 'Session scheduled', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <p className="small muted">Leaving the meeting link blank for a remote or hybrid session asks the configured video provider to create one.</p>
    <div className="form-grid">
      <Field label="Mode" name="mode">{() => <select value={f.values.mode} onChange={(e) => f.set('mode', e.target.value)}>{DELIVERY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select>}</Field>
      <Field label="Facilitator" name="facilitatorUserId" hint="Optional.">{(p) => <UserSelect {...p} value={f.values.facilitatorUserId} onChange={(v) => f.set('facilitatorUserId', v)} />}</Field>
      <Field label="Starts" name="startsAt" error={f.errors.startsAt} required>{(p) => <input {...p} type="datetime-local" value={f.values.startsAt} onChange={(e) => f.set('startsAt', e.target.value)} />}</Field>
      <Field label="Ends" name="endsAt" error={f.errors.endsAt} required>{(p) => <input {...p} type="datetime-local" value={f.values.endsAt} onChange={(e) => f.set('endsAt', e.target.value)} />}</Field>
      <Field label="Location" name="location" hint="Optional.">{(p) => <input {...p} value={f.values.location} onChange={(e) => f.set('location', e.target.value)} maxLength={500} />}</Field>
      <Field label="Meeting link" name="meetingUrl" hint="Optional.">{(p) => <input {...p} type="url" value={f.values.meetingUrl} onChange={(e) => f.set('meetingUrl', e.target.value)} />}</Field>
      <Field label="Capacity" name="capacity" hint="Optional.">{(p) => <input {...p} type="number" min={1} value={f.values.capacity} onChange={(e) => f.set('capacity', e.target.value)} />}</Field>
    </div>
    <Field label="Notes" name="notes" hint="Optional.">{(p) => <textarea {...p} value={f.values.notes} onChange={(e) => f.set('notes', e.target.value)} rows={2} maxLength={5000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Schedule session</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function AttendanceForm({ sessionId, participantId, existing, onDone, onCancel }: { sessionId: string; participantId: string; existing?: { status: string; note: string | null }; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ status: existing?.status ?? 'PRESENT', note: existing?.note ?? '' }, (v) => api.post(`/delivery-sessions/${sessionId}/attendance/${participantId}`, { status: v.status, note: v.note.trim() || null }), { success: 'Attendance recorded', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Status" name="status">{() => <select value={f.values.status} onChange={(e) => f.set('status', e.target.value)}>{['PRESENT', 'ABSENT', 'EXCUSED', 'LATE'].map((s) => <option key={s} value={s}>{s}</option>)}</select>}</Field>
      <Field label="Note" name="note" hint="Optional.">{(p) => <input {...p} value={f.values.note} onChange={(e) => f.set('note', e.target.value)} maxLength={2000} />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function AttendanceSection({ sessionId, cohortParticipants, canManage }: { sessionId: string; cohortParticipants: { id: string; organisationId: string }[]; canManage: boolean }) {
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const attendance = useApi<AttendanceRow[]>(`/delivery-sessions/${sessionId}/attendance`);
  const byParticipant = new Map((attendance.data ?? []).map((r) => [r.attendance.participantId, r.attendance]));
  return <div className="stack" style={{ gap: 8 }}>
    <span className="muted small">Attendance</span>
    {cohortParticipants.length === 0 ? <p className="small muted">No participants are assigned to this cohort yet.</p> :
      <ul className="stack" style={{ gap: 4 }}>{cohortParticipants.map((p) => { const a = byParticipant.get(p.id);
        return <li key={p.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <span><OrgNameCell organisationId={p.organisationId} /> {a && <Badge tone={a.status === 'PRESENT' ? 'ok' : a.status === 'ABSENT' ? 'bad' : ''}>{a.status}</Badge>}</span>
          {canManage && (recordingFor === p.id ? null : <Button size="sm" onClick={() => setRecordingFor(p.id)}>{a ? 'Edit' : 'Record'}</Button>)}
        </li>; })}
      </ul>}
    {recordingFor && <AttendanceForm sessionId={sessionId} participantId={recordingFor} existing={byParticipant.get(recordingFor) ? { status: byParticipant.get(recordingFor)!.status, note: byParticipant.get(recordingFor)!.note } : undefined}
      onDone={() => { setRecordingFor(null); attendance.reload(); }} onCancel={() => setRecordingFor(null)} />}
  </div>;
}

function OperationsSection({ cohortId, cohortParticipants, canManage }: { cohortId: string; cohortParticipants: { id: string; organisationId: string }[]; canManage: boolean }) {
  const toast = useToast();
  const [addingActivity, setAddingActivity] = useState(false);
  const [schedulingFor, setSchedulingFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const activities = useApi<Activity[]>(`/cohorts/${cohortId}/activities`);
  const sessions = useApi<SessionRow[]>(`/cohorts/${cohortId}/delivery-sessions`);
  const moveActivity = async (id: string, status: string) => { setBusy(id); try { await api.post(`/delivery-activities/${id}/status`, { status }); toast('Activity updated'); activities.reload(); } catch (e) { toast(errText(e)); } finally { setBusy(null); } };
  const moveSession = async (id: string, status: string) => { setBusy(id); try { await api.post(`/delivery-sessions/${id}/status`, { status }); toast('Session updated'); sessions.reload(); } catch (e) { toast(errText(e)); } finally { setBusy(null); } };

  return <Card title="Activities and sessions" actions={canManage && !addingActivity ? <Button size="sm" onClick={() => setAddingActivity(true)}>Add activity</Button> : undefined}>
    {addingActivity && <ActivityForm cohortId={cohortId} onDone={() => { setAddingActivity(false); activities.reload(); }} onCancel={() => setAddingActivity(false)} />}
    <Async state={activities}>{(acts) => acts.length === 0 ? <Empty title="No delivery activities yet" /> :
      <div className="stack">{acts.map((a) => {
        const activitySessions = (sessions.data ?? []).filter((r) => r.activity.id === a.id);
        return <div key={a.id} className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>#{a.sequence} {a.name} <span className="muted small">({a.activityType})</span> <Badge tone={STATUS_TONE[a.status] ?? ''}>{a.status.replace('_', ' ')}</Badge></span>
            {canManage && <div className="row" style={{ gap: 4 }}>
              <StatusButtons all={ACTIVITY_STATUSES} current={a.status} locked="COMPLETED" busy={busy === a.id} onMove={(s) => moveActivity(a.id, s)} />
              <Button size="sm" onClick={() => setSchedulingFor(schedulingFor === a.id ? null : a.id)}>{schedulingFor === a.id ? 'Cancel' : 'Add session'}</Button>
            </div>}
          </div>
          {schedulingFor === a.id && <SessionForm activityId={a.id} onDone={() => { setSchedulingFor(null); sessions.reload(); }} onCancel={() => setSchedulingFor(null)} />}
          {activitySessions.length === 0 ? <p className="small muted">No sessions scheduled.</p> :
            <div className="table-wrap"><table><thead><tr><th>Starts</th><th>Mode</th><th>Status</th>{canManage && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
              {activitySessions.map((r) => <Fragment key={r.session.id}>
                <tr>
                  <td>{new Date(r.session.startsAt).toLocaleString()}</td><td>{r.session.mode}{r.session.meetingUrl && <> · <a href={r.session.meetingUrl} target="_blank" rel="noreferrer">Join</a></>}</td>
                  <td><Badge tone={STATUS_TONE[r.session.status] ?? ''}>{r.session.status.replace('_', ' ')}</Badge></td>
                  {canManage && <td className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    <StatusButtons all={SESSION_STATUSES} current={r.session.status} locked="COMPLETED" busy={busy === r.session.id} onMove={(s) => moveSession(r.session.id, s)} />
                    <Button size="sm" onClick={() => setExpanded(expanded === r.session.id ? null : r.session.id)}>{expanded === r.session.id ? 'Hide attendance' : 'Attendance'}</Button>
                  </td>}
                </tr>
                {expanded === r.session.id && <tr><td colSpan={canManage ? 4 : 3}><AttendanceSection sessionId={r.session.id} cohortParticipants={cohortParticipants} canManage={canManage} /></td></tr>}
              </Fragment>)}
            </tbody></table></div>}
        </div>;
      })}</div>}
    </Async>
  </Card>;
}

function CohortDelivery({ cohort, workspaceId, canManage }: { cohort: CohortLite; workspaceId: string; canManage: boolean }) {
  const participants = useApi<{ id: string; organisationId: string; cohortId: string | null }[]>(`/programme-workspaces/${workspaceId}/participants`);
  const cohortParticipants = (participants.data ?? []).filter((p) => p.cohortId === cohort.id);
  return <div className="stack">
    <CohortConfigSection cohortId={cohort.id} canManage={canManage} />
    <CoordinationSection cohortId={cohort.id} canManage={canManage} />
    <OperationsSection cohortId={cohort.id} cohortParticipants={cohortParticipants} canManage={canManage} />
  </div>;
}

/** Cohort delivery configuration, coordination (tasks/milestones/exceptions) and operations (activities/sessions/attendance). */
export function DeliveryPanel({ programmeId, cohorts }: { programmeId: string; cohorts: CohortLite[] }) {
  const ws = useApi<Workspace>(`/programmes/${programmeId}/workspace`);
  const { can } = usePerms();
  const canManage = can('programme_workspaces', 'edit');
  const [cohortId, setCohortId] = useState<string>('');
  if (ws.loading && !ws.data) return <p className="muted">Loading…</p>;
  if (ws.error && !ws.data) return <Empty title="No workspace yet" hint="Open the programme's workspace on the Workspace tab before managing delivery." />;
  if (cohorts.length === 0) return <Empty title="No cohorts yet" hint="Add a cohort on the Cohorts tab before scheduling its delivery." />;
  const selected = cohorts.find((c) => c.id === cohortId) ?? cohorts[0];
  return <div className="stack">
    <Field label="Cohort" name="cohort">{() => <select value={selected.id} onChange={(e) => setCohortId(e.target.value)}>
      {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
    </select>}</Field>
    <CohortDelivery key={selected.id} cohort={selected} workspaceId={ws.data!.id} canManage={canManage} />
  </div>;
}
