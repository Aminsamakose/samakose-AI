'use client';
import { useState } from 'react';
import { api, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, KV, useApi, useToast } from '@/components/ui';

const tone = (s: string) => s === 'Active' ? 'ok' : s === 'Paused' || s === 'Disabled' ? 'bad' : s === 'Testing' || s === 'Evaluation' || s === 'Approval required' ? 'info' : '';
const num = (n: unknown) => Number(n ?? 0).toLocaleString('en-GB');
const LIMITS: [string, string][] = [['requestsPerDay', 'Requests per day'], ['requestsPerMonth', 'Requests per month'], ['tokensPerDay', 'Tokens per day'], ['tokensPerMonth', 'Tokens per month']];

/** One inline confirmation for every lifecycle move. A reason is required and goes into the audit trail. */
function Move({ id, to, label, variant, done }: { id: string; to: string; label: string; variant?: 'danger'; done: () => void }) {
  const toast = useToast(); const [open, setOpen] = useState(false); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  if (!open) return <Button size="sm" variant={variant} onClick={() => setOpen(true)}>{label}</Button>;
  return <div className="alert warn stack">
    <Field label={`Reason for: ${label}`} name={`reason-${to}`} hint="At least 5 characters. It is kept in the audit trail.">{(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    <div className="row"><Button variant={variant ?? 'primary'} loading={busy} disabled={reason.trim().length < 5} onClick={async () => {
      setBusy(true);
      try { await api.post(`/admin/agents/${id}/status`, { to, reason: reason.trim() }); toast(`${label} done`); setOpen(false); setReason(''); done(); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(false); }
    }}>Confirm</Button><Button onClick={() => setOpen(false)}>Cancel</Button></div>
  </div>;
}

function Detail({ id, canEdit, onChange }: { id: string; canEdit: boolean; onChange: () => void }) {
  const st = useApi<any>(`/admin/agents/${id}`); const toast = useToast();
  const [prompt, setPrompt] = useState<string | null>(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(''); const [lim, setLim] = useState<Record<string, string>>({});
  const reload = () => { st.reload(); onChange(); };
  return <Async state={st}>{(d) => {
    const a = d.agent, cur = d.versions.find((v: any) => v.id === a.currentVersionId);
    const cfg = cur?.config ?? {};
    const text = prompt ?? cur?.prompt ?? '';
    const save = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); toast(ok); reload(); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(''); } };
    return <div className="stack">
      <Card title={a.name} actions={<Badge tone={tone(a.status)}>{a.status}</Badge>}>
        <KV items={[
          ['Purpose', a.purpose ?? '-'], ['Role it works under', 'The requesting expert or reviewer. It has no login of its own.'],
          ['Autonomy', d.autonomyLabels[Number(cfg.autonomy ?? 0)] ?? '-'], ['Current version', cur ? `v${cur.version}, evaluation: ${cur.evaluation}` : 'None'],
          ['Why it is in this state', a.statusReason ?? '-'], ['Tasks waiting', num(d.queuedTasks)],
          ['Usage today', `${num(d.usage.requestsDay)} requests, ${num(d.usage.tokensDay)} tokens`], ['Usage this month', `${num(d.usage.requestsMonth)} requests, ${num(d.usage.tokensMonth)} tokens`]
        ]} />
        {canEdit && <div className="stack" style={{ marginTop: 12 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {a.status === 'Paused' && <Move id={id} to="Resume" label="Resume" done={reload} />}
            {a.next.filter((s: string) => s !== 'Paused' && s !== 'Disabled').map((s: string) => <Move key={s} id={id} to={s} label={`Move to ${s}`} done={reload} />)}
            {a.next.includes('Paused') && <Move id={id} to="Paused" label="Emergency pause" variant="danger" done={reload} />}
            {a.next.includes('Disabled') && <Move id={id} to="Disabled" label="Disable" variant="danger" done={reload} />}
          </div>
          {canEdit && ['diagnosis', 'opportunity_reader', 'opportunity_matcher'].includes(a.code) && <div className="row"><Button size="sm" loading={busy === 'eval'} onClick={() => save('eval', async () => { const r: any = await api.post(`/admin/agents/${id}/evaluate`, {}); toast(`Evaluation ${r.result}: ${r.passed} of ${r.total} cases, about USD ${r.spentUsd}`); }, 'Evaluation finished')}>Run live evaluation</Button><span className="small muted">Runs the synthetic cases against the live model (about USD 1 cap) and records the result.</span></div>}
          <p className="small muted">An agent cannot become Active until its current version has passed evaluation. Paused and disabled agents refuse new tasks, and the person who asked is told to do the work by hand.</p>
        </div>}
      </Card>
      <div className="grid two">
        <Card title="Owner and limits">
          <Field label="Human owner" name="owner">{(p) => <select {...p} value={a.ownerId ?? ''} disabled={!canEdit} onChange={(e) => save('owner', () => api.patch(`/admin/agents/${id}`, { ownerId: e.target.value || null }), 'Owner saved')}>
            <option value="">No owner</option>{d.ownerChoices.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}</Field>
          {LIMITS.map(([k, label]) => <Field key={k} label={label} name={k} hint="0 means no limit">{(p) => <input {...p} type="number" min={0} disabled={!canEdit} value={lim[k] ?? String(a.limits[k])} onChange={(e) => setLim({ ...lim, [k]: e.target.value })} />}</Field>)}
          <Field label="Warn at (%)" name="alertPct">{(p) => <input {...p} type="number" min={1} max={99} disabled={!canEdit} value={lim.alertPct ?? String(a.limits.alertPct)} onChange={(e) => setLim({ ...lim, alertPct: e.target.value })} />}</Field>
          <Field label="When a limit is reached" name="onLimit">{(p) => <select {...p} disabled={!canEdit} value={lim.onLimit ?? a.limits.onLimit} onChange={(e) => setLim({ ...lim, onLimit: e.target.value })}><option value="throttle">Hold new tasks until the limit resets</option><option value="pause">Pause the agent</option></select>}</Field>
          {canEdit && <Button variant="primary" loading={busy === 'limits'} disabled={!Object.keys(lim).length} onClick={() => save('limits', async () => { await api.patch(`/admin/agents/${id}`, { limits: Object.fromEntries(Object.entries(lim).map(([k, v]) => [k, k === 'onLimit' ? v : Number(v)])) }); setLim({}); }, 'Limits saved')}>Save limits</Button>}
          <p className="small muted" style={{ marginTop: 8 }}>The default limits are placeholders. They stop a runaway loop, not normal use. The platform-wide monthly cost cap is set in Settings and applies to all agents together.</p>
        </Card>
        <Card title="What this agent may and may not do">
          <h3 className="small">Permitted</h3><ul>{(cfg.permittedActions ?? []).map((x: string) => <li key={x}>{x}</li>)}</ul>
          <h3 className="small">Always forbidden</h3><ul>{d.alwaysForbidden.map((x: string) => <li key={x}>{x}</li>)}</ul>
          <h3 className="small">Human approval</h3><p>{cfg.approval ?? '-'}</p>
          <h3 className="small">If it fails</h3><p>{cfg.escalation ?? '-'}</p>
        </Card>
      </div>
      <Card title="Versions">
        <div className="table-wrap"><table><caption className="sr">Agent versions</caption><thead><tr><th>Version</th><th>Evaluation</th><th>Note</th><th>Created</th>{canEdit && <th>Action</th>}</tr></thead>
          <tbody>{d.versions.map((v: any) => <tr key={v.id}><td>v{v.version} {v.id === a.currentVersionId && <Badge tone="ok">Current</Badge>}</td><td>{v.evaluation}{v.evaluationNote && <div className="small muted">{v.evaluationNote}</div>}</td><td>{v.note}</td><td className="num">{dateTime(v.createdAt)}</td>
            {canEdit && <td>{v.id !== a.currentVersionId && <Button size="sm" loading={busy === v.id} onClick={() => save(v.id, () => api.post(`/admin/agents/${id}/current-version`, { versionId: v.id, reason: `Made v${v.version} current` }), `v${v.version} is now current`)}>Make current</Button>}</td>}</tr>)}</tbody></table></div>
        {canEdit && <div className="stack" style={{ marginTop: 12 }}>
          <Field label="Instructions for a new version" name="prompt" hint="Saving creates a new version. It does not take effect until you make it current, and a live run still needs a passed evaluation.">{(p) => <textarea {...p} rows={8} value={text} onChange={(e) => setPrompt(e.target.value)} />}</Field>
          <Field label="What changed and why" name="note">{(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div><Button variant="primary" loading={busy === 'version'} disabled={note.trim().length < 5 || prompt === null} onClick={() => save('version', async () => { await api.post(`/admin/agents/${id}/versions`, { prompt: text, note: note.trim() }); setPrompt(null); setNote(''); }, 'New version saved')}>Save as new version</Button></div>
        </div>}
      </Card>
      <div className="grid two">
        <Card title="Recent requests">{d.requests.length === 0 ? <Empty title="No requests yet" /> : <div className="table-wrap"><table><caption className="sr">Recent requests</caption><thead><tr><th>When</th><th>Result</th><th className="r">Tokens</th></tr></thead>
          <tbody>{d.requests.map((r: any, i: number) => <tr key={i}><td className="num">{dateTime(r.created_at)}</td><td>{r.blocked_reason ? <><Badge tone="warn">Refused</Badge> <span className="small">{r.blocked_reason}</span></> : r.ok ? <Badge tone="ok">Done</Badge> : <Badge tone="bad">Failed</Badge>}</td><td className="r num">{num(r.tokens)}</td></tr>)}</tbody></table></div>}</Card>
        <Card title="Audit trail">{d.trail.length === 0 ? <Empty title="No changes yet" /> : <div className="table-wrap"><table><caption className="sr">Audit trail</caption><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>{d.trail.map((t: any, i: number) => <tr key={i}><td className="num">{dateTime(t.at)}</td><td>{t.actorEmail ?? (t.actorType === 'AI' ? 'System' : '-')}</td><td>{t.action}</td></tr>)}</tbody></table></div>}</Card>
      </div>
    </div>;
  }}</Async>;
}

export function AgentWorkforce({ canEdit }: { canEdit: boolean; canApprove: boolean }) {
  const st = useApi<any>('/admin/agents'); const [sel, setSel] = useState<string | null>(null);
  return <Async state={st}>{(d) => <div className="stack">
    <div className={`alert ${d.model.live ? 'info' : 'warn'}`}>{d.model.live ? 'The live model is on. Only Active agents with a passed evaluation may use it.' : 'The platform is using the built-in mock model. No live AI is being called, so agents in Testing can be exercised safely.'}</div>
    <div className={`alert ${d.cost.state === 'ok' ? 'info' : 'warn'}`}>Estimated live AI spend this month: USD {d.cost.spend.toFixed(2)}{d.cost.cap > 0 ? ` of a USD ${d.cost.cap} cap (${Math.round(d.cost.share * 100)}%). ` : '. No cap is set. '}{d.cost.state === 'over' && 'New live tasks are refused until next month or the cap is raised. '}The cap and the token prices are set under Settings, in the rules list.</div>
    <Card title="Agents">
      <div className="table-wrap"><table><caption className="sr">AI agents</caption>
        <thead><tr><th>Agent</th><th>Status</th><th>Version</th><th>Evaluation</th><th>Owner</th><th>Usage today</th><th className="r">Errors (30 days)</th><th>Action</th></tr></thead>
        <tbody>{d.agents.map((a: any) => <tr key={a.id}>
          <td><b>{a.name}</b><div className="small muted">{a.autonomyLabel}</div></td><td><Badge tone={tone(a.status)}>{a.status}</Badge>{a.limit.state !== 'ok' && <> <Badge tone="warn">{a.limit.state === 'over' ? 'Over limit' : 'Near limit'}</Badge></>}</td>
          <td>v{a.version ?? '-'}</td><td>{a.evaluation}</td><td>{a.owner?.name ?? 'No owner'}</td><td className="num">{num(a.usage.requestsDay)} requests</td>
          <td className="r num">{a.vitals.errorRate === null ? 'n/a' : `${a.vitals.errorRate}%`}</td>
          <td><Button size="sm" onClick={() => setSel(sel === a.id ? null : a.id)}>{sel === a.id ? 'Close' : 'Open'}</Button></td></tr>)}</tbody></table></div>
    </Card>
    {sel && <Detail id={sel} canEdit={canEdit} onChange={st.reload} />}
  </div>}</Async>;
}
