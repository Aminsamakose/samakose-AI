'use client';
import { useState } from 'react';
import { api, ApiFail } from '@/lib/client/api';

/**
 * The CTA on a confirmed-price plan card. A signed-out visitor is bounced to /login (which itself
 * links to registration) by the api client's own 401 handling - no special-casing needed here. A
 * signed-in business owner goes straight to Paystack (or the mock payment page outside production)
 * for their own organisation, via plan-purchases.ts's self-serve checkout.
 */
export function PlanBuyButton({ planId, label, className }: { planId: string; label: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const buy = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ authorizationUrl: string }>(`/plans/${planId}/purchase`, {});
      window.location.href = r.authorizationUrl;
    } catch (e) {
      setBusy(false);
      setErr(e instanceof ApiFail ? e.message : 'Could not start checkout. Please try again.');
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={buy} disabled={busy}
        className={className ?? 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-forest px-6 text-[0.95rem] font-semibold text-white no-underline transition duration-200 active:scale-[0.97] focus-visible:outline-2 disabled:opacity-60'}>
        {busy ? 'Starting checkout…' : label}
      </button>
      {err && <span className="text-xs text-[color:var(--bad)]">{err}</span>}
    </div>
  );
}
