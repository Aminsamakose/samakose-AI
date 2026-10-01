'use client';
import Link from 'next/link';
import { PageHead } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { MediaLibrary } from '@/components/admin/MediaLibrary';

export default function MediaPage() {
  return <Guard resource="media" action="read" title="Media library">{(me) => <>
    <PageHead crumbs={<Link href="/admin/website">Website and content</Link>} title="Media library" />
    <MediaLibrary me={me} />
  </>}</Guard>;
}
