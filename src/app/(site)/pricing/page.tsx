import type { Metadata } from 'next';
import { PageHero, Section, Card, ButtonLink } from '@/components/site/ui';
import { Stagger, Item } from '@/components/site/motion';
import { REGISTER_HREF } from '@/components/site/config';

export const metadata: Metadata = { title: 'Pricing', description: 'Plan structure for Samakose business health products. Prices to be confirmed.' };

const TIERS = [
  { name: 'Discovery', who: 'Owners who want to see where they stand.', pts: ['A basic assessment', 'A limited health score', 'Basic recommendations'] },
  { name: 'Diagnostic', who: 'Owners who want a full picture and clear priorities.', pts: ['Full 360 assessment', 'AI-assisted diagnosis, reviewed against evidence', 'Detailed health report'] },
  { name: 'Transform', who: 'Owners ready to act on the diagnosis with support.', pts: ['Everything in Diagnostic', 'Action plan and KPI tracking', 'Coaching sessions', 'Monthly progress review'], featured: true },
  { name: 'Growth', who: 'Growing firms that need finance, markets or investment readiness.', pts: ['Everything in Transform', 'Opportunity matching', 'Investment readiness pack', 'Expert hours and priority support'] },
  { name: 'Programme', who: 'Programmes, partners and institutions supporting many organisations.', pts: ['Cohorts and many users', 'Coach management', 'Portfolio intelligence and reporting', 'Priced per participant by agreement'] }
];

export default function PricingPage() {
  return (
    <>
      <PageHero eyebrow="Pricing and plans" title="Start with a diagnosis. Add support when it helps." intro="Each plan is a step on the same business health journey. You keep the score and report you have paid for, and you can move up when the diagnosis shows you need more." />
      <Section>
        <div role="note" className="mb-8 rounded-card border border-dashed border-gold bg-[color:var(--warn-soft)] p-4 text-sm text-[color:var(--warn)]"><strong>Prices to be confirmed.</strong> The plan structure below is final enough to plan around. Amounts, currencies and any free tier will be published once Samakose confirms them.</div>
        <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {TIERS.map((t) => (
            <Item key={t.name}>
              <Card className={`flex h-full flex-col gap-3 ${t.featured ? '!border-2 !border-forest' : ''}`}>
                <h2 className="font-display text-2xl font-bold">{t.name}</h2>
                <p className="font-display text-lg font-semibold text-leaf">To be confirmed</p>
                <p className="text-sm text-muted">{t.who}</p>
                <ul className="mt-1 flex flex-1 flex-col gap-2 text-sm">{t.pts.map((p) => <li key={p} className="flex gap-2"><span className="mt-1.5 size-1.5 flex-none rounded-full bg-leaf" aria-hidden="true" />{p}</li>)}</ul>
              </Card>
            </Item>
          ))}
        </Stagger>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href={REGISTER_HREF}>Start your health check</ButtonLink>
          <ButtonLink href="/contact" variant="ghost">Ask about programme pricing</ButtonLink>
        </div>
      </Section>
    </>
  );
}
