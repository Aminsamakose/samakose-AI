import { unstable_cache } from 'next/cache';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { KIND_BY_ID, validateData, phoneHref, parseMenu, DEFAULT_MENU, type HomeSection, DEFAULT_SECTIONS } from '@/domain/content-kinds';
import { SITE } from '@/components/site/config';
import { entitlementLines } from '@/domain/plan-catalog';
import { REGISTER_HREF } from '@/components/site/config';

type Rec = Record<string, any>;
export type Faq = { question: string; answer: string };
export type Testimonial = { quote: string; name: string; role: string; organisation: string };
export type Partner = { name: string; website: string; note: string };
export type TeamMember = { name: string; role: string; bio: string; photo: string; linkedin: string };
export type Stat = { value: string; label: string; source: string };
export type PublicArticle = { slug: string; title: string; summary: string; date: string; author: string; body: string };
/** price is only ever a real figure once THIS plan's own price is confirmed (see PublishablePlanRow);
 *  otherwise it is null and priceStatus says why, so the page never renders a placeholder in the shape
 *  of a price - "Pricing pending confirmation" is text, not a number, and is styled as a status badge. */
export type PricingCard = { id: string | null; name: string; audience: string; features: string[]; price: string | null; priceStatus: 'free' | 'confirmed' | 'pending' | 'by_agreement'; reference: string | null; period: string; ctaLabel: string; ctaHref: string; buyable: boolean; highlighted: boolean; serviceTier: string | null; durationDays: number | null };
export type PricingView = { confirmed: boolean; banner: string; currency: 'GHS' | 'USD'; enquiryLabel: string; enquiryHref: string; plans: PricingCard[] };
export type SiteContent = {
  pricing: PricingView; pricing_settings: Rec;
  analytics: Rec; maintenance: { on: boolean; message: string }; brand: Rec; navigation: Rec; nav: { label: string; href: string }[]; contact: Rec; social: Rec; announcement: Rec; seo: Rec; home: Rec & { sections: HomeSection[] };
  faqs: Faq[]; testimonials: Testimonial[]; partners: Partner[]; team: TeamMember[]; stats: Stat[]; articles: PublicArticle[];
};

const D = (id: string): Rec => ({ ...KIND_BY_ID[id].defaults });

const money = (v: unknown, cur: string) => { const n = Number(String(v ?? '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? `${cur === 'USD' ? 'US$' : 'GH₵'}${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}` : null; };
/** A published, billable plan - the shape `finance.listPlans`/the `plans` table actually produces. This is
 *  the ONE authoritative source for public pricing cards; there is no separate CMS copy to keep in sync. */
export type PublishablePlanRow = {
  id: string; name: string; audience: string | null; serviceTier: string | null; durationDays: number | null;
  pricingModel: 'free' | 'fixed' | 'custom'; priceGhs: string; priceConfirmed: boolean;
  entitlements: { key: string; enabled: boolean; limit?: number | string }[] | null;
};
/**
 * Each plan's price is shown as a real figure only when that specific plan's own priceConfirmed is
 * true - confirmation is per plan, not a single site-wide switch, so Finance can confirm Diagnostic's
 * price while Growth's is still pending. A plan whose price is not confirmed never renders a
 * price-shaped placeholder like "To be confirmed": it carries an explicit priceStatus the page renders
 * as a status badge instead of a number. The site-wide "Pricing display" setting (pricesConfirmed +
 * approvalRef) is an additional governance gate: even a plan marked priceConfirmed will not show its
 * figure until Finance has also switched on public display at the site level.
 */
export function buildPricing(s: Rec, planRows: PublishablePlanRow[]): PricingView {
  const cur = s.currency === 'USD' ? 'USD' : 'GHS';
  const siteApproved = s.pricesConfirmed === true && String(s.approvalRef ?? '').trim().length >= 5;
  const plans: PricingCard[] = planRows.map((p) => {
    const priceStatus: PricingCard['priceStatus'] = p.pricingModel === 'free' ? 'free' : p.pricingModel === 'custom' ? 'by_agreement' : (siteApproved && p.priceConfirmed) ? 'confirmed' : 'pending';
    const price = priceStatus === 'free' ? 'Free' : priceStatus === 'by_agreement' ? 'Priced by agreement' : priceStatus === 'confirmed' ? money(p.priceGhs, cur) : null;
    // The period label follows the plan's own duration rather than a fixed "per year" - a 30-day
    // Quick Fix plan billed once for 30 days is not "per year", and a duration-less tier (Diagnostic,
    // a one-off assessment) has no recurring period to show at all.
    const period = priceStatus === 'free' || priceStatus === 'by_agreement' ? '' : p.durationDays ? `for ${p.durationDays} days` : '';
    // No self-serve checkout exists yet (see finance.ts: contracts are created by Finance/Admin, not
    // by a buyer). So every CTA routes into the same real next step that exists today - registration
    // for anything a visitor can act on immediately, an enquiry for anything whose price isn't public
    // yet or that needs a custom agreement - rather than a "Buy" button with nowhere real to land.
    // A confirmed, fixed-price plan is "buyable" - the button drives the real self-serve checkout
    // (see plan-purchases.ts) instead of just linking somewhere. Everything else still routes to the
    // next real step that exists for it: registration for the free tier, an enquiry for anything
    // whose price isn't public yet or that needs a custom agreement.
    const buyable = priceStatus === 'confirmed';
    const { ctaLabel, ctaHref } = priceStatus === 'by_agreement'
      ? { ctaLabel: 'Ask about programme pricing', ctaHref: '/contact' }
      : priceStatus === 'pending'
        ? { ctaLabel: 'Enquire about this plan', ctaHref: '/contact' }
        : buyable
          ? { ctaLabel: `Get started - ${price}`, ctaHref: REGISTER_HREF }
          : { ctaLabel: 'Start your health check', ctaHref: REGISTER_HREF };
    return {
      id: p.id, name: p.name, audience: p.audience ?? '', features: entitlementLines(p.entitlements),
      price, priceStatus, reference: null, period,
      ctaLabel, ctaHref, buyable, highlighted: false, serviceTier: p.serviceTier, durationDays: p.durationDays
    };
  });
  // Page-level "confirmed" now means "at least one real price is actually showing" - it drives whether
  // the top banner still needs to appear, not whether any individual card shows a number.
  const confirmed = plans.some((p) => p.priceStatus === 'confirmed');
  return { confirmed, banner: String(s.bannerText ?? ''), currency: cur, enquiryLabel: String(s.enquiryLabel ?? 'Send an enquiry'), enquiryHref: String(s.enquiryHref || '/contact'), plans };
}

export function defaultSite(): SiteContent {
  return { pricing: buildPricing(D('pricing_settings'), []), pricing_settings: D('pricing_settings'), analytics: D('analytics'), maintenance: { on: false, message: '' }, brand: D('brand'), navigation: D('navigation'), nav: parseMenu(DEFAULT_MENU).items, contact: D('contact'), social: D('social'), announcement: D('announcement'), seo: D('seo'), home: D('home') as any, faqs: [], testimonials: [], partners: [], team: [], stats: [], articles: [] };
}

/** What a visitor sees: published copies, plus anything whose scheduled time has passed. Gated items (consent, verification) are checked again here. */
async function load(): Promise<SiteContent> {
  const rows = await db().select().from(schema.contentDocs).where(inArray(schema.contentDocs.status, ['Published', 'Scheduled']));
  const now = Date.now();
  const site = defaultSite();
  const mrows = await db().select().from(schema.rules).where(inArray(schema.rules.key, ['switch.maintenance', 'text.maintenance_message']));
  const mv = new Map(mrows.map((r) => [r.key, r.value]));
  site.maintenance = { on: mv.get('switch.maintenance') === '1', message: mv.get('text.maintenance_message') ?? '' };
  const items: { kind: string; data: Rec; order: number; at: number }[] = [];
  for (const r of rows) {
    const k = KIND_BY_ID[r.kind]; if (!k) continue;
    const due = r.status === 'Scheduled' && r.publishAt && r.publishAt.getTime() <= now;
    const data = (due ? r.draft : r.live) as Rec | null;
    if (!data) continue;
    const v = validateData(k, data, { forPublish: true });
    if (!v.ok) continue;
    if (k.singleton) { (site as any)[k.id] = { ...(site as any)[k.id], ...v.data }; continue; }
    items.push({ kind: k.id, data: v.data, order: r.sortOrder, at: (r.publishedAt ?? r.updatedAt).getTime() });
  }
  items.sort((a, b) => a.order - b.order || b.at - a.at);
  const of = (kind: string) => items.filter((i) => i.kind === kind).map((i) => i.data);
  site.faqs = of('faq') as Faq[];
  site.testimonials = of('testimonial') as Testimonial[];
  site.partners = of('partner') as Partner[];
  site.team = (of('team_member') as (TeamMember & { position?: string })[]).map((m, i) => ({ m, k: m.position ? Number(m.position) : 1000 + i })).sort((a, b) => a.k - b.k).map((x) => x.m);
  site.stats = of('stat') as Stat[];
  const publishedPlans = await db().select({ id: schema.plans.id, name: schema.plans.name, audience: schema.plans.audience, serviceTier: schema.plans.serviceTier, durationDays: schema.plans.durationDays, pricingModel: schema.plans.pricingModel, priceGhs: schema.plans.priceGhs, priceConfirmed: schema.plans.priceConfirmed, entitlements: schema.plans.entitlements })
    .from(schema.plans).where(eq(schema.plans.publicationStatus, 'published'));
  site.pricing = buildPricing(site.pricing_settings, publishedPlans as any);
  site.articles = (of('article') as PublicArticle[]).sort((a, b) => b.date.localeCompare(a.date));
  const menu = parseMenu(String(site.navigation.menu ?? ''));
  site.nav = menu.error || !menu.items.length ? parseMenu(DEFAULT_MENU).items : menu.items;
  if (!Array.isArray(site.home.sections) || !site.home.sections.length) site.home.sections = DEFAULT_SECTIONS;
  return site;
}

/** Uncached read, for tests and scripts. */
export const __load = load;
const cached = unstable_cache(load, ['site-content-v1'], { tags: ['site-content'], revalidate: 120 });

/** Public pages read through this. If the database is unreachable the built-in text is shown, so the website never goes blank. */
export async function getSite(): Promise<SiteContent> {
  try { return await cached(); } catch (e) { console.error('[site-content] using built-in text:', (e as Error).message); return defaultSite(); }
}

export function contactOf(s: SiteContent) {
  const c = s.contact;
  const lines = String(c.address ?? '').split('\n').map((l: string) => l.trim()).filter(Boolean);
  return { email: String(c.email || SITE.email), phone: String(c.phone || SITE.phone), phoneHref: phoneHref(String(c.phone || SITE.phone)) || SITE.phoneHref, address: lines.length ? lines : SITE.address, hours: String(c.hours ?? '') };
}

export const SOCIAL_LABELS: [string, string][] = [['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['x', 'X'], ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['whatsapp', 'WhatsApp']];
export const socialLinks = (s: SiteContent) => SOCIAL_LABELS.filter(([k]) => /^https:\/\//.test(String(s.social[k] ?? ''))).map(([k, label]) => ({ label, href: String(s.social[k]) }));
