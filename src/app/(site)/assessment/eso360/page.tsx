import type { Metadata } from 'next';
import { PageHero } from '@/components/site/ui';
import { FreeAssessmentFlow } from '@/components/site/FreeAssessmentFlow';

export const metadata: Metadata = { title: 'ESO360 Free Business Health Check', description: 'A free, 25-question preliminary assessment across six dimensions for accelerators, incubators and enterprise support organisations.' };

export default function Eso360AssessmentPage() {
  return (
    <>
      <PageHero eyebrow="ESO360 · Free Business Health Check" title="Your free preliminary assessment" intro="25 questions, about 10 minutes. This is a preliminary assessment, not a certified diagnosis, investment-readiness determination or guarantee of business success." />
      <FreeAssessmentFlow platform="ESO360" />
    </>
  );
}
