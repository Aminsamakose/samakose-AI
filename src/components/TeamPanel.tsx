'use client';
import { useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { TeamRound } from '@/components/TeamRound';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, useApi, useForm, useToast } from '@/components/ui';

/** A notice reads "Heading. Body..." The first sentence is shown in bold. */
function Notice({ text }: { text: string }) { const i = text.indexOf('. '); return <span className="small"><b>{text.slice(0, i + 1)}</b>{text.slice(i + 1)}</span>; }

export function TeamPanel() {
  const team = useApi<any>('/team'); const areas = useApi<any>('/team/assignments');
  const reload = () => { team.reload(); areas.reload(); };
  return <div className="stack">
    <Async state={team}>{(t) => <>
      <Card title="Invite a colleague"><Invite t={t} onDone={reload} /></Card>
      <Card title="Your team">
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead><tbody>
          <tr><td>{t.me.name} (you)<div className="small muted">Owner of the account</div></td><td>{t.roles[t.me.jobRole] ?? t.me.jobRole ?? 'Owner'}</td><td><Badge tone="ok">Active</Badge></td><td /></tr>
          {t.members.map((m: any) => <tr key={m.id}>
          <td>{m.name}<div className="small muted">{m.email}</div></td><td>{t.roles[m.jobRole] ?? m.jobRole}</td><td><Badge tone={m.status === 'active' ? 'ok' : 'info'}>{m.status === 'active' ? 'Active' : 'Invited'}</Badge></td>
          <td><Row m={m} onDone={reload} /></td></tr>)}</tbody></table></div>
        {t.members.length === 0 && <p className="muted small">No colleagues yet. You can answer every area yourself, or invite people who know parts of the business better.</p>}</Card></>}</Async>
    <TeamRound />
    <Card title="Who answers what">
      <p className="muted small">These are suggestions based on each person's role. Nothing is final until you confirm it. Areas without a colleague stay with you.</p>
      <Async state={areas}>{(a) => <div className="table-wrap"><table><thead><tr><th>Area</th><th>Suggested</th><th>Answered by</th></tr></thead><tbody>{a.areas.map((x: any) => <Area key={x.code} a={x} members={a.members} onDone={reload} />)}</tbody></table></div>}</Async>
    </Card>
  </div>;
}

function Invite({ t, onDone }: { t: any; onDone: () => void }) {
  const [agree, setAgree] = useState(false); const [loc, setLoc] = useState<Record<string, string>>({});
  const f = useForm({ name: '', email: '', jobRole: '' }, async (v) => api.post('/team/members', { name: v.name.trim(), email: v.email.trim(), jobRole: v.jobRole, agree }), { success: 'Invitation sent', onDone: () => { f.setValues({ name: '', email: '', jobRole: '' }); setAgree(false); onDone(); } });
  if (!t.notice) return <p className="muted">Team invitations are not open yet.</p>;
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); const er: Record<string, string> = {};
    if (f.values.name.trim().length < 2) er.name = 'Enter their name';
    if (!/^\S+@\S+\.\S+$/.test(f.values.email.trim())) er.email = 'Enter a valid email address';
    if (!f.values.jobRole) er.jobRole = 'Choose their role';
    if (!agree) er.agree = 'Please confirm you have told them';
    setLoc(er); if (Object.keys(er).length === 0) f.onSubmit();
  };
  return <form className="stack" noValidate onSubmit={submit}>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Name" name="name" required error={loc.name ?? f.errors.name}>{(p) => <input {...p} {...f.input('name')} autoComplete="off" />}</Field>
      <Field label="Email" name="email" required error={loc.email ?? f.errors.email}>{(p) => <input {...p} type="email" {...f.input('email')} autoComplete="off" />}</Field>
      <Field label="Their role in the business" name="jobRole" required error={loc.jobRole ?? f.errors.jobRole}>{(p) => <select {...p} {...f.input('jobRole')}><option value="">Choose</option>{Object.entries(t.roles).map(([k, v]) => <option key={k} value={k}>{String(v)}</option>)}<option value={t.other}>Other</option></select>}</Field>
    </div>
    <Field label="" name="agree" error={loc.agree ?? f.errors.agree}>{(q) => <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}><input {...q} type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><Notice text={t.notice.text} /></label>}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Send invitation</Button></div>
  </form>;
}

function Row({ m, onDone }: { m: any; onDone: () => void }) {
  const toast = useToast();
  return <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
    {m.status === 'invited' && <Button onClick={async () => { try { await api.post(`/team/members/${m.id}/resend`, {}); toast('Invitation sent again'); } catch (e) { toast(errText(e), 'bad'); } }}>Resend</Button>}
    {m.status === 'invited'
      ? <ConfirmButton label="Cancel invitation" message={`Cancel the invitation to ${m.name}? The link already sent stops working. You can invite them again later.`} onConfirm={async () => { await api.post(`/team/members/${m.id}/cancel`, {}); toast('Invitation cancelled'); onDone(); }} />
      : <ConfirmButton label="Remove" message={`${m.name} will lose access and their areas come back to you. Their earlier answers are kept.`} onConfirm={async () => { await api.del(`/team/members/${m.id}`); toast('Removed'); onDone(); }} />}
  </div>;
}

function Area({ a, members, onDone }: { a: any; members: any[]; onDone: () => void }) {
  const toast = useToast();
  const cur = a.confirmed ?? a.suggested; const val = cur.kind === 'me' ? 'me' : cur.memberId;
  const set = async (v: string) => { try { await api.put(`/team/assignments/${encodeURIComponent(a.code)}`, { memberId: v === 'me' ? null : v }); toast('Saved'); onDone(); } catch (e) { toast(errText(e), 'bad'); } };
  return <tr><td>{a.name}{a.dimension ? <div className="small muted">{a.dimension}</div> : null}</td>
    <td className="small">{a.suggested.kind === 'me' ? 'You' : a.suggested.name}</td>
    <td><label className="sr" htmlFor={`area-${a.code}`}>Who answers {a.name}</label>
      <select id={`area-${a.code}`} value={val} onChange={(e) => set(e.target.value)}><option value="me">Me</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      {!a.confirmed && <span className="small muted"> Suggested</span>}</td></tr>;
}
