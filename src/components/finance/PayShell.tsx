'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Loading } from '@/components/ui';

/**
 * Payment pages sit outside the signed-in shell. Before doing anything, make sure there is a session,
 * and if not send the person to sign in and bring them back to this exact URL including the query.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/v1/auth/me', { credentials: 'same-origin' }).then((r) => {
      if (!live) return;
      if (r.status === 401) { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search); return; }
      setOk(true);
    }).catch(() => { if (live) setOk(true); });
    return () => { live = false; };
  }, []);
  return ok ? <>{children}</> : <Loading />;
}
