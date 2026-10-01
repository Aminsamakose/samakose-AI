import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageHero, Section, Card, Placeholder } from '@/components/site/ui';
import { Stagger, Item } from '@/components/site/motion';
import { listArticles } from '@/lib/content';

export const metadata: Metadata = { title: 'Resources', description: 'Plain-language guides on business health, evidence and action planning from Samakose.' };

export default function ResourcesPage() {
  const items = listArticles();
  return (
    <>
      <PageHero eyebrow="Resources and insights" title="Practical guidance for enterprise growth." intro="Short guides on how business health is measured and what to do with the results." />
      <Section>
        {items.length === 0 ? <Placeholder label="Articles and guides will be listed here as they are published." /> : (
          <Stagger className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => (
              <Item key={a.slug}>
                <Card className="flex h-full flex-col">
                  <p className="font-mono text-xs uppercase tracking-[0.12em] text-leaf-ink">{a.date}</p>
                  <h2 className="mt-2 font-display text-xl font-semibold"><Link href={`/resources/${a.slug}`} className="text-fg no-underline hover:text-leaf-ink">{a.title}</Link></h2>
                  <p className="mt-2 flex-1 text-sm text-muted">{a.summary}</p>
                  <Link href={`/resources/${a.slug}`} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-leaf-ink no-underline">Read <ArrowRight className="size-4" aria-hidden="true" /></Link>
                </Card>
              </Item>
            ))}
          </Stagger>
        )}
      </Section>
    </>
  );
}
