'use client';
import { useState } from 'react';
import { api, errText, ApiFail } from '@/lib/client/api';
import { Button, Modal, useApi, useToast } from './ui';
import { ROLE_LABEL } from '@/lib/rbac';
import type { Role } from '@/db/schema';
import { Icon } from './Icon';

type Roles = { primaryRole: Role; activeRole: Role; additionalRoles: Role[] };

/**
 * One account can hold more than one authorised role (an expert who is also a trained
 * reviewer, say), switchable here one at a time -- never both acting at once. Shown only to
 * people who actually have an additional approved role, so it adds nothing to anyone else's
 * screen. Requesting a new additional role is a separate, lower-traffic action under My profile.
 */
export function RoleSwitcher() {
  const roles = useApi<Roles>('/me/roles');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!roles.data || roles.data.additionalRoles.length === 0) return null;
  const { activeRole, primaryRole, additionalRoles } = roles.data;
  const options = [primaryRole, ...additionalRoles];

  const switchTo = async (role: Role) => {
    setBusy(true);
    try {
      await api.post('/me/roles/switch', { role: role === primaryRole ? null : role });
      toast(`Now acting as ${ROLE_LABEL[role]}`);
      window.location.reload(); // full reload: the nav and every permission check are resolved server-side from the session
    } catch (e) { toast(e instanceof ApiFail ? e.message : errText(e)); setBusy(false); }
  };

  return <>
    <Button className="btn ghost" onClick={() => setOpen(true)} title="Switch which role this session acts as">
      <Icon name="users" />Acting as {ROLE_LABEL[activeRole]}
    </Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Switch role">
      <p className="muted">Choose which authorised role this session acts as. Only one role is active at a time.</p>
      <div className="stack" role="radiogroup" aria-label="Role">
        {options.map((r) => <label key={r} className="row" style={{ gap: 8 }}>
          <input type="radio" name="active-role" checked={r === activeRole} disabled={busy} onChange={() => switchTo(r)} />
          <span>{ROLE_LABEL[r]}{r === primaryRole && <span className="small muted"> (your primary role)</span>}</span>
        </label>)}
      </div>
      <div className="form-actions"><Button type="button" onClick={() => setOpen(false)}>Close</Button></div>
    </Modal>
  </>;
}
