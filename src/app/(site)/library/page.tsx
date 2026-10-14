'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHero, Section, Card, Placeholder } from '@/components/site/ui';
import { Stagger, Item } from '@/components/site/motion';
import { api, ghs, qs } from '@/lib/client/api';

type Row = { slug: string; title: string; summary: string; dimension: string | null; isFree: boolean; priceGhs: number | null; locked: boolean };

export default function LibraryCataloguePage() {
  const [items, setItems] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { document.title = 'Resource Library | Business Doctor by Samakose'; }, []);
  useEffect(() => {
    const t = setTimeout(() => { api.get<Row[]>('/library/public/resources' + qs({ q })).then(setItems).catch(() => setItems([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <PageHero eyebrow="Resource Library" title="Practical guides for building an investment-ready business." intro="Free and premium guides from the Business Doctor, covering finance, operations, governance and growth." />
      <Section>
        <div className="mb-8 max-w-md">
          <label className="sr-only" htmlFor="lib-q">Search the Library</label>
          <input id="lib-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guides by title or topic" className="w-full rounded-full border border-line bg-surface px-5 py-3 text-sm" />
        </div>
        {!items ? <p className="text-muted">Loading…</p> : items.length === 0 ? <Placeholder label="Guides will be listed here as they are published." /> : (
          <Stagger className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {items.map((r) => (
              <Item key={r.slug}>
                <Card className="flex h-full flex-col">
                  {r.dimension && <p className="font-mono text-xs uppercase tracking-[0.12em] text-leaf-ink">{r.dimension}</p>}
                  <h2 className="mt-2 font-display text-xl font-semibold"><Link href={`/library/${r.slug}`} className="text-fg no-underline hover:text-leaf-ink">{r.title}</Link></h2>
                  <p className="mt-2 flex-1 text-sm text-muted">{r.summary}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-sm font-semibold">{r.isFree ? 'Free' : ghs(r.priceGhs)}</span>
                    <Link href={`/library/${r.slug}`} className="text-sm font-semibold text-leaf-ink no-underline">{r.locked ? 'View and unlock' : 'Read'} →</Link>
                  </div>
                </Card>
              </Item>
            ))}
          </Stagger>
        )}
      </Section>
    </>
  );
}
