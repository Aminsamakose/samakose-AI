'use client';
import { PageHead } from '@/components/ui';
import { useTitle } from '@/components/dash/common';
import { TeamPanel } from '@/components/TeamPanel';

export default function TeamPage() {
  useTitle('My team');
  return <><PageHead title="My team" sub="Invite colleagues to answer the parts of the assessment that fit their role." /><TeamPanel /></>;
}
