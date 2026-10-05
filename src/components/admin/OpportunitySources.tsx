'use client';
import { useState } from 'react';
import { api, dateFmt, errText } from '@/lib/client/api';
import { useMe } from '@/components/case/core/shared';
import { Async, Badge, Button, Card, Field, FormError, Modal, Tile, useApi, useToast } from '@/components/ui';

const KIND: Record<string, string> = { feed: 'Feed', page: 'Page', query: 'Search' };

export function OpportunitySourcesPanel() {
  const st = useApi<any>('/opportunity-sources');
  const [edit, setEdit] = useState<any>(null); const [busy, setBusy] = useState<string | null>(null); const [test, setTest] = useState<any>(null); const toast = useToast();
  const run = async (key: string, fn: () => Promise<any>, ok: (r: any) => string) => { setBusy(key); try { const r = await fn(); toast(ok(r)); st.reload(); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(null); } };
  const me = useMe();
  return <>
    <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <p className="muted" style={{ maxWidth: 560, margin: 0 }}>Where the Opportunity Scout looks each week. It reads each call, saves a draft, and stops. Nothing is published until you approve it in the Opportunities tab.</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <Button loading={busy === 'starter'} onClick={() => run('starter', () => api.post('/opportunity-sources/starter', {}), (r) => `${r.added} starter searches added`)}>Add starter searches</Button>
      <Button loading={busy === 'run'} onClick={() => run('run', () => api.post('/opportunity-sources/run', {}), (r) => `${r.drafted} drafts saved from ${r.sources} sources`)}>Run now</Button>
      <Button variant="primary" onClick={() => setEdit({})}>Add source</Button></div></div>
    <div className="stack">
      <Async state={st}>{(d) => <>
        <div className="grid">
          <Tile label="Drafts to review" value={d.draftsToReview} hint="Found by the Scout" tone={d.draftsToReview ? 'warn' : undefined} />
          <Tile label="Sources" value={d.items.filter((s: any) => s.active).length} hint={`${d.items.length} in total`} />
          <Tile label="Search this month" value={d.search.configured ? `${d.search.usedThisMonth} of ${d.search.monthlyLimit}` : 'Not set up'} hint={d.search.configured ? `Provider: ${d.search.provider}` : 'Feeds and pages still work'} />
        </div>
        {!d.search.configured && <div className="alert info" role="status">Search queries wait until a search key is set. Feeds and pages run without any key. Set SCOUT_SEARCH_PROVIDER, SCOUT_SEARCH_KEY and SCOUT_SEARCH_MONTHLY_LIMIT in the hosting settings, and keep the limit inside the provider&apos;s free allowance.</div>}
        {d.draftsToReview > 0 && <div className="alert" role="status"><>{d.draftsToReview} draft{d.draftsToReview === 1 ? '' : 's'} found by the Scout {d.draftsToReview === 1 ? 'is' : 'are'} waiting in the Opportunities tab.</></div>}
        <Card>
          {d.items.length === 0 ? <p className="muted">No sources yet. Add the starter searches, or add a funder&apos;s feed or calls page.</p> :
            <div className="table-wrap"><table><caption className="sr">Opportunity sources</caption>
              <thead><tr><th>Source</th><th>Type</th><th>Region</th><th>Last run</th><th><span className="sr">Actions</span></th></tr></thead>
              <tbody>{d.items.map((s: any) => <tr key={s.id}>
                <td><strong>{s.name}</strong><div className="small muted" style={{ overflowWrap: 'anywhere' }}>{s.kind === 'query' ? s.query : s.url}</div></td>
                <td><Badge>{KIND[s.kind]}</Badge>{!s.active && <> <Badge tone="warn">Paused</Badge></>}</td><td>{s.region}</td>
                <td>{s.lastRunAt ? dateFmt(s.lastRunAt) : 'Not yet'}<div className="small muted">{s.lastStatus ?? ''}{s.lastRunAt ? ` · ${s.lastFound} saved` : ''}</div></td>
                <td><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {s.kind !== 'query' && <Button size="sm" loading={busy === `t${s.id}`} onClick={async () => { setBusy(`t${s.id}`); try { setTest({ name: s.name, ...(await api.post(`/opportunity-sources/${s.id}/test`, {}) as any) }); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(null); } }}>Test</Button>}
                  <Button size="sm" onClick={() => setEdit(s)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => run(`p${s.id}`, () => api.patch(`/opportunity-sources/${s.id}`, { active: !s.active }), () => s.active ? 'Paused' : 'Resumed')}>{s.active ? 'Pause' : 'Resume'}</Button>
                  {me.can('opportunities', 'edit') && <Button size="sm" variant="ghost" onClick={() => run(`d${s.id}`, () => api.del(`/opportunity-sources/${s.id}`), () => 'Removed')}>Remove</Button>}
                </div></td></tr>)}</tbody></table></div>}
        </Card>
        {d.runs.length > 0 && <Card title="Recent runs"><ul className="small">{d.runs.map((r: any) => <li key={r.id}>{dateFmt(r.startedAt)}: {r.sources} sources, {r.candidates} items read, {r.drafted} saved, {r.skipped} skipped, {r.failed} failed{r.note ? `. ${r.note}` : ''}</li>)}</ul></Card>}
      </>}</Async>
    </div>
    {edit && <Form s={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); st.reload(); }} />}
    {test && <Modal open onClose={() => setTest(null)} title={`Test: ${test.name}`}>
      <div className="stack">{test.ok ? <><p>Found {test.count} item{test.count === 1 ? '' : 's'}. Nothing was saved.</p><ul className="small">{test.sample.map((i: any) => <li key={i.url}><a href={i.url} target="_blank" rel="noopener noreferrer">{i.title}<span className="sr"> (opens in a new tab)</span></a> {i.looksLikeCall ? '' : <Badge tone="warn">Does not look like a call</Badge>}</li>)}</ul></> : <p role="alert">Could not read it: {test.error}</p>}
        <Button onClick={() => setTest(null)}>Close</Button></div></Modal>}
  </>;
}

function Form({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ name: s.name ?? '', kind: s.kind ?? 'feed', url: s.url ?? '', query: s.query ?? '', region: s.region ?? 'Ghana' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: string) => ({ value: (v as any)[k], onChange: (e: React.ChangeEvent<any>) => setV((x) => ({ ...x, [k]: e.target.value })) });
  const go = async () => { setBusy(true); setErr(null); const body = { name: v.name, kind: v.kind, region: v.region, url: v.kind === 'query' ? null : v.url, query: v.kind === 'query' ? v.query : null }; try { if (s.id) await api.patch(`/opportunity-sources/${s.id}`, body); else await api.post('/opportunity-sources', body); onDone(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return <Modal open onClose={onClose} title={s.id ? 'Edit source' : 'Add source'}>
    <div className="stack"><FormError message={err} />
      <Field label="Name" name="n" required>{(q) => <input {...q} maxLength={120} {...set('name')} />}</Field>
      <div className="grid two">
        <Field label="Type" name="k" hint="Feed: RSS or Atom. Page: one calls page. Search: words to search for.">{(q) => <select {...q} {...set('kind')}><option value="feed">Feed</option><option value="page">Page</option><option value="query">Search</option></select>}</Field>
        <Field label="Region" name="r">{(q) => <select {...q} {...set('region')}>{['Ghana', 'West Africa', 'Africa', 'Europe', 'North America', 'Asia', 'Global'].map((x) => <option key={x}>{x}</option>)}</select>}</Field></div>
      {v.kind === 'query' ? <Field label="Search words" name="q" required hint="Each run uses one search from the free allowance.">{(q) => <input {...q} maxLength={200} {...set('query')} />}</Field>
        : <Field label="Web address" name="u" required hint="Must start with https://">{(q) => <input {...q} type="url" {...set('url')} />}</Field>}
      <div className="form-actions row" style={{ gap: 8 }}><Button variant="primary" loading={busy} onClick={go}>Save</Button><Button onClick={onClose}>Cancel</Button></div></div>
  </Modal>;
}
