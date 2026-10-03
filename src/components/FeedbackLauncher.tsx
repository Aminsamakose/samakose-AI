'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { api, errText } from '@/lib/client/api';
import { Button, Modal, useToast } from '@/components/ui';
import { Icon } from '@/components/Icon';

/** A feedback button on every signed-in page. The page and the person's role are attached automatically. Only the administrator reads it. */
export function FeedbackLauncher() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return <>
    <button className="btn" onClick={() => setOpen(true)} aria-label="Send feedback"><Icon name="inbox" /><span className="hide-sm">Feedback</span></button>
    <Modal open={open} onClose={() => setOpen(false)} title="Send feedback">{open && <FeedbackForm path={path} onDone={() => setOpen(false)} />}</Modal>
  </>;
}

function FeedbackForm({ path, onDone }: { path: string; onDone: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (message.trim().length < 5) { setErr('Tell us a little more: what you tried and what happened, or what should change.'); return; }
    setBusy(true);
    try { await api.post('/me/feedback', { page: path, rating, message: message.trim() }); toast('Thank you. Your feedback has been sent.'); onDone(); }
    catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  };
  return <form onSubmit={send} className="stack" noValidate>
    <p className="muted small">This goes to the Samakose Accelerator Lab team, with your name, your role and the page you are on (<span className="mono">{path}</span>). Please do not include passwords or bank details.</p>
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend>How easy was this page to use? (optional)</legend>
      <div className="row" role="radiogroup" aria-label="Ease of use, 1 is very hard and 5 is very easy">
        {[1, 2, 3, 4, 5].map((n) => <label key={n} className="row" style={{ gap: 6 }}><input type="radio" name="fb-rating" checked={rating === n} onChange={() => setRating(n)} />{n}</label>)}
        {rating !== null && <button type="button" className="btn sm" onClick={() => setRating(null)}>Clear</button>}
      </div>
      <span className="small muted">1 is very hard, 5 is very easy.</span>
    </fieldset>
    <div className="field"><label htmlFor="fb-message">What did you try, and what happened? *</label><textarea id="fb-message" rows={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} aria-describedby={err ? 'fb-err' : undefined} required /></div>
    {err && <div id="fb-err" className="alert bad" role="alert">{err}</div>}
    <div className="form-actions"><Button variant="primary" type="submit" loading={busy}>Send feedback</Button><Button type="button" onClick={onDone}>Cancel</Button></div>
  </form>;
}
