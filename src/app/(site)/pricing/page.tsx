import type { Metadata } from 'next';
import { PageHero, Section, Card, ButtonLink } from '@/components/site/ui';
import { Stagger, Item } from '@/components/site/motion';
import { REGISTER_HREF } from '@/components/site/config';
import { getSite, type PricingCard } from '@/lib/site-content';
import { PLAN_SERVICE_TIERS, PLAN_DURATIONS } from '@/domain/plan-catalog';

export const revalidate = 120;

export const metadata: Metadata = { title: 'Pricing', description: 'Plan structure for Business Doctor by Samakose. Prices to be confirmed.' };

/**
 * Every card here is either a published plan (real name, audience, features, price - straight from
 * the `plans` table via getSite().pricing) or, where no plan has been published for that slot yet, a
 * placeholder that shows the slot's generic one-line positioning and nothing else - never a feature
 * list or a price, since nothing has actually been approved to sell there. There is exactly one
 * authoritative source for what a visitor is told: the admin-published Plans list. Nothing on this
 * page is independently hardcoded pricing or feature copy.
 */
export default async function PricingPage() {
  const { pricing } = await getSite();
  const tierCards = PLAN_SERVICE_TIERS.map((t) => {
    const match = pricing.plans.find((p) => p.serviceTier === t.value && !p.durationDays) ?? pricing.plans.find((p) => p.serviceTier === t.value);
    return match ? { ...match, key: t.value } : { name: t.label, audience: t.who, features: [], price: null, reference: null, period: '', ctaLabel: '', ctaHref: '', highlighted: false, serviceTier: t.value, durationDays: null, key: t.value, placeholder: true };
  });
  const horizonCards = PLAN_DURATIONS.map((h) => {
    const match = pricing.plans.find((p) => p.durationDays === h.days);
    return match ? { ...match, key: String(h.days) } : { name: h.label, audience: h.who, features: [], price: null, reference: null, period: '', ctaLabel: '', ctaHref: '', highlighted: false, serviceTier: null, durationDays: h.days, key: String(h.days), placeholder: true };
  });
  const renderPrice = (c: (PricingCard & { placeholder?: boolean })) => c.placeholder ? 'To be confirmed' : (c.price ? <>{c.price}{c.period && <span className="text-sm font-normal text-muted"> {c.period}</span>}</> : 'To be confirmed');

  return (
    <>
      <PageHero eyebrow="Pricing and plans" title="Start with a diagnosis. Add support when it helps." intro="Each plan is a step on the same business health journey. You keep the score and report you have paid for, and you can move up when the diagnosis shows you need more." />
      <Section>
        {!pricing.confirmed && <div role="note" className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-card border border-dashed border-gold bg-[color:var(--warn-soft)] p-4 text-sm text-[color:var(--warn)]"><span><strong>Pricing coming soon.</strong> {pricing.banner}</span><ButtonLink href={pricing.enquiryHref} variant="ghost">{pricing.enquiryLabel}</ButtonLink></div>}
        <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {tierCards.map((t) => (
            <Item key={t.key}>
              <Card className={`flex h-full flex-col gap-3 ${t.highlighted ? '!border-2 !border-forest' : ''}`}>
                <h2 className="font-display text-2xl font-bold">{t.name}</h2>
                <p className="font-display text-lg font-semibold text-leaf-ink">{renderPrice(t)}</p>
                <p className="text-sm text-muted">{t.audience}</p>
                {t.features.length > 0 && <ul className="mt-1 flex flex-1 flex-col gap-2 text-sm">{t.features.map((p) => <li key={p} className="flex gap-2"><span className="mt-1.5 size-1.5 flex-none rounded-full bg-leaf" aria-hidden="true" />{p}</li>)}</ul>}
                {t.ctaLabel && t.ctaHref && <ButtonLink href={t.ctaHref} variant="ghost">{t.ctaLabel}</ButtonLink>}
              </Card>
            </Item>
          ))}
        </Stagger>
        <div className="mt-14">
          <h2 className="font-display text-3xl font-bold">Choose the length of your plan</h2>
          <p className="mt-2 max-w-2xl text-muted">Actions in your platform plan are grouped by horizon, so you can see what to do in 30, 180 and 360 days. The options below set how long Samakose supports you.{!pricing.confirmed && ' Prices to be confirmed.'}</p>
          <Stagger className="mt-6 grid gap-5 md:grid-cols-3">
            {horizonCards.map((h) => (
              <Item key={h.key}>
                <Card className={`flex h-full flex-col gap-3 ${h.highlighted ? '!border-2 !border-forest' : ''}`}>
                  <h3 className="font-display text-2xl font-bold">{h.name}</h3>
                  <p className="font-display text-lg font-semibold text-leaf-ink">{renderPrice(h)}</p>
                  <p className="text-sm text-muted">{h.audience}</p>
                  {h.features.length > 0 && <ul className="mt-1 flex flex-col gap-2 text-sm">{h.features.map((p) => <li key={p} className="flex gap-2"><span className="mt-1.5 size-1.5 flex-none rounded-full bg-leaf" aria-hidden="true" />{p}</li>)}</ul>}
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
