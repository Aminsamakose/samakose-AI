import { Fragment } from 'react';
import { ArrowRight, ClipboardCheck, HeartPulse, LineChart, Users, FileBarChart, FolderCheck, Mail, Phone, MapPin } from 'lucide-react';
import { Section, Container, Eyebrow, ButtonLink, Card, Placeholder } from '@/components/site/ui';
import { Reveal, Stagger, Item } from '@/components/site/motion';
import { HeroVitals } from '@/components/site/HeroVitals';
import { HowItWorks } from '@/components/site/HowItWorks';
import { REGISTER_HREF, LOGIN_HREF } from '@/components/site/config';
import { getSite, contactOf } from '@/lib/site-content';

const PRODUCTS = [
  { name: 'SME360', who: 'Owner-managed businesses in trade, services and light manufacturing.', pts: ['Scored across six health dimensions, from finance and sales to records and compliance', 'A Business Health Score with a plan of dated actions', 'Coaching sessions and progress tracking on one record'], tone: 'bg-leaf text-white' },
  { name: 'AgriFood360', who: 'Farms, aggregators, processors, cooperatives and agrifood exporters.', pts: ['The same six-dimension health check, set up for farms, aggregators and processors', 'Evidence upload and review for records and compliance', 'Agrifood-specific modules such as value-chain mapping are planned'], tone: 'bg-gold text-ink' },
  { name: 'ESO360', who: 'Accelerators, incubators, hubs and enterprise support programmes.', pts: ['Cohorts, programmes and portfolio views for the businesses you support', 'Baseline, midline and endline tracking', 'Programme-health modules such as a business model lab are planned'], tone: 'bg-clay text-white' }
];

const SOLUTIONS = [
  { icon: HeartPulse, t: 'Business health diagnostics', d: 'A structured assessment that shows how healthy the business is and why, in plain language.' },
  { icon: ClipboardCheck, t: 'Prescriptions and action plans', d: 'Specific interventions with owners, deadlines and expected results, not a general report.' },
  { icon: Users, t: 'Coaching and advisory', d: 'Coaches and consultants work from one shared record, so support is continuous.' },
  { icon: LineChart, t: 'Progress and KPI tracking', d: 'Re-measure scores and KPIs to see what has changed and what has not.' },
  { icon: FileBarChart, t: 'Programme intelligence', d: 'Portfolio views and reporting for programme managers, partners and donors.' },
  { icon: FolderCheck, t: 'Evidence and reports', d: 'Keep supporting documents with each finding and produce clear reports for boards, lenders and partners.' }
];

export default async function Home() {
  const site = await getSite();
  const h = site.home;
  const C = contactOf(site);
  const SECTIONS: Record<string, React.ReactNode> = {
    'partners': (
    <>
      <Section tone="soft" className="!py-12 sm:!py-14">
        <Reveal>
          <Eyebrow>Partners and clients</Eyebrow>
          {site.partners.length
            ? <ul className="mt-4 flex flex-wrap gap-3">{site.partners.map((p) => <li key={p.name} className="rounded-card border border-line bg-surface px-4 py-3 text-sm font-semibold">{/^https:\/\//.test(p.website) ? <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-fg no-underline hover:text-leaf-ink">{p.name}<span className="sr-only"> (opens in a new tab)</span></a> : p.name}{p.note && <span className="block text-xs font-normal text-muted">{p.note}</span>}</li>)}</ul>
            : <div className="mt-4"><Placeholder label="Partner and client logos go here, only with each organisation's written permission." /></div>}
        </Reveal>
      </Section>

    </>
  ),
    'platform': (
    <>
      <Section id="platform">
        <Reveal>
          <Eyebrow>The platform</Eyebrow>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">One health record, three products built for different organisations.</h2>
          <p className="mt-4 max-w-2xl text-muted">Each product measures what matters for that kind of organisation. All three share one core, so evidence, scores and coaching stay connected.</p>
        </Reveal>
        <Stagger className="mt-10 grid gap-6 md:grid-cols-3">
          {PRODUCTS.map((p) => (
            <Item key={p.name}>
              <Card className="flex h-full flex-col gap-4 overflow-hidden !p-0">
                <div className={`${p.tone} p-6`}>
                  <h3 className="font-display text-3xl font-bold tracking-tight">{p.name}</h3>
                  <p className="mt-2 text-sm opacity-90">{p.who}</p>
                </div>
                <ul className="flex flex-1 flex-col gap-3 px-6 pb-6 text-sm">
                  {p.pts.map((x) => <li key={x} className="flex gap-2"><span className="mt-1.5 size-1.5 flex-none rounded-full bg-leaf" aria-hidden="true" />{x}</li>)}
                </ul>
              </Card>
            </Item>
          ))}
        </Stagger>
      </Section>

    </>
  ),
    'how-it-works': (
    <>
      <Section id="how-it-works" tone="soft">
        <Reveal>
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">From diagnosis to growth in seven steps.</h2>
        </Reveal>
        <div className="mt-10"><HowItWorks /></div>
      </Section>

    </>
  ),
    'solutions': (
    <>
      <Section id="solutions">
        <Reveal>
          <Eyebrow>Solutions</Eyebrow>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">What you can do with it.</h2>
        </Reveal>
        <Stagger className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <Item key={s.t}>
              <Card className="h-full">
                <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-forest"><s.icon className="size-5" aria-hidden="true" /></span>
                <h3 className="mt-4 font-display text-xl font-semibold">{s.t}</h3>
                <p className="mt-2 text-sm text-muted">{s.d}</p>
              </Card>
            </Item>
          ))}
        </Stagger>
      </Section>

    </>
  ),
    'impact': (
    <>
      <Section id="impact" tone="dark">
        <Reveal>
          <Eyebrow dark>Impact</Eyebrow>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">Results, shown only when they are verified.</h2>
          <p className="mt-4 max-w-2xl text-white/70">{h.impactNote}</p>
          {site.stats.length
            ? <dl className="mt-8 grid gap-4 md:grid-cols-3">{site.stats.map((x) => <div key={x.label} className="rounded-card border border-white/15 bg-white/5 p-5"><dd className="font-display text-4xl font-bold text-lime">{x.value}</dd><dt className="mt-1 text-sm text-white/90">{x.label}</dt><p className="mt-2 text-xs text-white/60">Source: {x.source}</p></div>)}</dl>
            : <div className="mt-8 grid gap-4 md:grid-cols-3"><Placeholder label="Verified headline result" /><Placeholder label="Verified headline result" /><Placeholder label="Verified headline result" /></div>}
          {site.testimonials.length
            ? <div className="mt-6 grid gap-4 md:grid-cols-2">{site.testimonials.map((q) => <figure key={q.name + q.quote.slice(0, 12)} className="rounded-card border border-white/15 bg-white/5 p-5"><blockquote className="text-white/90">&ldquo;{q.quote}&rdquo;</blockquote><figcaption className="mt-3 text-sm text-white/70">{q.name}{(q.role || q.organisation) && `, ${[q.role, q.organisation].filter(Boolean).join(', ')}`}</figcaption></figure>)}</div>
            : <div className="mt-4"><Placeholder label="Testimonials and case studies go here, with consent from each person or organisation quoted." /></div>}
          <div className="mt-8"><ButtonLink href="/impact" variant="ghost-dark">How we measure impact</ButtonLink></div>
        </Reveal>
      </Section>

    </>
  ),
    'faq': site.faqs.length ? (
    <>
      <Section id="faq" tone="soft">
        <Reveal>
          <Eyebrow>Questions</Eyebrow>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">Frequently asked questions.</h2>
          <div className="mt-8 flex max-w-3xl flex-col gap-3">
            {site.faqs.map((f) => (
              <details key={f.question} className="group rounded-card border border-line bg-surface p-4">
                <summary className="cursor-pointer font-display text-lg font-semibold">{f.question}</summary>
                <p className="mt-3 whitespace-pre-line text-muted">{f.answer}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </Section>

    </>
  ) : null,
    'resources': (
    <>
      <Section id="resources">
        <Reveal>
          <Eyebrow>Resources and insights</Eyebrow>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">Practical guidance for enterprise growth.</h2>
          <div className="mt-8"><ButtonLink href="/resources" variant="ghost">Browse the guides <ArrowRight className="size-4" aria-hidden="true" /></ButtonLink></div>
        </Reveal>
      </Section>

    </>
  ),
    'contact': (
    <>
      <Section id="contact" tone="soft">
        <div className="grid gap-10 lg:grid-cols-2">
          <Reveal>
            <Eyebrow>Contact</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">Talk to the team.</h2>
            <p className="mt-4 max-w-md text-muted">Whether you run a business, a cooperative or a support programme, we can show you what a health check would look like.</p>
            <ul className="mt-6 flex flex-col gap-3 text-sm">
              <li className="flex items-start gap-3"><Mail className="mt-0.5 size-5 flex-none text-leaf-ink" aria-hidden="true" /><a href={`mailto:${C.email}`}>{C.email}</a></li>
              <li className="flex items-start gap-3"><Phone className="mt-0.5 size-5 flex-none text-leaf-ink" aria-hidden="true" /><a href={`tel:${C.phoneHref}`}>{C.phone}</a></li>
              <li className="flex items-start gap-3"><MapPin className="mt-0.5 size-5 flex-none text-leaf-ink" aria-hidden="true" /><span>{C.address.join(', ')}</span></li>
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="flex h-full flex-col justify-between gap-6 rounded-card bg-forest p-8 text-white">
              <div>
                <h3 className="font-display text-2xl font-bold">Ready to see where you stand?</h3>
                <p className="mt-3 text-white/80">Create an account to start your first health check, or sign in to continue where you left off.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <ButtonLink href={REGISTER_HREF} variant="lime">Start your health check</ButtonLink>
                <ButtonLink href={LOGIN_HREF} variant="ghost-dark">Sign in</ButtonLink>
                <ButtonLink href="/contact" variant="ghost-dark">Send us a message</ButtonLink>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>
    </>
  ),
  };
  return (
    <>
      <section className="relative overflow-hidden bg-forest text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'repeating-linear-gradient(45deg,rgba(255,255,255,.05) 0 1px,transparent 1px 22px),repeating-linear-gradient(-45deg,rgba(255,255,255,.05) 0 1px,transparent 1px 22px)' }} />
        <Container className="relative grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <Reveal><p className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 font-mono text-xs uppercase tracking-[0.14em] text-lime"><span className="size-2 rounded-full bg-lime" aria-hidden="true" />The Business Doctor, as software</p></Reveal>
            <Reveal delay={0.05}><h1 className="font-display text-4xl font-bold leading-[1.04] tracking-tight text-balance sm:text-6xl">{h.heroHeadline}</h1></Reveal>
            <Reveal delay={0.1}><p className="max-w-xl text-lg text-white/80">{h.heroText}</p></Reveal>
            <Reveal delay={0.15}>
              <div className="flex flex-wrap gap-3">
                <ButtonLink href={REGISTER_HREF} variant="lime">{h.primaryCta} <ArrowRight className="size-4" aria-hidden="true" /></ButtonLink>
                <ButtonLink href="/#how-it-works" variant="ghost-dark">See how it works</ButtonLink>
              </div>
            </Reveal>
            <Reveal delay={0.2}><p className="text-sm text-white/60">Built for SME owners, accelerators, cooperatives, development partners and governments.</p></Reveal>
          </div>
          <HeroVitals />
        </Container>
      </section>

      {h.sections.filter((s: { enabled: boolean }) => s.enabled).map((s: { id: string }) => <Fragment key={s.id}>{SECTIONS[s.id]}</Fragment>)}
    </>
  );
}
