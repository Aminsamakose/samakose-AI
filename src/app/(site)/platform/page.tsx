import type { Metadata } from 'next';
import { Database, Gauge, Library, MessagesSquare, Scale } from 'lucide-react';
import { PageHero, Section, Eyebrow, ButtonLink, Card } from '@/components/site/ui';
import { Reveal, Stagger, Item } from '@/components/site/motion';
import { REGISTER_HREF } from '@/components/site/config';

export const metadata: Metadata = { title: 'Platform', description: 'SME360, AgriFood360 and ESO360: three business health products on one shared core.' };

const PRODUCTS = [
  { name: 'SME360', tone: 'bg-leaf text-white', who: 'Owner-managed businesses in trade, services and light manufacturing.', dims: 'Strategy, finance, sales, operations, people, governance, digital and growth readiness (8 dimensions).', gets: ['Business Health Score and report', '90-day action plan', 'Coaching history and growth roadmap'] },
  { name: 'AgriFood360', tone: 'bg-gold text-ink', who: 'Farms, aggregators, processors, cooperatives and agrifood exporters.', dims: 'From production and farmer networks to climate resilience and investment readiness (12 dimensions).', gets: ['Value-chain view of where value and cash leak', 'Prescriptions matched to seasonal cycles', 'Evidence upload and review'] },
  { name: 'ESO360', tone: 'bg-clay text-white', who: 'Accelerators, incubators, hubs, cooperatives and enterprise support programmes.', dims: 'Strategic identity, governance, business model, financial sustainability and programme excellence (10 dimensions).', gets: ['ESO transformation plan', 'Business model lab', 'Entrepreneur outcomes linked to the programme’s own health'] }
];
const CORE = [
  { icon: Database, t: 'Evidence engine', d: 'Answers and uploaded documents are graded for reliability, so scores show how well each finding is supported.' },
  { icon: Gauge, t: 'Scoring model', d: 'Deterministic scoring with published rules that administrators can review and adjust.' },
  { icon: Library, t: 'Intervention library', d: 'A growing library of prescriptions matched to the conditions the diagnosis finds.' },
  { icon: MessagesSquare, t: 'Coaching engine', d: 'Coaches and advisers work from the same record, with notes and actions in one place.' },
  { icon: Scale, t: 'Review and approval', d: 'AI-assisted diagnoses and prescriptions are reviewed by a person before they reach the business.' }
];

export default function PlatformPage() {
  return (
    <>
      <PageHero eyebrow="The platform" title="Three products. One shared health record." intro="Each product measures what matters for that kind of organisation. Because all three run on the same core, your evidence, scores and coaching stay connected as you grow.">
        <ButtonLink href={REGISTER_HREF} variant="lime">Start your health check</ButtonLink>
        <ButtonLink href="/pricing" variant="ghost-dark">See plans</ButtonLink>
      </PageHero>
      <Section>
        <Stagger className="grid gap-6 lg:grid-cols-3">
          {PRODUCTS.map((p) => (
            <Item key={p.name}>
              <Card className="flex h-full flex-col !p-0 overflow-hidden">
                <div className={`${p.tone} p-6`}><h2 className="font-display text-3xl font-bold tracking-tight">{p.name}</h2><p className="mt-2 text-sm opacity-90">{p.who}</p></div>
                <div className="flex flex-1 flex-col gap-4 p-6 text-sm">
                  <p className="text-muted">{p.dims}</p>
                  <ul className="flex flex-col gap-2">{p.gets.map((g) => <li key={g} className="flex gap-2"><span className="mt-1.5 size-1.5 flex-none rounded-full bg-leaf" aria-hidden="true" />{g}</li>)}</ul>
                </div>
              </Card>
            </Item>
          ))}
        </Stagger>
      </Section>
      <Section tone="soft">
        <Reveal><Eyebrow>Shared core</Eyebrow><h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">What every product runs on.</h2></Reveal>
        <Stagger className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CORE.map((c) => (
            <Item key={c.t}><Card className="h-full"><span className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-forest"><c.icon className="size-5" aria-hidden="true" /></span><h3 className="mt-4 font-display text-xl font-semibold">{c.t}</h3><p className="mt-2 text-sm text-muted">{c.d}</p></Card></Item>
          ))}
        </Stagger>
      </Section>
    </>
  );
}
