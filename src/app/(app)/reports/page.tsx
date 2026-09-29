'use client';
import Link from 'next/link';
import { Badge, DataTable, LinkButton, PageHead, type Col } from '@/components/ui';
import { dateFmt } from '@/lib/client/api';
import { useTitle } from '@/components/portfolio/shared';

type Row = { id: string; code: string; name: string; funder: string | null; startDate: string | null; endDate: string | null; status: string; cohortCount: number };

/**
 * Funders cannot open individual case reports (case records are outside their scope),
 * so their reporting view is the results dashboard of each programme they fund.
 */
export default function FunderReportsPage() {
  useTitle('Reports');
  const cols: Col<Row>[] = [
    { key: 'name', label: 'Programme', sort: 'name', render: (r) => <>{r.name}</> },
    { key: 'code', label: 'Code', sort: 'code', render: (r) => <span className="mono">{r.code}</span> },
    { key: 'startDate', label: 'Dates', sort: 'start', render: (r) => <>{dateFmt(r.startDate)} to {dateFmt(r.endDate)}</> },
    { key: 'cohortCount', label: 'Cohorts', align: 'r', render: (r) => <span className="num">{r.cohortCount}</span> },
    { key: 'status', label: 'Status', sort: 'status', render: (r) => <Badge>{r.status}</Badge> },
    { key: 'link', label: 'Results', render: (r) => <Link href={`/programmes/${r.id}`}>View results<span className="sr"> for {r.name}</span></Link> }
  ];
  return <div className="stack">
    <PageHead title="Reports" sub="Programme results for the programmes you fund. Figures are aggregates: groups with too few businesses are hidden to protect privacy." />
    <DataTable<Row> endpoint="/programmes" columns={cols} rowHref={(r) => `/programmes/${r.id}`} placeholder="Search programmes"
      empty={{ title: 'No programmes to report on yet', hint: 'Individual business reports are not shared with funders. Results dashboards appear here for each programme linked to your account. Contact Samakose if a programme is missing.', action: <LinkButton href="/programmes" size="sm">Open programmes</LinkButton> }} />
  </div>;
}
