'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Async, Badge, Card, Button, Tile, useApi } from '@/components/ui';
import { Person } from '@/components/Avatar';
import { RatingModal } from '@/components/case/core/CaseTeam';

const tone = (s: string) => s === 'Approved' ? 'ok' : s === 'Submitted' ? 'info' : s === 'Rejected' || s === 'Suspended' ? 'bad' : 'warn';

/** What the expert, coach network needs from this person today. Rendered above the role dashboard. */
export function NetworkPanel({ role }: { role: string }) {
  if (role === 'EXPERT') return <ExpertStatus />;
  if (role === 'ADMIN') return <AdminVetting />;
  if (['OWNER', 'REVIEWER', 'PROGRAMME_MANAGER'].includes(role)) return <PendingRatings />;
  return null;
}

function ExpertStatus() {
  const p = useApi<any>('/me/practitioner'); const perf = useApi<any>('/me/practitioner/performance');
  return <Async state={p}>{(d) => <Card title="Your practitioner profile" actions={<Badge tone={tone(d.vettingStatus)}>{d.vettingStatus}</Badge>}>
    <div className="stack">
      {d.vettingStatus === 'Approved' ? <p>Your profile is approved. Programme managers can assign you to businesses. You currently have {d.load} of {d.maxActive} cases.</p>
        : d.vettingStatus === 'Submitted' ? <p>Your profile is with the administrator for review. You cannot be assigned until it is approved.</p>
        : <p><strong>Complete and submit your profile.</strong> You cannot be matched to businesses until an administrator has approved it ({d.completeness?.percent ?? 0}% complete).{d.vettingNote ? ` Note: ${d.vettingNote}` : ''}</p>}
      <div><Link className="btn" href="/profile">{d.vettingStatus === 'Approved' ? 'Review profile' : 'Complete profile'}</Link></div>
      <Async state={perf}>{(x) => <div className="grid">
        <Tile label="Performance" value={x.score == null ? '-' : Math.round(x.score)} hint={x.score == null ? 'Not enough evidence yet' : `Confidence: ${x.confidence}`} />
        <Tile label="Engagements" value={x.engagements?.total ?? 0} hint={`${x.engagements?.completed ?? 0} completed`} />
      </div>}</Async>
    </div>
  </Card>}</Async>;
}

function AdminVetting() {
  const st = useApi<any>('/practitioners');
  return <Async state={st}>{(d) => d.counts.Submitted ? <Card title="Experts and coaches"><div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
    <span><strong>{d.counts.Submitted}</strong> profile{d.counts.Submitted === 1 ? '' : 's'} waiting for your decision.</span><Link className="btn primary" href="/admin/practitioners">Review profiles</Link></div></Card> : null}</Async>;
}

function PendingRatings() {
  const st = useApi<any>('/ratings/pending'); const [open, setOpen] = useState<string | null>(null);
  return <Async state={st}>{(d) => d.items.length ? <Card title="Rate the support you received"><div className="stack">
    <p className="small muted">Your rating helps match the right people to future businesses. It takes about a minute.</p>
    {d.items.slice(0, 5).map((x: any) => <div key={x.assignmentId} className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <Person name={x.practitioner} src={x.photoUrl} sub={`Case ${x.caseCode}`} /><Button size="sm" onClick={() => setOpen(x.assignmentId)}>Rate</Button></div>)}
    {open && <RatingModal assignmentId={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); st.reload(); }} />}
  </div></Card> : null}</Async>;
}
