'use client';
import { Async, PageHead, useApi } from '@/components/ui';
import { dateTime } from '@/lib/client/api';
import { useMe, useTitle } from '@/components/dash/common';
import { Coach, Consultant, Finance, Funder, Management, Owner, Reviewer, Website } from '@/components/dash/Views';

export default function DashboardPage() {
  useTitle('Dashboard');
  const st = useApi<any>('/dashboard');
  const me = useMe();
  return <>
    <PageHead title="Dashboard" sub={st.data ? `${st.data.roleLabel} view. Updated ${dateTime(st.data.generatedAt)}` : undefined} />
    <div aria-live="polite">
      <Async state={st}>{(d) => {
        switch (d.kind) {
          case 'management': return <Management d={d} />;
          case 'consultant': return <Consultant d={d} />;
          case 'reviewer': return <Reviewer d={d} />;
          case 'expert': return <><Consultant d={d.lead} /><Coach d={d.coach} /></>;
          case 'coach': return <Coach d={d} />;
          case 'finance': return <Finance d={d} />;
          case 'owner': return <Owner d={d} />;
          case 'funder': return <Funder d={d} me={me.data} />;
          case 'website': return <Website d={d} />;
          default: return <p className="muted">There is no dashboard for your role.</p>;
        }
      }}</Async>
    </div>
  </>;
}
