'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, Modal, useApi, useForm, useToast } from '@/components/ui';
import { HOME_SECTIONS, contrastRatio, type Field as FieldDef, type HomeSection, type Kind } from '@/domain/content-kinds';
import type { useMe } from '@/components/admin/common';
type Me = ReturnType<typeof useMe>;

type Item = { id: string; kind: string; key: string; title: string; status: string; version: number; data: Record<string, any>; live: Record<string, any> | null; changed: boolean; customised: boolean; publishAt: string | null; publishedAt: string | null; updatedAt: string; sortOrder: number };
type Overview = { id: string; label: string; blurb: string; group: string; singleton: boolean; total: number; published: number; draft: number; inReview: number; scheduled: number; archived: number };

/* ------------------------------------------------------------------ hub */
export function WebsiteHub() {
  const st = useApi<Overview[]>('/admin/content');
  return <Async state={st}>{(rows) => {
    const g = (grp: string) => rows.filter((r) => r.group === grp);
    const card = (r: Overview) => <Link key={r.id} href={`/admin/website/${r.id}`} className="tile" style={{ textDecoration: 'none', color: 'inherit', gap: 8 }}>
      <span className="l">{r.label}</span>
      <span className="small muted">{r.blurb}</span>
      <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {r.singleton ? <Badge tone={r.published ? 'ok' : ''}>{r.published ? 'Customised' : 'Built-in text'}</Badge> : <Badge>{r.total} item{r.total === 1 ? '' : 's'}</Badge>}
        {r.published > 0 && !r.singleton && <Badge tone="ok">{r.published} live</Badge>}
        {r.inReview > 0 && <Badge tone="info">{r.inReview} in review</Badge>}
        {r.scheduled > 0 && <Badge tone="info">{r.scheduled} scheduled</Badge>}
      </span>
    </Link>;
    return <div className="stack">
      {g('site_settings').length > 0 && <section aria-labelledby="h-set"><h2 id="h-set" style={{ marginBottom: 10 }}>Site settings</h2><div className="grid">{g('site_settings').map(card)}</div></section>}
      <section aria-labelledby="h-med"><h2 id="h-med" style={{ marginBottom: 10 }}>Files</h2><div className="grid"><Link href="/admin/website/media" className="tile" style={{ textDecoration: 'none', color: 'inherit', gap: 8 }}><span className="l">Media library</span><span className="small muted">Logos, photos and PDFs for the website. Every image carries a description for screen readers.</span></Link></div></section>
      {g('content').length > 0 && <section aria-labelledby="h-con"><h2 id="h-con" style={{ marginBottom: 10 }}>Content</h2><div className="grid">{g('content').map(card)}</div></section>}
    </div>;
  }}</Async>;
}

/* ------------------------------------------------------------------ one kind */
export function KindScreen({ kindId, me }: { kindId: string; me: Me }) {
  const st = useApi<{ kind: Kind; items: Item[] }>(`/admin/content/kind/${kindId}`);
  const [open, setOpen] = useState<Item | 'new' | null>(null);
  const toast = useToast();
  const mayCreate = me.can('content', 'create');
  return <Async state={st}>{({ kind, items }) => {
    if (kind.singleton) return <DocEditor kind={kind} item={items[0]} me={me} onChanged={st.reload} />;
    return <div className="stack">
      <Card title={kind.plural} actions={mayCreate && <Button variant="primary" size="sm" onClick={() => setOpen('new')}>New {kind.label.toLowerCase()}</Button>}>
        <p className="muted small" style={{ marginBottom: 10 }}>{kind.blurb}</p>
        {items.length === 0 ? <Empty title={`No ${kind.plural.toLowerCase()} yet`} hint={mayCreate ? `Create the first one with “New ${kind.label.toLowerCase()}”.` : undefined} /> :
          <div className="table-wrap"><table><caption className="sr">{kind.plural}</caption>
            <thead><tr><th>Title</th><th>Status</th><th>Updated</th><th><span className="sr">Open</span></th></tr></thead>
            <tbody>{items.map((i) => <tr key={i.id}>
              <td><button type="button" className="btn ghost sm" onClick={() => setOpen(i)} style={{ textAlign: 'left' }}>{i.title}</button></td>
              <td><span className="row" style={{ gap: 6 }}><Badge>{i.status}</Badge>{i.changed && <Badge tone="warn">Unpublished changes</Badge>}</span></td>
              <td>{dateTime(i.updatedAt)}</td>
              <td><Button size="sm" onClick={() => setOpen(i)} aria-label={`Open ${i.title}`}>Open</Button></td></tr>)}</tbody></table></div>}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open === 'new' ? `New ${kind.label.toLowerCase()}` : open ? open.title : ''}>
        {open === 'new' && <NewForm kind={kind} onDone={() => { setOpen(null); st.reload(); toast('Saved as a draft'); }} />}
        {open && open !== 'new' && <DocEditor kind={kind} item={open} me={me} onChanged={() => { st.reload(); }} onClosed={() => setOpen(null)} inModal />}
      </Modal>
    </div>;
  }}</Async>;
}

/* ------------------------------------------------------------------ form pieces */
function FieldInput({ f, value, onChange, p, disabled }: { f: FieldDef; value: any; onChange: (v: any) => void; p: any; disabled: boolean }) {
  if (f.type === 'bool') return <label className="row" style={{ gap: 8 }}><input type="checkbox" {...p} checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span>{f.label}</span></label>;
  if (f.type === 'colour') {
    const ok = /^#[0-9a-fA-F]{6}$/.test(value ?? '');
    const ratio = ok ? contrastRatio(value, '#ffffff') : 0;
    return <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
      <input type="color" aria-label={`${f.label}, colour picker`} value={ok ? value : '#0f4a3f'} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ width: 48, height: 40, padding: 2 }} />
      <input {...p} type="text" value={value ?? ''} placeholder="#0f4a3f" maxLength={7} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 140 }} />
      {ok && <span className="row" style={{ gap: 8 }}><span style={{ background: value, color: '#fff', padding: '4px 12px', borderRadius: 99, fontWeight: 600 }}>Sample button</span><Badge tone={ratio >= 4.5 ? 'ok' : 'bad'}>{`Contrast ${ratio.toFixed(1)} to 1${ratio >= 4.5 ? ', readable' : ', too light'}`}</Badge></span>}
    </div>;
  }
  if (f.type === 'textarea' || f.type === 'markdown') return <textarea {...p} rows={f.type === 'markdown' ? 14 : 4} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  return <input {...p} type={f.type === 'email' ? 'email' : f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'url' ? 'url' : undefined} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

function Fields({ kind, form, disabled }: { kind: Kind; form: ReturnType<typeof useForm<any>>; disabled: boolean }) {
  return <>{kind.fields.map((f) => f.type === 'bool'
    ? <div key={f.key}><FieldInput f={f} value={form.values[f.key]} onChange={(v) => form.set(f.key, v)} p={{ id: `f-${f.key}`, name: f.key }} disabled={disabled} />{form.errors[f.key] && <span className="err" role="alert">{form.errors[f.key]}</span>}</div>
    : <Field key={f.key} label={f.label} name={f.key} required={f.required} hint={f.hint ?? (f.max ? `Up to ${f.max} characters` : undefined)} error={form.errors[f.key]}>{(p) => <FieldInput f={f} value={form.values[f.key]} onChange={(v) => form.set(f.key, v)} p={p} disabled={disabled} />}</Field>)}</>;
}

function NewForm({ kind, onDone }: { kind: Kind; onDone: () => void }) {
  const form = useForm<any>(kind.defaults, (v) => api.post(`/admin/content/kind/${kind.id}`, { data: v }), { onDone });
  return <form className="stack" onSubmit={form.onSubmit} noValidate>
    <FormError message={form.formError} />
    <Fields kind={kind} form={form} disabled={false} />
    <div className="form-actions"><Button variant="primary" type="submit" loading={form.busy}>Save as draft</Button></div>
  </form>;
}

/* ------------------------------------------------------------------ home page section order */
function SectionManager({ value, onChange, disabled }: { value: HomeSection[]; onChange: (v: HomeSection[]) => void; disabled: boolean }) {
  const label = (id: string) => HOME_SECTIONS.find((s) => s.id === id)?.label ?? id;
  const move = (i: number, d: number) => { const a = [...value]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  return <fieldset className="stack" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
    <legend className="small" style={{ fontWeight: 700 }}>Home page sections</legend>
    <p className="muted small">The opening banner always comes first. Use the arrows to reorder and the tick to show or hide a section.</p>
    <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
      {value.map((s, i) => <li key={s.id} className="row" style={{ gap: 8, justifyContent: 'space-between', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', opacity: s.enabled ? 1 : 0.65 }}>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={s.enabled} disabled={disabled} onChange={(e) => onChange(value.map((x) => x.id === s.id ? { ...x, enabled: e.target.checked } : x))} /><span>{label(s.id)}</span></label>
        <span className="row" style={{ gap: 4 }}>
          <Button size="sm" type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${label(s.id)} up`}>Up</Button>
          <Button size="sm" type="button" disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${label(s.id)} down`}>Down</Button>
        </span>
      </li>)}
    </ol>
  </fieldset>;
}

/* ------------------------------------------------------------------ the editor */
export function DocEditor({ kind, item, me, onChanged, onClosed, inModal }: { kind: Kind; item: Item; me: Me; onChanged: () => void; onClosed?: () => void; inModal?: boolean }) {
  const toast = useToast();
  const mayEdit = me.can(kind.group, 'edit') && item.status !== 'Archived';
  const mayPublish = me.can(kind.group, 'approve');
  const mayDelete = me.can(kind.group, 'delete') && !kind.singleton;
  const [busy, setBusy] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<'edit' | 'changes' | 'history'>('edit');
  const form = useForm<any>(item.data, (v) => api.put(`/admin/content/${item.id}`, { data: v }), { success: 'Draft saved', onDone: onChanged });
  useEffect(() => { form.setValues(item.data); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [item.id, item.updatedAt]);
  const dirty = JSON.stringify(form.values) !== JSON.stringify(item.data);

  const run = async (name: string, fn: () => Promise<unknown>, done: string, close = false) => {
    setBusy(name);
    try {
      if (mayEdit && dirty) await api.put(`/admin/content/${item.id}`, { data: form.values });
      await fn(); toast(done); onChanged(); if (close) onClosed?.();
    } catch (e: any) {
      if (e?.fields && Object.keys(e.fields).length) { /* show beside the fields */ form.setErrors(e.fields); }
      toast(errText(e), 'bad');
    } finally { setBusy(null); }
  };
  const act = (path: string, body?: unknown) => () => api.post(`/admin/content/${item.id}/${path}`, body);

  return <div className="stack">
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <Badge>{item.status}</Badge>
      {item.changed && <Badge tone="warn">Unpublished changes</Badge>}
      {kind.singleton && !item.customised && <Badge>Showing the built-in text</Badge>}
      {item.publishAt && <span className="small muted">Goes live {dateTime(item.publishAt)}</span>}
      {item.publishedAt && <span className="small muted">Last published {dateTime(item.publishedAt)} (version {item.version})</span>}
    </div>
    {!mayEdit && item.status !== 'Archived' && <div className="alert info" role="status">You can view this but not change it. Ask an administrator or site manager if an edit is needed.</div>}
    {item.status === 'Archived' && <div className="alert info" role="status">This item is archived and hidden from the website. Restore it to edit it again.</div>}
    <div className="tabs" role="tablist">
      {(['edit', 'changes', 'history'] as const).map((t) => <button type="button" key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'edit' ? 'Edit' : t === 'changes' ? 'Compare with live' : 'History'}</button>)}
    </div>
    {tab === 'edit' && <form className="stack" onSubmit={form.onSubmit} noValidate>
      <FormError message={form.formError} />
      <Fields kind={kind} form={form} disabled={!mayEdit} />
      {kind.id === 'home' && <SectionManager value={form.values.sections ?? []} onChange={(v) => form.set('sections', v)} disabled={!mayEdit} />}
      <div className="form-actions" style={{ flexWrap: 'wrap' }}>
        {mayEdit && <Button variant={mayPublish ? undefined : 'primary'} type="submit" loading={form.busy} disabled={!dirty}>Save draft</Button>}
        {mayEdit && !mayPublish && item.status === 'Draft' && <Button variant="primary" type="button" loading={busy === 'submit'} onClick={() => run('submit', act('submit'), 'Sent for review')}>Send for review</Button>}
        {mayPublish && item.status !== 'Archived' && <Button variant="primary" type="button" loading={busy === 'publish'} onClick={() => run('publish', act('publish', { note: note || undefined }), 'Published. Visitors see it now.')}>Publish now</Button>}
      </div>
      {mayPublish && item.status !== 'Archived' && <div className="form-grid">
        <Field label="Note for the history (optional)" name="note">{(p) => <input {...p} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <Field label="Or publish at a set time" name="when" hint="Uses your local time.">{(p) => <input {...p} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
        <div style={{ alignSelf: 'end' }}><Button type="button" disabled={!when} loading={busy === 'schedule'} onClick={() => run('schedule', act('schedule', { at: new Date(when).toISOString() }), 'Scheduled')}>Schedule</Button>{item.status === 'Scheduled' && <Button type="button" onClick={() => run('unschedule', act('unschedule'), 'Schedule cancelled')} style={{ marginLeft: 8 }}>Cancel schedule</Button>}</div>
      </div>}
      {!kind.singleton && mayPublish && <div className="row" style={{ gap: 8 }}>
        {item.status === 'Archived'
          ? <Button type="button" onClick={() => run('unarchive', act('unarchive'), 'Restored as a draft')}>Restore from archive</Button>
          : <ConfirmButton label="Archive" message="This takes the item off the website. You can restore it later." onConfirm={async () => { await api.post(`/admin/content/${item.id}/archive`); toast('Archived'); onChanged(); onClosed?.(); }} />}
        {mayDelete && item.status === 'Archived' && <ConfirmButton variant="danger" label="Delete permanently" message="This cannot be undone. The item and its history are removed. The action is recorded in the audit trail." onConfirm={async () => { await api.del(`/admin/content/${item.id}`); toast('Deleted'); onChanged(); onClosed?.(); }} />}
      </div>}
    </form>}
    {tab === 'changes' && <ChangeList kind={kind} item={item} draft={form.values} />}
    {tab === 'history' && <History kind={kind} item={item} mayRestore={mayEdit} onRestored={onChanged} />}
  </div>;
}

function ChangeList({ kind, item, draft }: { kind: Kind; item: Item; draft: Record<string, any> }) {
  const base = item.live ?? kind.defaults;
  const rows = useMemo(() => [...kind.fields.map((f) => ({ key: f.key, label: f.label })), ...(kind.id === 'home' ? [{ key: 'sections', label: 'Section order and visibility' }] : [])]
    .map((f) => ({ ...f, a: base[f.key], b: draft[f.key] })).filter((r) => JSON.stringify(r.a ?? '') !== JSON.stringify(r.b ?? '')), [kind, base, draft]);
  const show = (v: any) => Array.isArray(v) ? v.map((s: any) => `${s.id}${s.enabled ? '' : ' (hidden)'}`).join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v === '' || v == null ? '(empty)' : String(v);
  if (!rows.length) return <Empty title="No differences" hint={item.live ? 'The working copy matches what visitors see.' : 'The working copy matches the built-in text.'} />;
  return <div className="table-wrap"><table><caption className="sr">Changes compared with {item.live ? 'the live version' : 'the built-in text'}</caption>
    <thead><tr><th>Field</th><th>{item.live ? 'Live now' : 'Built-in'}</th><th>Your draft</th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.key}><td>{r.label}</td><td style={{ whiteSpace: 'pre-wrap' }}>{show(r.a)}</td><td style={{ whiteSpace: 'pre-wrap' }}><strong>{show(r.b)}</strong></td></tr>)}</tbody></table></div>;
}

function History({ kind, item, mayRestore, onRestored }: { kind: Kind; item: Item; mayRestore: boolean; onRestored: () => void }) {
  const st = useApi<{ id: string; version: number; data: Record<string, any>; note: string | null; createdAt: string; author: string | null }[]>(`/admin/content/${item.id}/versions`);
  const toast = useToast();
  return <Async state={st} empty={(d) => d.length === 0}>{(rows) => rows.length === 0 ? <Empty title="No published versions yet" hint="Each time this is published, a copy is kept here so it can be restored." /> :
    <div className="table-wrap"><table><caption className="sr">Published versions</caption>
      <thead><tr><th>Version</th><th>Published</th><th>By</th><th>Note</th><th><span className="sr">Restore</span></th></tr></thead>
      <tbody>{rows.map((v) => <tr key={v.id}><td className="num">{v.version}{v.version === item.version ? ' (live)' : ''}</td><td>{dateTime(v.createdAt)}</td><td>{v.author ?? '-'}</td><td>{v.note ?? '-'}</td>
        <td>{mayRestore && v.version !== item.version && <ConfirmButton size="sm" label="Restore" message={`Put version ${v.version} back into the working copy? It will not go live until it is published again.`} onConfirm={async () => { await api.post(`/admin/content/${item.id}/restore`, { version: v.version }); toast('Restored to the working copy'); onRestored(); }} />}</td></tr>)}</tbody></table></div>}</Async>;
}
