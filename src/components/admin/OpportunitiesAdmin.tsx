'use client';
import { useState } from 'react';
import { api, dateFmt, errText, ghs } from '@/lib/client/api';
import { Async, Badge, Button, Card, Field, FormError, Modal, PageHead, Tabs, Tile, useApi, useToast } from '@/components/ui';
import { Guard } from '@/components/admin/common';
import { OpportunitySourcesPanel } from '@/components/admin/OpportunitySources';

const TYPES = ['Funding', 'Grant', 'Loan', 'Equity', 'Partnership', 'Market', 'Procurement', 'Programme', 'Assistance', 'Training'];
const tone = (s: string) => s === 'Open' ? 'ok' : s === 'Draft' ? 'warn' : 'info';
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const pairs = (s: string, sep: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean).map((x) => x.split(sep).map((y) => y.trim()));

export function OpportunitiesAdmin({ initialTab = 'list' }: { initialTab?: 'list' | 'sources' }) {
  const [tab, setTab] = useState<'list' | 'sources'>(initialTab);
  const [status, setStatus] = useState('');
  const st = useApi<any>(`/opportunities${status ? `?status=${status}` : ''}`);
  const sum = useApi<any>('/unlock/summary');
  const [edit, setEdit] = useState<any>(null); const [imp, setImp] = useState(false); const [rd, setRd] = useState(false); const toast = useToast();
  const act = async (id: string, verb: string, ok: string) => { try { await api.post(`/opportunities/${id}/${verb}`, {}); toast(ok); st.reload(); sum.reload(); } catch (e) { toast(errText(e), 'bad'); } };
  return <Guard resource="opportunities" action="create" title="Opportunities">{(me) => <>
    <PageHead title="Opportunities" sub="Funding, partners, markets and programmes that ready businesses can reach. Each one states its own requirements. Nothing is shown to a business until you publish it." actions={<><Button onClick={() => setRd(true)}>Read a call</Button><Button onClick={() => setImp(true)}>Import</Button><Button variant="primary" onClick={() => setEdit({})}>Add opportunity</Button></>} />
    <Tabs tabs={[{ id: 'list', label: 'Opportunities' }, { id: 'sources', label: 'Sources (Scout)' }]} active={tab} onChange={(t) => setTab(t as 'list' | 'sources')} />
    {tab === 'sources' ? <OpportunitySourcesPanel /> : <div className="stack">
      <Async state={sum}>{(s) => <div className="grid">
        <Tile label="Open now" value={s.opportunitiesOpen} /><Tile label="Awaiting your decision" value={s.referrals.Consented ?? 0} hint="Owner has consented" tone={s.referrals.Consented ? 'warn' : undefined} />
        <Tile label="In progress" value={(s.referrals.Approved ?? 0) + (s.referrals.Referred ?? 0) + (s.referrals.Applied ?? 0) + (s.referrals.Shortlisted ?? 0)} /><Tile label="Funding mobilised" value={ghs(s.fundingMobilisedGhs)} hint={`${s.awardedCount} awarded`} />
      </div>}</Async>
      <Card>
        <div className="field" style={{ maxWidth: 240, marginBottom: 12 }}><label htmlFor="os">Status</label><select id="os" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All except archived</option>{['Draft', 'Open', 'Closed', 'Archived'].map((s) => <option key={s}>{s}</option>)}</select></div>
        <Async state={st} empty={(d) => !d.items.length}>{(d) => <div className="table-wrap"><table><caption className="sr">Opportunities</caption>
          <thead><tr><th>Opportunity</th><th>Type</th><th>Status</th><th>Closes</th><th>Source</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>{d.items.map((o: any) => <tr key={o.id}>
            <td><strong>{o.url ? <a href={o.url} target="_blank" rel="noopener noreferrer">{o.title}<span className="sr"> (opens the source in a new tab)</span></a> : o.title}</strong><div className="small muted">{o.provider}{o.url ? <> · <a href={o.url} target="_blank" rel="noopener noreferrer">{(() => { try { return new URL(o.url).hostname.replace(/^www\./, ''); } catch { return 'source'; } })()}</a></> : ''}</div></td><td>{o.type}</td><td><Badge tone={tone(o.status)}>{o.status}</Badge></td><td>{o.deadline ? <>{dateFmt(o.deadline)}{(() => { const n = Math.ceil((new Date(`${o.deadline}T23:59:59Z`).getTime() - Date.now()) / 86400000); return n < 0 ? <div><Badge tone="bad">Closed</Badge></div> : <div className="small muted">{n} day{n === 1 ? '' : 's'} left</div>; })()}</> : <>Rolling<div className="small muted">No closing date</div></>}</td><td>{o.source === 'scout' ? <Badge tone="info">Found by Scout</Badge> : o.source}</td>
            <td><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={() => setEdit(o)}>Edit</Button>
              {['Draft', 'Closed'].includes(o.status) && me.can('opportunities', 'approve') && <Button size="sm" variant="primary" onClick={() => act(o.id, 'publish', 'Published')}>{o.status === 'Closed' ? 'Reopen' : 'Publish'}</Button>}
              {o.status === 'Open' && <Button size="sm" onClick={() => act(o.id, 'close', 'Closed to new referrals')}>Close</Button>}
              {o.status !== 'Archived' && <Button size="sm" variant="ghost" onClick={() => act(o.id, 'archive', 'Archived')}>Archive</Button>}
            </div></td></tr>)}</tbody></table></div>}</Async>
        {!st.loading && st.data && !st.data.items.length && <p className="muted">No opportunities yet. Add one, or import from SOPIS.</p>}
      </Card>
    </div>}
    {edit && <Form o={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); st.reload(); sum.reload(); }} />}
    {rd && <Reader onClose={() => setRd(false)} onDraft={(d, u) => { setRd(false); setEdit({ ...d, _uncertain: u }); }} />}
    {imp && <Import onClose={() => setImp(false)} onDone={() => { setImp(false); st.reload(); }} />}
  </>}</Guard>;
}

function Form({ o, onClose, onDone }: { o: any; onClose: () => void; onDone: () => void }) {
  const c = o.criteria ?? {};
  const [v, setV] = useState({ title: o.title ?? '', type: o.type ?? 'Funding', provider: o.provider ?? '', summary: o.summary ?? '', url: o.url ?? '', valueMin: o.valueMin ?? '', valueMax: o.valueMax ?? '', deadline: o.deadline ?? '',
    minOverall: c.minOverall ?? '', minConfidence: c.minConfidence ?? '', certification: c.certification ?? '', minYears: c.minYearsOperating ?? '',
    sectors: (c.sectors ?? []).join(', '), regions: (c.regions ?? []).join(', '), sizes: (c.sizes ?? []).join(', '), orgTypes: (c.orgTypes ?? []).join(', '),
    readiness: (c.readiness ?? []).map((r: any) => `${r.code}:${r.min}`).join(', '), dims: Object.entries(c.dimensionMin ?? {}).map(([k, n]) => `${k}=${n}`).join(', ') });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const toast = useToast();
  const set = (k: string) => ({ value: (v as any)[k], onChange: (e: React.ChangeEvent<any>) => setV((x) => ({ ...x, [k]: e.target.value })) });
  const go = async () => {
    setBusy(true); setErr(null);
    const criteria: any = {};
    if (v.minOverall !== '') criteria.minOverall = Number(v.minOverall); if (v.minConfidence) criteria.minConfidence = v.minConfidence; if (v.certification) criteria.certification = v.certification; if (v.minYears !== '') criteria.minYearsOperating = Number(v.minYears);
    for (const k of ['sectors', 'regions', 'sizes', 'orgTypes'] as const) if (csv((v as any)[k]).length) criteria[k] = csv((v as any)[k]);
    if (v.readiness.trim()) criteria.readiness = pairs(v.readiness, ':').map(([code, min]) => ({ code, min }));
    if (v.dims.trim()) criteria.dimensionMin = Object.fromEntries(pairs(v.dims, '=').map(([k, n]) => [k, Number(n)]));
    const body = { title: v.title, type: v.type, provider: v.provider, summary: v.summary, url: v.url || null, valueMin: v.valueMin === '' ? null : Number(v.valueMin), valueMax: v.valueMax === '' ? null : Number(v.valueMax), deadline: v.deadline || null, criteria };
    try { if (o.id) await api.patch(`/opportunities/${o.id}`, body); else await api.post('/opportunities', body); toast(o.id ? 'Saved' : 'Saved as a draft'); onDone(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} title={o.id ? 'Edit opportunity' : 'Add opportunity'}>
    <div className="stack"><FormError message={err} />
      {o._uncertain?.length > 0 && <div className="alert info" role="note"><strong>Check these against the original call</strong><ul className="small">{o._uncertain.map((u: string) => <li key={u}>{u}</li>)}</ul></div>}
      <Field label="Title" name="t" required>{(q) => <input {...q} maxLength={160} {...set('title')} />}</Field>
      <div className="grid two"><Field label="Type" name="ty">{(q) => <select {...q} {...set('type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>}</Field>
        <Field label="Provider" name="p" required>{(q) => <input {...q} maxLength={160} {...set('provider')} />}</Field></div>
      <Field label="Summary" name="s" required hint="What it is, in plain words, for the business owner.">{(q) => <textarea {...q} rows={3} maxLength={2000} {...set('summary')} />}</Field>
      <Field label="Link" name="u" hint="Where the business can read more.">{(q) => <input {...q} type="url" {...set('url')} />}</Field>
      <div className="grid two"><Field label="Smallest amount (GHS)" name="a">{(q) => <input {...q} type="number" min={0} {...set('valueMin')} />}</Field><Field label="Largest amount (GHS)" name="b">{(q) => <input {...q} type="number" min={0} {...set('valueMax')} />}</Field></div>
      <Field label="Closing date" name="d" hint="Leave empty for a rolling opportunity.">{(q) => <input {...q} type="date" {...set('deadline')} />}</Field>
      <fieldset style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}><legend className="small" style={{ fontWeight: 600 }}>Who it is for</legend>
        <p className="small muted">Leave a box empty to set no requirement. Fit rules (sector, region, size, type) decide who sees it. Readiness rules decide who is eligible now.</p>
        <div className="grid two"><Field label="Sectors" name="se" hint="Comma separated">{(q) => <input {...q} {...set('sectors')} />}</Field><Field label="Regions" name="re" hint="Comma separated">{(q) => <input {...q} {...set('regions')} />}</Field>
          <Field label="Sizes" name="si" hint="Comma separated">{(q) => <input {...q} {...set('sizes')} />}</Field><Field label="Organisation types" name="ot" hint="For example SME, ESO">{(q) => <input {...q} {...set('orgTypes')} />}</Field>
          <Field label="Years operating, at least" name="y">{(q) => <input {...q} type="number" min={0} {...set('minYears')} />}</Field><Field label="Overall score, at least" name="mo">{(q) => <input {...q} type="number" min={0} max={100} {...set('minOverall')} />}</Field>
          <Field label="Score confidence" name="mc">{(q) => <select {...q} {...set('minConfidence')}><option value="">No requirement</option><option>Medium</option><option>High</option></select>}</Field>
          <Field label="Certification, at least" name="ce">{(q) => <select {...q} {...set('certification')}><option value="">No requirement</option><option>Foundation</option><option>Established</option><option>Investment-ready</option></select>}</Field></div>
        <Field label="Readiness indices" name="ri" hint="Code:level, for example LOAN:Ready, GRANT:Conditionally ready. Codes come from the framework.">{(q) => <input {...q} {...set('readiness')} />}</Field>
        <Field label="Minimum area scores" name="di" hint="Area=score, for example Finance=60, Market=55">{(q) => <input {...q} {...set('dims')} />}</Field>
      </fieldset>
      <div className="form-actions row" style={{ gap: 8 }}><Button variant="primary" loading={busy} onClick={go}>Save</Button><Button onClick={onClose}>Cancel</Button></div></div>
  </Modal>;
}

function Import({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [src, setSrc] = useState('sopis'); const [text, setText] = useState(''); const [err, setErr] = useState<string | null>(null); const [res, setRes] = useState<any>(null); const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(null); let items: unknown;
    try { items = JSON.parse(text); if (!Array.isArray(items)) throw 0; } catch { setErr('Paste a JSON list of opportunities'); return; }
    setBusy(true); try { setRes(await api.post('/opportunities/import', { source: src, items })); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <Modal open onClose={res ? onDone : onClose} title="Import opportunities">
    <div className="stack"><FormError message={err} />
      {res ? <><p>{res.created} added as drafts, {res.skipped} already imported, {res.rejected.length} rejected.</p>{res.rejected.length > 0 && <ul className="small">{res.rejected.map((r: any) => <li key={r.sourceRef}>{r.sourceRef}: {r.reason}</li>)}</ul>}<p className="small muted">Imported items have no requirements. Open each draft, set who it is for, then publish.</p><Button variant="primary" onClick={onDone}>Done</Button></> : <>
        <Field label="Where from" name="src">{(q) => <select {...q} value={src} onChange={(e) => setSrc(e.target.value)}><option value="sopis">SOPIS</option><option value="import">Other</option></select>}</Field>
        <Field label="List (JSON)" name="j" hint="Each item: sourceRef, title, type, provider, summary, and optionally url, valueMin, valueMax, deadline (YYYY-MM-DD). Importing again never duplicates.">{(q) => <textarea {...q} rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder='[{"sourceRef":"row-12","title":"...","type":"Grant","provider":"...","summary":"..."}]' />}</Field>
        <div className="form-actions row" style={{ gap: 8 }}><Button variant="primary" loading={busy} onClick={go}>Import as drafts</Button><Button onClick={onClose}>Cancel</Button></div></>}</div>
  </Modal>;
}

function Reader({ onClose, onDraft }: { onClose: () => void; onDraft: (d: any, uncertain: string[]) => void }) {
  const [text, setText] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async () => { setErr(null); setBusy(true); try { const r = await api.post<any>('/opportunities/read', { text }); onDraft(r.draft, r.uncertain); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return <Modal open onClose={onClose} title="Read a call">
    <div className="stack"><FormError message={err} />
      <p className="small muted">Paste the text of a funding call, programme or notice. The Opportunity Reader drafts the form for you. Nothing is saved until you check it and press Save, and it is never published automatically.</p>
      <Field label="Text of the call" name="rt" hint="Do not paste personal data about individuals.">{(q) => <textarea {...q} rows={10} maxLength={20000} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      <div className="form-actions row" style={{ gap: 8 }}><Button variant="primary" loading={busy} onClick={go}>Draft the form</Button><Button onClick={onClose}>Cancel</Button></div></div>
  </Modal>;
}
