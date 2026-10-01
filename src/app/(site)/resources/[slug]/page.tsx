import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Container, ButtonLink } from '@/components/site/ui';
import { Prose } from '@/components/site/Prose';
import { getArticle, listArticles } from '@/lib/content';
import { REGISTER_HREF } from '@/components/site/config';

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;
export const generateStaticParams = () => listArticles().map((a) => ({ slug: a.slug }));
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = getArticle((await params).slug);
  return a ? { title: a.title, description: a.summary } : {};
}

export default async function ArticlePage({ params }: Props) {
  const a = getArticle((await params).slug);
  if (!a) notFound();
  return (
    <article className="bg-bg py-12 sm:py-16">
      <Container><div className="mx-auto max-w-3xl">
        <Link href="/resources" className="inline-flex items-center gap-1 text-sm font-semibold text-leaf no-underline"><ArrowLeft className="size-4" aria-hidden="true" />All resources</Link>
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.12em] text-leaf">{a.date} · {a.author}</p>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight tracking-tight text-balance sm:text-5xl">{a.title}</h1>
        <p className="mt-4 text-lg text-muted">{a.summary}</p>
        <Prose>{a.body}</Prose>
        <div className="mt-12 rounded-card bg-forest p-8 text-white">
          <h2 className="font-display text-2xl font-bold">See where your business stands.</h2>
          <div className="mt-4"><ButtonLink href={REGISTER_HREF} variant="lime">Start your health check</ButtonLink></div>
        </div>
      </div></Container>
    </article>
  );
}
