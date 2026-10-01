'use client';
import { use } from 'react';
import Link from 'next/link';
import { PageHead } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { KindScreen } from '@/components/admin/WebsiteViews';
import { KIND_BY_ID } from '@/domain/content-kinds';

export default function WebsiteKindPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params);
  const k = KIND_BY_ID[kind];
  return <Guard resource={k?.group ?? 'content'} action="read" title={k?.plural ?? 'Website'}>{(me) => k
    ? <><PageHead crumbs={<Link href="/admin/website">Website and content</Link>} title={k.plural} sub={k.singleton ? k.blurb : undefined} /><KindScreen kindId={kind} me={me} /></>
    : <><PageHead title="Not found" /><p className="muted">There is no such content type. <Link href="/admin/website">Back to Website and content</Link></p></>}</Guard>;
}
