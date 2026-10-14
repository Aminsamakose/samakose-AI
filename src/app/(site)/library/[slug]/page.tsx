'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Section, Container, ButtonLink } from '@/components/site/ui';
import { api, errText, ghs } from '@/lib/client/api';

type Detail = { id: string; slug: string; title: string; summary: string; body: string | null; dimension: string | null; isFree: boolean; priceGhs: number | null; locked: boolean; publishedAt: string | null };

export default function LibraryDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [r, setR] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [buying, setBuying] = useState(false);
  const [buyErr, setBuyErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<Detail>(`/library/public/resources/${slug}`).then((d) => { setR(d); document.title = `${d.title} | Business Doctor by Samakose`; }).catch((e) => setErr(errText(e)));
    fetch('/api/v1/auth/me', { credentials: 'same-origin' }).then((res) => setSignedIn(res.ok)).catch(() => setSignedIn(false));
  }, [slug]);

  const buy = async () => {
    setBuying(true); setBuyErr(null);
    try {
      const start = await api.post<{ reference: string; authorizationUrl: string; mock: boolean }>(`/library/resources/${r!.id}/purchase`, {});
      window.location.href = start.authorizationUrl;
    } catch (e) { setBuyErr(errText(e)); setBuying(false); }
  };

  if (err) return <Section><p className="text-muted">{err} <Link href="/library">Back to the Library</Link></p></Section>;
  if (!r) return <Section><p className="text-muted">Loading…</p></Section>;

  return (
    <>
      <Section tone="soft">
        <Container className="max-w-3xl">
          {r.dimension && <p className="font-mono text-xs uppercase tracking-[0.12em] text-leaf-ink">{r.dimension}</p>}
          <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{r.title}</h1>
          <p className="mt-3 text-lg text-muted">{r.summary}</p>
          <p className="mt-4 text-sm font-semibold">{r.isFree ? 'Free' : ghs(r.priceGhs)}</p>
        </Container>
      </Section>
      <Section>
        <Container className="max-w-3xl">
          {r.locked ? (
            <div className="rounded-card border border-line bg-surface p-8 text-center">
              <h2 className="font-display text-xl font-semibold">This is a premium guide</h2>
              <p className="mt-2 text-muted">Unlock the full guide for {ghs(r.priceGhs)}.</p>
              {buyErr && <p className="mt-3 text-sm text-[color:var(--bad)]">{buyErr}</p>}
              <div className="mt-5">
                {signedIn === false ? (
                  <ButtonLink href={`/login?next=${encodeURIComponent(`/library/${slug}`)}`}>Sign in to purchase</ButtonLink>
                ) : (
                  <button className="btn primary" onClick={buy} disabled={buying || signedIn === null}>{buying ? 'Starting…' : `Unlock for ${ghs(r.priceGhs)}`}</button>
                )}
              </div>
            </div>
          ) : (
            <article className="prose max-w-none whitespace-pre-wrap">{r.body}</article>
          )}
        </Container>
      </Section>
    </>
  );
}
