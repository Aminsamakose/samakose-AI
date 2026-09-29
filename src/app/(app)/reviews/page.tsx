'use client';
import Link from 'next/link';
import { dateFmt } from '@/lib/client/api';
import { Async, Card, Empty, PageHead, LinkButton, useApi } from '@/components/ui';
import { LinkTile, useTitle } from '@/components/dash/common';

type Q = {
  prescriptions: { id: string; code: string; caseId: string; caseCode: string; org: string; version: number; createdAt: string; items: number }[];
  reports: { id: string; code: string; caseId: string; caseCode: string; org: string; title: string; createdAt: string }[];
  returned: { id: string; code: string; caseId: string; caseCode: string; org: string; reason: string | null }[];
};

export default function ReviewsPage() {
  useTitle('Review queue');
  const st = useApi<Q>('/reviews/queue');
  return <>
    <PageHead title="Review queue" sub="Work waiting for a decision. Oldest first." />
    <div aria-live="polite"><Async state={st}>{(d) => <div className="stack">
      <div className="grid">
        <LinkTile label="Prescriptions" value={d.prescriptions.length} hint="In review, waiting for approval or return" />
        <LinkTile label="Reports" value={d.reports.length} hint="Draft reports waiting for release or return" />
        {d.returned.length > 0 && <LinkTile label="Returned" value={d.returned.length} hint="Sent back and waiting for rework" />}
      </div>
      <Card title="Prescriptions awaiting review">
        {d.prescriptions.length === 0 ? <Empty title="No prescriptions waiting" hint="New submissions appear here." /> :
          <div className="table-wrap"><table><caption className="sr">Prescriptions awaiting review</caption><thead><tr><th>Prescription</th><th>Case</th><th>Organisation</th><th className="r">Version</th><th className="r">Items</th><th>Submitted</th><th><span className="sr">Open</span></th></tr></thead>
            <tbody>{d.prescriptions.map((p) => <tr key={p.id}><td><Link href={`/cases/${p.caseId}?tab=prescription`}>{p.code}</Link></td><td>{p.caseCode}</td><td>{p.org}</td><td className="r num">{p.version}</td><td className="r num">{p.items}</td><td>{dateFmt(p.createdAt)}</td>
              <td><LinkButton size="sm" href={`/cases/${p.caseId}?tab=prescription`}>Review</LinkButton></td></tr>)}</tbody></table></div>}
      </Card>
      <Card title="Reports awaiting review">
        {d.reports.length === 0 ? <Empty title="No reports waiting" hint="Draft reports appear here." /> :
          <div className="table-wrap"><table><caption className="sr">Reports awaiting review</caption><thead><tr><th>Report</th><th>Case</th><th>Organisation</th><th>Drafted</th><th><span className="sr">Open</span></th></tr></thead>
            <tbody>{d.reports.map((r) => <tr key={r.id}><td><Link href={`/reports/${r.id}`}>{r.title || r.code}</Link></td><td>{r.caseCode}</td><td>{r.org}</td><td>{dateFmt(r.createdAt)}</td><td><LinkButton size="sm" href={`/reports/${r.id}`}>Open</LinkButton></td></tr>)}</tbody></table></div>}
      </Card>
      {d.returned.length > 0 && <Card title="Returned for rework">
        <div className="table-wrap"><table><caption className="sr">Returned prescriptions</caption><thead><tr><th>Prescription</th><th>Case</th><th>Organisation</th><th>Reviewer note</th></tr></thead>
          <tbody>{d.returned.map((p) => <tr key={p.id}><td><Link href={`/cases/${p.caseId}?tab=prescription`}>{p.code}</Link></td><td>{p.caseCode}</td><td>{p.org}</td><td>{p.reason ?? '-'}</td></tr>)}</tbody></table></div>
      </Card>}
    </div>}</Async></div>
  </>;
}
