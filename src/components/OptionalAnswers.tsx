'use client';
import { useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Field, FormError, useApi, useToast } from '@/components/ui';

const GENDERS = ['Female', 'Male', 'Prefer not to say'];
const AGES = ['18-24', '25-35', '36-45', '46-55', '56+', 'Prefer not to say'];
const DIS = ['Yes', 'No', 'Prefer not to say'];

/** Optional answers. Each has its own wording, is never used in a score, and can be removed at any time. Nothing is ticked for the person. */
function Block({ category, title, d, reload, children, initial }: { category: 'demographics' | 'disability'; title: string; d: any; reload: () => void; initial: Record<string, string>; children: (v: Record<string, string>, set: (k: string, x: string) => void, err: Record<string, string>) => React.ReactNode }) {
  const toast = useToast();
  const [v, setV] = useState<Record<string, string>>(d.fields ?? initial);
  const [agree, setAgree] = useState(false); const [err, setErr] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (!d.available) return null;
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); const er: Record<string, string> = {};
    for (const k of Object.keys(initial)) if (!v[k]) er[k] = 'Choose one of the options';
    if (!d.granted && !agree) er.agree = 'Tick the box to agree, or leave this section blank';
    setErr(er); if (Object.keys(er).length) return;
    setBusy(true); setMsg(null);
    try { await api.put(`/me/demographics/${category}`, v); toast('Saved'); reload(); } catch (x) { setMsg(errText(x)); } finally { setBusy(false); }
  };
  const remove = async () => { setBusy(true); try { await api.del(`/me/demographics/${category}`); toast('Removed. Your answers are deleted.'); setV(initial); setAgree(false); reload(); } catch (x) { setMsg(errText(x)); } finally { setBusy(false); } };
  return <form className="stack" noValidate onSubmit={save} aria-label={title}>
    <h3 style={{ margin: 0 }}>{title} {d.granted && <Badge tone="ok">Saved</Badge>}</h3>
    <p className="small" style={{ margin: 0 }}>{d.notice.text}</p>
    <FormError message={msg} />
    {children(v, (k, x) => setV((p) => ({ ...p, [k]: x })), err)}
    {!d.granted && <Field label="" name={`${category}-agree`} error={err.agree}>{(q) => <label className="row" style={{ gap: 8 }}><input {...q} type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span className="small">I agree to the wording above.</span></label>}</Field>}
    <div className="form-actions"><Button variant="primary" type="submit" loading={busy}>{d.granted ? 'Update' : 'Save'}</Button>{d.granted && <Button type="button" onClick={remove} loading={busy}>Remove my answers</Button>}</div>
  </form>;
}

export function OptionalAnswers() {
  const st = useApi<any>('/me/demographics');
  return <Async state={st}>{(d) => (!d.demographics.available && !d.disability.available) ? <p className="muted">These optional questions are not open yet.</p> : <div className="stack">
    <p className="muted small">Both sections are optional and separate. They never change your score, your report or the support you receive.</p>
    <Block category="demographics" title="Who you are" d={d.demographics} reload={st.reload} initial={{ gender: '', ageBand: '' }}>{(v, set, err) => <div className="form-grid">
      <Field label="Gender" name="gender" error={err.gender}>{(p) => <select {...p} value={v.gender} onChange={(e) => set('gender', e.target.value)}><option value="">Choose</option>{GENDERS.map((x) => <option key={x}>{x}</option>)}</select>}</Field>
      <Field label="Age band" name="ageBand" error={err.ageBand}>{(p) => <select {...p} value={v.ageBand} onChange={(e) => set('ageBand', e.target.value)}><option value="">Choose</option>{AGES.map((x) => <option key={x}>{x}</option>)}</select>}</Field>
    </div>}</Block>
    <Block category="disability" title="Disability" d={d.disability} reload={st.reload} initial={{ status: '' }}>{(v, set, err) =>
      <Field label="Do you, or the owner of this business, live with a disability?" name="status" error={err.status}>{(p) => <select {...p} value={v.status} onChange={(e) => set('status', e.target.value)}><option value="">Choose</option>{DIS.map((x) => <option key={x}>{x}</option>)}</select>}</Field>}</Block>
  </div>}</Async>;
}

export function OptionalCard() { return <Card title="Optional: help us show who we reach"><OptionalAnswers /></Card>; }

/** Owner dashboard: the next best action from the answers given at registration. */
export function NextStepCard() {
  const st = useApi<any>('/me/next-step');
  return <Async state={st}>{(d) => <Card title="Your next step"><div className="stack"><strong>{d.title}</strong><p style={{ margin: 0 }}>{d.body}</p><div><a className="btn primary" href={d.href}>Go to my assessment</a></div><p className="small muted" style={{ margin: 0 }}>You can also answer the optional questions on your <a href="/profile">profile</a> page.</p></div></Card>}</Async>;
}
