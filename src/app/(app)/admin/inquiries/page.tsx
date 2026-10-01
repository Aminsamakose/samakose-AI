'use client';
import { PageHead } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { InquiryTable } from '@/components/admin/InquiryViews';

export default function InquiriesPage() {
  return <Guard resource="inquiries" action="read" title="Website enquiries">{(me) => <>
    <PageHead title="Website enquiries" sub="Messages and sign-ups sent from the public website. Mark each one handled once someone has replied." />
    <div className="card stack"><InquiryTable exportable={me.can('inquiries', 'export')} /></div>
  </>}</Guard>;
}
