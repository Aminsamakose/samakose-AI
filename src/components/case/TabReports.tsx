'use client';
import { dateTime } from '@/lib/client/api';
import { Async, Badge, Card, Button, Empty, LinkButton, useApi } from '@/components/ui';
import type { TabProps } from './types';
import { JobStatus, useJob, useMe } from './clinical/common';

type Rep = { id: string; code: string; title: string; status: string; releasedAt: string | null; createdAt: string; aiDrafted: boolean };

export default function TabReports({ caseId, caseData, reload }: TabProps) {
  const list = useApi<Rep[]>(`/cases/${caseId}/reports`);
  const { can } = useMe();
  const job = useJob(() => { list.reload(); reload(); });
  const generate = () => job.start(`/cases/${caseId}/reports/generate`);
  return <div className="stack">
    <Card title="Progress reports" actions={can('reports', 'create') && <Button variant="primary" size="sm" onClick={generate} loading={job.running} disabled={!caseData.score}>Generate report</Button>}>
      <p className="muted">A report is drafted, then checked and released by the case reviewer. Only released reports are visible to the business owner.</p>
      {can('reports', 'create') && !caseData.score && <div className="alert warn" style={{ marginTop: 10 }}>A report needs a scored diagnostic.</div>}
      <div style={{ marginTop: 10 }}><JobStatus job={job} label="The report draft" retry={generate} /></div>
    </Card>
    <Async state={list}>{(rows) => rows.length === 0 ? <Empty title="No reports yet" hint={can('reports', 'create') ? 'Generate a draft report from the latest results.' : 'Released reports will appear here.'} /> :
      <div className="table-wrap"><table><thead><tr><th>Report</th><th>Status</th><th>Created</th><th>Released</th><th><span className="sr">Open</span></th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.title}</strong><div className="small muted"><span className="mono">{r.code}</span>{r.aiDrafted ? ', AI drafted' : ''}</div></td>
          <td><Badge tone={r.status === 'Released' ? 'ok' : ''}>{r.status === 'Draft' ? 'Draft' : r.status}</Badge></td><td className="num">{dateTime(r.createdAt)}</td><td className="num">{dateTime(r.releasedAt)}</td>
          <td><LinkButton size="sm" href={`/reports/${r.id}`}>Open</LinkButton></td></tr>)}</tbody></table></div>}</Async>
  </div>;
}
