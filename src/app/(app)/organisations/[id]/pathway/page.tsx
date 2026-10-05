'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, dateFmt, errText, ghs } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, FormError, Modal, PageHead, Tile, useApi, useToast } from '@/components/ui';
import { useMe } from '@/components/case/core/shared';
import { useTitle } from '@/components/portfolio/shared';

const SCOPES: [string, string][] = [['overall', 'My overall health score'], ['maturity', 'My maturity level'], ['dimensions', 'My score in each area'], ['certification', 'My certification level'], ['readiness', 'My readiness for loans, grants and investment']];
const MATCH_TONE: Record<string, string> = { Eligible: 'ok', Close: 'info', 'Not yet': 'warn', Unknown: 'warn' };
const REF_TONE = (s: string) => s === 'Awarded' ? 'ok' : s === 'Declined' || s === 'Withdrawn' ? 'bad' : 'info';
const STAFF_NEXT: Record<string, string[]> = { Approved: ['Referred', 'Declined'], Referred: ['Applied', 'Declined'], Applied: ['Shortlisted', 'Awarded', 'Declined'], Shortlisted: ['Awarded', 'Declined'], Suggested: ['Declined'], Consented: ['Declined'] };
const money = (o: any) => o.valueMin == null && o.valueMax == null ? null : o.valueMin != null && o.valueMax != null ? `${ghs(o.valueMin)} to ${ghs(o.valueMax)}` : `Up to ${ghs(o.valueMax ?? o.valueMin)}`;

export default function PathwayPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useMe();
  const org = useApi<any>(`/organisations/${id}`);
  const st = useApi<any>(`/organisations/${id}/pathway`);
  useTitle('Opportunities');
  const owner = me?.role === 'OWNER';
  const [dlg, setDlg] = useState<{ kind: 'consent' | 'request' | 'status'; item: any; to?: string } | null>(null);
  const toast = useToast();
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); st.reload(); } catch (e) { toast(errText(e), 'bad'); } };
  const ctxp = { owner, can, id, act, setDlg };
  return <div className="stack">
    <PageHead crumbs={owner ? undefined : <Link href={`/organisations/${id}`}>{org.data?.name ?? 'Organisation'}</Link>} title="Opportunities" sub={owner ? 'What your business can reach now, what it is close to, and what to do next. Your adviser makes every introduction, and only with your agreement.' : `Matched to ${org.data?.name ?? 'this business'} from its Business Health Record. You decide every referral.`} />
    <Async state={st}>{(d) => {
      const groups = [['Open to you now', 'Eligible'], ['Close: a few things to do first', 'Close'], ['Not yet', 'Not yet'], ['Take a health check to find out', 'Unknown']] as const;
      const mine = d.items.filter((i: any) => i.referral);
      return <>
        <div className="grid">
          <Tile label="Health score" value={d.readiness.scored ? d.readiness.overall : '-'} hint={d.readiness.scored ? `${d.readiness.maturity}, confidence ${d.readiness.confidence}` : 'Not scored yet'} />
          <Tile label="Certification" value={d.readiness.certification ?? 'None'} hint="Current, in date" />
          <Tile label="Open to you now" value={d.items.filter((i: any) => i.match.status === 'Eligible').length} />
          <Tile label="Referrals in progress" value={mine.filter((i: any) => !['Awarded'].includes(i.referral.status)).length} />
        </div>
        {!d.readiness.scored && <div className="alert info" role="status">No health score yet. Opportunities with requirements will show as unknown until a health check is completed.</div>}
        {mine.length > 0 && <Card title="Referrals"><div className="stack">{mine.map((i: any) => <div key={i.referral.id} className="stack" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12 }}><Opp i={i} compact {...ctxp} /></div>)}</div></Card>}
        {groups.map(([title, key]) => { const rows = d.items.filter((i: any) => i.match.status === key && !i.referral); return rows.length ? <section key={key} aria-labelledby={`g-${key}`} className="stack"><h2 id={`g-${key}`} style={{ fontSize: '1.05rem' }}>{title} ({rows.length})</h2>{rows.map((i: any) => <Card key={i.opportunity.id}><Opp i={i} {...ctxp} /></Card>)}</section> : null; })}
        {d.items.length === 0 && <Card><Empty title="No opportunities yet" hint="When your adviser adds funding, partners, markets or programmes that suit you, they appear here." /></Card>}
        {d.notAFit > 0 && <p className="small muted">{d.notAFit} other opportunit{d.notAFit === 1 ? 'y is' : 'ies are'} not shown because {d.notAFit === 1 ? 'it' : 'they'} do not fit your sector, region, size or type.</p>}
        {d.history.length > 0 && <Card title="Earlier referrals"><ul className="small">{d.history.map((h: any) => <li key={h.id}>{h.opportunity?.title ?? 'Opportunity'} · <Badge tone={REF_TONE(h.status)}>{h.status}</Badge>{h.amountGhs != null ? ` · ${ghs(h.amountGhs)}` : ''} · {dateFmt(h.updatedAt)}{h.outcomeNote ? ` · ${h.outcomeNote}` : ''}</li>)}</ul></Card>}
        {dlg?.kind === 'consent' && <Consent item={dlg.item} onClose={() => setDlg(null)} onDone={() => { setDlg(null); st.reload(); }} orgId={id} />}
        {dlg?.kind === 'request' && <Consent item={dlg.item} onClose={() => setDlg(null)} onDone={() => { setDlg(null); st.reload(); }} orgId={id} request />}
        {dlg?.kind === 'status' && <Status item={dlg.item} to={dlg.to!} onClose={() => setDlg(null)} onDone={() => { setDlg(null); st.reload(); }} />}
      </>;
    }}</Async>
  </div>;
}


function Opp({ i, compact, owner, can, id, act, setDlg }: { i: any; compact?: boolean; owner: boolean; can: (r: string, a: string) => boolean; id: string; act: (fn: () => Promise<unknown>, ok: string) => Promise<void>; setDlg: (d: any) => void }) {
  const o = i.opportunity, m = i.match, r = i.referral;
  const staffNext = !owner && r ? STAFF_NEXT[r.status] ?? [] : [];
  const [ex, setEx] = useState<any>(null); const [exBusy, setExBusy] = useState(false); const toast = useToast();
  const explain = async () => { setExBusy(true); try { setEx(await api.post(`/organisations/${id}/opportunities/${o.id}/explain`, {})); } catch (e) { toast(errText(e), 'bad'); } finally { setExBusy(false); } };
  return <div className="stack" style={{ gap: 8 }}>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <strong>{o.url ? <a href={o.url} target="_blank" rel="noopener noreferrer">{o.title}<span className="sr"> (opens in a new tab)</span></a> : o.title}</strong>
      <Badge>{o.type}</Badge><Badge tone={MATCH_TONE[m.status]}>{m.status}</Badge>{r && <Badge tone={REF_TONE(r.status)}>{r.status}</Badge>}
    </div>
    <p className="small muted" style={{ margin: 0 }}>{o.provider}{money(o) ? ` · ${money(o)}` : ''}{o.deadline ? ` · closes ${dateFmt(o.deadline)}` : ' · rolling'}</p>
    {!compact && <p style={{ margin: 0 }}>{o.summary}</p>}
    <p className="small" style={{ margin: 0 }}>{m.summary}</p>
    {m.caution && <p className="small" role="note" style={{ margin: 0 }}><strong>Note:</strong> {m.caution}</p>}
    {m.gaps.length > 0 && <div><div className="small" style={{ fontWeight: 600 }}>To meet the requirements</div><ul className="small" style={{ margin: '4px 0 0' }}>{m.gaps.map((g: any) => <li key={g.id}>{g.label}. {g.detail}</li>)}</ul></div>}
    {m.met.length > 0 && !compact && <details><summary className="small">What you already meet ({m.met.length})</summary><ul className="small">{m.met.map((x: string) => <li key={x}>{x}</li>)}</ul></details>}
    {r?.consentScope?.length > 0 && <p className="small muted" style={{ margin: 0 }}>Agreed to share: {r.consentScope.join(', ')}</p>}
    {r?.amountGhs != null && <p className="small" style={{ margin: 0 }}><strong>Awarded {ghs(r.amountGhs)}</strong></p>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {owner && !r && m.status === 'Eligible' && can('referrals', 'create') && <Button variant="primary" onClick={() => setDlg({ kind: 'request', item: i })}>Ask to be referred</Button>}
      {owner && r?.status === 'Suggested' && <Button variant="primary" onClick={() => setDlg({ kind: 'consent', item: i })}>Review and agree</Button>}
      {owner && r && !['Awarded', 'Declined', 'Withdrawn'].includes(r.status) && <Button onClick={() => act(() => api.post(`/referrals/${r.id}/withdraw`, {}), 'Withdrawn. Nothing more will be shared')}>Withdraw</Button>}
      {!owner && !r && m.status === 'Eligible' && can('referrals', 'create') && <Button variant="primary" onClick={() => act(() => api.post(`/organisations/${id}/opportunities/${o.id}/suggest`, {}), 'Suggested to the owner')}>Suggest to the owner</Button>}
      {!owner && r?.status === 'Consented' && can('referrals', 'approve') && <Button variant="primary" onClick={() => act(() => api.post(`/referrals/${r.id}/approve`, {}), 'Approved')}>Approve the match</Button>}
      {!owner && can('referrals', 'edit') && staffNext.map((to) => <Button key={to} variant={to === 'Declined' ? 'danger' : undefined} onClick={() => setDlg({ kind: 'status', item: i, to })}>{to === 'Declined' ? 'Decline' : `Mark ${to.toLowerCase()}`}</Button>)}
      {!owner && !compact && can('opportunities', 'read') && <Button loading={exBusy} onClick={explain}>Explain this match</Button>}
      {r && <History id={r.id} />}
    </div>
    {ex && <div className="alert info" role="status"><strong>Opportunity Matcher</strong>
      <p style={{ margin: '4px 0' }}>{ex.explanation}</p>
      {ex.nextSteps?.length > 0 && <ul className="small">{ex.nextSteps.map((x: string) => <li key={x}>{x}</li>)}</ul>}
      {ex.caveat && <p className="small" style={{ margin: 0 }}><strong>Note:</strong> {ex.caveat}</p>}
      <p className="small muted" style={{ margin: '4px 0 0' }}>{ex.note}</p></div>}
    {!owner && r?.status === 'Approved' && <p className="small muted" style={{ margin: 0 }}>The platform does not send anything to the partner. Share only the items the owner agreed to.</p>}
  </div>;
}

function History({ id }: { id: string }) {
  const [open, setOpen] = useState(false); const st = useApi<any>(open ? `/referrals/${id}/history` : null);
  return <><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>History</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Referral history"><Async state={st}>{(d) => <ol className="small">{d.items.map((x: any, k: number) => <li key={k}>{dateFmt(x.at)} · {x.actor ?? 'System'}: {x.from ? `${x.from} to ${x.to}` : x.to}{x.note ? ` (${x.note})` : ''}</li>)}</ol>}</Async></Modal></>;
}

function Consent({ item, orgId, onClose, onDone, request }: { item: any; orgId: string; onClose: () => void; onDone: () => void; request?: boolean }) {
  const [scope, setScope] = useState<string[]>(['overall']); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const toast = useToast();
  const go = async () => {
    if (!scope.length) { setErr('Choose at least one item, or close this window'); return; }
    setBusy(true); setErr(null);
    try { if (request) await api.post(`/organisations/${orgId}/opportunities/${item.opportunity.id}/request`, { scope }); else await api.post(`/referrals/${item.referral.id}/consent`, { scope }); toast('Thank you. Your adviser will review this'); onDone(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} title={`Share with ${item.opportunity.provider}?`}>
    <div className="stack"><FormError message={err} />
      <p>You are agreeing that your adviser may share the items below with {item.opportunity.provider} for {item.opportunity.title}. Nothing is sent until your adviser has checked the match and approved it. You can withdraw at any time.</p>
      <fieldset style={{ border: 0, padding: 0 }}><legend className="small" style={{ fontWeight: 600 }}>What may be shared</legend>
        {SCOPES.map(([k, label]) => <label key={k} className="row" style={{ gap: 8, alignItems: 'center' }}><input type="checkbox" checked={scope.includes(k)} onChange={(e) => setScope((s) => e.target.checked ? [...s, k] : s.filter((x) => x !== k))} />{label}</label>)}
      </fieldset>
      <div className="form-actions row" style={{ gap: 8 }}><Button variant="primary" loading={busy} onClick={go}>I agree</Button><Button onClick={onClose}>Cancel</Button></div></div>
  </Modal>;
}

function Status({ item, to, onClose, onDone }: { item: any; to: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(''); const [amount, setAmount] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const toast = useToast();
  const go = async () => {
    if (to === 'Declined' && note.trim().length < 5) { setErr('Say why, so the owner can be told'); return; }
    setBusy(true); setErr(null);
    try { await api.post(`/referrals/${item.referral.id}/status`, { to, note: note.trim() || null, amountGhs: to === 'Awarded' && amount ? Number(amount) : null }); toast(`Marked ${to.toLowerCase()}`); onDone(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} title={`${to === 'Declined' ? 'Decline' : `Mark ${to.toLowerCase()}`}: ${item.opportunity.title}`}>
    <div className="stack"><FormError message={err} />
      {to === 'Awarded' && <Field label="Amount awarded (GHS, optional)" name="amt">{(q) => <input {...q} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>}
      <Field label={to === 'Declined' ? 'Reason (the owner will see this)' : 'Note (optional)'} name="note">{(q) => <textarea {...q} rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <div className="form-actions row" style={{ gap: 8 }}><Button variant={to === 'Declined' ? 'danger' : 'primary'} loading={busy} onClick={go}>Confirm</Button><Button onClick={onClose}>Cancel</Button></div></div>
  </Modal>;
}
