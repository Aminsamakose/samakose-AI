'use client';
import { api } from '@/lib/client/api';
import { Async, Badge, Button, Card, Field, FormError, KV, useApi, useForm, useToast } from '@/components/ui';
import { useState } from 'react';

type S = {
  mode: 'mock' | 'live'; active: string; activeLabel: string; host: string; model: string; chosen: string | null; claudeModel: string; openaiModel: string; openaiBaseUrl: string; aiModeOn: boolean;
  envDefaults: { provider: string; claudeModel: string; openaiModel: string; openaiBaseUrl: string };
  tiers: { tier: string; label: string; agents: string[]; claude: string; openai: string }[];
  providers: { id: string; label: string; keySet: boolean; keyName: string }[];
};

function Editor({ s, canEdit, onDone }: { s: S; canEdit: boolean; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const f = useForm({ provider: s.active, claudeModel: s.claudeModel, openaiModel: s.openaiModel, openaiBaseUrl: s.openaiBaseUrl, reason: '', ...Object.fromEntries(s.tiers.flatMap((t) => [[`${t.tier}_claude`, t.claude], [`${t.tier}_openai`, t.openai]])) } as Record<string, string>,
    (v) => api.put('/settings/ai', { tiers: Object.fromEntries(s.tiers.map((t) => { const fam = v.provider === 'anthropic' ? 'claude' : 'openai'; return [t.tier, { [fam]: v[`${t.tier}_${fam}`] ?? '' }]; })), provider: v.provider, claudeModel: v.claudeModel || undefined, openaiModel: v.openaiModel || undefined, openaiBaseUrl: v.openaiBaseUrl || undefined, confirm, reason: v.reason || undefined }),
    { onDone, success: 'AI settings saved' });
  const changing = f.values.provider !== s.active; const needsOpenai = f.values.provider !== 'anthropic';
  const chosen = s.providers.find((p) => p.id === f.values.provider);
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="AI provider settings"><FormError message={f.formError} />
    <Field label="Provider" name="provider" error={f.errors.provider}>{(p) => <select {...p} {...f.input('provider')} disabled={!canEdit}>{s.providers.map((x) => <option key={x.id} value={x.id}>{x.label}{x.keySet ? '' : ' (no key set)'}</option>)}</select>}</Field>
    {chosen && !chosen.keySet && <p className="small" role="alert">No key is set for this provider yet. Add <span className="mono">{chosen.keyName}</span> in the host settings and redeploy. Until then live AI stays off.</p>}
    <div className="form-grid">
      {!needsOpenai && <Field label="Claude model (optional)" name="claudeModel" error={f.errors.claudeModel} hint={`Default: ${s.envDefaults.claudeModel}`}>{(p) => <input {...p} {...f.input('claudeModel')} disabled={!canEdit} />}</Field>}
      {needsOpenai && <Field label="Model (optional)" name="openaiModel" error={f.errors.openaiModel} hint={`Default: ${s.envDefaults.openaiModel}`}>{(p) => <input {...p} {...f.input('openaiModel')} disabled={!canEdit} />}</Field>}
      {f.values.provider === 'openai-compatible' && <Field label="Service address" name="openaiBaseUrl" error={f.errors.openaiBaseUrl} hint="The public https address of the service, ending in /v1">{(p) => <input {...p} {...f.input('openaiBaseUrl')} disabled={!canEdit} placeholder="https://api.example.com/v1" />}</Field>}
    </div>
    <fieldset className="stack" style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 12 }}>
      <legend>Model routing by tier</legend>
      <p className="small muted">Send simple work to a cheaper model and keep the strongest model for diagnosis and prescription. Leave a tier empty to use the model above. Names are set separately for Claude and for ChatGPT or other OpenAI-compatible services.</p>
      <div className="form-grid">{s.tiers.map((t) => { const fam = needsOpenai ? 'openai' : 'claude'; return <Field key={t.tier} label={t.label} name={`${t.tier}_${fam}`} error={f.errors[`tier_${t.tier}_${fam}`]} hint={`Used by: ${t.agents.join(', ')}`}>{(p) => <input {...p} {...f.input(`${t.tier}_${fam}`)} disabled={!canEdit} />}</Field>; })}</div>
    </fieldset>
    {changing && <fieldset className="stack" style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 12 }}>
      <legend>Switching provider</legend>
      <p className="small">Client business information in AI requests will go to {chosen?.label}, a different company. Each AI agent's evaluation was passed on the current provider, so re-run it on the new one before relying on the answers. Update the privacy notice and the Data Protection Commission registration too.</p>
      <Field label="Reason" name="reason" error={f.errors.reason}>{(p) => <input {...p} {...f.input('reason')} maxLength={500} />}</Field>
      <div className="field"><label><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I understand and want to switch.</label>{f.errors.confirm && <span className="err" role="alert">{f.errors.confirm}</span>}</div>
    </fieldset>}
    {canEdit && <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save</Button></div>}
  </form>;
}

/** Choose where live AI goes. Keys are never shown or entered here: they stay in the host settings. */
export function AiProviderCard({ canEdit }: { canEdit: boolean }) {
  const st = useApi<S>('/settings/ai'); const toast = useToast(); const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null); const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); setTest(null); try { setTest(await api.post('/settings/ai/test', {})); } catch (e: any) { setTest({ ok: false, message: e?.message ?? 'Test failed' }); toast('Test failed'); } finally { setBusy(false); } };
  return <Async state={st}>{(s) => <Card title="AI provider">
    <KV items={[['In use', s.mode === 'mock' ? <Badge tone="warn">Mock (no live AI)</Badge> : <Badge tone="ok">{s.activeLabel}</Badge>], ['Model', s.model], ['Data is sent to', <span className="mono" key="h">{s.host}</span>],
      ['Keys', s.providers.map((p) => <span key={p.id} style={{ marginRight: 8 }}><Badge tone={p.keySet ? 'ok' : ''}>{p.label.split(' (')[0]}: {p.keySet ? 'set' : 'not set'}</Badge></span>)]]} />
    {!s.aiModeOn && <p className="small muted">The host setting <span className="mono">AI_MODE</span> is not set to claude, so AI runs in mock mode whichever provider is chosen.</p>}
    <Editor key={`${s.active}-${s.chosen}`} s={s} canEdit={canEdit} onDone={st.reload} />
    {canEdit && <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}><Button onClick={run} loading={busy}>Send test request</Button><span className="small muted">Sends one harmless message, no client data.</span></div>}
    {test && <p className="small" role="status" style={{ marginTop: 8 }}><Badge tone={test.ok ? 'ok' : 'bad'}>{test.ok ? 'Working' : 'Not working'}</Badge> {test.message}</p>}
  </Card>}</Async>;
}
