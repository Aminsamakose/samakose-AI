'use client';
import { PageHead } from '@/components/ui';
import { useTitle } from '@/components/dash/common';
import { AnswerRound } from '@/components/AnswerRound';

export default function AnswerPage() {
  useTitle('My questions');
  return <><PageHead title="My questions" sub="The parts of the business health check assigned to you." /><AnswerRound /></>;
}
