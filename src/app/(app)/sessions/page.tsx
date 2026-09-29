'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { dateTime } from '@/lib/client/api';
import { Async, Badge, Card, Empty, Loading, PageHead, useApi } from '@/components/ui';
import { useTitle } from '@/components/dash/common';

type Sess = { id: string; code: string; caseId: string; caseCode: string; org: string; scheduledAt: string; status: string; notes: string | null; brief: unknown };

function Inner() {
  useTitle('Coaching sessions');
  const sp = useSearchParams();
  const [upcoming, setUpcoming] = useState(sp.get('upcoming') === 'true');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const st = useApi<Sess[]>('/sessions' + (upcoming ? '?upcoming=true' : ''));
  const rows = useMemo(() => (st.data ?? []).filter((s) => (!status || s.status === status) && (!q || `${s.caseCode} ${s.org} ${s.code}`.toLowerCase().includes(q.toLowerCase()))), [st.data, status, q]);
  return <>
    <PageHead title="Coaching sessions" sub="Open a session's case to schedule, brief or record it." />
    <div className="toolbar" style={{ marginBottom: 12 }}>
      <div className="search-box"><label className="sr" htmlFor="ss-q">Search sessions</label><input id="ss-q" type="search" placeholder="Search case or organisation" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="field" style={{ minWidth: 150 }}><label className="sr" htmlFor="ss-status">Status</label>
        <select id="ss-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['Scheduled', 'Held', 'Missed', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}</select></div>
      <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={upcoming} onChange={(e) => setUpcoming(e.target.checked)} /> Upcoming only</label>
    </div>
    <div aria-live="polite"><Async state={st}>{() => rows.length === 0
      ? <Card><Empty title={st.data?.length ? 'No sessions match' : 'No coaching sessions yet'} hint={st.data?.length ? 'Clear the search or filters.' : 'Sessions are scheduled from a case, on its coaching tab.'} /></Card>
      : <div className="stack"><div className="table-wrap"><table>
        <caption className="sr">Coaching sessions</caption>
        <thead><tr><th>When</th><th>Case</th><th>Organisation</th><th>Status</th><th>Brief</th><th>Notes</th></tr></thead>
        <tbody>{rows.map((s) => <tr key={s.id}>
          <td><Link href={`/cases/${s.caseId}?tab=coaching`}>{dateTime(s.scheduledAt)}</Link></td><td>{s.caseCode}</td><td>{s.org}</td><td><Badge>{s.status}</Badge></td>
          <td>{s.brief ? 'Prepared' : 'Not prepared'}</td><td style={{ maxWidth: 320 }}>{s.notes ? s.notes.slice(0, 140) + (s.notes.length > 140 ? '...' : '') : '-'}</td></tr>)}</tbody></table></div>
        <p className="small muted">{rows.length} session{rows.length === 1 ? '' : 's'}{!upcoming && (st.data?.length ?? 0) >= 200 ? '. Showing the latest 200; tick Upcoming only or open a case for older ones.' : ''}</p></div>}</Async></div>
  </>;
}
export default function SessionsPage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
