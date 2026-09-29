'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, dateTime, errText, qs, titleCase } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, PageHead, useApi, useToast } from '@/components/ui';
import { useTitle } from '@/components/dash/common';

type Note = { id: string; kind: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };
type Page = { items: Note[]; total: number; unread: number; page: number; pages: number };

export default function NotificationsPage() {
  useTitle('Notifications');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const st = useApi<Page>('/notifications' + qs({ page, pageSize: 20, unread: unreadOnly ? 'true' : undefined }));
  const toast = useToast(); const router = useRouter();
  const [busy, setBusy] = useState(false);
  const markOne = async (n: Note) => { if (n.readAt) return; try { await api.post(`/notifications/${n.id}/read`); } catch (e) { toast(errText(e), 'bad'); throw e; } };
  const open = async (n: Note) => {
    try { await markOne(n); } catch { return; }
    if (n.link?.startsWith('/')) router.push(n.link); else st.reload();
  };
  const markAll = async () => { setBusy(true); try { await api.post('/notifications/read-all'); toast('All notifications marked as read'); st.reload(); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(false); } };
  return <>
    <PageHead title="Notifications" sub={st.data ? `${st.data.unread} unread` : undefined}
      actions={<Button onClick={markAll} loading={busy} disabled={!st.data?.unread}>Mark all as read</Button>} />
    <div className="toolbar" style={{ marginBottom: 12 }}>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} /> Show unread only</label>
    </div>
    <div aria-live="polite">
      <Async state={st}>{(d) => d.items.length === 0
        ? <Card><Empty title={unreadOnly ? 'No unread notifications' : 'No notifications yet'} hint={unreadOnly ? 'You are all caught up.' : 'Updates about your cases, reviews and invoices will appear here.'} /></Card>
        : <div className="stack">
          <Card><ul className="timeline" aria-label="Notifications">
            {d.items.map((n) => <li key={n.id} style={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderLeftColor: n.readAt ? undefined : 'var(--brand)' }}>
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {n.link?.startsWith('/') ? <Link href={n.link} onClick={(e) => { e.preventDefault(); open(n); }}><strong>{n.title}</strong></Link> : <strong>{n.title}</strong>}
                  {!n.readAt && <Badge tone="brand">Unread</Badge>}
                  <span className="badge">{titleCase(n.kind)}</span>
                </div>
                {n.body && <p style={{ margin: '4px 0' }}>{n.body}</p>}
                <span className="small muted">{dateTime(n.createdAt)}</span>
              </div>
              {!n.readAt && <Button size="sm" aria-label={`Mark "${n.title}" as read`} onClick={async () => { try { await markOne(n); st.reload(); } catch { /* toast shown */ } }}>Mark read</Button>}
            </li>)}
          </ul></Card>
          <div className="pager"><span className="muted">{d.total} notification{d.total === 1 ? '' : 's'}</span>
            <span className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="num">Page {page} of {d.pages}</span><button className="btn sm" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>Next</button></span></div>
        </div>}</Async>
    </div>
  </>;
}
