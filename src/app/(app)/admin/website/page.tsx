'use client';
import { PageHead } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { WebsiteHub } from '@/components/admin/WebsiteViews';

export default function WebsitePage() {
  return <Guard resource="content" action="read" title="Website and content">{() => <>
    <PageHead title="Website and content" sub="Change what visitors see without a developer. Every change is saved as a draft first, published on purpose, and kept in the history so it can be undone." />
    <WebsiteHub />
  </>}</Guard>;
}
