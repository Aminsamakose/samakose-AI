'use client';
import { useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, useApi, useToast } from '@/components/ui';

type EnvVar = { name: string; set: boolean; secret: boolean };
type Row = { id: string; label: string; category: string; docsHint: string; providerOptions: string[] | null; providerChoice: string | null; envVars: EnvVar[]; configured: boolean };

function EnvVarList({ vars }: { vars: EnvVar[] }) {
  return <div className="stack" style={{ gap: 4 }}>
    {vars.map((v) => <div key={v.name} className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
      <span className="mono small">{v.name}{v.secret ? '' : ' (not secret)'}</span>
      <Badge tone={v.set ? 'ok' : ''}>{v.set ? 'Set' : 'Not set'}</Badge>
    </div>)}
  </div>;
}

function IntegrationCard({ row, canEdit, onChanged }: { row: Row; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [provider, setProvider] = useState(row.providerChoice ?? '');

  const test = async () => {
    setBusy(true); setResult(null);
    try { const r = await api.post<{ ok: boolean; message: string }>(`/settings/integrations/${row.id}/test`, {}); setResult(r); }
    catch (e) { setResult({ ok: false, message: errText(e) }); }
    finally { setBusy(false); }
  };
  const saveProvider = async (next: string) => {
    setProvider(next); setBusy(true);
    try { await api.put(`/settings/integrations/${row.id}`, { provider: next }); toast(`${row.label} provider set to ${next}`); onChanged(); }
    catch (e) { toast(errText(e), 'bad'); }
    finally { setBusy(false); }
  };

  return <Card title={<span className="row" style={{ gap: 8 }}>{row.label}<Badge tone={row.configured ? 'ok' : 'warn'}>{row.configured ? 'Configured' : 'Not configured'}</Badge></span>}>
    <div className="stack">
      <p className="small muted">{row.docsHint}</p>
      {row.providerOptions && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="small">Provider:</span>
        {row.providerOptions.map((p) => <Button key={p} size="sm" variant={provider === p ? 'primary' : undefined} disabled={!canEdit || busy} onClick={() => saveProvider(p)}>{p}</Button>)}
      </div>}
      <EnvVarList vars={row.envVars} />
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" loading={busy} disabled={!canEdit} onClick={test}>Test connection</Button>
      </div>
      {result && <div className={`alert ${result.ok ? 'info' : 'warn'}`} role="status">{result.message}</div>}
    </div>
  </Card>;
}

/**
 * Admin-only settings for Zoom, Microsoft Teams, WhatsApp Business, SMS (Twilio/Arkesel),
 * e-signature (DocuSign) and accounting sync (QuickBooks Online/Xero). Credentials are never
 * entered here -- they are set as environment variables on the hosting platform (Vercel
 * project settings) and this screen only shows whether each one is set, lets an administrator
 * pick the SMS/accounting provider, and makes one real, read-only connectivity check.
 */
export function IntegrationSettings({ canEdit }: { canEdit: boolean }) {
  const st = useApi<Row[]>('/settings/integrations');
  return <Async state={st}>{(rows) => <div className="stack">
    <div className="alert info">
      Credentials for these services are set as environment variables where this application is hosted (on Vercel: Project Settings -&gt; Environment Variables), never typed in here. This screen shows which variables are set and lets you choose a provider and test the connection. Actually sending a Zoom/Teams meeting invite, a WhatsApp or SMS message, a document for signature, or an accounting-system sync is separate functionality that is not yet built.
    </div>
    {rows.map((row) => <IntegrationCard key={row.id} row={row} canEdit={canEdit} onChanged={st.reload} />)}
  </div>}</Async>;
}
