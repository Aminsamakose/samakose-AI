'use client';
import { PageHead } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { AuthorsPanel, ResourcesPanel } from '@/components/admin/LibraryViews';

export default function LibraryAdminPage() {
  return <Guard resource="library_resources" action="read" title="Resource Library">{(me) => <>
    <PageHead title="Resource Library" sub="The Business Doctor's paid and free guide catalogue." />
    <div className="stack" style={{ gap: 32 }}>
      <ResourcesPanel me={me} />
      <AuthorsPanel me={me} />
    </div>
  </>}</Guard>;
}
