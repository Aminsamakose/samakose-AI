import type { Metadata } from 'next';
import { PageHero, Section, Card, ButtonLink } from '@/components/site/ui';
import { Stagger, Item } from '@/components/site/motion';
import { REGISTER_HREF } from '@/components/site/config';
import { getSite, type PricingCard } from '@/lib/site-content';
import { PLAN_SERVICE_TIERS } from '@/domain/plan-catalog';
import { PlanBuyButton } from '@/components/site/PlanBuyButton';

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
  // One card per published plan, never two. A tier such as Transform or Growth can hold more than one
  // plan at different durations (Quick Fix vs Build, 180-day vs 360-day) - every one of them gets its
  // own card, ordered by tier and then by duration, instead of being picked into a single representative
  // "tier" card while also appearing again further down a separate duration-based grid. A tier with
  // nothing published yet still gets one placeholder card, so the five-stage journey always reads whole.
  const planCards = PLAN_SERVICE_TIERS.flatMap((t) => {
    const matches = pricing.plans.filter((p) => p.serviceTier === t.value).sort((a, b) => (a.durationDays ?? 0) - (b.durationDays ?? 0));
    if (!matches.length) return [{ id: null, name: t.label, audience: t.who, features: [], price: null, priceStatus: 'pending' as const, reference: null, period: '', ctaLabel: 'Ask about this plan', ctaHref: '/contact', buyable: false, highlighted: false, serviceTier: t.value, durationDays: null, key: t.value, placeholder: true }];
    return matches.map((m) => ({ ...m, key: `${t.value}-${m.name}` }));
  });
  // A real price renders as a price (bold, brand colour). Anything not yet confirmed - whether no plan
  // has been published for this slot at all, or a published plan's own price is still pending
  // confirmation - renders as an explicit status badge instead, so nothing price-shaped is ever shown
  // for a figure nobody has approved.
  const renderPrice = (c: (PricingCard & { placeholder?: boolean })) => {
    if (!c.placeholder && c.price) return <span className="font-display text-4xl font-extrabold tracking-tight">{c.price}{c.period && <span className="ml-1 text-sm font-normal text-muted">{c.period}</span>}</span>;
    const label = c.placeholder ? 'Not yet available' : 'Pricing pending confirmation';
    return <span className="inline-flex items-center rounded-full border border-dashed border-gold bg-[color:var(--warn-soft)] px-2.5 py-0.5 text-xs font-medium normal-case text-[color:var(--warn)]">{label}</span>;
  };
  const renderCta = (c: (PricingCard & { placeholder?: boolean })) => {
    if (!c.ctaLabel || !c.ctaHref) return null;
    if (c.buyable && c.id) return <PlanBuyButton planId={c.id} label={c.ctaLabel} className="inline-flex min-h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-forest px-6 text-[0.95rem] font-semibold text-white no-underline transition duration-200 active:scale-[0.97] focus-visible:outline-2 disabled:opacity-60" />;
    return <ButtonLink href={c.ctaHref} variant="ghost" className="w-full">{c.ctaLabel}</ButtonLink>;
  };

  return (
    <>
      <PageHero eyebrow="Pricing and plans" title="Start with a diagnosis. Add support when it helps." intro="Each plan is a step on the same business health journey. You keep the score and report you have paid for, and you can move up when the diagnosis shows you need more." />
      <Section>
        {!pricing.confirmed && <div role="note" className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-card border border-dashed border-gold bg-[color:var(--warn-soft)] p-4 text-sm text-[color:var(--warn)]"><span><strong>Pricing coming soon.</strong> {pricing.banner}</span><ButtonLink href={pricing.enquiryHref} variant="ghost">{pricing.enquiryLabel}</ButtonLink></div>}
        {/* auto-fit (not a fixed column count) so an uneven card count - 7 plans doesn't divide evenly
            into any neat column count - never leaves an empty, reserved-but-unused column of blank
            space hanging off a short last row. Empty tracks collapse to zero width automatically, and
            the layout reflows at any viewport without separate sm:/lg: breakpoints to keep in sync. */}
        <Stagger className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
          {planCards.map((c) => (
            <Item key={c.key}>
              <Card className={`flex h-full flex-col gap-3 ${c.highlighted ? '!border-2 !border-forest' : ''}`}>
                <h2 className="font-display text-2xl font-bold">{c.name}</h2>
                <div className="text-leaf-ink">{renderPrice(c)}</div>
                <p className="text-sm text-muted">{c.audience}</p>
                {c.features.length > 0 && <ul className="mt-1 flex flex-1 flex-col gap-2 text-sm">{c.features.map((p) => <li key={p} className="flex gap-2"><svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 size-4 flex-none text-leaf" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z" clipRule="evenodd" /></svg>{p}</li>)}</ul>}
                <div className="mt-1">{renderCta(c)}</div>
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
