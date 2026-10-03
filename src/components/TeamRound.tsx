'use client';
import { useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, LinkButton, useApi, useToast } from '@/components/ui';

type Area = { code: string; name: string; confirmed: boolean; who: string; total: number; answered: number; gates: number };
type View = { round: null | { id: string; total: number; answered: number; areas: Area[]; blockers: { code: string; message: string }[]; canSubmit: boolean } };

/** The owner's team assessment: open it, watch each area's progress, and submit once. Colleagues answer as drafts. Scoring only sees the full set at submission. */
export function TeamRound() {
  const cases = useApi<{ items: { id: string; code: string; orgName: string; status: string }[] }>('/cases?pageSize=5&sort=created&dir=desc');
  return <Card title="Team assessment">
    <Async state={cases}>{(c) => {
      if (c.items.length === 0) return <Empty title="Your business has no case yet" hint="Your adviser at Samakose opens one after your registration is confirmed. A team assessment can start then." />;
      return <Round caseId={c.items[0].id} />;
    }}</Async>
  </Card>;
}

function Round({ caseId }: { caseId: string }) {
  const st = useApi<View>(`/cases/${caseId}/round`);
  const toast = useToast();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setErr(null); try { await fn(); toast(ok); st.reload(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return <Async state={st}>{(v) => {
    if (!v.round) return <div className="stack">
      <p className="muted">Start a team assessment when you have confirmed who answers each area below. Each person answers only their own questions, and nothing is scored until you submit.</p>
      {err && <div className="alert bad" role="alert">{err}</div>}
      <div><Button variant="primary" loading={busy} onClick={() => run(() => api.post(`/cases/${caseId}/round`, {}), 'Team assessment opened')}>Start team assessment</Button></div>
    </div>;
    const r = v.round;
    return <div className="stack">
      <p className="small" aria-live="polite"><b>{r.answered}</b> of {r.total} questions have an answer.</p>
      <div className="table-wrap"><table><caption className="sr">Progress by assessment area</caption><thead><tr><th>Area</th><th>Answered by</th><th className="r">Progress</th></tr></thead>
        <tbody>{r.areas.map((a) => <tr key={a.code || 'other'}><td>{a.name}{a.gates > 0 && <> <Badge tone="info">Key questions</Badge></>}</td>
          <td>{a.who}{!a.confirmed && <div className="small muted">Not confirmed yet</div>}</td><td className="r num">{a.answered} of {a.total}</td></tr>)}</tbody></table></div>
      {r.blockers.length > 0 && <div className="alert" role="status"><b>Before you can submit</b><ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{r.blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul></div>}
      {err && <div className="alert bad" role="alert">{err}</div>}
      <div className="form-actions">
        <LinkButton href="/answer">Answer my questions</LinkButton>
        <ConfirmButton variant="primary" label="Submit assessment" message="This sends everyone's answers to be checked and scored. After this, the answers can no longer be changed in this round." onConfirm={async () => { await api.post(`/rounds/${r.id}/submit`, {}); toast('Assessment submitted and scored'); st.reload(); }} />
        <ConfirmButton variant="danger" label="Cancel assessment" message="This closes the round. Saved answers stay on record but nothing is scored. You can start a new round afterwards." onConfirm={async () => { await api.post(`/rounds/${r.id}/cancel`, {}); toast('Team assessment cancelled'); st.reload(); }} />
      </div>
      {!r.canSubmit && <p className="muted small">Submit is checked again when you press it. Key questions must all be answered and each key area must have a named person.</p>}
    </div>;
  }}</Async>;
}
