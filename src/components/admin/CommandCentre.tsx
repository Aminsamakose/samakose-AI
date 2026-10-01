'use client';
import Link from 'next/link';
import { dateTime } from '@/lib/client/api';
import { Async, Badge, Card, Empty, useApi } from '@/components/ui';
import { LinkTile } from '@/components/dash/common';

const mb = (b: number) => (Number(b) / 1048576).toFixed(1) + ' MB';
const num = (n: unknown) => Number(n ?? 0).toLocaleString('en-GB');

export function CommandCentre() {
  const st = useApi<any>('/admin/command-centre');
  return <Async state={st}>{(d) => {
    const c = d.counts, h = d.health;
    const ok = (good: boolean, label: string) => <Badge tone={good ? 'ok' : 'warn'}>{label}</Badge>;
    return <div className="stack">
      <Card title="Needs attention">
        {d.alerts.length === 0 ? <Empty title="Nothing needs attention" hint="No pending approvals, failures or waiting content." /> :
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>{d.alerts.map((a: any) => <li key={a.text} className="row" style={{ gap: 10 }}><Badge tone={a.tone}>{a.tone === 'bad' ? 'Failed' : a.tone === 'warn' ? 'Action' : 'Waiting'}</Badge><Link href={a.href}>{a.text}</Link></li>)}</ul>}
      </Card>
      <div className="grid">
        <LinkTile label="Organisations" value={num(c.organisations)} hint="All registered businesses" href="/organisations" />
        <LinkTile label="Pending organisations" value={num(c.pending_orgs)} hint="Not yet verified. Reports cannot be released for them." href="/organisations" tone={c.pending_orgs > 0 ? 'warn' : undefined} />
        <LinkTile label="Active users" value={num(c.active_users)} hint="Accounts able to sign in" href="/admin/users" />
        <LinkTile label="Assessments completed" value={num(c.assessments_completed)} hint="Health scores produced" href="/cases" />
        <LinkTile label="Awaiting review" value={num(c.awaiting_review)} hint="Prescriptions waiting for a reviewer" href="/reviews" />
        <LinkTile label="Reports released" value={num(c.reports_released)} hint={`${num(c.reports_draft)} still in draft`} href="/reports" />
        <LinkTile label="Website items to review" value={num(c.content_in_review)} hint={`${num(c.content_scheduled)} scheduled to go live`} href="/admin/website" tone={c.content_in_review > 0 ? 'warn' : undefined} />
        <LinkTile label="New enquiries" value={num(c.new_enquiries)} hint="Website messages not yet handled" href="/admin/website?tab=enquiries" />
        <LinkTile label="Storage used" value={mb(c.storage_bytes)} hint="Documents and website media" href="/admin/system" />
      </div>
      <div className="grid two">
        <Card title="System health" actions={<Link href="/admin/system">Details</Link>}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            <li className="row" style={{ gap: 8 }}>{ok(true, 'Database')} responds in {h.database} ms</li>
            <li className="row" style={{ gap: 8 }}>{ok(h.email === 'smtp', h.email === 'smtp' ? 'Email' : 'Email not set up')} {h.email === 'smtp' ? 'sending through your mail server' : 'messages are only logged'}</li>
            <li className="row" style={{ gap: 8 }}>{ok(h.storage === 'ok', h.storage === 'ok' ? 'File storage' : 'File storage problem')} {h.storage === 'ok' ? 'working' : h.storage}</li>
            <li className="row" style={{ gap: 8 }}>{ok(h.https, h.https ? 'Secure connection' : 'Not using https')}</li>
            <li className="row" style={{ gap: 8 }}>{ok(c.failed_jobs === 0 && c.failed_emails === 0, 'Background work')} {c.failed_jobs} failed job{c.failed_jobs === 1 ? '' : 's'}, {c.failed_emails} failed email{c.failed_emails === 1 ? '' : 's'}</li>
          </ul>
        </Card>
        <Card title="Recent administrator activity" actions={<Link href="/admin/audit">Audit trail</Link>}>
          {d.recent.length === 0 ? <Empty title="No activity yet" /> : <div className="table-wrap"><table><caption className="sr">Recent activity</caption><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
            <tbody>{d.recent.map((r: any, i: number) => <tr key={i}><td>{dateTime(r.at)}</td><td>{r.actor_email ?? 'System'}</td><td>{r.action}</td></tr>)}</tbody></table></div>}
        </Card>
      </div>
      <p className="muted small">Website traffic is not shown yet. It needs an analytics connection, which is part of a later phase.</p>
    </div>;
  }}</Async>;
}
