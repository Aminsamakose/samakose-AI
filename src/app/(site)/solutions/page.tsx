import type { Metadata } from 'next';
import { PageHero, Section, Card, ButtonLink } from '@/components/site/ui';
import { Stagger, Item } from '@/components/site/motion';
import { REGISTER_HREF } from '@/components/site/config';

export const metadata: Metadata = { title: 'Solutions', description: 'How business owners, coaches, programme managers and partners use Samakose.' };

const AUDIENCES = [
  { who: 'Business owners', line: 'Know where the business stands and what to fix first.', pts: ['Guided health assessment you can complete step by step', 'A clear list of priorities and an action plan with dates', 'Coaching and progress tracking in one place', 'Results stay within your organisation and the advisers assigned to you'] },
  { who: 'Consultants and coaches', line: 'Work from one record instead of scattered notes.', pts: ['A case file for each business you support', 'Review, adjust and approve diagnoses and prescriptions', 'Session notes tied to actions and KPIs', 'Clear hand-offs between advisers'] },
  { who: 'Programme managers', line: 'See the health of a whole portfolio, not one business at a time.', pts: ['Cohorts and programmes with portfolio views', 'Baseline, midline and endline comparisons', 'Reports for boards and partners', 'Consistent method across coaches'] },
  { who: 'Partners and donors', line: 'Follow results with evidence behind them.', pts: ['Portfolio dashboards for the programmes you fund', 'Scores shown with how well they are evidenced', 'Exports for your own reporting', 'Access limited to the programmes you support'] }
];

export default function SolutionsPage() {
  return (
    <>
      <PageHero eyebrow="Solutions" title="Built for everyone in the enterprise support chain." intro="The same platform serves the business, the adviser, the programme and the funder, each with the access that suits their role.">
        <ButtonLink href={REGISTER_HREF} variant="lime">Start your health check</ButtonLink>
        <ButtonLink href="/contact" variant="ghost-dark">Talk to us</ButtonLink>
      </PageHero>
      <Section>
        <Stagger className="grid gap-6 md:grid-cols-2">
          {AUDIENCES.map((a) => (
            <Item key={a.who}>
              <Card className="h-full"><h2 className="font-display text-2xl font-bold">{a.who}</h2><p className="mt-2 text-muted">{a.line}</p>
                <ul className="mt-4 flex flex-col gap-2 text-sm">{a.pts.map((p) => <li key={p} className="flex gap-2"><span className="mt-1.5 size-1.5 flex-none rounded-full bg-leaf" aria-hidden="true" />{p}</li>)}</ul></Card>
            </Item>
          ))}
        </Stagger>
        <p className="mt-8 max-w-2xl text-sm text-muted">Access is role-based. Creating an account does not by itself give anyone access to another organisation&rsquo;s or programme&rsquo;s data.</p>
      </Section>
    </>
  );
}
