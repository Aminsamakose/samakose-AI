'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

type Turn = { role: 'user' | 'assistant'; text: string; handoff?: boolean };

/** Public enquiry assistant. Answers come from published website content only. It never sees or stores who the visitor is. */
/** The pages are built ahead of time, so whether the assistant is switched on is asked in the browser. Nothing shows while it is off. */
export function AssistantChat() {
  const [on, setOn] = useState(false);
  useEffect(() => { let live = true; fetch('/api/v1/public/assistant', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (live) setOn(j?.data?.on === true); }).catch(() => undefined); return () => { live = false; }; }, []);
  return on ? <Panel /> : null;
}

function Panel() {
  const [open, setOpen] = useState(false); const [turns, setTurns] = useState<Turn[]>([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null); const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns, busy]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open]);
  const send = async () => {
    const message = text.trim(); if (message.length < 3 || busy) return;
    const history = turns.slice(-6).map(({ role, text }) => ({ role, text })); setTurns((t) => [...t, { role: 'user', text: message }]); setText(''); setBusy(true);
    try {
      const r = await fetch('/api/v1/public/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, history }) });
      const j = await r.json();
      if (!r.ok) throw new Error(r.status === 429 ? 'You have asked a lot of questions. Please try again later or contact our team.' : j?.error?.message ?? 'Something went wrong.');
      setTurns((t) => [...t, { role: 'assistant', text: j.data.reply, handoff: j.data.handoff }]);
    } catch (e) { setTurns((t) => [...t, { role: 'assistant', text: (e as Error).message || 'Something went wrong. Please use the contact page.', handoff: true }]); }
    finally { setBusy(false); }
  };
  return <div style={{ position: 'fixed', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', zIndex: 60 }}>
    {open && <section role="dialog" aria-label="Ask The Business Doctor" style={{ width: 'min(380px, calc(100vw - 32px))', maxHeight: 'min(560px, 75vh)', display: 'flex', flexDirection: 'column', background: 'var(--surface)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--shadow)', marginBottom: 12, overflow: 'hidden' }}>
      <header style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <b>Ask The Business Doctor</b><button type="button" className="btn" onClick={() => setOpen(false)} aria-label="Close the assistant">Close</button>
      </header>
      <p className="small" style={{ padding: '8px 14px', margin: 0, background: 'var(--surface-2)', color: 'var(--muted)' }}>This is an AI assistant. It answers from what is published on this website and cannot give prices or promises. Please do not type personal or financial details.</p>
      <div role="log" aria-live="polite" style={{ padding: 14, overflowY: 'auto', display: 'grid', gap: 10, flex: 1, minHeight: 120 }}>
        {turns.length === 0 && <p className="small" style={{ color: 'var(--muted)' }}>Ask about our services, how the business health check works, or how to get started.</p>}
        {turns.map((t, i) => <div key={i} style={{ justifySelf: t.role === 'user' ? 'end' : 'start', maxWidth: '90%', background: t.role === 'user' ? 'var(--brand)' : 'var(--surface-2)', color: t.role === 'user' ? 'var(--brand-fg)' : 'var(--fg)', padding: '8px 12px', borderRadius: 10, overflowWrap: 'anywhere' }}>
          {t.text}{t.handoff && <div style={{ marginTop: 8 }}><Link href="/contact" style={{ color: 'inherit', textDecoration: 'underline' }}>Send your question to our team</Link></div>}
        </div>)}
        {busy && <p className="small" style={{ color: 'var(--muted)' }}>Looking through our published pages...</p>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--line)' }}>
        <label className="sr" htmlFor="assistant-q">Your question</label>
        <textarea id="assistant-q" ref={input} rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="Type your question" style={{ flex: 1, minWidth: 0, resize: 'none' }} />
        <button type="submit" className="btn primary" disabled={busy || text.trim().length < 3}>Send</button>
      </form>
    </section>}
    {!open && <button type="button" className="btn primary" onClick={() => setOpen(true)} aria-haspopup="dialog" style={{ borderRadius: 999, padding: '12px 18px', boxShadow: 'var(--shadow)' }}>Ask The Business Doctor</button>}
  </div>;
}
