import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero, Section } from '@/components/site/ui';
import { FreeAssessmentFlow } from '@/components/site/FreeAssessmentFlow';
import { publicFreeAssessmentAvailability } from '@/services/publicFreeAssessmentAvailability';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'ESO360 Free Business Health Check', description: 'A free, 25-question preliminary assessment across six dimensions for accelerators, incubators and enterprise support organisations.' };

export default async function Eso360AssessmentPage() {
  const availability = await publicFreeAssessmentAvailability('ESO');
  const available = availability === 'available';
  const title = available
    ? 'Your free preliminary assessment'
    : availability === 'coming_soon'
      ? 'This assessment is not yet available'
      : 'This assessment is temporarily unavailable';
  const intro = available
    ? '25 questions, about 10 minutes. This is a preliminary assessment, not a certified diagnosis, investment-readiness determination or guarantee of business success.'
    : availability === 'coming_soon'
      ? 'We are finishing review of the ESO360 question bank before opening it to the public. In the meantime, you can take the SME360 free assessment or get in touch directly.'
      : 'We cannot confirm the ESO360 question bank is available right now. Please try again later, or take the SME360 free assessment.';

  return (
    <>
      <PageHero eyebrow="ESO360 · Free Business Health Check" title={title} intro={intro} />
      {available
        ? <FreeAssessmentFlow platform="ESO360" />
        : <Section>
            <div className="flex flex-wrap gap-4">
              <Link href="/assessment/sme360" className="inline-flex min-h-11 items-center justify-center rounded-full bg-forest px-6 font-semibold text-white no-underline transition duration-200 hover:bg-leaf active:scale-[0.97]">Take the SME360 free check</Link>
              <Link href="/contact" className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-6 font-semibold text-fg no-underline">Contact us</Link>
            </div>
          </Section>}
    </>
  );
}
