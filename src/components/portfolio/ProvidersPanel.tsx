'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, FormError, useApi, useForm } from '@/components/ui';
import { usePerms } from '@/components/portfolio/shared';

type Workspace = { id: string; status: string };
type CohortLite = { id: string; name: string; code: string };
type ProviderRole = 'EXPERT' | 'COACH';
type Availability = 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE';

type Capacity = { id: string; maxActiveAssignments: number; maxSessionsPerWeek: number | null; weeklyHours: number | null; availability: Availability; effectiveFrom: string; effectiveTo: string | null } | null;
type EligibleProvider = { userId: string; name: string; availability: string; activeAssignments: number; capacity: Capacity; weeklySessions: number };
type CapacityRow = { providerUserId: string; providerRole: ProviderRole; maxActiveAssignments: number; maxSessionsPerWeek: number | null; weeklyHours: number | null; availability: Availability; provider: { id: string; name: string }; activeAssignments: number; weeklySessions: number; assignmentUtilisation: number; sessionUtilisation: number | null };
type Assignment = {
  id: string; workspaceId: string; cohortId: string | null; providerUserId: string; providerRole: ProviderRole; status: 'PROPOSED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'DECLINED';
  allocationPercent: number; maxParticipants: number | null; startsAt: string; endsAt: string | null; reason: string | null;
  metadata: { kickoffMeetingUrl?: string }; provider: { id: string; name: string }; activeLoad: number; capacity: Capacity;
};

const ROLES: { value: ProviderRole; label: string }[] = [{ value: 'EXPERT', label: 'Experts' }, { value: 'COACH', label: 'Coaches' }];
const AVAILABILITY: Availability[] = ['AVAILABLE', 'LIMITED', 'UNAVAILABLE'];
const STATUS_TONE: Record<string, string> = { PROPOSED: 'pending', ACTIVE: 'ok', PAUSED: 'pending', ENDED: '', DECLINED: 'bad' };
const NEXT_MOVES: Record<string, string[]> = { PROPOSED: ['ACTIVE', 'DECLINED'], ACTIVE: ['PAUSED', 'ENDED'], PAUSED: ['ACTIVE', 'ENDED'], ENDED: [], DECLINED: [] };

function CapacityForm({ workspaceId, providerUserId, providerRole, existing, onDone, onCancel }: { workspaceId: string; providerUserId: string; providerRole: ProviderRole; existing: Capacity; onDone: () => void; onCancel: () => void }) {
  const f = useForm({
    maxActiveAssignments: String(existing?.maxActiveAssignments ?? 5), maxSessionsPerWeek: existing?.maxSessionsPerWeek != null ? String(existing.maxSessionsPerWeek) : '',
    weeklyHours: existing?.weeklyHours != null ? String(existing.weeklyHours) : '', availability: existing?.availability ?? 'AVAILABLE'
  }, (v) => api.post(`/programme-workspaces/${workspaceId}/provider-capacity`, {
    providerUserId, providerRole, maxActiveAssignments: Number(v.maxActiveAssignments),
    maxSessionsPerWeek: v.maxSessionsPerWeek.trim() ? Number(v.maxSessionsPerWeek) : null,
    weeklyHours: v.weeklyHours.trim() ? Number(v.weeklyHours) : null, availability: v.availability
  }), { success: 'Capacity updated', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Max active assignments" name="maxActiveAssignments" error={f.errors.maxActiveAssignments}>{(p) => <input {...p} type="number" min={1} max={100} value={f.values.maxActiveAssignments} onChange={(e) => f.set('maxActiveAssignments', e.target.value)} />}</Field>
      <Field label="Max sessions per week" name="maxSessionsPerWeek" hint="Optional.">{(p) => <input {...p} type="number" min={1} max={500} value={f.values.maxSessionsPerWeek} onChange={(e) => f.set('maxSessionsPerWeek', e.target.value)} />}</Field>
      <Field label="Weekly hours" name="weeklyHours" hint="Optional.">{(p) => <input {...p} type="number" min={1} max={168} value={f.values.weeklyHours} onChange={(e) => f.set('weeklyHours', e.target.value)} />}</Field>
      <Field label="Availability" name="availability">{() => <select value={f.values.availability} onChange={(e) => f.set('availability', e.target.value)}>
        {AVAILABILITY.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save capacity</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function AssignmentForm({ workspaceId, providerRole, providers, cohorts, onDone, onCancel }: { workspaceId: string; providerRole: ProviderRole; providers: EligibleProvider[]; cohorts: CohortLite[]; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ providerUserId: '', cohortId: '', allocationPercent: '100', maxParticipants: '', startsAt: '', endsAt: '', reason: '' },
    (v) => api.post(`/programme-workspaces/${workspaceId}/provider-assignments`, {
      providerUserId: v.providerUserId, providerRole, cohortId: v.cohortId || null, allocationPercent: Number(v.allocationPercent),
      maxParticipants: v.maxParticipants.trim() ? Number(v.maxParticipants) : null,
      startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : null, endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : null, reason: v.reason.trim() || null
    }), { success: 'Assignment created', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Provider" name="providerUserId" error={f.errors.providerUserId} required>{() => <select value={f.values.providerUserId} onChange={(e) => f.set('providerUserId', e.target.value)}>
        <option value="">Choose a provider</option>
        {providers.map((p) => <option key={p.userId} value={p.userId}>{p.name} ({p.activeAssignments}{p.capacity ? `/${p.capacity.maxActiveAssignments}` : ''} active)</option>)}
      </select>}</Field>
      <Field label="Cohort" name="cohortId" hint="Optional — leave blank for a programme-wide assignment.">{() => <select value={f.values.cohortId} onChange={(e) => f.set('cohortId', e.target.value)}>
        <option value="">No specific cohort</option>
        {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
      </select>}</Field>
      <Field label="Allocation (%)" name="allocationPercent" error={f.errors.allocationPercent}>{(p) => <input {...p} type="number" min={1} max={100} value={f.values.allocationPercent} onChange={(e) => f.set('allocationPercent', e.target.value)} />}</Field>
      <Field label="Max participants" name="maxParticipants" hint="Optional.">{(p) => <input {...p} type="number" min={1} value={f.values.maxParticipants} onChange={(e) => f.set('maxParticipants', e.target.value)} />}</Field>
      <Field label="Starts" name="startsAt" hint="Optional, defaults to now.">{(p) => <input {...p} type="date" value={f.values.startsAt} onChange={(e) => f.set('startsAt', e.target.value)} />}</Field>
      <Field label="Ends" name="endsAt" hint="Optional.">{(p) => <input {...p} type="date" value={f.values.endsAt} onChange={(e) => f.set('endsAt', e.target.value)} />}</Field>
    </div>
    <Field label="Reason" name="reason" hint="Optional.">{(p) => <textarea {...p} value={f.values.reason} onChange={(e) => f.set('reason', e.target.value)} rows={2} maxLength={2000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy} disabled={!providers.length}>Create assignment</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function StatusMoveForm({ workspaceId, assignment, next, onDone, onCancel }: { workspaceId: string; assignment: Assignment; next: string; onDone: () => void; onCancel: () => void }) {
  const needsReason = next === 'DECLINED' || next === 'ENDED';
  const f = useForm({ reason: '', scheduleKickoffMeeting: false }, (v) => api.post(`/provider-assignments/${assignment.id}/status`, { status: next, reason: v.reason.trim() || undefined, scheduleKickoffMeeting: v.scheduleKickoffMeeting }), { success: 'Assignment updated', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    {needsReason && <Field label={`Reason for ${next === 'DECLINED' ? 'declining' : 'ending'}`} name="reason" error={f.errors.reason} required>{(p) => <textarea {...p} value={f.values.reason} onChange={(e) => f.set('reason', e.target.value)} rows={2} maxLength={2000} required />}</Field>}
    {next === 'ACTIVE' && <Field label="Kickoff meeting" name="scheduleKickoffMeeting">{() => <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.scheduleKickoffMeeting} onChange={(e) => f.set('scheduleKickoffMeeting', e.target.checked)} />Schedule a kickoff meeting with the provider</label>}</Field>}
    <div className="form-actions"><Button variant={next === 'DECLINED' || next === 'ENDED' ? 'danger' : 'primary'} type="submit" loading={f.busy}>{next === 'DECLINED' ? 'Decline' : next === 'ENDED' ? 'End assignment' : next === 'ACTIVE' ? 'Activate' : 'Pause'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

/** Programme provider roster: capacity/availability per provider and the cohort/programme assignments drawing on it. */
export function ProvidersPanel({ programmeId, cohorts }: { programmeId: string; cohorts: CohortLite[] }) {
  const ws = useApi<Workspace>(`/programmes/${programmeId}/workspace`);
  if (ws.loading && !ws.data) return <p className="muted">Loading…</p>;
  if (ws.error && !ws.data) return <Empty title="No workspace yet" hint="Open the programme's workspace on the Workspace tab before assigning providers." />;
  return ws.data ? <ProvidersDetail workspace={ws.data} cohorts={cohorts} /> : null;
}

function ProvidersDetail({ workspace, cohorts }: { workspace: Workspace; cohorts: CohortLite[] }) {
  const { can } = usePerms();
  const canAssign = can('programme_workspaces', 'assign');
  const canEdit = can('programme_workspaces', 'edit');
  const [role, setRole] = useState<ProviderRole>('EXPERT');
  const [settingCapacityFor, setSettingCapacityFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<{ id: string; next: string } | null>(null);

  const eligible = useApi<{ items: EligibleProvider[] }>(`/programme-workspaces/${workspace.id}/providers?providerRole=${role}`);
  const capacity = useApi<CapacityRow[]>(`/programme-workspaces/${workspace.id}/provider-capacity`);
  const assignments = useApi<Assignment[]>(`/programme-workspaces/${workspace.id}/provider-assignments`);
  const refreshAll = () => { eligible.reload(); capacity.reload(); assignments.reload(); };
  const cohortLabel = (id: string | null) => { const c = cohorts.find((x) => x.id === id); return c ? `${c.name} (${c.code})` : 'Programme-wide'; };

  return <div className="stack">
    <Card title="Eligible providers" actions={<div className="row" style={{ gap: 6 }}>{ROLES.map((r) => <Button key={r.value} size="sm" variant={role === r.value ? 'primary' : undefined} onClick={() => setRole(r.value)}>{r.label}</Button>)}</div>}>
      <p className="small muted">Workspace team members with role {role}, an active profile and an approved {role === 'EXPERT' ? 'expert' : 'coach'} function.</p>
      <Async state={eligible}>{(e) => e.items.length === 0 ? <Empty title="No eligible providers" hint="Add staff to the workspace team with this role on the Workspace tab." /> :
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Availability</th><th className="r">Active</th><th className="r">Weekly sessions</th>{canEdit && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
          {e.items.map((p) => <tr key={p.userId}>
            <td>{p.name}</td><td>{p.availability}</td>
            <td className="r num">{p.activeAssignments}{p.capacity ? `/${p.capacity.maxActiveAssignments}` : ''}</td>
            <td className="r num">{p.weeklySessions}{p.capacity?.maxSessionsPerWeek ? `/${p.capacity.maxSessionsPerWeek}` : ''}</td>
            {canEdit && <td>{settingCapacityFor === p.userId ? null : <Button size="sm" onClick={() => setSettingCapacityFor(p.userId)}>{p.capacity ? 'Edit capacity' : 'Set capacity'}</Button>}</td>}
          </tr>)}
        </tbody></table></div>}
      </Async>
      {settingCapacityFor && <CapacityForm workspaceId={workspace.id} providerUserId={settingCapacityFor} providerRole={role}
        existing={eligible.data?.items.find((p) => p.userId === settingCapacityFor)?.capacity ?? null}
        onDone={() => { setSettingCapacityFor(null); refreshAll(); }} onCancel={() => setSettingCapacityFor(null)} />}
    </Card>

    <Card title="Capacity and utilisation">
      <Async state={capacity}>{(rows) => rows.length === 0 ? <Empty title="No capacity set yet" hint="Set capacity for a provider above." /> :
        <div className="table-wrap"><table><thead><tr><th>Provider</th><th>Role</th><th>Availability</th><th className="r">Assignment load</th><th className="r">Session load</th></tr></thead><tbody>
          {rows.map((r) => <tr key={`${r.providerUserId}-${r.providerRole}`}>
            <td>{r.provider.name}</td><td>{r.providerRole}</td><td><Badge tone={r.availability === 'AVAILABLE' ? 'ok' : r.availability === 'LIMITED' ? 'pending' : 'bad'}>{r.availability}</Badge></td>
            <td className="r num">{r.activeAssignments}/{r.maxActiveAssignments} ({Math.round(r.assignmentUtilisation * 100)}%)</td>
            <td className="r num">{r.maxSessionsPerWeek ? `${r.weeklySessions}/${r.maxSessionsPerWeek} (${Math.round((r.sessionUtilisation ?? 0) * 100)}%)` : '-'}</td>
          </tr>)}
        </tbody></table></div>}
      </Async>
    </Card>

    <Card title="Assignments" actions={canAssign && !adding ? <Button onClick={() => setAdding(true)}>New assignment</Button> : undefined}>
      {adding && <AssignmentForm workspaceId={workspace.id} providerRole={role} providers={eligible.data?.items ?? []} cohorts={cohorts} onDone={() => { setAdding(false); refreshAll(); }} onCancel={() => setAdding(false)} />}
      <Async state={assignments}>{(items) => items.length === 0 ? <Empty title="No provider assignments yet" /> :
        <div className="table-wrap"><table><thead><tr><th>Provider</th><th>Role</th><th>Cohort</th><th>Status</th><th className="r">Allocation</th>{canEdit && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
          {items.map((a) => <tr key={a.id}>
            <td>{a.provider.name}</td><td>{a.providerRole}</td><td>{cohortLabel(a.cohortId)}</td>
            <td><Badge tone={STATUS_TONE[a.status] ?? ''}>{a.status}</Badge>{a.metadata?.kickoffMeetingUrl && <div className="small"><a href={a.metadata.kickoffMeetingUrl} target="_blank" rel="noreferrer">Kickoff link</a></div>}</td>
            <td className="r num">{a.allocationPercent}%</td>
            {canEdit && <td className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {moving?.id === a.id ? null : (NEXT_MOVES[a.status] ?? []).map((next) => <Button key={next} size="sm" variant={next === 'DECLINED' || next === 'ENDED' ? 'danger' : undefined} onClick={() => setMoving({ id: a.id, next })}>{next === 'DECLINED' ? 'Decline' : next === 'ENDED' ? 'End' : next === 'ACTIVE' ? 'Activate' : 'Pause'}</Button>)}
            </td>}
          </tr>)}
          {items.filter((a) => moving?.id === a.id).map((a) => <tr key={`${a.id}-move`}><td colSpan={canEdit ? 6 : 5}>
            <StatusMoveForm workspaceId={workspace.id} assignment={a} next={moving!.next} onDone={() => { setMoving(null); refreshAll(); }} onCancel={() => setMoving(null)} />
          </td></tr>)}
        </tbody></table></div>}
      </Async>
    </Card>
  </div>;
}
