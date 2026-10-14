'use client';
import Link from 'next/link';
import { PageHead } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { ResourceEditor } from '@/components/admin/LibraryViews';

export default function NewLibraryResourcePage() {
  return <Guard resource="library_resources" action="create" title="New resource">{(me) => <>
    <PageHead crumbs={<Link href="/admin/library">Resource Library</Link>} title="New resource" />
    <ResourceEditor id={null} me={me} />
  </>}</Guard>;
}
