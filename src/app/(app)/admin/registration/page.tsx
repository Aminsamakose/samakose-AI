'use client';
import { PageHead } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { RegistrationSettings } from '@/components/admin/RegistrationSettings';

export default function Page() {
  return <Guard resource="consent" action="read" title="Registration settings">{(me) => <>
    <PageHead title="Registration settings" sub="The consent wording people see, and the mapping that suggests who answers which part of an assessment. Both are versioned. A published version never changes. Create a new version instead." />
    <RegistrationSettings canEdit={me.can('consent', 'edit')} canApprove={me.can('consent', 'approve')} />
  </>}</Guard>;
}
