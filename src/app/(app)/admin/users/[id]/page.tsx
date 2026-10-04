'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiFail, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Field, FormError, KV, Modal, PageHead, Tabs, useApi, useToast } from '@/components/ui';
import { AuditTable } from '@/components/admin/AuditViews';
import { Guard, OrgPicker, ProgrammePicker, ROLE_OPTIONS, roleLabel, statusTone, userStatus, useDocTitle } from '@/components/admin/common';

type User = { id: string; code: string; email: string; name: string; role: string; roleLabel: string; orgId: string | null; active: boolean; mfaEnabled: boolean; lockedUntil: string | null; lastLoginAt: string | null; createdAt: string; invited: boolean; programmes: { id: string; code: string; name: string }[] };

function EditProfile({ u, self, onSaved }: { u: User; self: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: u.name, role: u.role, orgId: u.orgId ?? '', active: u.active });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setV({ name: u.name, role: u.role, orgId: u.orgId ?? '', active: u.active }); }, [u]);
  const set = (k: string, val: any) => { setV((x) => ({ ...x, [k]: val })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };
  const dirty = v.name.trim() !== u.name || v.role !== u.role || v.active !== u.active || (v.role === 'OWNER' ? v.orgId : '') !== (u.orgId ?? '');
  const deactivating = u.active && !v.active; const roleChange = v.role !== u.role;

  const validate = () => {
    const e: Record<string, string> = {};
    if (v.name.trim().length < 2) e.name = 'Enter at least 2 characters';
    if (v.role === 'OWNER' && !v.orgId) e.orgId = 'Choose the organisation this business owner belongs to';
    setErrors(e); return Object.keys(e).length === 0;
  };
  const save = async () => {
    setBusy(true); setFormError(null);
    try {
      await api.patch(`/users/${u.id}`, { name: v.name.trim(), role: v.role, active: v.active, orgId: v.role === 'OWNER' ? v.orgId : null });
      toast('Changes saved'); setConfirm(false); onSaved();
    } catch (err) {
      setConfirm(false);
      if (err instanceof ApiFail && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      setFormError(errText(err));
    } finally { setBusy(false); }
  };
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (!validate()) return; if (deactivating || roleChange) setConfirm(true); else save(); };
  return <form onSubmit={submit} noValidate className="stack">
    <FormError message={formError} />
    <div className="form-grid">
      <Field label="Full name" name="name" error={errors.name} required>{(p) => <input {...p} value={v.name} onChange={(e) => set('name', e.target.value)} />}</Field>
      <Field label="Role" name="role" error={errors.role} hint={self ? 'You cannot change your own role.' : 'Changing a role signs the person out everywhere.'}>{(p) => <select {...p} value={v.role} disabled={self} onChange={(e) => { set('role', e.target.value); set('orgId', ''); }}>{ROLE_OPTIONS.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select>}</Field>
    </div>
    {v.role === 'OWNER' && <OrgPicker value={v.orgId} onChange={(id) => set('orgId', id)} error={errors.orgId} required />}
    <div className="field"><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.active} disabled={self} onChange={(e) => set('active', e.target.checked)} />Account is active</label>
      <span className="hint">{self ? 'You cannot deactivate your own account.' : 'Inactive users cannot sign in. Their history is kept.'}</span></div>
    <div className="form-actions"><Button type="submit" variant="primary" loading={busy && !confirm} disabled={!dirty}>Save changes</Button></div>
    <Modal open={confirm} onClose={() => setConfirm(false)} title={deactivating ? 'Deactivate this account' : 'Change this role'}>
      <p>{deactivating ? `${u.name} will be signed out and will not be able to sign in until the account is reactivated.` : `${u.name} will change from ${roleLabel(u.role)} to ${roleLabel(v.role)} and will be signed out everywhere.`}{deactivating && roleChange ? ` Their role will also change to ${roleLabel(v.role)}.` : ''}</p>
      <div className="form-actions"><Button variant={deactivating ? 'danger' : 'primary'} loading={busy} onClick={save}>Confirm</Button><Button onClick={() => setConfirm(false)}>Cancel</Button></div>
    </Modal>
  </form>;
}

function ProgrammeAccess({ u, onSaved }: { u: User; onSaved: () => void }) {
  const toast = useToast();
  const [ids, setIds] = useState<string[]>(u.programmes.map((p) => p.id));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setIds(u.programmes.map((p) => p.id)); }, [u]);
  const cur = u.programmes.map((p) => p.id).sort().join(','); const dirty = [...ids].sort().join(',') !== cur;
  return <div className="stack">
    <p className="muted small">{u.role === 'FUNDER' ? 'Funders see aggregated results for the programmes selected here.' : 'Programme managers see the programmes selected here and their cases.'}</p>
    <FormError message={err} />
    <ProgrammePicker value={ids} onChange={setIds} />
    <div className="form-actions"><Button variant="primary" loading={busy} disabled={!dirty} onClick={async () => {
      setBusy(true); setErr(null);
      try { await api.put(`/users/${u.id}/programmes`, { programmeIds: ids }); toast('Programme access saved'); onSaved(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
    }}>Save programme access</Button></div>
  </div>;
}

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const st = useApi<User>(`/users/${id}`);
  const toast = useToast(); const router = useRouter();
  const [tab, setTab] = useState('by');
  useDocTitle(st.data ? st.data.name : 'User');
  const act = (path: string, msg: string) => async () => { await api.post(`/users/${id}/${path}`); toast(msg); st.reload(); };
  return <Guard resource="users" action="create" title="User">{(me) => <>
    <Async state={st}>{(u) => {
      const status = userStatus(u); const self = me.data?.user.id === u.id;
      const locked = status === 'Locked';
      return <>
        <PageHead title={u.name} crumbs={<Link href="/admin/users">Users</Link>} sub={<>{u.email} <span className="mono small">{u.code}</span></>}
          actions={<>
            {u.invited && u.active && <ConfirmButton label="Resend invite" variant="primary" message={`Send a new invitation email to ${u.email}? Earlier links stop being the latest.`} onConfirm={act('resend-invite', 'Invitation sent')} />}
            {u.invited && u.active && <ConfirmButton label="Cancel invitation" variant="danger" message={`Cancel the invitation to ${u.email}? Any link already sent stops working and the pending account is closed. An email already delivered cannot be recalled, but its link will say the invitation was withdrawn. You can invite the person again later.`} onConfirm={act('cancel-invite', 'Invitation cancelled')} />}
            {u.invited && !u.active && <ConfirmButton label="Delete invitation" variant="danger" message={`Delete ${u.email} for good? This cannot be undone. The audit log keeps a note that it was deleted.`} onConfirm={async () => { await api.del(`/users/${id}/invitation`); toast('Invitation deleted'); router.push('/admin/users'); }} />}
            {locked && <ConfirmButton label="Unlock account" message={`Clear the sign-in lockout for ${u.name}?`} onConfirm={act('unlock', 'Account unlocked')} />}
            {u.mfaEnabled && <ConfirmButton label="Reset two-step" variant="danger" message={`Remove two-step verification for ${u.name}? They are signed out and must set it up again. Only do this after confirming their identity.`} onConfirm={act('reset-mfa', 'Two-step verification reset')} />}
          </>} />
        <div className="grid two">
          <Card title="Profile">
            <KV items={[
              ['Status', <Badge key="s" tone={statusTone(status)}>{status}</Badge>],
              ['Role', u.roleLabel],
              ['Organisation', u.orgId ? <Link key="o" href={`/organisations/${u.orgId}`}>Open organisation</Link> : '-'],
              ['Two-step verification', u.mfaEnabled ? 'On' : 'Off'],
              ['Locked until', locked ? dateTime(u.lockedUntil) : 'Not locked'],
              ['Last sign-in', u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'],
              ['Created', dateTime(u.createdAt)]
            ]} />
            {u.invited && u.active && <div className="alert info" style={{ marginTop: 12 }}>This person has not accepted the invitation yet.</div>}
            {u.invited && !u.active && <div className="alert info" style={{ marginTop: 12 }}>This invitation was cancelled. Its links no longer work. You can delete it, or invite the person again from the Users page.</div>}
          </Card>
          <Card title="Edit account"><EditProfile u={u} self={self} onSaved={st.reload} /></Card>
        </div>
        {(u.role === 'PROGRAMME_MANAGER' || u.role === 'FUNDER') && <Card title="Programme access"><ProgrammeAccess u={u} onSaved={st.reload} /></Card>}
        <Card title="Recent activity">
          <Tabs tabs={[{ id: 'by', label: 'Actions by this user' }, { id: 'on', label: 'Changes to this account' }]} active={tab} onChange={setTab} />
          <div style={{ marginTop: 12 }}>
            {tab === 'by' ? <AuditTable key="by" fixed={{ actor: u.email }} filters={false} pageSize={10} searchable={false} /> : <AuditTable key="on" fixed={{ entity: 'user', q: u.id }} filters={false} pageSize={10} searchable={false} />}
          </div>
        </Card>
      </>;
    }}</Async>
  </>}</Guard>;
}
