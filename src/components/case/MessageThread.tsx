'use client';
import { useEffect, useRef } from 'react';
import { api, dateTime } from '@/lib/client/api';
import { Async, Badge, Button, Empty, Field, FormError, useApi, useForm } from '@/components/ui';

type Msg = { id: string; body: string; at: string; sender: string; senderRole: string; mine: boolean; unread: boolean };
type Thread = { items: Msg[]; canWrite: boolean; oversight: boolean };

/**
 * The conversation on a case. Shared by the business and the practitioners. Messages cannot be edited or recalled, and
 * managers who read for oversight are recorded, so the page says so plainly.
 */
export function MessageThread({ caseId }: { caseId: string }) {
  const st = useApi<Thread>(`/cases/${caseId}/messages`);
  const { reload } = st;
  const end = useRef<HTMLDivElement>(null);
  // Refresh every 30 seconds while the page is in view, and mark what is on screen as read.
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 30000); return () => clearInterval(t); }, [reload]);
  useEffect(() => { if (st.data?.items.some((m) => m.unread) && !st.data.oversight) api.post(`/cases/${caseId}/messages/read`, {}).catch(() => {}); end.current?.scrollIntoView?.({ block: 'nearest' }); }, [st.data, caseId]);
  return <div className="stack">
    <p className="small muted">Messages here are kept with the case, cannot be edited after sending, and are visible to the business and the practitioners on it. Programme managers and administrators may read them for oversight, and each such read is recorded. Do not put passwords or bank details in a message.</p>
    <Async state={st}>{(t) => <>
      {t.oversight && <p className="small" role="status"><Badge tone="info">Oversight view</Badge> You can read this conversation but not write in it.</p>}
      {t.items.length === 0 ? <Empty title="No messages yet" hint={t.canWrite ? 'Send the first message.' : 'Nothing has been sent on this case.'} /> :
        <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label="Messages, oldest first">{t.items.map((m) => <li key={m.id} style={{ display: 'flex', justifyContent: m.mine ? 'flex-end' : 'flex-start' }}>
          <div style={{ maxWidth: 'min(560px, 92%)', background: m.mine ? 'var(--brand-soft)' : 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '8px 12px' }}>
            <div className="small muted"><strong style={{ color: 'var(--fg)' }}>{m.mine ? 'You' : m.sender}</strong> · {m.senderRole} · <time dateTime={m.at}>{dateTime(m.at)}</time>{m.unread && <> · <Badge tone="info">New</Badge></>}</div>
            <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</p>
          </div>
        </li>)}</ol>}
      <div ref={end} />
      {t.canWrite && <Composer caseId={caseId} onSent={reload} />}
    </>}</Async>
  </div>;
}

function Composer({ caseId, onSent }: { caseId: string; onSent: () => void }) {
  const f = useForm({ body: '' }, (v) => api.post(`/cases/${caseId}/messages`, { body: v.body }), { success: 'Message sent', onDone: () => { f.setValues({ body: '' }); onSent(); } });
  return <form className="stack" onSubmit={f.onSubmit} noValidate>
    <FormError message={f.formError} />
    <Field label="Message" name="body" error={f.errors.body} hint="Up to 4,000 characters. It cannot be edited after you send it.">{(p) => <textarea {...p} rows={3} maxLength={4000} {...f.input('body')} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy} disabled={!f.values.body.trim()}>Send message</Button></div>
  </form>;
}
