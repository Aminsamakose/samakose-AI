'use client';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Async, Button, useApi, useToast } from '@/components/ui';

type Given = { accuracy: string; rating: number | null; message: string | null } | null;
const OPTIONS = [['accurate', 'Yes, it matches my business'], ['partly', 'Partly'], ['not_accurate', 'No, it does not match']] as const;

/** The owner says whether their latest score matched their business. It is feedback for the Samakose team only: it never changes the score. */
export function ResultFeedback({ caseId }: { caseId: string }) {
  const st = useApi<{ scored: boolean; given: Given }>(`/me/feedback/result/${caseId}`);
  return <Async state={st}>{(d) => d.scored ? <Form caseId={caseId} given={d.given} onSaved={st.reload} /> : <p className="muted">You can tell us how well your score matches your business once it has been scored.</p>}</Async>;
}

function Form({ caseId, given, onSaved }: { caseId: string; given: Given; onSaved: () => void }) {
  const toast = useToast();
  const [accuracy, setAccuracy] = useState(given?.accuracy ?? '');
  const [rating, setRating] = useState<number | null>(given?.rating ?? null);
  const [message, setMessage] = useState(given?.message ?? '');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setAccuracy(given?.accuracy ?? ''); setRating(given?.rating ?? null); setMessage(given?.message ?? ''); }, [given]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!accuracy) { setErr('Choose how well the score matches your business.'); return; }
    setBusy(true);
    try { await api.post('/me/feedback/result', { caseId, accuracy, rating, message: message.trim() || null }); toast('Thank you. Your answer has been recorded.'); onSaved(); }
    catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  };
  return <form onSubmit={send} className="stack" noValidate>
    <p className="muted small">Your answer helps Samakose improve the health check. It does not change your score, and only the Samakose team sees it.</p>
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend>Does this score match what you know about your business?</legend>
      <div className="row" role="radiogroup" aria-label="How well the score matches">{OPTIONS.map(([v, l]) => <label key={v} className="row" style={{ gap: 6 }}><input type="radio" name="rf-acc" checked={accuracy === v} onChange={() => setAccuracy(v)} />{l}</label>)}</div>
    </fieldset>
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend>How useful was it to you? (optional)</legend>
      <div className="row" role="radiogroup" aria-label="Usefulness, 1 is not useful and 5 is very useful">{[1, 2, 3, 4, 5].map((n) => <label key={n} className="row" style={{ gap: 6 }}><input type="radio" name="rf-rating" checked={rating === n} onChange={() => setRating(n)} />{n}</label>)}</div>
      <span className="small muted">1 is not useful, 5 is very useful.</span>
    </fieldset>
    <div className="field"><label htmlFor="rf-message">What felt right or wrong? (optional)</label><textarea id="rf-message" rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
    {err && <div className="alert bad" role="alert">{err}</div>}
    <div className="form-actions"><Button variant="primary" type="submit" loading={busy}>{given ? 'Update my answer' : 'Send my answer'}</Button></div>
  </form>;
}
