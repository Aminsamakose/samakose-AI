'use client';
import { useState } from 'react';
import { dateTime } from '@/lib/client/api';
import { Badge, Button, DataTable, PageHead, type Col } from '@/components/ui';
import { Guard, ROLE_OPTIONS, roleLabel, statusTone, userStatus } from '@/components/admin/common';
import { InviteUserDialog } from '@/components/admin/InviteUser';

type UserRow = { id: string; code: string; email: string; name: string; role: string; orgId: string | null; active: boolean; mfaEnabled: boolean; lockedUntil: string | null; lastLoginAt: string | null; createdAt: string; invited: boolean };
const cols: Col<UserRow>[] = [
  { key: 'name', label: 'Name', sort: 'name' },
  { key: 'email', label: 'Email', sort: 'email' },
  { key: 'role', label: 'Role', sort: 'role', render: (u) => roleLabel(u.role) },
  { key: 'status', label: 'Status', render: (u) => { const s = userStatus(u); return <Badge tone={statusTone(s)}>{s}</Badge>; } },
  { key: 'mfa', label: 'Two-step', render: (u) => u.mfaEnabled ? 'On' : 'Off' },
  { key: 'lastLoginAt', label: 'Last sign-in', sort: 'lastLogin', render: (u) => <span className="num">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</span> }
];

export default function UsersPage() {
  const [role, setRole] = useState(''); const [active, setActive] = useState('');
  const [open, setOpen] = useState(false); const [tick, setTick] = useState(0);
  return <Guard resource="users" action="create" title="Users">{(me) => <>
    <PageHead title="Users" sub="People who can sign in to the platform, their roles and account status."
      actions={<Button variant="primary" onClick={() => setOpen(true)}>Invite user</Button>} />
    <div className="card">
      <DataTable<UserRow> endpoint="/users" columns={cols} params={{ role, active }} rowHref={(u) => `/admin/users/${u.id}`} exportable={me.can('users', 'export')} placeholder="Search name, email or code" refreshKey={tick}
        empty={{ title: 'No users yet', hint: 'Invite the first user to get started.' }}
        toolbar={<>
          <div className="field"><label htmlFor="uf-role">Role</label><select id="uf-role" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="uf-active">Account</label><select id="uf-active" value={active} onChange={(e) => setActive(e.target.value)}><option value="">Active and inactive</option><option value="true">Active only</option><option value="false">Inactive only</option></select></div>
        </>} />
    </div>
    <InviteUserDialog open={open} onClose={() => setOpen(false)} onInvited={() => setTick((t) => t + 1)} />
  </>}</Guard>;
}
