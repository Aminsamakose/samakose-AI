import type { Metadata } from 'next';
import { PageHero } from '@/components/site/ui';
import { FreeAssessmentFlow } from '@/components/site/FreeAssessmentFlow';

export const metadata: Metadata = { title: 'SME360 Free Business Health Check', description: 'A free, 25-question preliminary assessment across six dimensions of your business.' };

export default function Sme360AssessmentPage() {
  return (
    <>
      <PageHero eyebrow="SME360 · Free Business Health Check" title="Your free preliminary assessment" intro="25 questions, about 10 minutes. This is a preliminary assessment, not a certified diagnosis, investment-readiness determination or guarantee of business success." />
      <FreeAssessmentFlow />
    </>
  );
}
