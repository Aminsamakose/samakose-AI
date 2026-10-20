'use client';
import { Fragment, useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, FormError, useApi, useForm, useToast } from '@/components/ui';
import { usePerms, OrgSelect } from '@/components/portfolio/shared';

type Workspace = { id: string; participantConsentRequired: boolean };
type Participant = {
  id: string; programmeId: string; workspaceId: string; organisationId: string; cohortId: string | null; status: string;
  invitedAt: string | null; consentAt: string | null; onboardedAt: string | null; completedAt: string | null; withdrawnAt: string | null;
  metadata: Record<string, unknown>; createdAt: string; updatedAt: string;
};
type PersonLink = { id: string; role: string; isPrimary: boolean; createdAt: string; participantId: string; fullName: string; phone: string | null; email: string | null };
type CohortLite = { id: string; name: string; code: string };

const STATUS_TONE: Record<string, string> = {
  APPLICATION: '', ELIGIBILITY: '', SELECTED: '', INVITED: 'pending', CONSENTED: 'pending', ONBOARDED: 'pending',
  COHORT_ASSIGNED: 'pending', ACTIVE: 'ok', COMPLETING: 'pending', COMPLETED: 'ok', WITHDRAWN: '', REJECTED: 'bad'
};
// Status moves offered through the generic transition endpoint. CONSENTED, ONBOARDED, COHORT_ASSIGNED
// and ACTIVE are reached through their own dedicated actions instead (consent/onboard/cohort/activate),
// which enforce extra business rules the generic move does not (consent capture, cohort capacity, ...).
const GENERIC_MOVES: Record<string, string[]> = {
  APPLICATION: ['ELIGIBILITY', 'REJECTED'], ELIGIBILITY: ['SELECTED', 'REJECTED'], SELECTED: ['INVITED', 'REJECTED'],
  INVITED: ['WITHDRAWN', 'REJECTED'], CONSENTED: ['WITHDRAWN'], ONBOARDED: ['WITHDRAWN'], COHORT_ASSIGNED: ['WITHDRAWN'],
  ACTIVE: ['COMPLETING', 'WITHDRAWN'], COMPLETING: ['COMPLETED', 'WITHDRAWN'], COMPLETED: [], WITHDRAWN: [], REJECTED: []
};

function AddParticipantForm({ workspaceId, onDone, onCancel }: { workspaceId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ organisationId: '' }, (v) => api.post(`/programme-workspaces/${workspaceId}/participants`, { organisationId: v.organisationId }), { success: 'Organisation added to the programme', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Organisation" name="organisationId" error={f.errors.organisationId}>{(p) => <OrgSelect {...p} value={f.values.organisationId} onChange={(v) => f.set('organisationId', v)} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Add to programme</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function CohortAssignForm({ workspaceId, participantId, cohorts, onDone, onCancel }: { workspaceId: string; participantId: string; cohorts: CohortLite[]; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ cohortId: '' }, (v) => api.post(`/programme-workspaces/${workspaceId}/participants/${participantId}/cohort`, { cohortId: v.cohortId }), { success: 'Assigned to cohort', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Cohort" name="cohortId" error={f.errors.cohortId}>{() => <select value={f.values.cohortId} onChange={(e) => f.set('cohortId', e.target.value)}>
      <option value="">Choose a cohort</option>
      {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
    </select>}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy} disabled={!cohorts.length}>Assign</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function AddPersonForm({ workspaceId, participantId, onDone, onCancel }: { workspaceId: string; participantId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ fullName: '', phone: '', email: '', role: 'OWNER', isPrimary: false },
    (v) => api.post(`/programme-workspaces/${workspaceId}/participants/${participantId}/people`, { fullName: v.fullName, phone: v.phone || null, email: v.email || null, role: v.role, isPrimary: v.isPrimary }),
    { success: 'Person added', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <p className="small muted">Records one of the people behind this enterprise's enrolment. The same person can be added to more than one enrolment separately; this does not yet search for an existing record.</p>
    <div className="form-grid">
      <Field label="Full name" name="fullName" error={f.errors.fullName} required>{(p) => <input {...p} value={f.values.fullName} onChange={(e) => f.set('fullName', e.target.value)} maxLength={160} />}</Field>
      <Field label="Phone" name="phone">{(p) => <input {...p} value={f.values.phone} onChange={(e) => f.set('phone', e.target.value)} maxLength={40} />}</Field>
      <Field label="Email" name="email">{(p) => <input {...p} type="email" value={f.values.email} onChange={(e) => f.set('email', e.target.value)} maxLength={200} />}</Field>
      <Field label="Role on this enrolment" name="role">{() => <select value={f.values.role} onChange={(e) => f.set('role', e.target.value)}>
        {['OWNER', 'MANAGER', 'DELEGATE', 'OTHER'].map((r) => <option key={r} value={r}>{r}</option>)}
      </select>}</Field>
    </div>
    <Field label="Primary contact" name="isPrimary">{() => <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.isPrimary} onChange={(e) => f.set('isPrimary', e.target.checked)} />Make this the primary contact</label>}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Add person</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

export function OrgNameCell({ organisationId }: { organisationId: string }) {
  const org = useApi<{ name: string; code: string }>(`/organisations/${organisationId}`);
  return <>{org.loading && !org.data ? '…' : org.data ? `${org.data.name} (${org.data.code})` : organisationId}</>;
}

function PeopleList({ workspaceId, participant, canManage }: { workspaceId: string; participant: Participant; canManage: boolean }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const people = useApi<PersonLink[]>(`/programme-workspaces/${workspaceId}/participants/${participant.id}/people`);
  return <div className="stack" style={{ gap: 8 }}>
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="muted small">People behind this enrolment</span>
      {canManage && !adding && <Button size="sm" onClick={() => setAdding(true)}>Add person</Button>}
    </div>
    {adding && <AddPersonForm workspaceId={workspaceId} participantId={participant.id} onDone={() => { setAdding(false); people.reload(); }} onCancel={() => setAdding(false)} />}
    <Async state={people}>{(items) => items.length === 0 ? <p className="muted small">No one recorded yet.</p> :
      <ul className="stack" style={{ gap: 4 }}>{items.map((pl) => <li key={pl.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span>{pl.fullName}{pl.isPrimary && <Badge tone="ok">Primary</Badge>} <span className="muted small">{pl.role}{pl.phone ? ` · ${pl.phone}` : ''}{pl.email ? ` · ${pl.email}` : ''}</span></span>
        {canManage && <Button size="sm" variant="danger" onClick={async () => { await api.del(`/programme-workspaces/${workspaceId}/participants/${participant.id}/people/${pl.id}`); toast('Person removed'); people.reload(); }}>Remove</Button>}
      </li>)}</ul>}
    </Async>
  </div>;
}

/** Participants (organisations enrolled in the programme) and the people behind each enrolment. */
export function ParticipantsPanel({ programmeId, cohorts }: { programmeId: string; cohorts: CohortLite[] }) {
  const ws = useApi<Workspace>(`/programmes/${programmeId}/workspace`);
  if (ws.loading && !ws.data) return <p className="muted">Loading…</p>;
  if (ws.error && !ws.data) return <Empty title="No workspace yet" hint="Open the programme's workspace on the Workspace tab before adding participants." />;
  return ws.data ? <ParticipantsDetail workspace={ws.data} cohorts={cohorts} /> : null;
}

function ParticipantsDetail({ workspace, cohorts }: { workspace: Workspace; cohorts: CohortLite[] }) {
  const toast = useToast();
  const { can } = usePerms();
  const canManage = can('programme_workspaces', 'edit');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assigningCohort, setAssigningCohort] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = useApi<Participant[]>(`/programme-workspaces/${workspace.id}/participants`);
  const cohortLabel = (id: string | null) => { const c = cohorts.find((x) => x.id === id); return c ? `${c.name} (${c.code})` : '-'; };

  const dedicated = async (p: Participant, action: 'consent' | 'onboard' | 'activate') => {
    setBusy(p.id);
    try { await api.post(`/programme-workspaces/${workspace.id}/participants/${p.id}/${action}`, {}); toast('Updated'); list.reload(); }
    catch (e) { toast(errText(e)); } finally { setBusy(null); }
  };
  const generic = async (p: Participant, status: string) => {
    setBusy(p.id);
    try { await api.post(`/programme-workspaces/${workspace.id}/participants/${p.id}/transition`, { status }); toast('Updated'); list.reload(); }
    catch (e) { toast(errText(e)); } finally { setBusy(null); }
  };

  return <Card title="Participants" actions={canManage && !adding ? <Button onClick={() => setAdding(true)}>Add organisation</Button> : undefined}>
    {adding && <AddParticipantForm workspaceId={workspace.id} onDone={() => { setAdding(false); list.reload(); }} onCancel={() => setAdding(false)} />}
    <Async state={list}>{(items) => items.length === 0 ? <Empty title="No participants yet" hint={canManage ? 'Add an organisation to begin its enrolment.' : undefined} /> :
      <div className="table-wrap"><table><thead><tr><th>Organisation</th><th>Status</th><th>Cohort</th>{canManage && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
        {items.map((p) => <Fragment key={p.id}>
          <tr>
            <td><OrgNameCell organisationId={p.organisationId} /></td>
            <td><Badge tone={STATUS_TONE[p.status] ?? ''}>{p.status}</Badge></td>
            <td>{cohortLabel(p.cohortId)}</td>
            {canManage && <td className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {p.status === 'INVITED' && workspace.participantConsentRequired && <Button size="sm" loading={busy === p.id} onClick={() => dedicated(p, 'consent')}>Record consent</Button>}
              {(p.status === 'CONSENTED' || (p.status === 'INVITED' && !workspace.participantConsentRequired)) && <Button size="sm" loading={busy === p.id} onClick={() => dedicated(p, 'onboard')}>Onboard</Button>}
              {p.status === 'ONBOARDED' && (assigningCohort === p.id ? null : <Button size="sm" onClick={() => setAssigningCohort(p.id)}>Assign cohort</Button>)}
              {p.status === 'COHORT_ASSIGNED' && <Button size="sm" loading={busy === p.id} onClick={() => dedicated(p, 'activate')}>Activate</Button>}
              {(GENERIC_MOVES[p.status] ?? []).map((next) => <Button key={next} size="sm" variant={next === 'REJECTED' || next === 'WITHDRAWN' ? 'danger' : undefined} loading={busy === p.id} onClick={() => generic(p, next)}>{next === 'REJECTED' ? 'Reject' : next === 'WITHDRAWN' ? 'Withdraw' : next}</Button>)}
              <Button size="sm" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>{expanded === p.id ? 'Hide people' : 'People'}</Button>
            </td>}
          </tr>
          {expanded === p.id && <tr><td colSpan={canManage ? 4 : 3}><PeopleList workspaceId={workspace.id} participant={p} canManage={canManage} /></td></tr>}
          {assigningCohort === p.id && <tr><td colSpan={canManage ? 4 : 3}><CohortAssignForm workspaceId={workspace.id} participantId={p.id} cohorts={cohorts} onDone={() => { setAssigningCohort(null); list.reload(); }} onCancel={() => setAssigningCohort(null)} /></td></tr>}
        </Fragment>)}
      </tbody></table></div>}
    </Async>
  </Card>;
}
