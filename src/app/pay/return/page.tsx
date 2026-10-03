'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, errText, qs } from '@/lib/client/api';
import { Button, Loading } from '@/components/ui';
import { RequireSession } from '@/components/finance/PayShell';

const RETRY_MS = 4000, MAX_TRIES = 10;
type Outcome = { status: 'Succeeded' | 'Pending' | 'Failed'; invoice: string };

function Return() {
  const sp = useSearchParams();
  const reference = sp.get('reference') || sp.get('trxref') || '';
  const [out, setOut] = useState<Outcome | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [checking, setChecking] = useState(false);
  const [href, setHref] = useState('/finance/invoices');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    setChecking(true); setErr(null);
    try { const r = await api.post<Outcome>(`/payments/${encodeURIComponent(reference)}/verify`); setOut(r); setTries((t) => t + 1); }
    catch (e) { setErr(errText(e)); }
    finally { setChecking(false); }
  }, [reference]);

  useEffect(() => { document.title = 'Payment result | Business Doctor'; if (reference) check(); }, [reference, check]);
  useEffect(() => {
    if (out?.status === 'Pending' && tries < MAX_TRIES && !checking) { timer.current = setTimeout(check, RETRY_MS); return () => { if (timer.current) clearTimeout(timer.current); }; }
  }, [out, tries, checking, check]);
  // Find the invoice id so the link goes straight to it.
  useEffect(() => {
    if (!out?.invoice) return;
    api.get<{ items: { id: string; code: string }[] }>('/invoices' + qs({ q: out.invoice, pageSize: 5 })).then((d) => { const m = d.items.find((x) => x.code === out.invoice); if (m) setHref(`/finance/invoices/${m.id}`); }).catch(() => {});
  }, [out?.invoice]);

  if (!reference) return <div className="stack"><h1>Payment result</h1><div className="alert bad" role="alert">No payment reference was found in this link. Open your invoice to see its payments.</div><Link className="btn" href="/finance/invoices">Go to invoices</Link></div>;
  const waiting = out?.status === 'Pending' && tries < MAX_TRIES;
  return <div className="stack">
    <h1>Payment result</h1>
    <p className="small muted">Reference <span className="mono">{reference}</span></p>
    <div aria-live="polite" className="stack">
      {!out && !err && <Loading rows={2} />}
      {err && !out && <div className="alert bad" role="alert">{err}</div>}
      {out?.status === 'Succeeded' && <div className="alert ok"><strong>Payment received.</strong> Invoice {out.invoice} is now marked as paid. Thank you.</div>}
      {out?.status === 'Failed' && <div className="alert bad"><strong>The payment did not go through.</strong> No money was taken for invoice {out.invoice}, or the payment could not be matched to it. You can go back to the invoice and try again.</div>}
      {waiting && <div className="alert info"><strong>Waiting for confirmation.</strong> Your payment for invoice {out.invoice} has not been confirmed yet. Checking again automatically (attempt {tries} of {MAX_TRIES}).</div>}
      {out?.status === 'Pending' && !waiting && <div className="alert warn"><strong>Still pending.</strong> The provider has not confirmed this payment yet. It can take a few minutes. Use Check again, or come back to the invoice later.</div>}
    </div>
    <div className="row">
      {(err || (out?.status === 'Pending' && !waiting)) && <Button loading={checking} onClick={() => { setTries(0); check(); }}>Check again</Button>}
      <Link className="btn primary" href={href}>{out ? `Back to invoice ${out.invoice}` : 'Back to invoices'}</Link>
    </div>
  </div>;
}

export default function PayReturnPage() {
  return <RequireSession><Suspense fallback={<Loading />}><Return /></Suspense></RequireSession>;
}
