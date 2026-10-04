'use client';
import Link from 'next/link';
import { PageHead } from '@/components/ui';
import { RegistryPanel } from '@/components/portfolio/RegistryPanel';
import { usePerms, useTitle } from '@/components/portfolio/shared';

export default function RegistryPage() {
  const { can } = usePerms(); useTitle('Registry clean-up');
  return <div className="stack"><PageHead crumbs={<Link href="/organisations">Organisations</Link>} title="Registry clean-up" sub="Merge duplicates and restore archived organisations" />
    {can('organisations', 'delete') ? <RegistryPanel /> : <p className="muted">Only administrators can clean up the registry.</p>}</div>;
}
