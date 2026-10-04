import type { Metadata } from 'next';
import { PageHero, Section, Card, ButtonLink } from '@/components/site/ui';
import { Stagger, Item } from '@/components/site/motion';
import { REGISTER_HREF } from '@/components/site/config';
import { getSite } from '@/lib/site-content';

export const revalidate = 120;
const PERIOD: Record<string, string> = { 'one-off': 'one-off', month: 'per month', quarter: 'per quarter', year: 'per year', participant: 'per participant' };

export const metadata: Metadata = { title: 'Pricing', description: 'Plan structure for Samakose business health products. Prices to be confirmed.' };

const BUILT_IN = [
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

export default async function PricingPage() {
  const { pricing } = await getSite();
  const TIERS = pricing.plans.length
    ? pricing.plans.map((p) => ({ name: p.name, who: p.audience, pts: p.features, featured: p.highlighted, price: p.price, reference: p.reference, period: PERIOD[p.period] ?? '', cta: p.ctaLabel && p.ctaHref ? { label: p.ctaLabel, href: p.ctaHref } : null }))
    : BUILT_IN.map((t) => ({ ...t, featured: (t as any).featured === true, price: null as string | null, reference: null as string | null, period: '', cta: null as { label: string; href: string } | null }));
  return (
    <>
      <PageHero eyebrow="Pricing and plans" title="Start with a diagnosis. Add support when it helps." intro="Each plan is a step on the same business health journey. You keep the score and report you have paid for, and you can move up when the diagnosis shows you need more." />
      <Section>
        {!pricing.confirmed && <div role="note" className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-card border border-dashed border-gold bg-[color:var(--warn-soft)] p-4 text-sm text-[color:var(--warn)]"><span><strong>Pricing coming soon.</strong> {pricing.banner}</span><ButtonLink href={pricing.enquiryHref} variant="ghost">{pricing.enquiryLabel}</ButtonLink></div>}
        <Stagger className={`grid gap-5 sm:grid-cols-2 ${TIERS.length <= 3 ? 'lg:grid-cols-3' : TIERS.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
          {TIERS.map((t) => (
            <Item key={t.name}>
              <Card className={`flex h-full flex-col gap-3 ${t.featured ? '!border-2 !border-forest' : ''}`}>
                <h2 className="font-display text-2xl font-bold">{t.name}</h2>
                <p className="font-display text-lg font-semibold text-leaf-ink">{t.price ? <>{t.price}{t.period && <span className="text-sm font-normal text-muted"> {t.period}</span>}{t.reference && <span className="block text-sm font-normal text-muted">about {t.reference}</span>}</> : 'To be confirmed'}</p>
                <p className="text-sm text-muted">{t.who}</p>
                <ul className="mt-1 flex flex-1 flex-col gap-2 text-sm">{t.pts.map((p) => <li key={p} className="flex gap-2"><span className="mt-1.5 size-1.5 flex-none rounded-full bg-leaf" aria-hidden="true" />{p}</li>)}</ul>
                {t.cta && <ButtonLink href={t.cta.href} variant="ghost">{t.cta.label}</ButtonLink>}
              </Card>
            </Item>
          ))}
        </Stagger>
        <div className="mt-14">
          <h2 className="font-display text-3xl font-bold">Choose the length of your plan</h2>
          <p className="mt-2 max-w-2xl text-muted">Actions in your platform plan are grouped by horizon, so you can see what to do in 30, 90, 180 and 360 days. The options below set how long Samakose supports you.{!pricing.confirmed && ' Prices to be confirmed.'}</p>
          <Stagger className="mt-6 grid gap-5 md:grid-cols-3">
            {HORIZONS.map((h) => (
              <Item key={h.days}>
                <Card className={`flex h-full flex-col gap-3 ${h.featured ? '!border-2 !border-forest' : ''}`}>
                  <h3 className="font-display text-2xl font-bold">{h.label}</h3>
                  <p className="font-display text-lg font-semibold text-leaf-ink">To be confirmed</p>
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
