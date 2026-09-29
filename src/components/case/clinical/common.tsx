'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Button, useApi } from '@/components/ui';

export type Me = { user: { id: string; role: string; name: string }; permissions: Record<string, string[]> };

/** Current user and a can() helper. The API stays the authority. */
export function useMe() {
  const st = useApi<Me>('/auth/me');
  const perms = st.data?.permissions ?? {};
  return { me: st.data?.user ?? null, ready: !!st.data, can: (resource: string, action: string) => !!perms[resource]?.includes(action) };
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Lists every field error the server returned that has no input of its own. */
export function ErrorList({ errors, skip = [] }: { errors: Record<string, string>; skip?: string[] }) {
  const rows = Object.entries(errors).filter(([k]) => !skip.includes(k));
  if (!rows.length) return null;
  return <ul className="alert bad" role="alert" style={{ margin: 0, paddingLeft: 28 }}>{rows.map(([k, v]) => <li key={k}>{v}</li>)}</ul>;
}

type JobState = { status: 'idle' | 'running' | 'failed' | 'done'; error?: string };

/** Starts a background job through a POST that returns { jobId } and polls /jobs/:id every 1.5 seconds. */
export function useJob(onDone: () => void) {
  const [state, setState] = useState<JobState>({ status: 'idle' });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);
  const done = useRef(onDone); done.current = onDone;
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop(); }; }, []);
  const start = useCallback(async (path: string) => {
    stop(); setState({ status: 'running' });
    try {
      const r = await api.post<{ jobId: string }>(path);
      let busy = false;
      timer.current = setInterval(async () => {
        if (busy) return; busy = true;
        try {
          const j = await api.get<{ status: string; error: string | null }>(`/jobs/${r.jobId}`);
          if (!alive.current) return;
          if (j.status === 'done') { stop(); setState({ status: 'done' }); done.current(); }
          else if (j.status === 'failed') { stop(); setState({ status: 'failed', error: j.error ?? 'It could not be completed.' }); }
        } catch (e) { if (alive.current) { stop(); setState({ status: 'failed', error: errText(e) }); } }
        finally { busy = false; }
      }, 1500);
    } catch (e) { setState({ status: 'failed', error: errText(e) }); }
  }, []);
  return { state, start, running: state.status === 'running', reset: () => setState({ status: 'idle' }) };
}

/** Progress, failure with retry, and completion message for a background job. */
export function JobStatus({ job, label, retry }: { job: ReturnType<typeof useJob>; label: string; retry: () => void }) {
  const s = job.state;
  return <div aria-live="polite">
    {s.status === 'running' && <div className="alert info row"><span className="spin" style={{ width: 14, height: 14, borderWidth: 2 }} aria-hidden /><span>{label} is being prepared. This page updates by itself when it is ready.</span></div>}
    {s.status === 'failed' && <div className="alert bad row" role="alert"><span>{s.error}</span><Button size="sm" onClick={retry}>Try again</Button></div>}
    {s.status === 'done' && <div className="alert ok">{label} is ready.</div>}
  </div>;
}

export const rxTone = (s: string) => ({ DRAFT: '', 'IN REVIEW': 'info', APPROVED: 'ok', RETURNED: 'warn', SUPERSEDED: '' } as Record<string, string>)[s] ?? '';
export const rxLabel = (s: string) => ({ DRAFT: 'Draft', 'IN REVIEW': 'In review', APPROVED: 'Approved', RETURNED: 'Returned', SUPERSEDED: 'Superseded' } as Record<string, string>)[s] ?? s;
export const sevTone = (s: string) => ({ High: 'bad', Medium: 'warn', Low: 'ok' } as Record<string, string>)[s] ?? '';
