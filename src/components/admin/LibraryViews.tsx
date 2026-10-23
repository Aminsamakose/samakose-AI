'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, errText, ghs, dateFmt, qs } from '@/lib/client/api';
import { useApi, Button, Badge, Loading, ErrorState, Empty, Field, useForm, FormError, useToast, ConfirmButton, Modal } from '@/components/ui';
import { DIMENSIONS, useMe } from '@/components/admin/common';
import { UserSelect } from '@/components/portfolio/shared';

type Me = ReturnType<typeof useMe>;

type Author = { id: string; name: string; title: string | null; bio: string | null };
type Resource = {
  id: string; slug: string; title: string; authorId: string; topic: string | null; dimension: string | null;
  summary: string; body: string; priceGhs: number | null; isFree: boolean; status: string; hasFile: boolean;
  publishedAt: string | null; createdAt: string; updatedAt: string;
};

const statusTone = (s: string) => s === 'Published' ? 'ok' : s === 'In review' ? 'warn' : s === 'Archived' ? '' : 'info';

/* --------------------------------- authors --------------------------------- */
export function AuthorsPanel({ me }: { me: Me }) {
  const st = useApi<Author[]>('/library/authors');
  const [open, setOpen] = useState(false);
  const canWrite = me.can('library_authors', 'create');
  const toast = useToast();
  const form = useForm({ name: '', title: '', bio: '' }, (v) => api.post('/library/authors', v), {
    success: 'Author added.', onDone: () => { st.reload(); setOpen(false); form.setValues({ name: '', title: '', bio: '' }); }
  });
  return <div className="stack">
    <div className="toolbar"><h2 style={{ margin: 0 }}>Authors</h2>{canWrite && <Button size="sm" onClick={() => setOpen((o) => !o)}>{open ? 'Cancel' : 'Add author'}</Button>}</div>
    {open && <form onSubmit={form.onSubmit} className="stack" style={{ gap: 10, maxWidth: 480 }}>
      <FormError message={form.formError} />
      <Field label="Name" name="name" error={form.errors.name} required>{(p) => <input {...p} {...form.input('name')} required />}</Field>
      <Field label="Title" name="title" error={form.errors.title} hint="e.g. Senior Business Advisor">{(p) => <input {...p} {...form.input('title')} />}</Field>
      <Field label="Bio" name="bio" error={form.errors.bio}>{(p) => <textarea {...p} {...form.input('bio')} rows={3} />}</Field>
      <Button variant="primary" loading={form.busy} type="submit">Save author</Button>
    </form>}
    {st.error && !st.data ? <ErrorState message={st.error} retry={st.reload} /> : !st.data ? <Loading rows={2} /> : st.data.length === 0 ? <Empty title="No authors yet" hint="Add the first author above." /> : (
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Title</th><th></th></tr></thead>
        <tbody>{st.data.map((a) => <tr key={a.id}><td>{a.name}</td><td>{a.title ?? '-'}</td><td>
          {canWrite && <ConfirmButton size="sm" variant="danger" label="Remove" message={`Remove ${a.name}? This only works while they have no resources.`} onConfirm={async () => { try { await api.del(`/library/authors/${a.id}`); toast('Author removed.'); st.reload(); } catch (e) { toast(errText(e)); } }} />}
        </td></tr>)}</tbody>
      </table></div>
    )}
  </div>;
}

/* ------------------------------- entitlements ------------------------------- */
type Entitlement = { id: string; userId: string; resourceId: string; grantedVia: 'purchase' | 'promo' | 'admin_grant'; invoiceId: string | null; grantedBy: string | null; grantedAt: string; revokedAt: string | null };

function EntitlementsModal({ resource, me, onClose }: { resource: Resource; me: Me; onClose: () => void }) {
  const st = useApi<Entitlement[]>(`/library/resources/${resource.id}/entitlements`);
  const toast = useToast();
  const canGrant = me.can('library_entitlements', 'create');
  const canRevoke = me.can('library_entitlements', 'approve');
  const [userId, setUserId] = useState('');
  const [granting, setGranting] = useState(false);
  const rows = (st.data ?? []).slice().sort((a, b) => (a.revokedAt ? 1 : 0) - (b.revokedAt ? 1 : 0));

  const grant = async () => {
    if (!userId) { toast('Choose a person to grant access to'); return; }
    setGranting(true);
    try { await api.post('/library/entitlements/grant', { userId, resourceId: resource.id }); toast('Access granted'); setUserId(''); st.reload(); }
    catch (e) { toast(errText(e)); } finally { setGranting(false); }
  };

  return <Modal open onClose={onClose} title={`Entitlements — ${resource.title}`}>
    <div className="stack">
      {resource.isFree && <p className="small muted">This resource is free — everyone signed in may already read it. Entitlements only matter for premium resources.</p>}
      {canGrant && <div className="row" style={{ gap: 8, alignItems: 'end' }}>
        <div style={{ flex: 1 }}><UserSelect id="ent-user" name="userId" value={userId} onChange={setUserId} /></div>
        <Button loading={granting} onClick={grant}>Grant access</Button>
      </div>}
      {st.error && !st.data ? <ErrorState message={st.error} retry={st.reload} /> : !st.data ? <Loading rows={3} /> : rows.length === 0 ? <Empty title="No one holds an entitlement yet" /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>User</th><th>Via</th><th>Granted</th><th>Status</th>{canRevoke && <th></th>}</tr></thead>
          <tbody>{rows.map((e) => <tr key={e.id} style={e.revokedAt ? { opacity: 0.6 } : undefined}>
            <td className="mono small">{e.userId}</td>
            <td className="small">{e.grantedVia.replace('_', ' ')}</td>
            <td className="small muted">{dateFmt(e.grantedAt)}</td>
            <td><Badge tone={e.revokedAt ? 'bad' : 'ok'}>{e.revokedAt ? 'Revoked' : 'Active'}</Badge></td>
            {canRevoke && <td>{!e.revokedAt && <ConfirmButton size="sm" variant="danger" label="Revoke" message="Revoke this person's access to this resource?" onConfirm={async () => { try { await api.post(`/library/entitlements/${e.id}/revoke`, {}); toast('Entitlement revoked'); st.reload(); } catch (err) { toast(errText(err)); } }} />}</td>}
          </tr>)}</tbody>
        </table></div>
      )}
    </div>
  </Modal>;
}

/* -------------------------------- resources list -------------------------------- */
export function ResourcesPanel({ me }: { me: Me }) {
  const [status, setStatus] = useState('');
  const st = useApi<Resource[]>('/library/resources' + qs({ status }));
  const canCreate = me.can('library_resources', 'create');
  const canSeeEntitlements = me.can('library_entitlements', 'read');
  const [entitlementsFor, setEntitlementsFor] = useState<Resource | null>(null);
  return <div className="stack">
    <div className="toolbar">
      <h2 style={{ margin: 0 }}>Resources</h2>
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
        <option value="">All statuses</option>
        {['Draft', 'In review', 'Published', 'Archived'].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {canCreate && <Link className="btn primary right" href="/admin/library/new">New resource</Link>}
    </div>
    {st.error && !st.data ? <ErrorState message={st.error} retry={st.reload} /> : !st.data ? <Loading rows={5} /> : st.data.length === 0 ? (
      <Empty title="No resources match" hint={canCreate ? 'Create the first one.' : undefined} />
    ) : (
      <div className="table-wrap"><table>
        <thead><tr><th>Title</th><th>Status</th><th>Dimension</th><th className="r">Price</th><th>File</th><th>Updated</th>{canSeeEntitlements && <th></th>}</tr></thead>
        <tbody>{st.data.map((r) => <tr key={r.id}>
          <td><Link href={`/admin/library/${r.id}`}>{r.title}</Link></td>
          <td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
          <td>{r.dimension ?? '-'}</td>
          <td className="r num">{r.isFree ? 'Free' : ghs(r.priceGhs)}</td>
          <td>{r.hasFile ? 'Yes' : '-'}</td>
          <td>{dateFmt(r.updatedAt)}</td>
          {canSeeEntitlements && <td>{!r.isFree && <Button size="sm" onClick={() => setEntitlementsFor(r)}>Entitlements</Button>}</td>}
        </tr>)}</tbody>
      </table></div>
    )}
    {entitlementsFor && <EntitlementsModal resource={entitlementsFor} me={me} onClose={() => setEntitlementsFor(null)} />}
  </div>;
}

/* -------------------------------- resource editor -------------------------------- */
export function ResourceEditor({ id, me }: { id: string | null; me: Me }) {
  const isNew = !id;
  const st = useApi<Resource>(id ? `/library/resources/${id}` : null);
  const authorsSt = useApi<Author[]>('/library/authors');
  const toast = useToast();
  const canPrice = me.can('settings', 'edit');
  const canApprove = me.can('library_resources', 'approve');
  const canEdit = me.can('library_resources', 'edit') || me.can('library_resources', 'create');
  const [uploading, setUploading] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [brief, setBrief] = useState('');
  const r = st.data;

  const form = useForm<{ title: string; authorId: string; topic: string; dimension: string; summary: string; body: string; priceGhs: string }>(
    { title: r?.title ?? '', authorId: r?.authorId ?? '', topic: r?.topic ?? '', dimension: r?.dimension ?? '', summary: r?.summary ?? '', body: r?.body ?? '', priceGhs: r?.priceGhs != null ? String(r.priceGhs) : '' },
    async (v) => {
      const payload: Record<string, unknown> = { title: v.title, authorId: v.authorId, topic: v.topic || null, dimension: v.dimension || null, summary: v.summary, body: v.body };
      if (canPrice) payload.priceGhs = v.priceGhs === '' ? null : Number(v.priceGhs);
      if (isNew) { const created = await api.post<Resource>('/library/resources', payload); window.location.href = `/admin/library/${created.id}`; return created; }
      return api.patch<Resource>(`/library/resources/${id}`, payload);
    },
    { success: isNew ? undefined : 'Saved.', onDone: () => { if (!isNew) st.reload(); } }
  );

  if (id && st.loading && !r) return <Loading rows={6} />;
  if (id && st.error && !r) return <ErrorState message={st.error} retry={st.reload} />;
  if (!isNew && !r) return null;

  const locked = r && (r.status === 'Published' || r.status === 'Archived');
  const authors = authorsSt.data ?? [];

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      await api.upload(`/library/resources/${id}/file`, fd);
      toast('File attached.'); st.reload();
    } catch (e) { toast(errText(e)); } finally { setUploading(false); }
  };

  const draftWithAI = async () => {
    if (!brief.trim()) return;
    setDrafting(true);
    try {
      const d = await api.post<{ title: string; summary: string; body: string; suggestedDimension: string | null; blocked?: boolean }>('/library/draft', { topic: brief });
      if (d.blocked) { toast('The drafting agent is unavailable right now. Write the content directly.'); return; }
      form.setValues((v) => ({ ...v, title: d.title || v.title, summary: d.summary || v.summary, body: d.body || v.body, dimension: d.suggestedDimension ?? v.dimension }));
      toast('Draft proposal filled in below. Review and edit before saving.');
    } catch (e) { toast(errText(e)); } finally { setDrafting(false); }
  };

  return <div className="stack" style={{ maxWidth: 760 }}>
    {r && <div className="row" style={{ gap: 8 }}><Badge tone={statusTone(r.status)}>{r.status}</Badge>{r.publishedAt && <span className="small muted">Published {dateFmt(r.publishedAt)}</span>}</div>}
    {locked && <div className="alert warn" role="note">This resource is {r!.status.toLowerCase()}. Archive it or create a new draft to make content changes; an administrator may still adjust the price.</div>}
    {isNew && <div className="stack" style={{ gap: 6, maxWidth: 480 }}>
      <label htmlFor="lib-brief">Draft from a topic brief (AI-assisted, optional)</label>
      <div className="row" style={{ gap: 8 }}>
        <input id="lib-brief" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Record-keeping basics for a market stall" style={{ flex: 1 }} />
        <Button type="button" loading={drafting} onClick={draftWithAI} disabled={!brief.trim()}>Draft</Button>
      </div>
      <span className="small muted">Nothing is saved until you review the proposal and submit the form below.</span>
    </div>}
    <form onSubmit={form.onSubmit} className="stack" style={{ gap: 12 }}>
      <FormError message={form.formError} />
      <Field label="Title" name="title" error={form.errors.title} required>{(p) => <input {...p} {...form.input('title')} disabled={!!locked && !canPrice} required />}</Field>
      <Field label="Author" name="authorId" error={form.errors.authorId} required>{(p) => <select {...p} {...form.input('authorId')} disabled={!!locked}>
        <option value="">Choose an author</option>{authors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>}</Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Topic" name="topic" error={form.errors.topic}>{(p) => <input {...p} {...form.input('topic')} disabled={!!locked} />}</Field>
        <Field label="Dimension" name="dimension" error={form.errors.dimension}>{(p) => <select {...p} {...form.input('dimension')} disabled={!!locked}>
          <option value="">No dimension</option>{DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>}</Field>
      </div>
      <Field label="Summary" name="summary" error={form.errors.summary} required>{(p) => <textarea {...p} {...form.input('summary')} rows={2} disabled={!!locked} required />}</Field>
      <Field label="Body" name="body" error={form.errors.body} hint="Shown in full to a reader who may access this resource." required>{(p) => <textarea {...p} {...form.input('body')} rows={10} disabled={!!locked} required />}</Field>
      <Field label="Price (GHS)" name="priceGhs" error={form.errors.priceGhs} hint={canPrice ? 'Leave blank for a free resource.' : 'Only an administrator can set or change the price.'}>
        {(p) => <input {...p} {...form.input('priceGhs')} type="number" min={0} step="0.01" disabled={!canPrice} />}
      </Field>
      <div className="row">
        <Button variant="primary" loading={form.busy} type="submit" disabled={!!locked && !canPrice}>{isNew ? 'Create draft' : 'Save'}</Button>
        {!isNew && !locked && canEdit && <Button loading={false} type="button" onClick={async () => { try { await api.post(`/library/resources/${id}/submit`, {}); toast('Submitted for review.'); st.reload(); } catch (e) { toast(errText(e)); } }} disabled={r?.status !== 'Draft'}>Submit for review</Button>}
        {!isNew && r?.status === 'In review' && canApprove && <>
          <Button variant="primary" type="button" onClick={async () => { try { await api.post(`/library/resources/${id}/decision`, { decision: 'Published' }); toast('Published.'); st.reload(); } catch (e) { toast(errText(e)); } }}>Publish</Button>
          <Button variant="danger" type="button" onClick={async () => { try { await api.post(`/library/resources/${id}/decision`, { decision: 'Draft' }); toast('Returned to draft.'); st.reload(); } catch (e) { toast(errText(e)); } }}>Return to draft</Button>
        </>}
      </div>
    </form>
    {!isNew && r?.status === 'Published' && canApprove && <div className="row"><ConfirmButton variant="danger" label="Archive" message="Archive this resource? It will no longer appear in the public catalogue." onConfirm={async () => { await api.post(`/library/resources/${id}/archive`, {}); toast('Archived.'); st.reload(); }} /></div>}
    {!isNew && !locked && <div className="stack" style={{ gap: 6 }}>
      <label htmlFor="lib-file">Attach PDF</label>
      <input id="lib-file" type="file" accept="application/pdf" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      {r?.hasFile && <span className="small muted">A file is already attached. Uploading again replaces it.</span>}
    </div>}
  </div>;
}
