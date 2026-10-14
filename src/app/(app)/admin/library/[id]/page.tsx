'use client';
import { use } from 'react';
import Link from 'next/link';
import { PageHead } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { ResourceEditor } from '@/components/admin/LibraryViews';

export default function LibraryResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Guard resource="library_resources" action="read" title="Resource">{(me) => <>
    <PageHead crumbs={<Link href="/admin/library">Resource Library</Link>} title="Edit resource" />
    <ResourceEditor id={id} me={me} />
  </>}</Guard>;
}
