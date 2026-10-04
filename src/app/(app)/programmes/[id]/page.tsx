'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Async, Badge, Button, Card, DataTable, Empty, KV, Modal, PageHead, Tabs, useApi, type Col } from '@/components/ui';
import { dateFmt, ghs } from '@/lib/client/api';
import { CohortForm, ProgrammeForm, type Cohort, type Programme } from '@/components/portfolio/ProgrammeForms';
import { IndicatorsPanel } from '@/components/portfolio/IndicatorsPanel';
import { BudgetPanel } from '@/components/portfolio/BudgetPanel';
import { ProgrammeDashboard } from '@/components/portfolio/ProgrammeDashboard';
import { usePerms, useTitle } from '@/components/portfolio/shared';

type Detail = Programme & { cohorts: Cohort[] };
type CaseRow = { id: string; code: string; orgName: string; status: string; consultantName: string | null; score: number | null; maturity: string | null };

export default function ProgrammePage() {
  const { id } = useParams<{ id: string }>();
  const { can, ready, role } = usePerms();
  const st = useApi<Detail>(`/programmes/${id}`);
  const [tab, setTab] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [cohortModal, setCohortModal] = useState<'new' | Cohort | null>(null);
  const [caseKey, setCaseKey] = useState(0);
  useTitle(st.data?.name ?? 'Programme');
  const funder = role === 'FUNDER';
  const tabs = [
    { id: 'overview', label: 'Overview' }, { id: 'cohorts', label: 'Cohorts' },
    ...(can('cases', 'read') ? [{ id: 'cases', label: 'Cases' }] : []),
    ...(can('dashboard', 'read') && !funder ? [{ id: 'targets', label: 'Targets' }] : []),
    ...(can('dashboard', 'read') ? [{ id: 'budget', label: 'Budget' }] : []),
    ...(can('dashboard', 'read') ? [{ id: 'dashboard', label: 'Dashboard' }] : [])
  ];
  useEffect(() => { if (ready && tab === null) setTab(funder ? 'dashboard' : 'overview'); }, [ready, tab, funder]);
  const active = tab ?? 'overview';
  const caseCols: Col<CaseRow>[] = [
    { key: 'code', label: 'Case', sort: 'code', render: (r) => <span className="mono">{r.code}</span> },
    { key: 'orgName', label: 'Organisation', sort: 'org' },
    { key: 'status', label: 'State', sort: 'status', render: (r) => <Badge>{r.status}</Badge> },
    { key: 'consultantName', label: 'Consultant', render: (r) => <>{r.consultantName ?? '-'}</> },
    { key: 'score', label: 'Score', sort: 'score', align: 'r', render: (r) => <span className="num">{r.score ?? '-'}</span> },
    { key: 'maturity', label: 'Maturity', render: (r) => <>{r.maturity ?? '-'}</> }
  ];
  return <Async state={st}>{(p) => {
    const canEdit = can('programmes', 'edit'); const canCohortCreate = can('cohorts', 'create'); const canCohortEdit = can('cohorts', 'edit');
    const closed = ['Completed', 'Cancelled'].includes(p.status);
    return <div className="stack">
      <PageHead crumbs={<Link href="/programmes">Programmes</Link>} title={p.name} sub={<><span className="mono">{p.code}</span> · <Badge>{p.status}</Badge>{p.funder ? ` · ${p.funder}` : ''}</>} />
      {tabs.length > 1 && <Tabs tabs={tabs} active={active} onChange={setTab} />}
      <div role="tabpanel" className="stack">
      {active === 'overview' && (editing ?
        <Card title="Edit programme"><ProgrammeForm programme={p} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); st.reload(); }} /></Card> :
        <Card title="Details" actions={canEdit ? <Button onClick={() => setEditing(true)}>Edit</Button> : undefined}>
          <KV items={[['Funder', p.funder], ['Start date', dateFmt(p.startDate)], ['End date', dateFmt(p.endDate)], ['Budget', ghs(p.budgetGhs)], ['Cohorts', p.cohortCount], ...(funder ? [] : [['Cases', p.caseCount] as [string, any]])]} />
        </Card>)}
      {active === 'cohorts' && <Card title={`Cohorts (${p.cohorts.length})`} actions={canCohortCreate && !closed ? <Button variant="primary" onClick={() => setCohortModal('new')}>Add cohort</Button> : undefined}>
        {p.cohorts.length === 0 ? <Empty title="No cohorts yet" hint={canCohortCreate && !closed ? 'Add a cohort to enrol businesses in batches.' : undefined} /> :
          <div className="table-wrap"><table><thead><tr><th>Cohort</th><th>Code</th><th>Dates</th><th className="r">Capacity</th>{!funder && <th className="r">Enrolled</th>}<th>Status</th>{canCohortEdit && <th><span className="sr">Actions</span></th>}</tr></thead>
            <tbody>{p.cohorts.map((c) => <tr key={c.id}><td>{c.name}</td><td className="mono">{c.code}</td><td>{dateFmt(c.startDate)} to {dateFmt(c.endDate)}</td><td className="r num">{c.capacity}</td>{!funder && <td className="r num">{c.enrolled}</td>}<td><Badge tone={c.status === 'Open' ? 'ok' : c.status === 'Closed' ? '' : 'info'}>{c.status}</Badge></td>{canCohortEdit && <td><Button size="sm" onClick={() => setCohortModal(c)} aria-label={`Edit ${c.name}`}>Edit</Button></td>}</tr>)}</tbody></table></div>}
      </Card>}
      {active === 'cases' && <Card title="Cases in this programme"><DataTable<CaseRow> endpoint="/cases" params={{ programmeId: id }} columns={caseCols} rowHref={(r) => `/cases/${r.id}`} exportable={can('cases', 'export')} refreshKey={caseKey} placeholder="Search case or organisation" empty={{ title: 'No cases in this programme yet', hint: 'Open a case from an organisation and assign it to this programme.' }} /></Card>}
      {active === 'budget' && <BudgetPanel programmeId={id} canEdit={can('programmes', 'edit') && !closed} />}
      {active === 'targets' && <IndicatorsPanel programmeId={id} canEdit={can('programmes', 'edit') && !closed} />}
      {active === 'dashboard' && <ProgrammeDashboard id={id} canExport={can('dashboard', 'export')} />}
      </div>
      <Modal open={cohortModal !== null} onClose={() => setCohortModal(null)} title={cohortModal === 'new' ? 'Add cohort' : 'Edit cohort'}>
        {cohortModal && <CohortForm programmeId={id} cohort={cohortModal === 'new' ? undefined : cohortModal} onCancel={() => setCohortModal(null)} onDone={() => { setCohortModal(null); st.reload(); setCaseKey((k) => k + 1); }} />}
      </Modal>
    </div>;
  }}</Async>;
}
