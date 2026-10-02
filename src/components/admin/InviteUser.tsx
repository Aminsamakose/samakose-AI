'use client';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, Modal, useForm } from '@/components/ui';
import { fieldFail, OrgPicker, ProgrammePicker, ROLE_OPTIONS, validEmail } from './common';

function InviteForm({ onDone }: { onDone: () => void }) {
  const f = useForm({ email: '', name: '', role: 'EXPERT', orgId: '', programmeIds: [] as string[] }, async (v) => {
    const e: Record<string, string> = {};
    if (!v.email.trim()) e.email = 'Enter an email address'; else if (!validEmail(v.email)) e.email = 'Enter a valid email address, for example name@example.com';
    if (v.name.trim().length < 2) e.name = 'Enter at least 2 characters';
    if (v.role === 'OWNER' && !v.orgId) e.orgId = 'Choose the organisation this business owner belongs to';
    if (Object.keys(e).length) throw fieldFail(e);
    const withProgs = v.role === 'PROGRAMME_MANAGER' || v.role === 'FUNDER';
    return api.post('/users', { email: v.email.trim(), name: v.name.trim(), role: v.role, orgId: v.role === 'OWNER' ? v.orgId : undefined, programmeIds: withProgs && v.programmeIds.length ? v.programmeIds : undefined });
  }, { success: 'Invitation sent', onDone });
  const withProgs = f.values.role === 'PROGRAMME_MANAGER' || f.values.role === 'FUNDER';
  return <form onSubmit={f.onSubmit} noValidate className="stack">
    <p className="muted small">The person receives an email with a link to set their password. The link works for 7 days.</p>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Full name" name="name" error={f.errors.name} required>{(p) => <input {...p} {...f.input('name')} autoComplete="off" />}</Field>
      <Field label="Email" name="email" error={f.errors.email} required>{(p) => <input {...p} type="email" {...f.input('email')} autoComplete="off" />}</Field>
      <Field label="Role" name="role" error={f.errors.role} required hint="Only business owners are tied to an organisation.">{(p) => <select {...p} value={f.values.role} onChange={(e) => { f.set('role', e.target.value); f.set('orgId', ''); }}>{ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>
    </div>
    {f.values.role === 'OWNER' && <OrgPicker value={f.values.orgId} onChange={(id) => f.set('orgId', id)} error={f.errors.orgId} required />}
    {withProgs && <ProgrammePicker value={f.values.programmeIds} onChange={(ids) => f.set('programmeIds', ids)} error={f.errors.programmeIds} />}
    <div className="form-actions"><Button type="submit" variant="primary" loading={f.busy}>Send invitation</Button></div>
  </form>;
}

export function InviteUserDialog({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: () => void }) {
  return <Modal open={open} onClose={onClose} title="Invite a user"><InviteForm onDone={() => { onInvited(); onClose(); }} /></Modal>;
}
