'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Empty, ErrorState, Loading, PageHead } from '@/components/ui';
import { useDocTitle, useMe } from '@/components/admin/common';
import { CommandCentre } from '@/components/admin/CommandCentre';

// Administrators land on the Command Centre. Other roles that reach /admin are sent to the first area they may use.
const TARGETS: [string, string, string][] = [['content', 'read', '/admin/website'], ['inquiries', 'read', '/admin/website?tab=enquiries'], ['audit', 'read', '/admin/audit'], ['settings', 'read', '/admin/settings'], ['integrations', 'read', '/admin/system']];

export default function AdminIndex() {
  const me = useMe(); const router = useRouter();
  useDocTitle('Administrator Command Centre');
  const isAdmin = !!me.data && me.can('users', 'create');
  const target = me.data && !isAdmin ? TARGETS.find(([r, a]) => me.can(r as any, a))?.[2] : undefined;
  useEffect(() => { if (target) router.replace(target); }, [target, router]);
  if (me.error && !me.data) return <ErrorState message={me.error} retry={me.reload} />;
  if (isAdmin) return <><PageHead title="Administrator Command Centre" sub="What needs attention across the platform and the website, with links to act on it." /><CommandCentre /></>;
  if (me.data && !target) return <><PageHead title="Administration" /><Empty title="You do not have access to administration" /></>;
  return <Loading />;
}
