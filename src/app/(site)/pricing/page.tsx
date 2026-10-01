import type { Metadata } from 'next';
import { PageHero, Section, Card, ButtonLink } from '@/components/site/ui';
import { Stagger, Item } from '@/components/site/motion';
import { REGISTER_HREF } from '@/components/site/config';

export const metadata: Metadata = { title: 'Pricing', description: 'Plan structure for Samakose business health products. Prices to be confirmed.' };

const TIERS = [
  { name: 'Discovery', who: 'Owners who want to see where they stand.', pts: ['A basic assessment', 'A limited health score', 'Basic recommendations'] },
  { name: 'Diagnostic', who: 'Owners who want a full picture and clear priorities.', pts: ['Full 360 assessment', 'AI-assisted diagnosis, reviewed against evidence', 'Detailed health report'] },
  { name: 'Transform', who: 'Owners ready to act on the diagnosis with support.', pts: ['Everything in Diagnostic', 'Action plan and KPI tracking', 'Coaching sessions', 'Monthly progress review'], featured: true },
  { name: 'Growth', who: 'Growing firms that need finance, markets or investment readiness.', pts: ['Everything in Transform', 'Priority support', 'Planned: opportunity matching and investment readiness pack'] },
  { name: 'Programme', who: 'Programmes, partners and institutions supporting many organisations.', pts: ['Cohorts and many users', 'Coach management', 'Portfolio intelligence and reporting', 'Priced per participant by agreement'] }
];

const HORIZONS = [
  { days: '30', label: '30 day plan', who: 'A fast start: fix the one or two things holding the business back.', pts: ['Quick wins on the weakest dimension', 'Weekly check-ins', 'Progress check at day 30'] },
  { days: '180', label: '180 day plan', who: 'Six months to build the systems behind the quick wins.', pts: ['Priorities across several dimensions', 'Monthly reviews and KPI tracking', 'Re-assessment to show the change in score'], featured: true },
  { days: '360', label: '360 day plan', who: 'A full year of structured support toward investment readiness.', pts: ['Full action plan with long horizon items', 'Quarterly reviews and re-assessment', 'Planned: investment readiness pack'] }
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
        <div className="mt-14">
          <h2 className="font-display text-3xl font-bold">Choose the length of your plan</h2>
          <p className="mt-2 max-w-2xl text-muted">Actions in your platform plan are grouped by horizon, so you can see what to do in 30, 90, 180 and 360 days. The options below set how long Samakose supports you. Prices to be confirmed.</p>
          <Stagger className="mt-6 grid gap-5 md:grid-cols-3">
            {HORIZONS.map((h) => (
              <Item key={h.days}>
                <Card className={`flex h-full flex-col gap-3 ${h.featured ? '!border-2 !border-forest' : ''}`}>
                  <h3 className="font-display text-2xl font-bold">{h.label}</h3>
                  <p className="font-display text-lg font-semibold text-leaf">To be confirmed</p>
                  <p className="text-sm text-muted">{h.who}</p>
                  <ul className="mt-1 flex flex-col gap-2 text-sm">{h.pts.map((p) => <li key={p} className="flex gap-2"><span className="mt-1.5 size-1.5 flex-none rounded-full bg-leaf" aria-hidden="true" />{p}</li>)}</ul>
                </Card>
              </Item>
            ))}
          </Stagger>
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href={REGISTER_HREF}>Start your health check</ButtonLink>
          <ButtonLink href="/contact" variant="ghost">Ask about programme pricing</ButtonLink>
        </div>
      </Section>
    </>
  );
}
