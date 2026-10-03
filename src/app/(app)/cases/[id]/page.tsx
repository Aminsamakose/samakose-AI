'use client';
import { Suspense, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Async, Loading, PageHead, Tabs, Tile, useApi } from '@/components/ui';
import { CASE_TABS, type CaseData, type TabProps } from '@/components/case/types';
import { AssignPanel, Lifecycle } from '@/components/case/core/Lifecycle';
import { MaturityBadge, StateBadge, TAB_PERMISSION, one, useMe } from '@/components/case/core/shared';
import { ROLE_LABEL } from '@/lib/rbac';
import TabOverview from '@/components/case/TabOverview';
import TabDiagnostic from '@/components/case/TabDiagnostic';
import TabEvidence from '@/components/case/TabEvidence';
import TabScore from '@/components/case/TabScore';
import TabDiagnosis from '@/components/case/TabDiagnosis';
import TabPrescription from '@/components/case/TabPrescription';
import TabActions from '@/components/case/TabActions';
import TabKpis from '@/components/case/TabKpis';
import TabRisks from '@/components/case/TabRisks';
import TabCoaching from '@/components/case/TabCoaching';
import TabReports from '@/components/case/TabReports';
import TabActivity from '@/components/case/TabActivity';

const COMPONENTS: Record<string, (p: TabProps) => React.ReactNode> = {
  overview: TabOverview, diagnostic: TabDiagnostic, evidence: TabEvidence, score: TabScore, diagnosis: TabDiagnosis, prescription: TabPrescription,
  actions: TabActions, kpis: TabKpis, risks: TabRisks, coaching: TabCoaching, reports: TabReports, activity: TabActivity
};

export default function CasePage() {
  return <Suspense fallback={<Loading />}><Workspace /></Suspense>;
}

function Workspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams();
  const { me, can, ready } = useMe();
  const st = useApi<CaseData>(`/cases/${id}`);
  const c = st.data;
  useEffect(() => { document.title = c ? `${c.code} | Business Doctor` : 'Case | Business Doctor'; }, [c]);

  const tabs = useMemo(() => CASE_TABS.filter((t) => { const p = TAB_PERMISSION[t.id]; return !p || can(p[0], p[1]); }).map((t) => ({ id: t.id, label: t.label })), [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const requested = sp.get('tab') ?? 'overview';
  const active = tabs.some((t) => t.id === requested) ? requested : 'overview';
  const setTab = (t: string) => { const n = new URLSearchParams(sp.toString()); n.set('tab', t); router.replace(`${pathname}?${n.toString()}`, { scroll: false }); };

  return <div className="stack">
    <Async state={st}>{(cd) => {
      const role = me?.role ?? '';
      const Tab = COMPONENTS[active];
      if (!ready) return <Loading />;
      const canEdit = can('cases', 'edit') && role !== 'OWNER';
      const canAssign = can('cases', 'edit') && (role === 'ADMIN' || role === 'PROGRAMME_MANAGER');
      return <>
        <PageHead crumbs={<Link href="/cases">Cases</Link>}
          title={<span className="row"><span className="mono">{cd.code}</span><StateBadge state={cd.status} /></span>}
          sub={<>{role !== 'FUNDER' ? <Link href={`/organisations/${cd.orgId}`}>{cd.orgName}</Link> : cd.orgName}{cd.region ? `, ${cd.region}` : ''}{cd.programmeName ? ` | ${cd.programmeName}` : ''}</>} />
        <div className="grid">
          <div className="tile meter"><span className="l" id="hs-l">Health score</span>{cd.score ? <><span className="v">{one(cd.score.overall)}<span className="small muted"> / 100</span></span><div className="track" role="meter" aria-labelledby="hs-l" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(cd.score.overall)}><div className={`fill ${Number(cd.score.overall) < 40 ? 'bad' : Number(cd.score.overall) < 60 ? 'warn' : ''}`} style={{ width: `${Math.max(0, Math.min(100, Number(cd.score.overall)))}%` }} /></div><span className="small muted">Confidence {cd.score.confidenceClass}</span></> : <><span className="v">-</span><span className="small muted">Not scored yet</span></>}</div>
          <Tile label="Maturity" value={cd.score ? <MaturityBadge value={cd.score.maturity} /> : '-'} />
          <Tile label="Consultant" value={<span style={{ fontSize: '1.1rem' }}>{cd.consultantName ?? 'Unassigned'}</span>} />
          <div className="tile"><span className="l">People</span>
            {cd.people.length ? <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>{cd.people.map((p) => <li key={p.id}>{p.name} ({ROLE_LABEL[p.role as keyof typeof ROLE_LABEL] ?? p.role})</li>)}</ul> : <span className="muted">Nobody assigned</span>}</div>
        </div>
        <Lifecycle c={cd} role={role} canEdit={canEdit} reload={st.reload} />
        {canAssign && <AssignPanel key={`${cd.consultantId}-${cd.coachId}-${cd.reviewerId}`} c={cd} reload={st.reload} />}
        <Tabs tabs={tabs.length ? tabs : [{ id: 'overview', label: 'Overview' }]} active={active} onChange={setTab} />
        <div role="tabpanel" aria-label={CASE_TABS.find((t) => t.id === active)?.label} className="stack">
          {ready && Tab && <Tab caseId={id} caseData={cd} role={role} reload={st.reload} />}
        </div>
      </>;
    }}</Async>
  </div>;
}
