'use client';
import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Mail, Printer } from 'lucide-react';
import { Section } from './ui';

type Platform = 'SME360' | 'AGRIFOOD360' | 'ESO360';
type Question = { code: string; dimension: string; text: string; options: { A: string; B: string; C: string; D: string } | null };
type StartOk = { eligible: true; id: string; platform: string; frameworkVersionId: string; questions: Question[] };
type AlreadyUsed = { eligible: false; title: string; body: string; actions: string[] };
type StartResponse = StartOk | AlreadyUsed;
type Result = { eligible: true; id: string; platform: string; fullName: string; businessName: string | null; overallScore: number; classification: string; dimensionScores: { dimension: string; score: number }[]; completedAt: string };

/** Isolates printing to the branded one-page report block below (.fa-print-area), regardless of what
 *  else is on the page (site header/footer, hero, buttons) -- the standard print-isolation technique,
 *  so it keeps working even if those components change independently of this one. */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 14mm; }
  body * { visibility: hidden; }
  .fa-print-area, .fa-print-area * { visibility: visible; }
  .fa-print-area { position: absolute; top: 0; left: 0; width: 100%; }
}
`;

const ctl = 'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-fg placeholder:text-muted/70 focus-visible:outline-2';
const lbl = 'mb-1 block text-sm font-semibold';

async function post<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string; fields?: Record<string, string> }> {
  try {
    const res = await fetch('/api/v1' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, message: j?.error?.message ?? 'Something went wrong. Please try again.', fields: j?.error?.details && typeof j.error.details === 'object' ? j.error.details : undefined };
    return { ok: true, data: (j?.data ?? j) as T };
  } catch { return { ok: false, status: 0, message: 'We could not reach the server. Check your connection and try again.' }; }
}
async function get<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/v1' + path);
    const j = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: j?.error?.message ?? 'Something went wrong. Please try again.' };
    return { ok: true, data: (j?.data ?? j) as T };
  } catch { return { ok: false, message: 'We could not reach the server. Check your connection and try again.' }; }
}

const BAND_TONE: Record<string, string> = { 'Critical Attention': 'text-[color:var(--bad)]', 'Needs Improvement': 'text-[color:var(--warn)]', Developing: 'text-leaf-ink', 'Strong Foundation': 'text-leaf-ink' };

function RegisterStep({ platform, onStarted }: { platform: Platform; onStarted: (r: StartResponse) => void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      email: String(f.get('email') ?? ''), fullName: String(f.get('fullName') ?? ''), businessName: String(f.get('businessName') ?? '') || undefined,
      platform, marketingConsent: f.get('marketingConsent') === 'on', privacyAcknowledged: f.get('privacyAcknowledged') === 'on' ? true : false, source: `assessment-${platform.toLowerCase()}`
    };
    const local: Record<string, string> = {};
    if (body.fullName.trim().length < 2) local.fullName = 'Enter your name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) local.email = 'Enter a valid email address';
    if (!body.privacyAcknowledged) local.privacyAcknowledged = 'Please acknowledge the privacy notice to continue';
    if (Object.keys(local).length) { setFields(local); setError('Please check the highlighted fields.'); return; }
    setBusy(true); setError(null); setFields({});
    const r = await post<StartResponse>('/public/assessments/start', body);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 429) setError('Too many attempts from this connection. Please wait a few minutes and try again.');
      else { setFields(r.fields ?? {}); setError(r.message); }
      return;
    }
    onStarted(r.data);
  }

  const err = (k: string) => fields[k] ? <p role="alert" className="mt-1 text-sm font-semibold text-[color:var(--bad)]">{fields[k]}</p> : null;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6 sm:p-8" aria-label="Start your free assessment">
      {error && <div role="alert" className="rounded-xl border border-[color:var(--bad)] bg-[color:var(--bad-soft)] px-4 py-3 text-sm font-semibold text-[color:var(--bad)]">{error}</div>}
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label htmlFor={`${id}-name`} className={lbl}>Your name <span aria-hidden="true">*</span></label><input id={`${id}-name`} name="fullName" autoComplete="name" required className={ctl} />{err('fullName')}</div>
        <div><label htmlFor={`${id}-email`} className={lbl}>Email <span aria-hidden="true">*</span></label><input id={`${id}-email`} name="email" type="email" autoComplete="email" required className={ctl} />{err('email')}</div>
      </div>
      <div><label htmlFor={`${id}-biz`} className={lbl}>Business name</label><input id={`${id}-biz`} name="businessName" autoComplete="organization" className={ctl} /></div>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="privacyAcknowledged" required className="mt-1 size-5 flex-none" /><span>I have read and agree to the <Link href="/privacy" className="font-semibold text-leaf-ink underline">privacy notice</Link>. <span aria-hidden="true">*</span></span></label>
      {err('privacyAcknowledged')}
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="marketingConsent" className="mt-1 size-5 flex-none" /><span>I would also like to receive occasional emails about Samakose services. (Optional, not required for your free result.)</span></label>
      <button type="submit" disabled={busy} className="inline-flex min-h-12 w-fit items-center justify-center rounded-full bg-forest px-7 font-semibold text-white transition duration-200 hover:bg-leaf active:scale-[0.97] disabled:opacity-60">
        {busy ? 'Starting...' : 'Start the 25 questions'}
      </button>
    </form>
  );
}

function AlreadyUsedCard({ r }: { r: AlreadyUsed }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-card border border-line bg-surface p-8">
      <h3 className="font-display text-2xl font-bold">{r.title}</h3>
      <p className="text-muted">{r.body}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Link href="/pricing" className="inline-flex min-h-11 items-center justify-center rounded-full bg-forest px-6 font-semibold text-white no-underline transition duration-200 hover:bg-leaf active:scale-[0.97]">Explore Full Assessment</Link>
        <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-6 font-semibold text-fg no-underline transition duration-200 hover:bg-surface-2">Return to Home</Link>
      </div>
    </div>
  );
}

function QuestionsStep({ start, onDone }: { start: StartOk; onDone: (r: Result) => void }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, 'A' | 'B' | 'C' | 'D'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = start.questions[i];
  const picked = answers[q.code];

  function pick(letter: 'A' | 'B' | 'C' | 'D') {
    const next = { ...answers, [q.code]: letter };
    setAnswers(next);
    if (i < start.questions.length - 1) setTimeout(() => setI(i + 1), 150);
  }

  async function submit() {
    setBusy(true); setError(null);
    const r = await post<Result>(`/public/assessments/${start.id}/submit`, { answers });
    setBusy(false);
    if (!r.ok) {
      if (r.fields?.answers) setError(r.fields.answers);
      else setError(r.message);
      return;
    }
    onDone(r.data);
  }

  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === start.questions.length;

  return (
    <div className="flex flex-col gap-6 rounded-card border border-line bg-surface p-6 sm:p-8">
      <div>
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted"><span>{q.dimension}</span><span>Question {i + 1} of {start.questions.length}</span></div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-leaf transition-all duration-300" style={{ width: `${((i + 1) / start.questions.length) * 100}%` }} /></div>
      </div>
      <h3 className="font-display text-xl font-bold sm:text-2xl">{q.text}</h3>
      <div className="flex flex-col gap-3" role="radiogroup" aria-label={q.text}>
        {q.options && (['A', 'B', 'C', 'D'] as const).map((letter) => (
          <button key={letter} type="button" role="radio" aria-checked={picked === letter} onClick={() => pick(letter)}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition duration-150 ${picked === letter ? 'border-leaf bg-leaf/10 font-semibold' : 'border-line bg-bg hover:bg-surface-2'}`}>
            <span className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-full border border-line text-xs font-bold">{letter}</span>
            <span>{q.options![letter]}</span>
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-[color:var(--bad)]">{error}</p>}
      <div className="flex items-center justify-between">
        <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-5 font-semibold text-fg transition duration-200 hover:bg-surface-2 disabled:opacity-40">
          <ChevronLeft className="size-4" aria-hidden="true" />Back
        </button>
        {i < start.questions.length - 1
          ? <button type="button" disabled={!picked} onClick={() => setI(i + 1)} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-forest px-5 font-semibold text-white transition duration-200 hover:bg-leaf active:scale-[0.97] disabled:opacity-40">Next<ChevronRight className="size-4" aria-hidden="true" /></button>
          : <button type="button" disabled={!allAnswered || busy} onClick={submit} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-forest px-6 font-semibold text-white transition duration-200 hover:bg-leaf active:scale-[0.97] disabled:opacity-40">{busy ? 'Scoring...' : 'See my result'}</button>}
      </div>
      {!allAnswered && i === start.questions.length - 1 && <p className="text-sm text-muted">Answer all {start.questions.length} questions to see your result. {answeredCount} of {start.questions.length} answered.</p>}
    </div>
  );
}

function ResultStep({ result }: { result: Result }) {
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [downloadState, setDownloadState] = useState<'idle' | 'done'>('idle');
  const [printState, setPrintState] = useState<'idle' | 'done'>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  async function sendEmail() {
    setEmailState('sending'); setActionError(null);
    const r = await post(`/public/assessments/${result.id}/actions/email`, {});
    if (r.ok) setEmailState('sent'); else { setEmailState('error'); setActionError(r.message); }
  }
  async function download() {
    setActionError(null);
    // #123: the server now returns a real PDF (application/pdf) for this action, not JSON -- fetch it
    // directly rather than going through post(), which assumes a JSON body.
    let res: Response;
    try {
      res = await fetch(`/api/v1/public/assessments/${result.id}/actions/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    } catch { setActionError('We could not reach the server. Check your connection and try again.'); return; }
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setActionError(j?.error?.message ?? 'Something went wrong. Please try again.');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${result.platform}-result.pdf`; a.click();
    URL.revokeObjectURL(url);
    setDownloadState('done');
  }
  async function print() {
    setActionError(null);
    const r = await post(`/public/assessments/${result.id}/actions/print`, {});
    if (!r.ok) { setActionError(r.message); return; }
    setPrintState('done');
    window.print();
  }

  const sorted = [...result.dimensionScores].sort((a, b) => b.score - a.score);
  const topN = sorted.length >= 5 ? 2 : 1;
  const strengths = sorted.slice(0, topN);
  const priorities = sorted.slice(-topN).reverse();
  const ref = `REF-${result.id.slice(0, 8).toUpperCase()}`;
  const dateStr = new Date(result.completedAt).toLocaleDateString();

  return (
    <div className="flex flex-col gap-8">
      {/* Branded, one-page printable report. Hidden on screen (print:block), shown only via window.print(); see PRINT_CSS above for how it is isolated from the rest of the page when printing. */}
      <style>{PRINT_CSS}</style>
      <div className="fa-print-area hidden print:block" style={{ color: '#0c2622' }}>
        <div className="flex items-center justify-between border-b-2 pb-3" style={{ borderColor: '#0f4a3f' }}>
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 40 40" style={{ width: 36, height: 36 }} aria-hidden="true">
              <circle cx="20" cy="20" r="19" fill="#0f4a3f" />
              <path d="M6 21h7l3-8 5 16 4-11 2 3h7" fill="none" stroke="#c6f26b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Business Doctor</div>
              <div style={{ fontSize: 11, color: '#555' }}>by Samakose</div>
            </div>
          </div>
          <div className="text-right">
            <div style={{ fontWeight: 700, fontSize: 13 }}>Free Business Health Check</div>
            <div style={{ fontSize: 11, color: '#555' }}>{result.platform}</div>
          </div>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginTop: 14 }}>{result.platform} Preliminary Result</h1>
        <p style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{[result.fullName, result.businessName, ref, dateStr].filter(Boolean).join('   |   ')}</p>
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 34, fontWeight: 700 }}>{result.overallScore}<span style={{ fontSize: 14, color: '#777', fontWeight: 400 }}>/100</span></span>
          <span className={BAND_TONE[result.classification] ?? ''} style={{ fontSize: 13, fontWeight: 700 }}>{result.classification}</span>
        </div>
        <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 16 }}>Dimension scores</h2>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {result.dimensionScores.map((d) => (
            <div key={d.dimension} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5 }}>
              <span style={{ width: 170, flex: 'none' }}>{d.dimension}</span>
              <span style={{ flex: 1, height: 6, borderRadius: 3, background: '#e5e5e5', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${d.score}%`, background: '#1e7a5a' }} />
              </span>
              <span style={{ width: 44, flex: 'none', textAlign: 'right', color: '#555' }}>{d.score}/100</span>
            </div>
          ))}
        </div>
        <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 14 }}>Key findings</h2>
        <p style={{ fontSize: 10.5, marginTop: 4 }}>Strength{strengths.length > 1 ? 's' : ''}: {strengths.map((d) => d.dimension).join(', ')}.</p>
        <p style={{ fontSize: 10.5, marginTop: 2 }}>Priority area{priorities.length > 1 ? 's' : ''}: {priorities.map((d) => d.dimension).join(', ')}.</p>
        <h2 style={{ fontSize: 13, fontWeight: 700, marginTop: 10 }}>Recommended next step</h2>
        <p style={{ fontSize: 10.5, marginTop: 4 }}>Address your priority area{priorities.length > 1 ? 's' : ''} first, then explore the full {result.platform} Business Health Assessment for a complete diagnosis, evidence review and written action plan.</p>
        <p style={{ fontSize: 9, color: '#777', marginTop: 12 }}>This is a preliminary assessment based on your own answers, not a certified diagnosis, investment-readiness determination or guarantee of business success. The score bands above are provisional, set by expert judgment and not yet statistically validated against business outcomes.</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '0.6px solid #ccc', marginTop: 16, paddingTop: 6, fontSize: 8.5, color: '#777' }}>
          <span>Business Doctor by Samakose  |  Free preliminary assessment</span>
          <span>www.samakose.com</span>
        </div>
      </div>

      <div className="print:hidden flex flex-col gap-8 rounded-card border border-line bg-surface p-6 sm:p-8">
      <div role="status" className="flex flex-col items-start gap-2">
        <CheckCircle2 className="size-8 text-leaf-ink" aria-hidden="true" />
        <h2 className="font-display text-3xl font-bold">Your preliminary result</h2>
        {result.businessName && <p className="text-muted">{result.businessName}</p>}
      </div>
      <div className="flex flex-col items-start gap-1">
        <span className={`font-display text-6xl font-bold ${BAND_TONE[result.classification] ?? ''}`}>{result.overallScore}<span className="text-2xl text-muted">/100</span></span>
        <span className={`text-lg font-semibold ${BAND_TONE[result.classification] ?? ''}`}>{result.classification}</span>
      </div>
      <div>
        <h3 className="font-display text-lg font-bold">Dimension scores</h3>
        <ul className="mt-3 flex flex-col gap-3">
          {result.dimensionScores.map((d) => (
            <li key={d.dimension}>
              <div className="flex items-center justify-between text-sm"><span className="font-semibold">{d.dimension}</span><span className="text-muted">{d.score}/100</span></div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-leaf" style={{ width: `${d.score}%` }} /></div>
            </li>
          ))}
        </ul>
      </div>
      <p className="rounded-xl bg-surface-2 p-4 text-sm text-muted">This is a preliminary assessment based on your own answers, not a certified diagnosis, investment-readiness determination or guarantee of business success. The score bands above (Critical Attention / Needs Improvement / Developing / Strong Foundation) are provisional, set by expert judgment and not yet statistically validated against business outcomes. For a full diagnosis, evidence review and a written action plan, explore the full Business Health Assessment below.</p>
      {actionError && <p role="alert" className="text-sm font-semibold text-[color:var(--bad)]">{actionError}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={sendEmail} disabled={emailState === 'sending' || emailState === 'sent'} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-5 font-semibold text-fg transition duration-200 hover:bg-surface-2 disabled:opacity-60">
          <Mail className="size-4" aria-hidden="true" />{emailState === 'sent' ? 'Emailed' : emailState === 'sending' ? 'Sending...' : 'Email me this result'}
        </button>
        <button type="button" onClick={download} disabled={downloadState === 'done'} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-5 font-semibold text-fg transition duration-200 hover:bg-surface-2 disabled:opacity-60">
          <Download className="size-4" aria-hidden="true" />{downloadState === 'done' ? 'Downloaded' : 'Download'}
        </button>
        <button type="button" onClick={print} disabled={printState === 'done'} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-5 font-semibold text-fg transition duration-200 hover:bg-surface-2 disabled:opacity-60">
          <Printer className="size-4" aria-hidden="true" />{printState === 'done' ? 'Printed' : 'Print'}
        </button>
      </div>
      <p className="text-xs text-muted">Each of the three actions above can be used once for this result. Screenshots and other ways of saving what is on screen are outside our control.</p>
      <div className="border-t border-line pt-6">
        <Link href="/pricing" className="inline-flex min-h-12 w-fit items-center justify-center rounded-full bg-forest px-7 font-semibold text-white no-underline transition duration-200 hover:bg-leaf active:scale-[0.97]">Explore the full Business Health Assessment</Link>
      </div>
      </div>
    </div>
  );
}

export function FreeAssessmentFlow({ platform = 'SME360' }: { platform?: Platform }) {
  const [start, setStart] = useState<StartResponse | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const storageKey = `${platform.toLowerCase()}_assessment_id`;

  // If the browser already holds a completed assessment id for this session (e.g. a refresh right
  // after submitting), fetch and show the result again rather than losing it.
  useEffect(() => {
    const saved = (() => { try { return sessionStorage.getItem(storageKey); } catch { return null; } })();
    if (!saved) return;
    let cancelled = false;
    get<Result>(`/public/assessments/${saved}`).then((r) => { if (!cancelled && r.ok) setResult(r.data); });
    return () => { cancelled = true; };
  }, [storageKey]);

  function onStarted(r: StartResponse) {
    setStart(r);
    if (r.eligible) { try { sessionStorage.setItem(storageKey, r.id); } catch { /* ignore */ } }
  }
  function onDone(r: Result) { setResult(r); }

  return (
    <Section>
      <div className="mx-auto max-w-2xl">
        {result ? <ResultStep result={result} />
          : !start ? <RegisterStep platform={platform} onStarted={onStarted} />
          : !start.eligible ? <AlreadyUsedCard r={start} />
          : <QuestionsStep start={start} onDone={onDone} />}
      </div>
    </Section>
  );
}
