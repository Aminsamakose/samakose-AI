'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Empty, Loading, PageHead } from '@/components/ui';
import { useMe } from '@/components/case/core/shared';

/** A business owner's own opportunities. Sends them to their organisation's pathway. */
export default function MyPathway() {
  const router = useRouter(); const { me, ready } = useMe();
  useEffect(() => { if (me?.orgId) router.replace(`/organisations/${me.orgId}/pathway`); }, [me, router]);
  if (!ready || me?.orgId) return <Loading />;
  return <><PageHead title="Opportunities" /><Card><Empty title="No business is linked to your account" hint="Opportunities appear once your business registration is confirmed." /></Card></>;
}
