'use client';
import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

const INTERESTS = [
  'A health check for my business',
  'A health check for my cooperative or agribusiness',
  'A tool for my support programme or accelerator',
  'Partnership or funding',
  'Coaching or consulting support',
  'Request a demo of the platform',
  'Something else'
];
type Errors = Record<string, string>;
const ctl = 'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-fg placeholder:text-muted/70 focus-visible:outline-2';

export function ContactForm({ source = 'contact-page' }: { source?: string }) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const interest = String(f.get('interest') ?? '');
    const body = {
      kind: interest === 'Request a demo of the platform' ? 'demo' : 'contact',
      name: String(f.get('name') ?? ''), email: String(f.get('email') ?? ''), organisation: String(f.get('organisation') ?? ''),
      phone: String(f.get('phone') ?? ''), interest, message: String(f.get('message') ?? ''), consent: f.get('consent') === 'on' ? true : false,
      website: String(f.get('website') ?? ''), source
    };
    const local: Errors = {};
    if (body.name.trim().length < 2) local.name = 'Enter your name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) local.email = 'Enter a valid email address';
    if (body.message.trim().length < 10) local.message = 'Tell us a little more (at least 10 characters)';
    if (!body.consent) local.consent = 'Please confirm you agree to be contacted';
    if (Object.keys(local).length) { setErrors(local); setFormError('Please check the highlighted fields.'); return; }
    setState('sending'); setErrors({}); setFormError(null);
    try {
      const res = await fetch('/api/v1/public/inquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) { setState('done'); return; }
      const j = await res.json().catch(() => null);
      if (res.status === 429) setFormError('Too many messages from this connection. Please wait a few minutes or email us directly.');
      else if (j?.error?.details && typeof j.error.details === 'object') { setErrors(j.error.details as Errors); setFormError('Please check the highlighted fields.'); }
      else setFormError('We could not send your message. Please try again or email us directly.');
    } catch { setFormError('We could not reach the server. Check your connection and try again, or email us directly.'); }
    setState('idle');
  }

  if (state === 'done') {
    return (
      <div role="status" className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-8">
        <CheckCircle2 className="size-8 text-leaf" aria-hidden="true" />
        <h3 className="font-display text-2xl font-bold">Thank you. We have your message.</h3>
        <p className="text-muted">Someone from the Samakose team will reply by email. If it is urgent, call us on the number shown on this page.</p>
      </div>
    );
  }
  const err = (k: string) => errors[k] ? <p id={`${id}-${k}-e`} role="alert" className="mt-1 text-sm font-semibold text-[color:var(--bad)]">{errors[k]}</p> : null;
  const a11y = (k: string) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `${id}-${k}-e` : undefined });
  const lbl = 'mb-1 block text-sm font-semibold';
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6 sm:p-8" aria-label="Contact form">
      {formError && <div role="alert" className="rounded-xl border border-[color:var(--bad)] bg-[color:var(--bad-soft)] px-4 py-3 text-sm font-semibold text-[color:var(--bad)]">{formError}</div>}
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label htmlFor={`${id}-name`} className={lbl}>Your name <span aria-hidden="true">*</span></label><input id={`${id}-name`} name="name" autoComplete="name" required className={ctl} {...a11y('name')} />{err('name')}</div>
        <div><label htmlFor={`${id}-email`} className={lbl}>Email <span aria-hidden="true">*</span></label><input id={`${id}-email`} name="email" type="email" autoComplete="email" required className={ctl} {...a11y('email')} />{err('email')}</div>
        <div><label htmlFor={`${id}-org`} className={lbl}>Business or organisation</label><input id={`${id}-org`} name="organisation" autoComplete="organization" className={ctl} /></div>
        <div><label htmlFor={`${id}-phone`} className={lbl}>Phone or WhatsApp</label><input id={`${id}-phone`} name="phone" type="tel" autoComplete="tel" className={ctl} /></div>
      </div>
      <div><label htmlFor={`${id}-interest`} className={lbl}>What are you interested in?</label>
        <select id={`${id}-interest`} name="interest" defaultValue="" className={ctl}><option value="">Choose one</option>{INTERESTS.map((x) => <option key={x}>{x}</option>)}</select></div>
      <div><label htmlFor={`${id}-message`} className={lbl}>Message <span aria-hidden="true">*</span></label><textarea id={`${id}-message`} name="message" rows={5} required className={ctl} {...a11y('message')} />{err('message')}</div>
      {/* Honeypot: hidden from people and assistive tech. Bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="consent" required className="mt-1 size-5 flex-none" {...a11y('consent')} /><span>I agree that Samakose may use these details to reply to me, as described in the <Link href="/privacy" className="font-semibold text-leaf underline">privacy notice</Link>. <span aria-hidden="true">*</span></span></label>
        {err('consent')}
      </div>
      <button type="submit" disabled={state === 'sending'} className="inline-flex min-h-12 w-fit items-center justify-center rounded-full bg-forest px-7 font-semibold text-white transition duration-200 hover:bg-leaf active:scale-[0.97] disabled:opacity-60">
        {state === 'sending' ? 'Sending...' : 'Send message'}
      </button>
    </form>
  );
}
