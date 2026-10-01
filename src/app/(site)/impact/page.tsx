import type { Metadata } from 'next';
import { PageHero, Section, Eyebrow, Placeholder, ButtonLink, Card } from '@/components/site/ui';
import { Reveal, Stagger, Item } from '@/components/site/motion';
import { RESULTS, TESTIMONIALS, PARTNERS, CASE_STUDIES } from '@/lib/impact-data';

export const metadata: Metadata = { title: 'Impact', description: 'How Samakose measures change, and the verified results we publish.' };

const METHOD = [
  { t: 'Baseline', d: 'Every business starts with a health check, so later change is measured against a clear starting point.' },
  { t: 'Evidence', d: 'Answers are graded by how well they are supported, so results show how much confidence to place in them.' },
  { t: 'Midline and endline', d: 'Re-assessments during and after support show whether scores and KPIs have moved.' },
  { t: 'Review', d: 'A person reviews diagnoses and prescriptions before they reach the business.' }
];

export default function ImpactPage() {
  return (
    <>
      <PageHero eyebrow="Impact" title="Results, shown only when they are verified." intro="We publish outcomes once they are documented and cleared with the people and organisations involved. Until then, this page explains how change is measured." />
      <Section>
        <Reveal><Eyebrow>How we measure</Eyebrow><h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-balance">Change is measured against a baseline, with evidence.</h2></Reveal>
        <Stagger className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {METHOD.map((m, i) => <Item key={m.t}><Card className="h-full"><p className="font-mono text-xs text-leaf-ink">0{i + 1}</p><h3 className="mt-2 font-display text-xl font-semibold">{m.t}</h3><p className="mt-2 text-sm text-muted">{m.d}</p></Card></Item>)}
        </Stagger>
      </Section>
      <Section tone="soft">
        <Eyebrow>Verified results</Eyebrow>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">What the data shows so far.</h2>
        {RESULTS.length === 0 ? <div className="mt-6"><Placeholder label="Verified headline results go here, each with its source and date." /></div> : (
          <dl className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {RESULTS.map((r) => <div key={r.label} className="rounded-card border border-line bg-surface p-6"><dd className="font-display text-4xl font-bold text-forest">{r.value}</dd><dt className="mt-1 font-semibold">{r.label}</dt><p className="mt-2 text-xs text-muted">{r.source}, as of {r.asOf}</p></div>)}
          </dl>
        )}
      </Section>
      <Section>
        <Eyebrow>Voices</Eyebrow>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">In their own words.</h2>
        {TESTIMONIALS.length === 0 ? <div className="mt-6"><Placeholder label="Testimonials go here, each with written consent from the person quoted." /></div> : (
          <div className="mt-8 grid gap-5 md:grid-cols-2">{TESTIMONIALS.map((t) => <blockquote key={t.name} className="rounded-card border border-line bg-surface p-6"><p className="text-lg">&ldquo;{t.quote}&rdquo;</p><footer className="mt-4 text-sm text-muted">{t.name}, {t.role}, {t.organisation}</footer></blockquote>)}</div>
        )}
        <h3 className="mt-12 font-display text-2xl font-semibold">Case studies</h3>
        {CASE_STUDIES.length === 0 ? <div className="mt-4"><Placeholder label="Case studies go here once the organisations involved have approved them." /></div> : null}
        <h3 className="mt-12 font-display text-2xl font-semibold">Partners</h3>
        {PARTNERS.length === 0 ? <div className="mt-4"><Placeholder label="Partner logos go here, only with each organisation's written permission." /></div> : (
          <ul className="mt-6 flex flex-wrap items-center gap-8">{PARTNERS.map((p) => <li key={p.name}><img src={p.logoSrc} alt={p.name} className="h-12 w-auto" /></li>)}</ul>
        )}
        <div className="mt-12"><ButtonLink href="/contact">Talk to us about results in your context</ButtonLink></div>
      </Section>
    </>
  );
}
