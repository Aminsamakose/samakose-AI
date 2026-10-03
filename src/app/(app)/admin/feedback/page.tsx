'use client';
import { useState } from 'react';
import { api, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Card, PageHead, Tile, DataTable, useApi, useToast } from '@/components/ui';
import { Guard } from '@/components/admin/common';

const STATUSES = ['New', 'Triaged', 'Resolved', 'Not an issue'];
const MATCH: Record<string, string> = { accurate: 'Matches', partly: 'Partly', not_accurate: 'Does not match' };

export default function FeedbackPage() {
  const [status, setStatus] = useState(''); const [kind, setKind] = useState(''); const [tick, setTick] = useState(0);
  const sum = useApi<any>('/feedback/summary' + (tick ? `?_=${tick}` : ''));
  const toast = useToast();
  return <Guard resource="feedback" action="read" title="Feedback">{(me) => {
    const canEdit = me.can('feedback', 'edit');
    const set = async (id: string, s: string) => { try { await api.patch(`/feedback/${id}`, { status: s }); toast('Updated'); setTick((t) => t + 1); } catch (e) { toast(errText(e), 'bad'); } };
    return <>
      <PageHead title="Feedback" sub="What testers and business owners tell us. Read here by the administrator only; it never reaches a score." />
      <div className="stack">
        <Async state={sum}>{(s) => <div className="grid">
          <Tile label="New" value={s.byStatus['New']} hint="Not yet looked at" />
          <Tile label="Average ease of use" value={s.averageRating ?? '-'} hint={`From ${s.ratings} rating${s.ratings === 1 ? '' : 's'}, 1 to 5`} />
          <Tile label="Score matched" value={s.scoreMatched.accurate} hint={`${s.scoreMatched.partly} partly, ${s.scoreMatched.not_accurate} did not match`} />
        </div>}</Async>
        <Card>
          <DataTable<any> endpoint="/feedback" exportable refreshKey={tick} params={{ status, kind }} defaultSort={{ key: 'createdAt', dir: 'desc' }} placeholder="Search message, page or person"
            empty={{ title: 'No feedback yet', hint: 'It appears here as soon as a tester sends it from the Feedback button, or an owner answers the score question.' }}
            toolbar={<>
              <div className="field"><label className="sr" htmlFor="fb-status">Status</label><select id="fb-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></div>
              <div className="field"><label className="sr" htmlFor="fb-kind">Type</label><select id="fb-kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All types</option><option value="app">Screen feedback</option><option value="result">Score feedback</option></select></div>
            </>}
            columns={[
              { key: 'createdAt', label: 'Received', sort: 'createdAt', render: (r) => dateTime(r.createdAt) },
              { key: 'from', label: 'From', render: (r) => <>{r.name}<div className="small muted">{r.role}</div></> },
              { key: 'message', label: 'Feedback', render: (r) => <>{r.kind === 'result' ? <Badge tone={r.accuracy === 'accurate' ? 'ok' : r.accuracy === 'partly' ? 'info' : 'bad'}>{MATCH[r.accuracy] ?? 'Score'}</Badge> : <span className="small muted mono">{r.page ?? '-'}</span>}{r.rating ? <span className="small muted"> · rated {r.rating}/5</span> : null}<div style={{ maxWidth: 520, whiteSpace: 'pre-wrap' }}>{r.message ?? <span className="muted">No comment</span>}</div></> },
              { key: 'status', label: 'Status', sort: 'status', render: (r) => canEdit ? <><label className="sr" htmlFor={`st-${r.id}`}>Status for feedback from {r.name}</label><select id={`st-${r.id}`} value={r.status} onChange={(e) => set(r.id, e.target.value)}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></> : r.status }
            ]} />
        </Card>
      </div>
    </>;
  }}</Guard>;
}
