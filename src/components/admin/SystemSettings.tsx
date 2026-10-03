'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ApiFail, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Field, FormError, KV, Tile, useApi, useToast } from '@/components/ui';

type Mt = { on: boolean; blockSignin: boolean; message: string; updatedAt: string | null };
export function MaintenanceEditor({ canEdit }: { canEdit: boolean }) {
  const st = useApi<Mt>('/settings/maintenance'); const toast = useToast();
  const [on, setOn] = useState(false); const [block, setBlock] = useState(false); const [msg, setMsg] = useState('');
  const [err, setErr] = useState<string | null>(null); const [fe, setFe] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (st.data) { setOn(st.data.on); setBlock(st.data.blockSignin); setMsg(st.data.message); } }, [st.data]);
  const save = async () => {
    setBusy(true); setErr(null); setFe({});
    try { await api.put('/settings/maintenance', { on, blockSignin: block, message: msg }); toast(on ? 'Maintenance mode is on' : 'Maintenance mode is off'); setConfirm(false); st.reload(); }
    catch (e) { if (e instanceof ApiFail && e.fields) setFe(e.fields); setErr(errText(e)); } finally { setBusy(false); }
  };
  return <Async state={st}>{(d) => <Card title="Maintenance mode">
    <div className="stack">
      <div className={`alert ${d.on ? 'warn' : 'info'}`}>{d.on ? 'Maintenance mode is ON. Visitors see a notice instead of the website.' : 'Maintenance mode is off. The website is live.'}{d.updatedAt ? ` Last changed ${dateTime(d.updatedAt)}.` : ''}</div>
      <p className="small muted">Use it while you make big changes. Administrators can always sign in. The website returns the moment you switch it off.</p>
      <FormError message={err} />
      <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={on} disabled={!canEdit} onChange={(e) => setOn(e.target.checked)} /> Show the maintenance notice on the public website</label>
      <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={block} disabled={!canEdit} onChange={(e) => setBlock(e.target.checked)} /> Also pause sign-in for everyone except administrators</label>
      <Field label="Message for visitors" name="mmsg" error={fe.message} hint="Optional. Leave blank to use the standard wording.">{(p) => <textarea {...p} rows={3} value={msg} disabled={!canEdit} onChange={(e) => setMsg(e.target.value)} />}</Field>
      {canEdit && (confirm
        ? <div className="alert warn stack"><span>{block ? 'Staff, clients and partners will not be able to sign in until you switch this off. Continue?' : 'Visitors will see the maintenance notice. Continue?'}</span><div className="row"><Button variant="danger" loading={busy} onClick={save}>Yes, turn it on</Button><Button onClick={() => setConfirm(false)}>Cancel</Button></div></div>
        : <div className="form-actions"><Button variant="primary" loading={busy} disabled={on === d.on && block === d.blockSignin && msg === d.message} onClick={() => (on && !d.on ? setConfirm(true) : save())}>Save</Button></div>)}
    </div>
  </Card>}</Async>;
}

type Sec = { enforced: { label: string; ok: boolean; detail?: string }[]; counts: Record<string, number>; note: string };
export function SecurityOverview() {
  const st = useApi<Sec>('/settings/security');
  return <Async state={st}>{(s) => <div className="stack">
    <div className="grid">
      <Tile label="Staff without two-step" value={s.counts.staffNoMfa} hint="Active staff accounts" tone={s.counts.adminsNoMfa ? 'bad' : ''} />
      <Tile label="Administrators without two-step" value={s.counts.adminsNoMfa} hint={`${s.counts.activeAdmins} active administrators`} tone={s.counts.adminsNoMfa ? 'bad' : ''} />
      <Tile label="Failed sign-ins, 24 hours" value={s.counts.failed24} hint="Includes lockouts" />
      <Tile label="Locked accounts" value={s.counts.locked} hint="Right now" />
      <Tile label="Dormant staff accounts" value={s.counts.dormant} hint="No sign-in for 90 days" />
    </div>
    <Card title="What is enforced"><KV items={s.enforced.map((e) => [e.label, <Badge key={e.label} tone={e.ok ? 'ok' : 'warn'}>{e.detail ?? (e.ok ? 'Yes' : 'No')}</Badge>] as [string, React.ReactNode])} /><p className="small muted" style={{ marginTop: 12 }}>{s.note}</p></Card>
  </div>}</Async>;
}

export function TransferPanel({ canExport }: { canExport: boolean }) {
  const toast = useToast(); const fileRef = useRef<HTMLInputElement>(null);
  const [bundle, setBundle] = useState<unknown>(null); const [name, setName] = useState(''); const [plan, setPlan] = useState<{ drafts: number; switches: number; templates: number; reportText: number } | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    setPlan(null); setErr(null); setBundle(null); if (!f) return; setName(f.name);
    if (f.size > 2_000_000) { setErr('That file is larger than 2 MB, so it is probably not a configuration file.'); return; }
    let parsed: unknown; try { parsed = JSON.parse(await f.text()); } catch { setErr('That file is not valid JSON.'); return; }
    setBusy(true);
    try { const r = await api.post<any>('/settings/config/import', { bundle: parsed, dryRun: true }); setBundle(parsed); setPlan(r); }
    catch (e) { setErr(e instanceof ApiFail && e.fields?.file ? e.fields.file : errText(e)); } finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/settings/config/import', { bundle, dryRun: false }); toast('Imported. Review the new drafts and publish when ready.'); setPlan(null); setBundle(null); setName(''); if (fileRef.current) fileRef.current.value = ''; }
    catch (e) { setErr(e instanceof ApiFail && e.fields?.file ? e.fields.file : errText(e)); } finally { setBusy(false); }
  };
  const sets: [string, string, string][] = [['users', 'Users', 'Names, roles and status. No passwords.'], ['organisations', 'Organisations', 'Every organisation record.'], ['audit', 'Audit trail', 'Who did what and when.'], ['inquiries', 'Website enquiries', 'Messages from the public site.']];
  return <div className="stack">
    <Card title="Configuration file">
      <p className="small muted" style={{ marginBottom: 12 }}>Take a copy of the website content, switches, email wording and report wording, or bring one in from another environment. Importing never publishes anything: content arrives as drafts for you to review. A file cannot switch off a safety rule.</p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {canExport && <a className="btn" href="/api/v1/settings/config/export">Download configuration</a>}
        <label className="btn" style={{ cursor: 'pointer' }}>Choose a file to import<input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} /></label>
      </div>
      <div style={{ marginTop: 12 }} aria-live="polite"><FormError message={err} />
        {plan && <div className="alert info stack"><span><b>{name}</b> is valid. Importing will create or update {plan.drafts} content draft{plan.drafts === 1 ? '' : 's'}, set {plan.switches} switch{plan.switches === 1 ? '' : 'es'}, {plan.templates} email wording{plan.templates === 1 ? '' : 's'} and {plan.reportText} report wording{plan.reportText === 1 ? '' : 's'}.</span><div className="row"><Button variant="primary" loading={busy} onClick={apply}>Import now</Button><Button onClick={() => { setPlan(null); setBundle(null); setName(''); if (fileRef.current) fileRef.current.value = ''; }}>Cancel</Button></div></div>}</div>
    </Card>
    {canExport && <Card title="Data export"><p className="small muted" style={{ marginBottom: 12 }}>Spreadsheet (CSV) copies of platform records. Each download is recorded in the audit trail.</p>
      <ul className="stack" style={{ gap: 10, listStyle: 'none', padding: 0 }}>{sets.map(([k, l, h]) => <li key={k} className="row" style={{ justifyContent: 'space-between', gap: 12 }}><span><b>{l}</b><br /><span className="small muted">{h}</span></span><a className="btn sm" href={k === 'users' || k === 'organisations' ? `/api/v1/${k}?format=csv` : k === 'audit' ? '/api/v1/audit?format=csv' : '/api/v1/inquiries?format=csv'}>Download CSV</a></li>)}</ul>
      <p className="small muted" style={{ marginTop: 12 }}>Bulk import of users or organisations is not offered here on purpose: creating many accounts at once without invitations would bypass the approval steps.</p></Card>}
  </div>;
}

type Bl = { currency: 'GHS' | 'USD'; usdReferenceEnabled: boolean; taxEnabled: boolean; taxLabel: string; taxRatePercent: number; taxInclusive: boolean; taxRegistrationNumber: string; taxConfirmationRef: string; invoicePrefix: string; paymentTermsDays: number; paymentInstructions: string; invoiceFooter: string; updatedAt: string | null };
export function BillingEditor({ canEdit }: { canEdit: boolean }) {
  const st = useApi<Bl>('/settings/billing'); const toast = useToast();
  const [v, setV] = useState<Bl | null>(null); const [fe, setFe] = useState<Record<string, string>>({}); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (st.data) setV(st.data); }, [st.data]);
  const set = <K extends keyof Bl>(k: K, x: Bl[K]) => setV((o) => (o ? { ...o, [k]: x } : o));
  const save = async () => {
    if (!v) return; setBusy(true); setErr(null); setFe({});
    const { updatedAt, ...body } = v; void updatedAt;
    try { await api.put('/settings/billing', body); toast('Billing settings saved'); st.reload(); }
    catch (e) { if (e instanceof ApiFail && e.fields) setFe(e.fields); setErr(errText(e)); } finally { setBusy(false); }
  };
  if (!v) return <Async state={st}>{() => null}</Async>;
  const n = (k: keyof Bl, label: string, hint?: string, type: 'text' | 'number' = 'text') => <Field label={label} name={String(k)} error={fe[k as string]} hint={hint}>{(p) => <input {...p} type={type} inputMode={type === 'number' ? 'decimal' : undefined} disabled={!canEdit} value={String(v[k] ?? '')} onChange={(e) => set(k, (type === 'number' ? Number(e.target.value) : e.target.value) as never)} />}</Field>;
  return <div className="stack">
    <div className="alert info">These settings are for Finance and billing only. They are separate from the public pricing cards: changing a pricing card never changes invoices, contracts or plans, and nothing here changes what visitors see.</div>
    <FormError message={err} />
    <Card title="Currency">
      <div className="form-grid">
        <Field label="Default currency" name="currency" error={fe.currency}>{(p) => <select {...p} disabled={!canEdit} value={v.currency} onChange={(e) => set('currency', e.target.value as 'GHS' | 'USD')}><option value="GHS">Ghana cedi (GHS)</option><option value="USD">US dollar (USD)</option></select>}</Field>
        <label className="row" style={{ gap: 10, paddingTop: 28 }}><input type="checkbox" disabled={!canEdit} checked={v.usdReferenceEnabled} onChange={(e) => set('usdReferenceEnabled', e.target.checked)} /> Keep USD reference amounts available for future use</label>
      </div>
    </Card>
    <Card title="Tax (off until Finance confirms)">
      <p className="small muted" style={{ marginBottom: 12 }}>Switch tax on only after Finance has confirmed whether Samakose Accelerator Lab is registered and how it is treated. It cannot be turned on without a rate, a registration number and a confirmation reference.</p>
      <div className="stack">
        <label className="row" style={{ gap: 10 }}><input type="checkbox" disabled={!canEdit} checked={v.taxEnabled} onChange={(e) => set('taxEnabled', e.target.checked)} /> Tax is applied</label>
        <div className="form-grid">{n('taxLabel', 'Tax label')}{n('taxRatePercent', 'Rate (percent)', undefined, 'number')}{n('taxRegistrationNumber', 'Tax registration number')}{n('taxConfirmationRef', 'Finance confirmation reference', 'Who confirmed this and when.')}</div>
        <label className="row" style={{ gap: 10 }}><input type="checkbox" disabled={!canEdit} checked={v.taxInclusive} onChange={(e) => set('taxInclusive', e.target.checked)} /> Prices already include tax</label>
      </div>
    </Card>
    <Card title="Invoices">
      <div className="form-grid">{n('invoicePrefix', 'Invoice number prefix', '2 to 6 capital letters.')}{n('paymentTermsDays', 'Payment terms (days)', undefined, 'number')}</div>
      <div className="stack" style={{ marginTop: 12 }}>
        <Field label="Payment instructions" name="paymentInstructions" error={fe.paymentInstructions} hint="Bank or mobile money details shown to clients.">{(p) => <textarea {...p} rows={3} disabled={!canEdit} value={v.paymentInstructions} onChange={(e) => set('paymentInstructions', e.target.value)} />}</Field>
        <Field label="Invoice footer" name="invoiceFooter" error={fe.invoiceFooter}>{(p) => <textarea {...p} rows={2} disabled={!canEdit} value={v.invoiceFooter} onChange={(e) => set('invoiceFooter', e.target.value)} />}</Field>
      </div>
    </Card>
    {canEdit && <div className="form-actions"><Button variant="primary" loading={busy} onClick={save}>Save billing settings</Button></div>}
  </div>;
}

type Pay = { mode: string; ready: boolean; checks: { label: string; ok: boolean; fix: string }[]; webhookUrl: string; callbackUrl: string; note: string };
export function PaymentReadiness() {
  const st = useApi<Pay>('/admin/system/payments');
  return <Async state={st}>{(d) => <Card title="Online payment readiness">
    <div className={`alert ${d.ready ? 'ok' : 'warn'}`} style={{ marginBottom: 12 }}>{d.ready ? 'Ready for real payments.' : `Not ready for real money. Current mode: ${d.mode}.`}</div>
    <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: 8 }}>{d.checks.map((c) => <li key={c.label} className="row" style={{ gap: 10, alignItems: 'flex-start' }}><Badge tone={c.ok ? 'ok' : 'warn'}>{c.ok ? 'OK' : 'To do'}</Badge><span>{c.label}{!c.ok && <span className="small muted"><br />{c.fix}</span>}</span></li>)}</ul>
    <KV items={[['Webhook address', <span key="w" className="mono" style={{ overflowWrap: 'anywhere' }}>{d.webhookUrl}</span>], ['Return address', <span key="c" className="mono" style={{ overflowWrap: 'anywhere' }}>{d.callbackUrl}</span>]]} />
    <p className="small muted" style={{ marginTop: 12 }}>{d.note}</p>
  </Card>}</Async>;
}
