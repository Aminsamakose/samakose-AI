'use client';
import { Card } from '@/components/ui';
import type { TabProps } from './types';
import { MessageThread } from './MessageThread';

export default function TabMessages({ caseId }: TabProps) {
  return <Card title="Messages"><MessageThread caseId={caseId} /></Card>;
}
