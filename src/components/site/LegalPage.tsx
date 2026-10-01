import { PageHero, Section } from './ui';
import { Prose } from './Prose';

/** Legal pages ship as clearly marked drafts until counsel has reviewed them. */
export function LegalPage({ title, updated, body }: { title: string; updated: string; body: string }) {
  return (
    <>
      <PageHero eyebrow="Legal" title={title} intro={`Last updated ${updated}.`} />
      <Section>
        <div className="mx-auto max-w-3xl">
          <div role="note" className="rounded-card border border-dashed border-gold bg-[color:var(--warn-soft)] p-4 text-sm text-[color:var(--warn)]"><strong>Draft, pending legal review.</strong> This text describes how the website currently works. It must be reviewed by counsel before real users register.</div>
          <Prose>{body}</Prose>
        </div>
      </Section>
    </>
  );
}
