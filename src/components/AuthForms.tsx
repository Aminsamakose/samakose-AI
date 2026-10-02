'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiFail } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from './ui';
import { REGIONS, SECTORS, SIZES } from './portfolio/shared';

const dest = (next: string, fallback: string) => ({ ok: fallback, mfa: '/mfa', mfa_setup: '/mfa-setup', change_password: '/change-password', pending: '/pending', profile: '/complete-profile' } as Record<string, string>)[next] ?? fallback;
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard');

export function LoginForm() {
  const sp = useSearchParams();
  const f = useForm({ email: '', password: '' }, (v) => api.post('/auth/login', v), { onDone: (d) => { window.location.href = dest(d.next, safeNext(sp.get('next'))); } });
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <h1>Sign in</h1>
    <GoogleNotice />
    <GoogleButton />
    <FormError message={f.formError} />
    <Field label="Email" name="email" error={f.errors.email} required>{(p) => <input {...p} type="email" autoComplete="username" autoFocus {...f.input('email')} />}</Field>
    <Field label="Password" name="password" error={f.errors.password} required>{(p) => <input {...p} type="password" autoComplete="current-password" {...f.input('password')} />}</Field>
    <Button variant="primary" loading={f.busy} type="submit">Sign in</Button>
    <Link href="/forgot-password" className="small">Forgot your password?</Link>
    <span className="small muted">New here? <Link href="/register">Create an account</Link></span>
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

const SELF = [['OWNER', 'Business owner', 'You run a business and want a health check'], ['EXPERT', 'Expert, consultant or coach', 'You advise, coach or mentor businesses'], ['PROGRAMME_MANAGER', 'Programme manager', 'You run a programme or cohort'], ['FUNDER', 'Partner or funder', 'You support or fund enterprises']] as const;

export function RegisterForm() {
  const [prov, setProv] = useState<{ selfRegistration: boolean; roles: string[] } | null>(null);
  useEffect(() => { api.get<{ selfRegistration: boolean; roles: string[] }>('/auth/providers').then(setProv).catch(() => setProv({ selfRegistration: true, roles: SELF.map((s) => s[0]) })); }, []);
  if (!prov) return <div className="stack"><span className="spin" role="status" aria-label="Loading" /></div>;
  if (!prov.selfRegistration) return <div className="stack"><h1>Registration is closed</h1><p className="muted">New accounts are by invitation at the moment. If you expect to be invited, ask your Samakose contact to send the invitation again.</p><Link href="/login">Back to sign in</Link></div>;
  return <RegisterFormInner roles={prov.roles} />;
}

function RegisterFormInner({ roles }: { roles: string[] }) {
  const [done, setDone] = useState(false); const [consent, setConsent] = useState(false);
  const f = useForm({ name: '', email: '', password: '', role: roles[0] ?? 'OWNER', orgName: '', orgType: 'SME', note: '' }, async (v) => {
    const e: Record<string, string> = {};
    if (v.name.trim().length < 2) e.name = 'Enter your name';
    if (!/^\S+@\S+\.\S+$/.test(v.email)) e.email = 'Enter a valid email address';
    if (v.password.length < 10) e.password = 'Use at least 10 characters';
    if (v.orgName.trim().length < 2) e.orgName = v.role === 'OWNER' ? 'Enter your business name' : 'Enter your organisation';
    if (!consent) e.consent = 'Please accept the terms and privacy notice';
    if (Object.keys(e).length) throw new ApiFail(422, 'validation', 'Check the highlighted fields', e);
    return api.post('/auth/register', { ...v, consent, orgType: v.role === 'OWNER' ? v.orgType : undefined });
  }, { onDone: () => setDone(true) });
  if (done) return <div className="stack"><h1>Check your email</h1><p className="muted">We sent a link to <b>{f.values.email}</b>. Open it to confirm your address.</p>
    <p className="small muted">{f.values.role === 'OWNER' ? 'After you confirm, you can sign in and start your health check. Our team checks business details before any report leaves your organisation.' : 'After you confirm, an administrator reviews your request. You will not see any organisation or programme data until you are approved and linked to your work.'}</p>
    <Link href="/login">Back to sign in</Link></div>;
  const owner = f.values.role === 'OWNER';
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <h1>Create your account</h1>
    <GoogleNotice />
    <GoogleButton label="Sign up with Google" />
    <FormError message={f.formError} />
    <Field label="I am a" name="role">{(p) => <select {...p} {...f.input('role')}>{SELF.filter(([v]) => roles.includes(v)).map(([v, l, h]) => <option key={v} value={v}>{l} ({h})</option>)}</select>}</Field>
    <Field label="Your name" name="name" error={f.errors.name} required>{(p) => <input {...p} autoComplete="name" {...f.input('name')} />}</Field>
    <Field label="Email" name="email" error={f.errors.email} required>{(p) => <input {...p} type="email" autoComplete="email" {...f.input('email')} />}</Field>
    <Field label="Password" name="password" error={f.errors.password} hint="At least 10 characters." required>{(p) => <input {...p} type="password" autoComplete="new-password" {...f.input('password')} />}</Field>
    <Field label={owner ? 'Business name' : 'Organisation or employer'} name="orgName" error={f.errors.orgName} required>{(p) => <input {...p} {...f.input('orgName')} />}</Field>
    {owner && <Field label="Type of business" name="orgType">{(p) => <select {...p} {...f.input('orgType')}><option value="SME">SME</option><option value="AGRIFOOD">Agribusiness or food</option><option value="ESO">Support organisation</option></select>}</Field>}
    {!owner && <Field label="What do you want to do on the platform?" name="note" hint="Optional. This helps the administrator review your request.">{(p) => <textarea {...p} rows={3} {...f.input('note')} />}</Field>}
    <Field label="" name="consent" error={f.errors.consent}>{(p) => <label className="row" style={{ gap: 8 }}><input {...p} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span className="small">I accept the <a href="/terms" target="_blank">terms</a> and the <a href="/privacy" target="_blank">privacy notice</a>.</span></label>}</Field>
    <Button variant="primary" loading={f.busy} type="submit">Create account</Button>
    <span className="small muted">Already registered? <Link href="/login">Sign in</Link></span>
  </form>;
}

export function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'idle' | 'ok' | 'pending' | 'err'>('idle'); const [msg, setMsg] = useState('');
  const go = async () => { try { const d = await api.post('/auth/verify-email', { token }); setState(d.next === 'ok' ? 'ok' : 'pending'); } catch (e: any) { setMsg(e.message); setState('err'); } };
  return <div className="stack"><h1>Confirm your email</h1>
    {state === 'idle' && <><p className="muted">Press the button to confirm your address.</p><Button variant="primary" onClick={go} disabled={!token}>Confirm email</Button></>}
    {state === 'ok' && <><p>Your email is confirmed.</p><Link className="btn primary" href="/login">Sign in</Link></>}
    {state === 'pending' && <><p>Your email is confirmed. An administrator will review your request. You can sign in to check its status.</p><Link className="btn primary" href="/login">Sign in</Link></>}
    {state === 'err' && <><FormError message={msg} /><ResendVerification /></>}
  </div>;
}

function ResendVerification() {
  const [sent, setSent] = useState(false);
  const f = useForm({ email: '' }, (v) => api.post('/auth/resend-verification', v), { onDone: () => setSent(true) });
  if (sent) return <p className="muted">If that address is waiting for confirmation, we sent a new link.</p>;
  return <form onSubmit={f.onSubmit} className="stack" noValidate><Field label="Email" name="email" error={f.errors.email}>{(p) => <input {...p} type="email" {...f.input('email')} />}</Field><Button loading={f.busy} type="submit">Send a new link</Button></form>;
}

export function PendingNotice() {
  return <div className="stack"><h1>Waiting for approval</h1>
    <p className="muted">Your registration is with the Samakose team. You will get an email when it is approved. Until then you cannot see any organisation, programme or report data.</p>
    <button type="button" className="btn ghost" onClick={async () => { await api.post('/auth/logout').catch(() => {}); window.location.href = '/login'; }}>Sign out</button></div>;
}

const GOOGLE_ERR: Record<string, string> = {
  google_failed: 'Google sign-in did not work. Please try again or use your email and password.',
  google_off: 'Google sign-in is not switched on yet. Use your email and password.',
  google_not_allowed: 'Google sign-in is for business owners. Staff and partners sign in with their email and password.'
};

/** "Continue with Google" appears only when the platform has Google keys. Owners only. */
export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => { api.get<{ google: boolean }>('/auth/providers').then((d) => setOn(!!d.google)).catch(() => {}); }, []);
  if (!on) return null;
  return <div className="stack" style={{ gap: 10 }}>
    <a className="btn" href="/api/v1/auth/google/start" style={{ textDecoration: 'none', gap: 10 }}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.9-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
      {label}
    </a>
    <p className="small muted" style={{ textAlign: 'center' }}>For business owners. Staff and partners use email and password.</p>
    <div className="row small muted" style={{ gap: 10 }} aria-hidden="true"><hr style={{ flex: 1, border: 0, borderTop: '1px solid var(--line)' }} />or<hr style={{ flex: 1, border: 0, borderTop: '1px solid var(--line)' }} /></div>
  </div>;
}

export function GoogleNotice() {
  const e = useSearchParams().get('error');
  return e && GOOGLE_ERR[e] ? <div role="alert" className="alert bad">{GOOGLE_ERR[e]}</div> : null;
}

type Profile = { required: boolean; name: string; type: string; sector: string | null; region: string | null; district: string | null; size: string | null; contactPhone: string | null; registrationNumber: string | null; consentGiven: boolean };
export function CompleteProfile() {
  const [p, setP] = useState<Profile | null>(null); const [err, setErr] = useState<string | null>(null); const [consent, setConsent] = useState(false);
  useEffect(() => { api.get<Profile>('/auth/profile').then(setP).catch((e: any) => setErr(e.message)); }, []);
  const f = useForm({ name: '', type: 'SME', sector: '', region: '', district: '', size: '', contactPhone: '', registrationNumber: '' }, async (v) => {
    const e: Record<string, string> = {};
    if (v.name.trim().length < 2 || /to confirm\)$/.test(v.name)) e.name = 'Enter your real business name';
    if (!v.sector.trim()) e.sector = 'Choose or type your sector';
    if (!v.region) e.region = 'Choose your region';
    if (!v.district.trim()) e.district = 'Enter your district or town';
    if (!v.size) e.size = 'Choose the number of people';
    if ((v.contactPhone.match(/\d/g) ?? []).length < 9) e.contactPhone = 'Enter a phone number we can reach you on';
    if (!consent && !p?.consentGiven) e.consent = 'Please agree so we can use your business information';
    if (Object.keys(e).length) throw new ApiFail(422, 'validation', 'Check the highlighted fields', e);
    return api.put('/auth/profile', { ...v, consent: consent || !!p?.consentGiven });
  }, { onDone: () => { window.location.href = '/dashboard'; } });
  useEffect(() => { if (p) f.setValues({ name: p.name.endsWith('to confirm)') ? '' : p.name, type: p.type, sector: p.sector ?? '', region: p.region ?? '', district: p.district ?? '', size: p.size ?? '', contactPhone: p.contactPhone ?? '', registrationNumber: p.registrationNumber ?? '' }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p]);
  if (err) return <div className="stack"><h1>Complete your profile</h1><FormError message={err} /><Link href="/login">Sign in</Link></div>;
  if (!p) return <div className="stack"><h1>Complete your profile</h1><span className="spin" role="status" aria-label="Loading" /></div>;
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <h1>Tell us about your business</h1>
    <p className="muted">This takes about two minutes. We use it to ask the right questions and to read your results in context. You need to finish it before you can use the platform.</p>
    <FormError message={f.formError} />
    <Field label="Business name" name="name" error={f.errors.name} required>{(q) => <input {...q} {...f.input('name')} />}</Field>
    <Field label="Type of business" name="type">{(q) => <select {...q} {...f.input('type')}><option value="SME">SME</option><option value="AGRIFOOD">Agribusiness or food</option><option value="ESO">Support organisation</option></select>}</Field>
    <Field label="Sector" name="sector" error={f.errors.sector} required>{(q) => <><input {...q} list="sectors" {...f.input('sector')} /><datalist id="sectors">{SECTORS.map((x) => <option key={x} value={x} />)}</datalist></>}</Field>
    <Field label="Region" name="region" error={f.errors.region} required>{(q) => <select {...q} {...f.input('region')}><option value="">Choose a region</option>{REGIONS.map((x) => <option key={x}>{x}</option>)}</select>}</Field>
    <Field label="District or town" name="district" error={f.errors.district} required>{(q) => <input {...q} {...f.input('district')} />}</Field>
    <Field label="Number of people working in the business" name="size" error={f.errors.size} required>{(q) => <select {...q} {...f.input('size')}><option value="">Choose</option>{SIZES.map((x) => <option key={x}>{x}</option>)}</select>}</Field>
    <Field label="Phone number" name="contactPhone" error={f.errors.contactPhone} hint="A number we can call or message on WhatsApp." required>{(q) => <input {...q} type="tel" autoComplete="tel" {...f.input('contactPhone')} />}</Field>
    <Field label="Business registration number" name="registrationNumber" hint="Optional. Adding it helps us verify your business sooner.">{(q) => <input {...q} {...f.input('registrationNumber')} />}</Field>
    {!p.consentGiven && <Field label="" name="consent" error={f.errors.consent}>{(q) => <label className="row" style={{ gap: 8 }}><input {...q} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span className="small">I agree that Samakose may use my business information to run my health check, as set out in the <a href="/privacy" target="_blank">privacy notice</a>.</span></label>}</Field>}
    <Button variant="primary" loading={f.busy} type="submit">Save and continue</Button>
    <button type="button" className="btn ghost" onClick={async () => { await api.post('/auth/logout').catch(() => {}); window.location.href = '/login'; }}>Sign out</button>
  </form>;
}
