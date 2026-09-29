'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { qs } from '@/lib/client/api';
import { Async, Card, Empty, Loading, PageHead, useApi } from '@/components/ui';
import { useTitle } from '@/components/dash/common';

type Hit = { type: string; id: string; title: string; subtitle: string | null; href: string };
const ORDER = ['Organisation', 'Case', 'Programme', 'Invoice', 'User'];

function Results({ q }: { q: string }) {
  const st = useApi<Hit[]>(q.length >= 2 ? '/search' + qs({ q }) : null);
  if (q.length < 2) return <Empty title="Type at least 2 characters" hint="Search by organisation name or code, case code, programme, invoice number or, for administrators, people." />;
  return <div aria-live="polite"><Async state={st}>{(hits) => {
    if (!hits.length) return <Empty title={`No results for "${q}"`} hint="Check the spelling, or try part of a name or code." />;
    const types = [...new Set([...ORDER.filter((t) => hits.some((h) => h.type === t)), ...hits.map((h) => h.type)])];
    return <div className="stack">
      <p className="muted" role="status">{hits.length} result{hits.length === 1 ? '' : 's'} for "{q}"</p>
      {types.map((t) => <Card key={t} title={`${t === 'Case' ? 'Cases' : t === 'Programme' ? 'Programmes' : t + 's'} (${hits.filter((h) => h.type === t).length})`}>
        <ul className="timeline">{hits.filter((h) => h.type === t).map((h) => <li key={h.type + h.id}><div><Link href={h.href}><strong>{h.title}</strong></Link>{h.subtitle && <div className="small muted">{h.subtitle}</div>}</div></li>)}</ul>
      </Card>)}
      <p className="small muted">Each group shows up to 5 matches. Refine your search to narrow further.</p>
    </div>;
  }}</Async></div>;
}

function Inner() {
  const sp = useSearchParams(); const router = useRouter();
  const q = (sp.get('q') ?? '').trim();
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  useTitle(q ? `Search: ${q}` : 'Search');
  return <>
    <PageHead title="Search" sub="Results are limited to what your role can see." />
    <form role="search" className="toolbar" onSubmit={(e) => { e.preventDefault(); router.push('/search' + qs({ q: text.trim() })); }} style={{ marginBottom: 16 }}>
      <div className="search-box"><label className="sr" htmlFor="q-page">Search term</label><input id="q-page" type="search" value={text} maxLength={80} onChange={(e) => setText(e.target.value)} placeholder="Search cases, organisations, people" /></div>
      <button className="btn primary" type="submit">Search</button>
    </form>
    <Results q={q} />
  </>;
}
export default function SearchPage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
