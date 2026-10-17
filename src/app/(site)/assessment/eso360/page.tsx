import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero, Section } from '@/components/site/ui';

export const metadata: Metadata = { title: 'ESO360 Free Business Health Check', description: 'A free, 25-question preliminary assessment across six dimensions for accelerators, incubators and enterprise support organisations.' };

/** The ESO360 free-assessment question bank is still in Draft, pending content review (see
 *  ensureESO360FreeAssessmentFramework's comment), so the backend correctly refuses to serve it.
 *  Until it is reviewed and published, this page must not collect a visitor's name and email only to
 *  fail them with a raw server error afterwards -- show a clear "coming soon" notice instead. */
export default function Eso360AssessmentPage() {
  return (
    <>
      <PageHero eyebrow="ESO360 · Free Business Health Check" title="This assessment is not yet available" intro="We are finishing review of the ESO360 question bank before opening it to the public. In the meantime, you can take the SME360 free assessment or get in touch directly." />
      <Section>
        <div className="flex flex-wrap gap-4">
          <Link href="/assessment/sme360" className="inline-flex min-h-11 items-center justify-center rounded-full bg-forest px-6 font-semibold text-white no-underline transition duration-200 hover:bg-leaf active:scale-[0.97]">Take the SME360 free check</Link>
          <Link href="/contact" className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-6 font-semibold text-fg no-underline">Contact us</Link>
        </div>
      </Section>
    </>
  );
}
