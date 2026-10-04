'use client';
import Link from 'next/link';
import { dateTime } from '@/lib/client/api';
import { Async, Badge, Card, Empty, useApi } from '@/components/ui';
import { useMe } from '@/components/case/core/shared';

type Esc = { id: string; kind: string; detail: string | null; flaggedAt: string; caseId: string; caseCode: string; org: string };
const LABEL: Record<string, string> = { stalled: 'No recent activity', session_outcome: 'Session outcome not recorded' };

/** Work that has stopped moving, for the people who can reassign or chase it. Clears itself when the cause goes. */
export function EscalationsCard() {
  const { ready, can } = useMe();
  const st = useApi<{ items: Esc[]; count: number }>(ready && can('escalations', 'read') ? '/escalations' : null);
  if (!ready || !can('escalations', 'read')) return null;
  return <Card title="Needs attention" actions={st.data ? <span className="small muted">{st.data.count} open</span> : undefined}>
    <Async state={st}>{(d) => d.items.length === 0 ? <Empty title="Nothing is stuck" hint="Cases with no recent activity and sessions with no recorded outcome appear here." /> :
      <div className="table-wrap"><table><caption className="sr-only">Open escalations</caption><thead><tr><th>Case</th><th>Business</th><th>Why</th><th>Flagged</th></tr></thead>
        <tbody>{d.items.map((e) => <tr key={e.id}><td><Link href={`/cases/${e.caseId}${e.kind === 'session_outcome' ? '?tab=coaching' : ''}`} className="mono">{e.caseCode}</Link></td><td>{e.org}</td>
          <td><Badge tone={e.kind === 'stalled' ? 'warn' : 'info'}>{LABEL[e.kind] ?? e.kind}</Badge>{e.detail ? <span className="small muted"> {e.detail}</span> : null}</td><td>{dateTime(e.flaggedAt)}</td></tr>)}</tbody></table></div>}</Async>
  </Card>;
}
