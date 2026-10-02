'use client';
import { PageHead } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { AgentWorkforce } from '@/components/admin/AgentWorkforce';

export default function Page() {
  return <Guard resource="agents" action="read" title="AI workforce">{(me) => <>
    <PageHead title="AI workforce" sub="The AI agents the platform uses. They draft and recommend. People decide, and no agent can change a score, a role or the audit trail." />
    <AgentWorkforce canEdit={me.can('agents', 'edit')} canApprove={me.can('agents', 'approve')} />
  </>}</Guard>;
}
