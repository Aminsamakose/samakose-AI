'use client';
import { useEffect, useState } from 'react';
import { api, ApiFail, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Field, FormError, useApi, useToast } from '@/components/ui';

type Sw = { key: string; label: string; help: string; group: 'workflow' | 'registration'; default: 0 | 1; protected?: boolean; on: boolean; changed: boolean; updatedAt: string | null };

function SwitchRow({ s, canEdit, reload }: { s: Sw; canEdit: boolean; reload: () => void }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = async (on: boolean, why?: string) => {
    setBusy(true); setErr(null);
    try { await api.put(`/settings/switches/${encodeURIComponent(s.key)}`, { on, reason: why }); toast(`${s.label}: ${on ? 'on' : 'off'}`); setAsking(false); setReason(''); reload(); }
    catch (e) { setErr(e instanceof ApiFail && e.fields?.reason ? e.fields.reason : errText(e)); }
    finally { setBusy(false); }
  };
  const flip = () => { if (s.on && s.protected) setAsking(true); else set(!s.on); };
  return <div className="stack" style={{ gap: 8, paddingBlock: 12, borderBottom: '1px solid var(--line)' }}>
    <div className="row" style={{ justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
      <div className="stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
        <span style={{ fontWeight: 600 }}>{s.label} {s.protected && <Badge tone="warn">Safety rule</Badge>}</span>
        <span className="small muted">{s.help}</span>
        <span className="small muted">Default {s.default ? 'on' : 'off'}{s.changed && s.updatedAt ? ` · changed ${dateTime(s.updatedAt)}` : ''}</span>
      </div>
      <button type="button" role="switch" aria-checked={s.on} aria-label={s.label} disabled={!canEdit || busy} onClick={flip} className={`toggle ${s.on ? 'on' : ''}`}><span /></button>
    </div>
    {asking && <div className="alert warn stack" role="group" aria-label="Reason needed">
      <Field label="Why are you turning this safety rule off?" name={`reason-${s.key}`} error={err ?? undefined} hint="At least 10 characters. Recorded in the audit trail with your name.">
        {(p) => <textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <div className="row"><Button variant="danger" loading={busy} onClick={() => set(false, reason)}>Turn off</Button><Button onClick={() => { setAsking(false); setErr(null); }}>Keep it on</Button></div>
    </div>}
    {!asking && err && <span className="err" role="alert">{err}</span>}
  </div>;
}

export function WorkflowEditor({ canEdit }: { canEdit: boolean }) {
  const st = useApi<Sw[]>('/settings/switches');
  return <Async state={st}>{(d) => <div className="stack">
    <div className="alert info">Each switch takes effect straight away and every change is recorded in the audit trail. Safety rules ask for a reason before they are turned off.</div>
    <Card title="Workflow rules">{d.filter((s) => s.group === 'workflow').map((s) => <SwitchRow key={s.key} s={s} canEdit={canEdit} reload={st.reload} />)}</Card>
    <Card title="Registration">{d.filter((s) => s.group === 'registration').map((s) => <SwitchRow key={s.key} s={s} canEdit={canEdit} reload={st.reload} />)}
      <p className="small muted" style={{ marginTop: 12 }}>Staff roles such as reviewer, finance and administrator can never self-register. They are always by invitation.</p></Card>
  </div>}</Async>;
}

type Tpl = { key: string; label: string; when: string; vars: { name: string; sample: string; note: string }[]; subject: string; body: string; subjectNow: string; bodyNow: string; customised: boolean; updatedAt: string | null };
const fill = (t: string, vars: Tpl['vars']) => t.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k) => vars.find((v) => v.name === k)?.sample ?? '');

function TemplateCard({ t, canEdit, reload }: { t: Tpl; canEdit: boolean; reload: () => void }) {
  const toast = useToast();
  const [subject, setSubject] = useState(t.subjectNow); const [body, setBody] = useState(t.bodyNow);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [formError, setFormError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setSubject(t.subjectNow); setBody(t.bodyNow); }, [t.subjectNow, t.bodyNow]);
  const dirty = subject !== t.subjectNow || body !== t.bodyNow;
  const save = async () => {
    setBusy(true); setErrors({}); setFormError(null);
    try { await api.put(`/settings/email-templates/${t.key}`, { subject, body }); toast('Email wording saved'); reload(); }
    catch (e) { if (e instanceof ApiFail && e.fields) setErrors(e.fields); setFormError(errText(e)); }
    finally { setBusy(false); }
  };
  const reset = async () => { setBusy(true); try { await api.post(`/settings/email-templates/${t.key}/reset`, {}); toast('Built-in wording restored'); reload(); } catch (e) { setFormError(errText(e)); } finally { setBusy(false); } };
  return <Card title={t.label}>
    <p className="small muted" style={{ marginBottom: 12 }}>{t.when} {t.customised && <Badge tone="info">Edited</Badge>}</p>
    <FormError message={formError} />
    <div className="stack">
      <Field label="Subject" name={`${t.key}-subject`} error={errors.subject}>{(p) => <input {...p} value={subject} disabled={!canEdit} onChange={(e) => setSubject(e.target.value)} />}</Field>
      <Field label="Message" name={`${t.key}-body`} error={errors.body} hint={`Variables you can use: ${t.vars.map((v) => `{{${v.name}}}`).join(', ')}`}>{(p) => <textarea {...p} rows={8} value={body} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} />}</Field>
      <details><summary className="small">Preview with sample values</summary>
        <div className="card" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}><b>{fill(subject, t.vars)}</b>{'\n\n'}{fill(body, t.vars)}</div>
        <ul className="small muted" style={{ marginTop: 8 }}>{t.vars.map((v) => <li key={v.name}><code>{`{{${v.name}}}`}</code> {v.note}</li>)}</ul>
      </details>
      {canEdit && <div className="row"><Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>Save wording</Button>{dirty && <Button onClick={() => { setSubject(t.subjectNow); setBody(t.bodyNow); setErrors({}); }}>Discard</Button>}{t.customised && <Button onClick={reset}>Restore built-in wording</Button>}</div>}
    </div>
  </Card>;
}

export function EmailEditor({ canEdit }: { canEdit: boolean }) {
  const st = useApi<Tpl[]>('/settings/email-templates');
  return <Async state={st}>{(d) => <div className="stack">
    <div className="alert info">These emails are sent by the platform itself. The link variable is required in each one, because without it the person cannot finish the step.</div>
    {d.map((t) => <TemplateCard key={t.key} t={t} canEdit={canEdit} reload={st.reload} />)}
  </div>}</Async>;
}

type Rt = { key: string; label: string; help: string; value: string; max: number };
export function ReportTextEditor({ canEdit }: { canEdit: boolean }) {
  const st = useApi<Rt[]>('/settings/report-text');
  const toast = useToast();
  const [vals, setVals] = useState<Record<string, string>>({}); const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [fe, setFe] = useState<string | null>(null);
  useEffect(() => { if (st.data) setVals(Object.fromEntries(st.data.map((r) => [r.key, r.value]))); }, [st.data]);
  const save = async () => {
    setBusy(true); setErrors({}); setFe(null);
    try { await api.put('/settings/report-text', { values: vals }); toast('Report wording saved'); st.reload(); }
    catch (e) { if (e instanceof ApiFail && e.fields) setErrors(e.fields); setFe(errText(e)); } finally { setBusy(false); }
  };
  return <Async state={st}>{(d) => <Card title="Report wording">
    <p className="small muted" style={{ marginBottom: 12 }}>Applies to reports drafted from now on. Reports already drafted keep their wording.</p>
    <div className="stack"><FormError message={fe} />
      {d.map((r) => <Field key={r.key} label={r.label} name={r.key} error={errors[r.key]} hint={r.help}>{(p) => r.max > 200 ? <textarea {...p} rows={4} value={vals[r.key] ?? ''} disabled={!canEdit} onChange={(e) => setVals((v) => ({ ...v, [r.key]: e.target.value }))} /> : <input {...p} value={vals[r.key] ?? ''} disabled={!canEdit} onChange={(e) => setVals((v) => ({ ...v, [r.key]: e.target.value }))} />}</Field>)}
      {canEdit && <div className="form-actions"><Button variant="primary" loading={busy} onClick={save}>Save report wording</Button></div>}
    </div></Card>}</Async>;
}
