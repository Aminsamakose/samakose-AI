'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, errText } from '@/lib/client/api';
import { Button } from '@/components/ui';
import { RequireSession } from '@/components/finance/PayShell';

function Mock() {
  const { reference } = useParams<{ reference: string }>();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { document.title = 'Test payment | Business Doctor by Samakose'; }, []);
  const complete = async () => {
    setBusy(true); setErr(null);
    try { await api.post(`/library/purchases/${encodeURIComponent(reference)}/mock-complete`); router.push(`/pay/return?reference=${encodeURIComponent(reference)}`); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return <div className="stack">
    <h1>Test payment page</h1>
    <div className="alert warn" role="note"><strong>This is a TEST payment page.</strong> No online payment provider is configured on this system, so no real money is charged and no card or mobile money details are asked for. Completing this page simply unlocks the resource.</div>
    <p className="small muted">Payment reference <span className="mono">{reference}</span></p>
    {err && <div className="alert bad" role="alert">{err}</div>}
    <div className="row">
      <Button variant="primary" loading={busy} onClick={complete}>Complete test payment</Button>
      <Link className="btn" href="/library">Cancel and go back</Link>
    </div>
    <p className="small muted">Cancelling leaves the purchase pending. You can start a new purchase from the resource's page at any time.</p>
  </div>;
}

export default function LibraryMockPayPage() { return <RequireSession><Mock /></RequireSession>; }
