'use client';
import { useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, KV, useApi, useForm, useToast } from '@/components/ui';
import { usePerms, UserSelect } from '@/components/portfolio/shared';
import { CreateWorkspaceForm, ConfigurationDraftForm, type ConfigDraft } from '@/components/portfolio/WorkspaceConfigForm';

type Workspace = {
  id: string; programmeId: string; name: string; status: string; providerSource: string; configurationVersion: number;
  frameworkVersionId: string | null; participantConsentRequired: boolean; funderReportingEnabled: boolean; configuration: Record<string, unknown>;
};
type Member = { workspaceId: string; userId: string; role: string; active: boolean; joinedAt: string; name: string; email: string };
type Entitlements = { workspaceId: string; usage: Record<string, number>; limits: Record<string, number | null>; entitlements: unknown };
type ConfigVersion = {
  id: string; workspaceId: string; version: number; status: string; configuration: Record<string, unknown>; objectives: unknown[];
  eligibilityRules: Record<string, unknown>; deliveryModel: Record<string, unknown>; reporting: Record<string, unknown>; entitlements: unknown[];
  frameworkVersionId: string | null; participantConsentRequired: boolean; funderReportingEnabled: boolean; changeReason: string | null;
  createdBy: string | null; approvedBy: string | null; approvedAt: string | null; rejectionReason: string | null; createdAt: string; updatedAt: string;
};

const LIFECYCLE = ['DRAFT', 'COMMERCIAL_REVIEW', 'INVOICED', 'PAYMENT_PENDING', 'APPROVED', 'CONFIGURING', 'READY', 'ACTIVE', 'PAUSED', 'COMPLETING', 'COMPLETED', 'CLOSED', 'ARCHIVED'];
const PROVIDER_SOURCES = [{ value: 'SAMAKOSE_NETWORK', label: 'Samakose network' }, { value: 'BRING_YOUR_OWN', label: "Bring your own" }, { value: 'HYBRID', label: 'Hybrid' }];
const WORKSPACE_ROLES = ['PROGRAMME_MANAGER', 'ASSESSOR', 'EXPERT', 'COACH', 'REVIEWER', 'FINANCE', 'MEL'];
const CONFIG_TONE: Record<string, string> = { DRAFT: '', SUBMITTED: 'pending', APPROVED: 'ok', REJECTED: 'bad', SUPERSEDED: '' };
const LIFECYCLE_TONE: Record<string, string> = { ACTIVE: 'ok', READY: 'ok', PAUSED: 'pending', CLOSED: '', ARCHIVED: '', COMPLETED: 'ok' };

function WorkspaceSettingsForm({ ws, onDone, onCancel }: { ws: Workspace; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ name: ws.name, status: ws.status, providerSource: ws.providerSource, participantConsentRequired: ws.participantConsentRequired, funderReportingEnabled: ws.funderReportingEnabled },
    (v) => api.patch(`/programme-workspaces/${ws.id}`, v), { success: 'Workspace updated', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Workspace name" name="name" error={f.errors.name}>{(p) => <input {...p} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} maxLength={160} />}</Field>
      <Field label="Lifecycle status" name="status" error={f.errors.status} hint="The server validates the transition; an invalid move is rejected.">{() => <select value={f.values.status} onChange={(e) => f.set('status', e.target.value)}>
        {LIFECYCLE.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>}</Field>
      <Field label="Provider source" name="providerSource">{() => <select value={f.values.providerSource} onChange={(e) => f.set('providerSource', e.target.value)}>
        {PROVIDER_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>}</Field>
    </div>
    <Field label="Participant consent" name="participantConsentRequired">{() => <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.participantConsentRequired} onChange={(e) => f.set('participantConsentRequired', e.target.checked)} />Require participant consent before onboarding</label>}</Field>
    <Field label="Funder reporting" name="funderReportingEnabled">{() => <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.funderReportingEnabled} onChange={(e) => f.set('funderReportingEnabled', e.target.checked)} />Enable funder-facing reporting</label>}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save changes</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function AddMemberForm({ workspaceId, onDone, onCancel }: { workspaceId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ userId: '', role: 'PROGRAMME_MANAGER' }, (v) => api.post(`/programme-workspaces/${workspaceId}/members`, v), { success: 'Team member added', onDone });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Person" name="userId" error={f.errors.userId}>{(p) => <UserSelect {...p} value={f.values.userId} onChange={(v) => f.set('userId', v)} />}</Field>
    <Field label="Workspace role" name="role" error={f.errors.role}>{() => <select value={f.values.role} onChange={(e) => f.set('role', e.target.value)}>
      {WORKSPACE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
    </select>}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Add member</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function RejectForm({ onSubmit, onCancel, busy }: { onSubmit: (reason: string) => void; onCancel: () => void; busy: boolean }) {
  const [reason, setReason] = useState('');
  return <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(reason); }}>
    <Field label="Reason for rejection" name="reason" required>{(p) => <textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} required />}</Field>
    <div className="form-actions"><Button variant="danger" type="submit" loading={busy}>Reject</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

/** The programme's single delivery workspace: lifecycle, versioned configuration approvals, team and entitlement usage. */
export function WorkspacePanel({ programmeId }: { programmeId: string }) {
  const st = useApi<Workspace>(`/programmes/${programmeId}/workspace`);
  const { can } = usePerms();
  const canManage = can('programme_workspaces', 'edit') || can('programme_workspaces', 'create');
  const [creating, setCreating] = useState(false);

  if (st.loading && !st.data) return <p className="muted">Loading workspace…</p>;
  if (st.error && !st.data) {
    return creating
      ? <Card title="Open a workspace"><CreateWorkspaceForm programmeId={programmeId} onDone={() => { setCreating(false); st.reload(); }} onCancel={() => setCreating(false)} /></Card>
      : <Empty title="No workspace yet" hint="A workspace holds this programme's delivery configuration, team and participant onboarding." action={canManage ? <Button variant="primary" onClick={() => setCreating(true)}>Open workspace</Button> : undefined} />;
  }
  return st.data ? <WorkspaceDetail ws={st.data} canManage={canManage} onReload={st.reload} /> : null;
}

function WorkspaceDetail({ ws, canManage, onReload }: { ws: Workspace; canManage: boolean; onReload: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [draftingConfig, setDraftingConfig] = useState<false | 'new' | ConfigDraft>(false);
  const [rejectingVersion, setRejectingVersion] = useState<number | null>(null);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);

  const members = useApi<{ items: Member[] }>(`/programme-workspaces/${ws.id}/members`);
  const entitlements = useApi<Entitlements>(`/programme-workspaces/${ws.id}/team-entitlements`);
  const configs = useApi<{ items: ConfigVersion[] }>(`/programme-workspaces/${ws.id}/configurations`);

  const runAction = async (version: number, action: 'submit' | 'approve' | 'revise', body?: unknown) => {
    setBusyVersion(version);
    try {
      await api.post(`/programme-workspaces/${ws.id}/configurations/${version}/${action}`, body ?? {});
      toast(action === 'submit' ? 'Draft submitted for review' : action === 'approve' ? 'Configuration approved' : 'New draft opened for revision');
      configs.reload(); onReload();
    } catch (e) { toast(errText(e)); } finally { setBusyVersion(null); }
  };
  const rejectVersion = async (version: number, reason: string) => {
    setBusyVersion(version);
    try { await api.post(`/programme-workspaces/${ws.id}/configurations/${version}/reject`, { reason }); toast('Configuration rejected'); setRejectingVersion(null); configs.reload(); }
    catch (e) { toast(errText(e)); } finally { setBusyVersion(null); }
  };

  return <div className="stack">
    <Card title="Workspace" actions={canManage && !editing ? <Button size="sm" onClick={() => setEditing(true)}>Edit</Button> : undefined}>
      {editing
        ? <WorkspaceSettingsForm ws={ws} onDone={() => { setEditing(false); onReload(); }} onCancel={() => setEditing(false)} />
        : <KV items={[
            ['Name', ws.name], ['Status', <Badge key="s" tone={LIFECYCLE_TONE[ws.status] ?? 'pending'}>{ws.status}</Badge>],
            ['Provider source', PROVIDER_SOURCES.find((s) => s.value === ws.providerSource)?.label ?? ws.providerSource],
            ['Configuration version', String(ws.configurationVersion)],
            ['Framework version', ws.frameworkVersionId ?? '-'],
            ['Participant consent required', ws.participantConsentRequired ? 'Yes' : 'No'],
            ['Funder reporting enabled', ws.funderReportingEnabled ? 'Yes' : 'No']
          ]} />}
    </Card>

    <Card title="Team" actions={canManage && !addingMember ? <Button size="sm" onClick={() => setAddingMember(true)}>Add member</Button> : undefined}>
      {addingMember && <AddMemberForm workspaceId={ws.id} onDone={() => { setAddingMember(false); members.reload(); entitlements.reload(); }} onCancel={() => setAddingMember(false)} />}
      <Async state={members}>{(m) => m.items.length === 0 ? <Empty title="No team members yet" /> :
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th>{canManage && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
          {m.items.map((mem) => <tr key={`${mem.userId}-${mem.role}`}>
            <td>{mem.name}<div className="muted small">{mem.email}</div></td><td>{mem.role}</td>
            <td><Badge tone={mem.active ? 'ok' : ''}>{mem.active ? 'Active' : 'Inactive'}</Badge></td>
            <td>{new Date(mem.joinedAt).toLocaleDateString()}</td>
            {canManage && <td><ConfirmButton size="sm" label={mem.active ? 'Deactivate' : 'Reactivate'} message={`${mem.active ? 'Deactivate' : 'Reactivate'} ${mem.name} as ${mem.role}?`}
              onConfirm={async () => { await api.patch(`/programme-workspaces/${ws.id}/members/${mem.userId}/${mem.role}`, { active: !mem.active }); toast('Membership updated'); members.reload(); entitlements.reload(); }} /></td>}
          </tr>)}
        </tbody></table></div>}
      </Async>
    </Card>

    <Card title="Team entitlement usage">
      <Async state={entitlements}>{(e) => {
        const roles = Array.from(new Set([...Object.keys(e.usage), ...Object.keys(e.limits)]));
        return roles.length === 0 ? <Empty title="No entitlement data" /> :
          <div className="table-wrap"><table><thead><tr><th>Role</th><th className="r">In use</th><th className="r">Limit</th></tr></thead><tbody>
            {roles.map((r) => { const used = e.usage[r] ?? 0; const limit = e.limits[r]; const over = limit !== null && limit !== undefined && used > limit;
              return <tr key={r}><td>{r}</td><td className="r num">{used}</td><td className="r num"><span className={over ? 'err' : undefined}>{limit === null || limit === undefined ? 'Unlimited' : limit}</span></td></tr>; })}
          </tbody></table></div>;
      }}</Async>
    </Card>

    <Card title="Configuration versions" actions={canManage && !draftingConfig ? <Button size="sm" onClick={() => setDraftingConfig('new')}>New draft</Button> : undefined}>
      {draftingConfig === 'new' && <ConfigurationDraftForm workspaceId={ws.id} onDone={() => { setDraftingConfig(false); configs.reload(); onReload(); }} onCancel={() => setDraftingConfig(false)} />}
      {draftingConfig && draftingConfig !== 'new' && <ConfigurationDraftForm workspaceId={ws.id} initial={draftingConfig} onDone={() => { setDraftingConfig(false); configs.reload(); onReload(); }} onCancel={() => setDraftingConfig(false)} />}
      <Async state={configs}>{(c) => c.items.length === 0 ? <Empty title="No configuration drafts yet" /> :
        <div className="table-wrap"><table><thead><tr><th>Version</th><th>Status</th><th>Change reason</th><th>Updated</th>{canManage && <th><span className="sr">Actions</span></th>}</tr></thead><tbody>
          {c.items.map((cv) => <tr key={cv.id}>
            <td>v{cv.version}</td><td><Badge tone={CONFIG_TONE[cv.status] ?? ''}>{cv.status}</Badge></td>
            <td className="small">{cv.status === 'REJECTED' && cv.rejectionReason ? cv.rejectionReason : cv.changeReason ?? '-'}</td>
            <td>{new Date(cv.updatedAt).toLocaleDateString()}</td>
            {canManage && <td className="row" style={{ gap: 6 }}>
              {cv.status === 'DRAFT' && <Button size="sm" loading={busyVersion === cv.version} onClick={() => runAction(cv.version, 'submit')}>Submit</Button>}
              {cv.status === 'SUBMITTED' && <>
                <Button size="sm" loading={busyVersion === cv.version} onClick={() => runAction(cv.version, 'approve')}>Approve</Button>
                {rejectingVersion === cv.version
                  ? null
                  : <Button size="sm" variant="danger" onClick={() => setRejectingVersion(cv.version)}>Reject</Button>}
              </>}
              {cv.status === 'REJECTED' && <Button size="sm" onClick={() => setDraftingConfig({
                configuration: cv.configuration, objectives: cv.objectives, eligibilityRules: cv.eligibilityRules, deliveryModel: cv.deliveryModel,
                reporting: cv.reporting, entitlements: cv.entitlements, frameworkVersionId: cv.frameworkVersionId,
                participantConsentRequired: cv.participantConsentRequired, funderReportingEnabled: cv.funderReportingEnabled
              })}>Revise</Button>}
            </td>}
          </tr>)}
        </tbody></table></div>}
      </Async>
      {rejectingVersion !== null && <RejectForm busy={busyVersion === rejectingVersion} onCancel={() => setRejectingVersion(null)} onSubmit={(reason) => rejectVersion(rejectingVersion, reason)} />}
    </Card>
  </div>;
}
