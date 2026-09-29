'use client';
import { useEffect, useState } from 'react';
import { api, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, KV, PageHead, Tile, useApi, useToast } from '@/components/ui';
import { Guard } from '@/components/admin/common';

type Status = {
  database: { ok: boolean; latencyMs: number }; jobs: Record<string, number>;
  failedJobs: { id: string; kind: string; attempts: number; lastError: string | null; updatedAt: string }[];
  email: { mode: 'smtp' | 'log-only'; queue: Record<string, number> };
  ai: { mode: 'mock' | 'claude'; model: string | null }; payments: { provider: string; mode: 'mock' | 'live' };
  kobo: { configured: boolean; pullConfigured: boolean; server: string };
  storage: { dir: string; status: string; maxUploadMb: number };
  security: { mfaRequiredRoles: string[]; trustProxy: boolean; https: boolean };
  runtime: { node: string; uptimeSec: number; env: string };
};
const uptime = (s: number) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' '); };
const mode = (ok: boolean, good: string, bad: string) => <Badge tone={ok ? 'ok' : 'warn'}>{ok ? good : bad}</Badge>;
const counts = (o: Record<string, number>) => Object.keys(o).length ? Object.entries(o).map(([k, v]) => `${v} ${k}`).join(', ') : 'Empty';

function KoboCard({ s }: { s: Status['kobo'] }) {
  const toast = useToast(); const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/api/v1/integrations/kobo/webhook`;
  return <Card title="KoboToolbox intake">
    <KV items={[
      ['Webhook intake', mode(s.configured, 'Configured', 'Not configured')],
      ['Scheduled pull', mode(s.pullConfigured, 'Configured', 'Not configured')],
      ['Kobo server', <span key="s" className="mono">{s.server}</span>],
      ['Webhook URL', <span key="u" className="mono" style={{ overflowWrap: 'anywhere' }}>{url}</span>],
      ['Secret header name', <span key="h" className="mono">X-Kobo-Secret</span>]
    ]} />
    <p className="small muted" style={{ margin: '12px 0' }}>In KoboToolbox, add a REST service with this URL and a custom header named X-Kobo-Secret. The value is the shared secret set on the server. It is never shown here.{!s.configured && ' Intake stays off until the secret is set on the server.'}</p>
    <Button size="sm" disabled={!origin} onClick={async () => { try { await navigator.clipboard.writeText(url); toast('Webhook URL copied'); } catch { toast('Copy failed. Select the URL and copy it manually.', 'bad'); } }}>Copy webhook URL</Button>
  </Card>;
}

function HealthCheck() {
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  return <div className="stack" style={{ gap: 8 }}>
    <div><Button loading={busy} onClick={async () => {
      setBusy(true);
      try { const r = await api.get<{ ok: boolean; db: string; latencyMs: number }>('/health'); setRes({ ok: r.ok, text: `Healthy. Database ${r.db}, answered in ${r.latencyMs} ms at ${dateTime(new Date())}.` }); }
      catch (e) { setRes({ ok: false, text: `Health check failed: ${errText(e)}` }); } finally { setBusy(false); }
    }}>Run health check</Button></div>
    <div aria-live="polite">{res && <div className={`alert ${res.ok ? 'ok' : 'bad'}`}>{res.text}</div>}</div>
  </div>;
}

export default function SystemPage() {
  const st = useApi<Status>('/admin/system'); const toast = useToast(); const [busy, setBusy] = useState<string | null>(null);
  return <Guard resource="integrations" action="read" title="System">{(me) => <>
    <PageHead title="System" sub="Environment status, background jobs and integrations." actions={<><Button onClick={st.reload}>Refresh</Button><a className="btn" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">API description (OpenAPI)</a></>} />
    <Async state={st}>{(s) => <>
      <div className="grid">
        <Tile label="Database" value={s.database.ok ? 'Up' : 'Down'} hint={`${s.database.latencyMs} ms`} />
        <Tile label="AI" value={s.ai.mode === 'claude' ? 'Live' : 'Mock'} hint={s.ai.mode === 'claude' ? s.ai.model ?? undefined : 'Canned answers, no AI provider key set'} />
        <Tile label="Payments" value={s.payments.mode === 'live' ? 'Live' : 'Mock'} hint={s.payments.mode === 'live' ? 'Paystack' : 'Paystack key not set; test payments only'} />
        <Tile label="Email" value={s.email.mode === 'smtp' ? 'SMTP' : 'Log only'} hint={s.email.mode === 'smtp' ? 'Sent through the mail server' : 'Mail is written to the log, not sent'} />
        <Tile label="Failed jobs" value={s.jobs.failed ?? 0} hint={counts(s.jobs)} />
      </div>
      {s.ai.mode === 'mock' && <div className="alert warn">AI is in mock mode. Generated drafts are not real AI output. Do not use this setting for client work.</div>}
      {s.payments.mode === 'mock' && <div className="alert warn">Payments are in mock mode. No real money moves.</div>}
      {s.email.mode === 'log-only' && <div className="alert warn">Email is in log-only mode. Invitations and reset links are not delivered to inboxes.</div>}
      <div className="grid two">
        <Card title="Environment">
          <KV items={[
            ['AI mode', mode(s.ai.mode === 'claude', `Live (${s.ai.model ?? 'Claude'})`, 'Mock')],
            ['Payment mode', mode(s.payments.mode === 'live', 'Live Paystack', 'Mock')],
            ['Mail mode', mode(s.email.mode === 'smtp', 'SMTP', 'Log only')],
            ['Mail queue', counts(s.email.queue)],
            ['Storage', <>{mode(s.storage.status === 'ok', 'Writable', s.storage.status)} <span className="mono small">{s.storage.dir}</span></>],
            ['Largest upload', `${s.storage.maxUploadMb} MB`],
            ['Two-step required for', s.security.mfaRequiredRoles.length ? s.security.mfaRequiredRoles.join(', ') : 'No roles'],
            ['Secure connection (https)', mode(s.security.https, 'Yes', 'No')],
            ['Behind a proxy', s.security.trustProxy ? 'Yes' : 'No'],
            ['Runtime', `Node ${s.runtime.node}, ${s.runtime.env}, up ${uptime(s.runtime.uptimeSec)}`]
          ]} />
        </Card>
        <div className="stack">
          <KoboCard s={s.kobo} />
          <Card title="Health check"><HealthCheck /></Card>
        </div>
      </div>
      <Card title="Job queue">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>{['queued', 'running', 'done', 'failed'].map((k) => <Badge key={k} tone={k === 'failed' && (s.jobs[k] ?? 0) > 0 ? 'bad' : ''}>{k}: {s.jobs[k] ?? 0}</Badge>)}</div>
        {s.failedJobs.length === 0 ? <Empty title="No failed jobs" hint="Background work is running cleanly." /> : <>
          <h3 className="small" style={{ marginBottom: 8 }}>Failed jobs (latest {s.failedJobs.length})</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Job</th><th className="r">Attempts</th><th>Last error</th><th>Failed at</th>{me.can('integrations', 'edit') && <th>Action</th>}</tr></thead>
            <tbody>{s.failedJobs.map((j) => <tr key={j.id}>
              <td><span className="mono">{j.kind}</span><div className="small muted mono">{j.id.slice(0, 8)}</div></td><td className="r num">{j.attempts}</td>
              <td style={{ minWidth: 200, overflowWrap: 'anywhere' }}>{j.lastError ?? '-'}</td><td className="num">{dateTime(j.updatedAt)}</td>
              {me.can('integrations', 'edit') && <td><Button size="sm" loading={busy === j.id} onClick={async () => { setBusy(j.id); try { await api.post(`/admin/jobs/${j.id}/retry`); toast('Job queued to run again'); st.reload(); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(null); } }}>Retry</Button></td>}
            </tr>)}</tbody></table></div>
        </>}
      </Card>
    </>}</Async>
  </>}</Guard>;
}
