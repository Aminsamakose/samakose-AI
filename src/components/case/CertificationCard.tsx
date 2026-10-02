'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, dateFmt, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, useApi, useToast } from '@/components/ui';

const TONE: Record<string, string> = { Certified: 'ok', Proposed: 'info', Declined: 'bad', Revoked: 'bad', Expired: 'warn' };

/** One inline form per action. A reason or note is always required and is kept in the audit trail. */
function Step({ label, variant, field, url, body, done, hint }: { label: string; variant?: 'danger' | 'primary'; field: string; url: string; body: (t: string) => unknown; done: () => void; hint?: string }) {
  const toast = useToast(); const [open, setOpen] = useState(false); const [t, setT] = useState(''); const [busy, setBusy] = useState(false);
  if (!open) return <Button size="sm" variant={variant} onClick={() => setOpen(true)}>{label}</Button>;
  return <div className="alert warn stack">
    <Field label={field} name={`f-${label}`} hint={hint ?? 'Kept in the audit trail.'}>{(p) => <textarea {...p} rows={2} value={t} onChange={(e) => setT(e.target.value)} />}</Field>
    <div className="row"><Button variant={variant ?? 'primary'} loading={busy} disabled={t.trim().length < 5} onClick={async () => {
      setBusy(true); try { await api.post(url, body(t.trim())); toast(`${label} done`); setOpen(false); setT(''); done(); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(false); }
    }}>Confirm</Button><Button onClick={() => setOpen(false)}>Cancel</Button></div>
  </div>;
}

/** The owner decides whether a lender or partner can confirm the certificate from a link. Off until they turn it on. */
function Share({ cert, done }: { cert: any; done: () => void }) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/verify/${cert.id}`;
  return <div className="alert info stack">
    <span>{cert.verifyPublic ? 'Anyone with this link can confirm your business name, level and dates. They see no scores or records.' : 'Sharing is off. Turn it on if you want a lender or partner to be able to confirm your certificate from a link.'}</span>
    {cert.verifyPublic && <span className="mono small" style={{ overflowWrap: 'anywhere' }}>{link}</span>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <Button size="sm" variant={cert.verifyPublic ? undefined : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await api.post(`/certificates/${cert.id}/verification`, { on: !cert.verifyPublic }); toast(cert.verifyPublic ? 'Sharing turned off' : 'Sharing turned on'); done(); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(false); } }}>{cert.verifyPublic ? 'Turn sharing off' : 'Turn sharing on'}</Button>
      {cert.verifyPublic && <Button size="sm" onClick={async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast('Copy failed. Select the link and copy it.', 'bad'); } }}>Copy link</Button>}
    </div>
  </div>;
}

export default function CertificationCard({ caseId }: { caseId: string }) {
  const st = useApi<any>(`/cases/${caseId}/certification`);
  return <Async state={st}>{(d) => {
    const cur = d.current, el = d.eligibility, open = d.history.find((h: any) => h.status === 'Proposed');
    return <Card title="Business health certificate" actions={cur ? <Badge tone="ok">{cur.level}</Badge> : <Badge>Not certified</Badge>}>
      <div className="stack">
        {cur ? <p>Certified at <b>{cur.level}</b> on {dateFmt(cur.decidedAt)}. Valid until {dateFmt(cur.expiresAt)}.</p> : <p className="muted">No current certificate. Certification rests on verified evidence, not on the score alone. Two different people are involved: the lead expert proposes and a reviewer or administrator decides.</p>}
        {cur?.unlocks?.length > 0 && <div><h3 className="small">What it opens, in the framework&apos;s words</h3><ul>{cur.unlocks.map((u: any) => <li key={u.code}><b>{u.name}</b> ({u.level}): {u.text}</li>)}</ul></div>}
        {cur && <div className="stack" style={{ gap: 8 }}>
          {cur.level === 'Investment-ready' && <div><Link className="btn" href={`/cases/${caseId}/pack`}>Open the investment readiness pack</Link></div>}
          {d.canShare && <Share cert={cur} done={st.reload} />}
        </div>}
        {el && <div>
          <h3 className="small">Criteria</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>{el.criteria.map((c: any) => <li key={c.id} className="row" style={{ gap: 8 }}><Badge tone={c.met ? 'ok' : 'warn'}>{c.met ? 'Met' : 'Not met'}</Badge><span>{c.label} <span className="small muted">({c.detail})</span></span></li>)}</ul>
          {el.eligible ? <p className="small" style={{ marginTop: 8 }}>Eligible for <b>{el.level}</b>.</p> : <p className="small muted" style={{ marginTop: 8 }}>{el.scoreNote ?? 'Not eligible yet.'}</p>}
          {el.investmentReadyNote && <p className="small muted">{el.investmentReadyNote}</p>}
        </div>}
        {open && <div className="alert info">A proposal for <b>{open.level}</b> is waiting for a decision. {open.rationale}</div>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {d.canPropose && el?.eligible && <Step label="Propose certificate" field="Why this business should be certified" url={`/cases/${caseId}/certification/propose`} body={(t) => ({ rationale: t })} done={st.reload} hint="At least 10 characters." />}
          {d.canDecide && open && <>
            <Step label="Certify" field="What you checked before certifying" url={`/certificates/${open.id}/decision`} body={(t) => ({ decision: 'Certify', note: t })} done={st.reload} />
            <Step label="Decline" variant="danger" field="Why it is declined" url={`/certificates/${open.id}/decision`} body={(t) => ({ decision: 'Decline', note: t })} done={st.reload} />
          </>}
          {cur && d.canRevoke && <Step label="Revoke certificate" variant="danger" field="Why it is being revoked" url={`/certificates/${cur.id}/revoke`} body={(t) => ({ reason: t })} done={st.reload} />}
        </div>
        {d.history.length > 0 && <div className="table-wrap"><table><caption className="sr">Certificate history</caption><thead><tr><th>Proposed</th><th>Level</th><th>Status</th><th>Valid until</th></tr></thead>
          <tbody>{d.history.map((h: any) => <tr key={h.id}><td className="num">{dateFmt(h.proposedAt)}</td><td>{h.level}</td><td><Badge tone={TONE[h.status]}>{h.status}</Badge></td><td className="num">{h.expiresAt ? dateFmt(h.expiresAt) : '-'}</td></tr>)}</tbody></table></div>}
        {!cur && !el && <Empty title="No certificate yet" />}
      </div>
    </Card>;
  }}</Async>;
}
