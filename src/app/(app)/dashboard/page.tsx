'use client';
import { useState } from 'react';
import { Async, PageHead, useApi } from '@/components/ui';
import { dateTime } from '@/lib/client/api';
import { useMe, useTitle } from '@/components/dash/common';
import { NextStepCard } from '@/components/OptionalAnswers';
import { Respondent, Coach, Consultant, Finance, Funder, Management, Owner, Reviewer, Website } from '@/components/dash/Views';

export default function DashboardPage() {
  useTitle('Dashboard');
  const me = useMe();
  const isAdmin = me.data?.user?.role === 'ADMIN';
  const [as, setAs] = useState('');
  const people = useApi<any>(isAdmin ? '/users?pageSize=100&sort=name&dir=asc' : null);
  const st = useApi<any>(as ? `/dashboard?as=${as}` : '/dashboard');
  return <>
    <PageHead title="Dashboard" sub={st.data ? `${st.data.viewingAs ? `${st.data.viewingAs.name}, ${st.data.roleLabel}` : st.data.roleLabel} view. Updated ${dateTime(st.data.generatedAt)}` : undefined} />
    {isAdmin && <div className="card" style={{ marginBottom: 'var(--space-4, 16px)' }}>
      <label htmlFor="view-as"><strong>View as</strong></label>{' '}
      <select id="view-as" value={as} onChange={(e) => setAs(e.target.value)}>
        <option value="">My own dashboard (Administrator)</option>
        {(people.data?.items ?? []).filter((u: any) => u.active && u.id !== me.data?.user?.id).map((u: any) => <option key={u.id} value={u.id}>{u.name}, {u.role}</option>)}
      </select>
      {as && <p className="small muted" style={{ marginTop: 8 }}>Read-only. You are seeing exactly what this person sees. Each view is recorded in the audit trail.</p>}
    </div>}
    <div aria-live="polite">
      <Async state={st}>{(d) => {
        switch (d.kind) {
          case 'management': return <Management d={d} />;
          case 'consultant': return <Consultant d={d} />;
          case 'reviewer': return <Reviewer d={d} />;
          case 'expert': return <><Consultant d={d.lead} /><Coach d={d.coach} /></>;
          case 'coach': return <Coach d={d} />;
          case 'finance': return <Finance d={d} />;
          case 'owner': return <><NextStepCard /><Owner d={d} /></>;
          case 'respondent': return <Respondent d={d} />;
          case 'funder': return <Funder d={d} me={me.data} />;
          case 'website': return <Website d={d} />;
          default: return <p className="muted">There is no dashboard for your role.</p>;
        }
      }}</Async>
    </div>
  </>;
}
