'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHead, Tabs } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { WebsiteHub } from '@/components/admin/WebsiteViews';
import { InquiryTable } from '@/components/admin/InquiryViews';

function Inner() {
  const router = useRouter(); const params = useSearchParams();
  return <Guard resource="content" action="read" title="Website">{(me) => {
    const canInq = me.can('inquiries', 'read');
    const tab = params.get('tab') === 'enquiries' && canInq ? 'enquiries' : 'content';
    return <>
      <PageHead title="Website" sub="Everything about the public website in one place: what visitors read, the messages they send, and the files and settings behind it. Changes are drafted first, published on purpose, and can be undone." />
      <Tabs tabs={[{ id: 'content', label: 'Content and settings' }, ...(canInq ? [{ id: 'enquiries', label: 'Enquiries' }] : [])]} active={tab} onChange={(t) => router.replace(t === 'content' ? '/admin/website' : `/admin/website?tab=${t}`)} />
      <div role="tabpanel">
        {tab === 'content' && <WebsiteHub />}
        {tab === 'enquiries' && <div className="card stack"><p className="muted small">Messages and sign-ups sent from the public website. Mark each one handled once someone has replied.</p><InquiryTable exportable={me.can('inquiries', 'export')} /></div>}
      </div>
    </>;
  }}</Guard>;
}
export default function WebsitePage() { return <Suspense><Inner /></Suspense>; }
