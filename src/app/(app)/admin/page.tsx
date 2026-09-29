'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Empty, ErrorState, Loading, PageHead } from '@/components/ui';
import { useDocTitle, useMe } from '@/components/admin/common';

const TARGETS: [string, string, string][] = [['users', 'create', '/admin/users'], ['audit', 'read', '/admin/audit'], ['settings', 'read', '/admin/settings'], ['integrations', 'read', '/admin/system']];

export default function AdminIndex() {
  const me = useMe(); const router = useRouter();
  useDocTitle('Administration');
  const target = me.data ? TARGETS.find(([r, a]) => me.can(r as any, a))?.[2] : undefined;
  useEffect(() => { if (target) router.replace(target); }, [target, router]);
  if (me.error && !me.data) return <ErrorState message={me.error} retry={me.reload} />;
  if (me.data && !target) return <><PageHead title="Administration" /><Empty title="You do not have access to administration" /></>;
  return <Loading />;
}
