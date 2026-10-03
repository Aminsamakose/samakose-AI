'use client';
import { useState } from 'react';
import { Async, Card, Empty, PageHead, useApi } from '@/components/ui';
import { useMe, useTitle } from '@/components/dash/common';
import { ResultFeedback } from '@/components/ResultFeedback';
import { ActionsPanel, EvidencePanel, InvoicesPanel, KpiPanel, Lifecycle, ReportsPanel, ScorePanel, SessionsPanel } from '@/components/dash/MyCasePanels';

export default function MyCasePage() {
  useTitle('My business');
  const me = useMe();
  const list = useApi<{ items: { id: string; code: string; orgName: string; status: string }[] }>('/cases?pageSize=20&sort=created&dir=desc');
  const [pick, setPick] = useState<string>('');
  if (me.data && me.data.user.role !== 'OWNER') return <><PageHead title="My business" /><Card><Empty title="This page is for business owners" hint="Use Cases in the menu to see the businesses you work with." /></Card></>;
  return <>
    <PageHead title="My business" sub="Where you are, what to do next, and what you owe." />
    <Async state={list}>{(l) => {
      if (l.items.length === 0) return <Card><Empty title="Your business has no case yet" hint="Your adviser at Samakose will open one after your registration is confirmed. Nothing is needed from you until then." /></Card>;
      const id = pick || l.items[0].id;
      return <div className="stack">
        {l.items.length > 1 && <div className="field" style={{ maxWidth: 360 }}><label htmlFor="case-pick">Case</label><select id="case-pick" value={id} onChange={(e) => setPick(e.target.value)}>{l.items.map((c) => <option key={c.id} value={c.id}>{c.code} ({c.orgName})</option>)}</select></div>}
        <Detail id={id} />
      </div>;
    }}</Async>
  </>;
}

function Detail({ id }: { id: string }) {
  const st = useApi<any>(`/cases/${id}`);
  return <Async state={st}>{(c) => <div className="stack">
    <Card title={`${c.orgName} (${c.code})`}><Lifecycle status={c.status} /></Card>
    <Card title="Your health score"><ScorePanel score={c.score} /></Card>
    <Card title="Does your score match your business?"><ResultFeedback caseId={id} /></Card>
    <Card title="Your actions"><ActionsPanel caseId={id} /></Card>
    <div className="grid two">
      <Card title="Reports for you"><ReportsPanel caseId={id} /></Card>
      <Card title="Next coaching sessions"><SessionsPanel caseId={id} /></Card>
    </div>
    <Card title="Invoices"><InvoicesPanel /></Card>
    <Card title="Indicators you report"><KpiPanel caseId={id} /></Card>
    <Card title="Share evidence and documents"><EvidencePanel caseId={id} /></Card>
  </div>}</Async>;
}
