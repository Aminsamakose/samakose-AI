'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from './ui';

const dest = (next: string, fallback: string) => ({ ok: fallback, mfa: '/mfa', mfa_setup: '/mfa-setup', change_password: '/change-password' } as Record<string, string>)[next] ?? fallback;
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard');

export function LoginForm() {
  const sp = useSearchParams();
  const f = useForm({ email: '', password: '' }, (v) => api.post('/auth/login', v), { onDone: (d) => { window.location.href = dest(d.next, safeNext(sp.get('next'))); } });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <h1>Sign in</h1>
    <FormError message={f.formError} />
    <Field label="Email" name="email" error={f.errors.email} required>{(p) => <input {...p} type="email" autoComplete="username" autoFocus {...f.input('email')} />}</Field>
    <Field label="Password" name="password" error={f.errors.password} required>{(p) => <input {...p} type="password" autoComplete="current-password" {...f.input('password')} />}</Field>
    <Button variant="primary" loading={f.busy} type="submit">Sign in</Button>
    <Link href="/forgot-password" className="small">Forgot your password?</Link>
  </form>;
}

export function MfaForm() {
  const f = useForm({ code: '' }, (v) => api.post('/auth/mfa/verify', v), { onDone: (d) => { window.location.href = dest(d.next, '/dashboard'); } });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <h1>Two-step verification</h1>
    <p className="muted">Enter the 6-digit code from your authenticator app.</p>
    <FormError message={f.formError} />
    <Field label="Code" name="code" error={f.errors.code} required>{(p) => <input {...p} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} autoFocus {...f.input('code')} />}</Field>
    <Button variant="primary" loading={f.busy} type="submit">Verify</Button>
    <button type="button" className="btn ghost" onClick={async () => { await api.post('/auth/logout').catch(() => {}); window.location.href = '/login'; }}>Use a different account</button>
  </form>;
}

export function MfaSetupForm() {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const f = useForm({ code: '' }, (v) => api.post('/auth/mfa/enable', v), { onDone: () => { window.location.href = '/dashboard'; } });
  return <div className="stack">
    <h1>Set up two-step verification</h1>
    <p className="muted">Your role needs a second step at sign-in. Use an authenticator app such as Google Authenticator or Microsoft Authenticator.</p>
    <FormError message={err} />
    {!setup ? <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { setSetup(await api.post('/auth/mfa/setup')); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>Start setup</Button> : <form onSubmit={f.onSubmit} className="stack" noValidate>
      <img src={setup.qr} alt="QR code for your authenticator app" width={220} height={220} style={{ alignSelf: 'center' }} />
      <p className="small muted">Cannot scan? Enter this key by hand: <span className="mono">{setup.secret}</span></p>
      <FormError message={f.formError} />
      <Field label="Code from the app" name="code" error={f.errors.code} required>{(p) => <input {...p} inputMode="numeric" autoComplete="one-time-code" maxLength={6} {...f.input('code')} />}</Field>
      <Button variant="primary" loading={f.busy} type="submit">Turn on</Button>
    </form>}
  </div>;
}

export function ChangePasswordForm({ forced }: { forced?: boolean }) {
  const f = useForm({ current: '', password: '', confirm: '' }, (v) => api.post('/auth/change-password', { current: v.current, next: v.password }), { onDone: () => { window.location.href = '/dashboard'; } });
  const mismatch = f.values.confirm !== '' && f.values.confirm !== f.values.password;
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <h1>{forced ? 'Choose a new password' : 'Change password'}</h1>
    {forced && <p className="muted">You need to set your own password before you continue.</p>}
    <FormError message={f.formError} />
    <Field label="Current password" name="current" error={f.errors.current} required>{(p) => <input {...p} type="password" autoComplete="current-password" {...f.input('current')} />}</Field>
    <Field label="New password" name="password" error={f.errors.password} hint="At least 12 characters. Avoid your name or email." required>{(p) => <input {...p} type="password" autoComplete="new-password" {...f.input('password')} />}</Field>
    <Field label="Confirm new password" name="confirm" error={mismatch ? 'Passwords do not match' : undefined} required>{(p) => <input {...p} type="password" autoComplete="new-password" {...f.input('confirm')} />}</Field>
    <Button variant="primary" loading={f.busy} type="submit" disabled={mismatch || !f.values.confirm}>Save password</Button>
  </form>;
}

export function ForgotForm() {
  const [done, setDone] = useState(false);
  const f = useForm({ email: '' }, (v) => api.post('/auth/forgot', v), { onDone: () => setDone(true) });
  if (done) return <div className="stack"><h1>Check your email</h1><p className="muted">If an account exists for that address, a reset link is on its way. It works for one hour.</p><Link href="/login" className="btn">Back to sign in</Link></div>;
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <h1>Reset your password</h1><FormError message={f.formError} />
    <Field label="Email" name="email" error={f.errors.email} required>{(p) => <input {...p} type="email" autoComplete="username" {...f.input('email')} />}</Field>
    <Button variant="primary" loading={f.busy} type="submit">Send reset link</Button><Link href="/login" className="small">Back to sign in</Link>
  </form>;
}

export function TokenPasswordForm({ mode }: { mode: 'reset' | 'accept' }) {
  const sp = useSearchParams(); const token = sp.get('token') ?? '';
  const f = useForm({ password: '', confirm: '' }, (v) => api.post(mode === 'reset' ? '/auth/reset' : '/auth/accept-invite', { token, password: v.password }), { onDone: () => { window.location.href = '/login?done=1'; } });
  if (!token) return <div className="stack"><h1>Link incomplete</h1><p className="muted">Open the link from your email again, or request a new one.</p><Link className="btn" href="/forgot-password">Request a new link</Link></div>;
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <h1>{mode === 'reset' ? 'Choose a new password' : 'Welcome to Samakose'}</h1>
    {mode === 'accept' && <p className="muted">Set a password to activate your account.</p>}
    <FormError message={f.formError} />
    <Field label="Password" name="password" error={f.errors.password} hint="At least 12 characters. Avoid your name or email." required>{(p) => <input {...p} type="password" autoComplete="new-password" {...f.input('password')} />}</Field>
    <Field label="Confirm password" name="confirm" error={f.values.confirm && f.values.confirm !== f.values.password ? 'Passwords do not match' : undefined} required>{(p) => <input {...p} type="password" autoComplete="new-password" {...f.input('confirm')} />}</Field>
    <Button variant="primary" loading={f.busy} type="submit" disabled={f.values.password !== f.values.confirm || !f.values.confirm}>Save and continue</Button>
  </form>;
}
