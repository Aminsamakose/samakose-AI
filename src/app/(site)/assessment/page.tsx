import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero, Section, Card } from '@/components/site/ui';
import { Reveal, Stagger, Item } from '@/components/site/motion';
import { publicFreeAssessmentAvailability } from '@/services/publicFreeAssessmentAvailability';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Free Business Health Check', description: 'Understand your business. Identify your priorities. Take your next step. A free, 25-question preliminary assessment.' };

const PLATFORMS = [
  {
    code: 'sme360', name: 'SME360', tone: 'bg-leaf text-white',
    who: 'Micro and small businesses, SMEs, startups, traders, manufacturers and service providers.',
    dims: 'Strategy and Leadership, Financial Health, Marketing and Sales, Operations and Productivity, Human Resources and Organisation, Risk Resilience and Growth.'
  },
  {
    code: 'agrifood360', name: 'AgriFood360', tone: 'bg-gold text-ink',
    who: 'Smallholder and commercial farmers, agribusinesses, input suppliers, aggregators, processors and distributors.',
    dims: 'Production and Agronomic Practices, Climate and Seasonal Resilience, Input Access and Supply Reliability, Storage and Post-Harvest Handling, Market Access and Value Chain Position, Business and Financial Management.'
  },
  {
    code: 'eso360', name: 'ESO360', tone: 'bg-clay text-white',
    who: 'Enterprise support organisations, accelerators, incubators and enterprise mentorship programmes.',
    dims: 'Programme Design and Curriculum, Cohort Recruitment and Selection, Mentorship and Delivery Capacity, Monitoring and Impact Tracking, Funding and Sustainability, Organisational Capacity and Governance.'
  }
];

export default async function AssessmentLandingPage() {
  const [agrifoodStatus, esoStatus] = await Promise.all([
    publicFreeAssessmentAvailability('AGRIFOOD'),
    publicFreeAssessmentAvailability('ESO')
  ]);
  const statusByCode: Record<string, string> = { agrifood360: agrifoodStatus, eso360: esoStatus };

  return (
    <>
      <PageHero eyebrow="Free Business Health Check" title="Understand your business. Identify your priorities. Take your next step." intro="25 questions, about 10 minutes. You will get your overall score, strengths and priority areas immediately. This is a preliminary assessment, not a certified diagnosis, investment-readiness determination or guarantee of business success." />
      <Section>
        <h2 className="font-display text-2xl font-bold">Select your assessment</h2>
        <Stagger className="mt-6 grid gap-6 lg:grid-cols-3">
          {PLATFORMS.map((p) => {
            const status = statusByCode[p.code] ?? 'available';
            const available = status === 'available';
            const unavailableLabel = status === 'temporarily_unavailable' ? 'Temporarily unavailable' : 'Coming soon';
            return (
              <Item key={p.code}>
                <Card className="flex h-full flex-col !p-0 overflow-hidden">
                  <div className={`${p.tone} p-6`}>
                    <h3 className="font-display text-2xl font-bold tracking-tight">{p.name}</h3>
                    {!available && <p className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-90">{unavailableLabel}</p>}
                  </div>
                  <div className="flex flex-1 flex-col gap-4 p-6 text-sm">
                    <p className="text-muted">{p.who}</p>
                    <p className="text-muted">{p.dims}</p>
                    {available
                      ? <Link href={`/assessment/${p.code}`} className="mt-auto inline-flex min-h-11 w-fit items-center justify-center rounded-full bg-forest px-6 font-semibold text-white no-underline transition duration-200 hover:bg-leaf active:scale-[0.97]">Start free check</Link>
                      : <span className="mt-auto inline-flex min-h-11 w-fit items-center justify-center rounded-full border border-line px-6 font-semibold text-muted">{unavailableLabel}</span>}
                  </div>
                </Card>
              </Item>
            );
          })}
        </Stagger>
        <Reveal delay={0.1}>
          <p className="mt-8 max-w-2xl text-sm text-muted">One free assessment per email address, per platform. You will need a valid email address to see and keep your result.</p>
          <p className="mt-3 max-w-2xl text-sm text-muted">AgriFood360 and ESO360 free checks are preliminary six-dimension screens. A full Business Health Assessment provides a broader, platform-specific diagnosis with evidence review and an action plan.</p>
        </Reveal>
      </Section>
    </>
  );
}
