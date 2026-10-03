import type { Metadata } from 'next';
import { PageHero, Section, Eyebrow, ButtonLink } from '@/components/site/ui';
import { Reveal } from '@/components/site/motion';
import { getSite, contactOf } from '@/lib/site-content';

export const metadata: Metadata = { title: 'About', description: 'Samakose is an enterprise development and business transformation organisation based in Tamale, Northern Ghana.' };

export default async function AboutPage() {
  const SITE = contactOf(await getSite());
  return (
    <>
      <PageHero eyebrow="About Samakose" title="Helping enterprises become sustainable and investment-ready." intro="Samakose is an enterprise development and business transformation organisation based in Tamale, Northern Ghana. The Business Doctor is how we diagnose, treat and track the health of the enterprises we serve." />
      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <Reveal>
            <Eyebrow>What we do</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-balance">Practical systems, not just reports.</h2>
            <p className="mt-4 text-muted">We work with SMEs, agribusinesses, cooperatives, startups, social enterprises and development organisations. Our focus is on practical systems that improve how a business is run: enterprise development, business coaching, cooperative formation, agribusiness advisory and capacity building.</p>
            <p className="mt-4 text-muted">The platform turns that practice into a repeatable method, so each business gets a clear diagnosis, a specific prescription and support to carry it out.</p>
          </Reveal>
          <Reveal delay={0.1}>
            <Eyebrow>Where we work</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-balance">Rooted in Northern Ghana, built for Africa.</h2>
            <p className="mt-4 text-muted">Our office is in Tamale, and our starting point is the realities of enterprises in Northern Ghana and West Africa: seasonal cash flow, informal records, limited access to finance and strong cooperative traditions.</p>
            <address className="mt-4 text-sm not-italic text-muted">{SITE.address.join(', ')}</address>
          </Reveal>
        </div>
      </Section>
      <Section tone="soft">
        <Reveal>
          <Eyebrow>Leadership and team</Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">The people behind Samakose.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-card border border-line bg-surface p-6"><p className="font-display text-xl font-semibold">Amin Yahaya</p><p className="text-sm text-muted">Founder and Lead Advisor</p></div>
          </div>
          <div className="mt-8"><ButtonLink href="/contact">Get in touch</ButtonLink></div>
        </Reveal>
      </Section>
    </>
  );
}
