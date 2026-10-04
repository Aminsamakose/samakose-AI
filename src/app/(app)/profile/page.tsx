'use client';
import { useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Field, FormError, KV, PageHead, useForm, useToast } from '@/components/ui';
import { useMe, useTitle } from '@/components/dash/common';
import { OptionalCard } from '@/components/OptionalAnswers';
import { RecoveryCodes } from '@/components/RecoveryCodes';
import { PhotoCard, PractitionerProfileCard } from '@/components/PractitionerProfile';

function NameForm({ name, onSaved }: { name: string; onSaved: () => void }) {
  const f = useForm({ name }, async (v) => { return api.patch('/auth/me', { name: v.name.trim() }); }, { success: 'Name updated', onDone: onSaved });
  const [local, setLocal] = useState<string | null>(null);
  return <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); if (f.values.name.trim().length < 2) { setLocal('Enter your full name'); return; } setLocal(null); f.onSubmit(); }}>
    <FormError message={f.formError} />
    <Field label="Full name" name="name" required error={local ?? f.errors.name}>{(p) => <input {...p} {...f.input('name')} autoComplete="name" maxLength={120} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save name</Button></div>
  </form>;
}

function PasswordForm() {
  const [local, setLocal] = useState<Record<string, string>>({});
  const f = useForm({ current: '', next: '', confirm: '' }, async (v) => api.post('/auth/change-password', { current: v.current, next: v.next }), { success: 'Password changed. Other devices have been signed out.', onDone: () => { f.setValues({ current: '', next: '', confirm: '' }); } });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!f.values.current) err.current = 'Enter your current password';
    if (!f.values.next) err.next = 'Enter a new password';
    else if (f.values.next.length < 12) err.next = 'Use at least 12 characters';
    if (f.values.next && f.values.confirm !== f.values.next) err.confirm = 'The two passwords do not match';
    setLocal(err); if (Object.keys(err).length) return;
    f.onSubmit();
  };
  return <form className="stack" noValidate onSubmit={submit}>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Current password" name="current" required error={local.current ?? f.errors.current}>{(p) => <input {...p} {...f.input('current')} type="password" autoComplete="current-password" />}</Field>
      <span />
      <Field label="New password" name="next" required error={local.next ?? f.errors.password ?? f.errors.next} hint="At least 12 characters with letters and numbers. Do not include your name or email name.">{(p) => <input {...p} {...f.input('next')} type="password" autoComplete="new-password" />}</Field>
      <Field label="Confirm new password" name="confirm" required error={local.confirm ?? f.errors.confirm}>{(p) => <input {...p} {...f.input('confirm')} type="password" autoComplete="new-password" />}</Field>
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Change password</Button></div>
  </form>;
}

type Setup = { secret: string; otpauthUrl: string; qr: string };
function RecoverySection({ left, onShown }: { left: number; onShown: (codes: string[]) => void }) {
  const f = useForm({ password: '', code: '' }, (v) => api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { password: v.password, code: v.code.trim() }), { onDone: (d) => { f.setValues({ password: '', code: '' }); onShown(d.recoveryCodes); } });
  const [loc, setLoc] = useState<Record<string, string>>({});
  return <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); const err: Record<string, string> = {}; if (!f.values.password) err.password = 'Enter your password'; if (!/^\d{6}$/.test(f.values.code.trim())) err.code = 'Enter the 6-digit code'; setLoc(err); if (!Object.keys(err).length) f.onSubmit(); }}>
    <p><strong>Recovery codes:</strong> {left > 0 ? <>{left} unused. </> : <Badge tone="warn">None left</Badge>} {left === 0 && ' '}Each code signs you in once if you lose your phone.{left <= 2 && ' Make a new set soon.'}</p>
    <FormError message={f.formError} />
    <p className="small muted">Making a new set replaces the old one. Confirm your password and a current code.</p>
    <div className="form-grid">
      <Field label="Password" name="rc-password" required error={loc.password ?? f.errors.password}>{(p) => <input {...p} {...f.input('password')} type="password" autoComplete="current-password" />}</Field>
      <Field label="6-digit code" name="rc-code" required error={loc.code ?? f.errors.code}>{(p) => <input {...p} {...f.input('code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />}</Field>
    </div>
    <div className="form-actions"><Button type="submit" loading={f.busy}>Make new recovery codes</Button></div>
  </form>;
}

function MfaSection({ enabled, recoveryLeft, onChanged }: { enabled: boolean; recoveryLeft: number; onChanged: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState<string | null>(null);
  const start = async () => { setStarting(true); setStartErr(null); try { setSetup(await api.post<Setup>('/auth/mfa/setup')); } catch (e) { setStartErr(errText(e)); } finally { setStarting(false); } };
  const enable = useForm({ code: '' }, (v) => api.post('/auth/mfa/enable', { code: v.code.trim() }), { success: 'Two-step verification is on', onDone: (d) => { setSetup(null); setCodes(d.recoveryCodes); } });
  const disable = useForm({ password: '', code: '' }, (v) => api.post('/auth/mfa/disable', { password: v.password, code: v.code.trim() }), { success: 'Two-step verification is off', onDone: () => { disable.setValues({ password: '', code: '' }); onChanged(); } });
  const [loc, setLoc] = useState<Record<string, string>>({});
  const checkCode = (code: string, extra?: { password: string }) => {
    const err: Record<string, string> = {};
    if (!/^\d{6}$/.test(code.trim())) err.code = 'Enter the 6-digit code';
    if (extra && !extra.password) err.password = 'Enter your password';
    setLoc(err); return !Object.keys(err).length;
  };
  if (codes) return <RecoveryCodes codes={codes} onDone={() => { setCodes(null); onChanged(); }} />;
  if (enabled) return <div className="stack"><RecoverySection left={recoveryLeft} onShown={setCodes} /><hr /><form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); if (checkCode(disable.values.code, disable.values)) disable.onSubmit(); }}>
    <p><Badge tone="ok">On</Badge> Your account asks for a code from your authenticator app each time you sign in.</p>
    <FormError message={disable.formError} />
    <p className="small muted">To turn it off, confirm your password and a current code. Some roles must keep two-step verification on, and the system will tell you if yours is one of them.</p>
    <div className="form-grid">
      <Field label="Password" name="password" required error={loc.password ?? disable.errors.password}>{(p) => <input {...p} {...disable.input('password')} type="password" autoComplete="current-password" />}</Field>
      <Field label="6-digit code" name="code" required error={loc.code ?? disable.errors.code}>{(p) => <input {...p} {...disable.input('code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />}</Field>
    </div>
    <div className="form-actions"><Button variant="danger" type="submit" loading={disable.busy}>Turn off two-step verification</Button></div>
  </form></div>;
  if (!setup) return <div className="stack">
    <p><Badge>Off</Badge> Add a second step at sign in using an authenticator app on your phone.</p>
    <FormError message={startErr} />
    <div className="form-actions"><Button variant="primary" onClick={start} loading={starting}>Set up two-step verification</Button></div>
  </div>;
  return <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); if (checkCode(enable.values.code)) enable.onSubmit(); }}>
    <ol style={{ paddingLeft: 20, margin: 0 }} className="stack">
      <li>Open an authenticator app and scan this code.<div style={{ marginTop: 8 }}><img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} style={{ background: '#fff', padding: 6, borderRadius: 8 }} /></div></li>
      <li>Cannot scan? Enter this key by hand: <code className="mono" style={{ wordBreak: 'break-all' }}>{setup.secret}</code></li>
      <li>Type the 6-digit code the app shows to finish.</li>
    </ol>
    <FormError message={enable.formError} />
    <Field label="6-digit code" name="code" required error={loc.code ?? enable.errors.code}>{(p) => <input {...p} {...enable.input('code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} style={{ maxWidth: 180 }} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={enable.busy}>Turn on</Button><Button type="button" onClick={() => setSetup(null)}>Cancel</Button></div>
  </form>;
}

export default function ProfilePage() {
  useTitle('Profile');
  const me = useMe();
  const toast = useToast();
  return <>
    <PageHead title="Profile and security" />
    <Async state={me}>{(d) => <div className="stack">
      <Card title="Your details">
        <div className="stack">
          <KV items={[['Email', d.user.email], ['Role', d.user.roleLabel], ['User code', (d.user as any).code ?? '-']]} />
          <NameForm name={d.user.name} onSaved={me.reload} />
        </div>
      </Card>
      <PhotoCard name={d.user.name} photoUrl={(d.user as any).photoUrl ?? null} onChanged={me.reload} />
      {d.user.role === 'EXPERT' && <PractitionerProfileCard onPhotoChange={me.reload} />}
      <OptionalCard />
      <Card title="Change password"><PasswordForm /></Card>
      <Card title="Two-step verification"><MfaSection enabled={d.user.mfaEnabled} recoveryLeft={(d as any).recoveryCodesLeft ?? 0} onChanged={me.reload} /></Card>
      <Card title="Sessions">
        <div className="stack">
          <p>You are signed in on this device. If you used a shared or lost device, sign out everywhere else.</p>
          <div><ConfirmButton label="Sign out other sessions" message="Every other device signed in to your account will be signed out. This device stays signed in." onConfirm={async () => { await api.post('/auth/logout-others'); toast('Other sessions signed out'); }} /></div>
        </div>
      </Card>
    </div>}</Async>
  </>;
}
