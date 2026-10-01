'use client';
import { useState } from 'react';
import { api, errText, qs, dateFmt } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, Modal, useApi, useToast } from '@/components/ui';
import type { useMe } from '@/components/admin/common';

type Me = ReturnType<typeof useMe>;
type Asset = { id: string; name: string; filename: string; category: string; mime: string; size: number; altText: string | null; url: string; isImage: boolean; createdAt: string };
const kb = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

export function MediaLibrary({ me }: { me: Me }) {
  const [q, setQ] = useState(''); const [cat, setCat] = useState('');
  const [adding, setAdding] = useState(false); const [sel, setSel] = useState<Asset | null>(null);
  const st = useApi<{ items: Asset[]; categories: string[] }>('/admin/media' + qs({ q, category: cat }));
  const toast = useToast();
  return <Card title="Media library" actions={me.can('media', 'create') && <Button variant="primary" size="sm" onClick={() => setAdding(true)}>Upload a file</Button>}>
    <p className="muted small" style={{ marginBottom: 10 }}>Images and PDFs for the website. Every image needs a short description for people who use screen readers. Copy a file's address into any link or image field.</p>
    <div className="toolbar">
      <div className="search-box"><label className="sr" htmlFor="mq">Search files</label><input id="mq" type="search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <label className="sr" htmlFor="mc">Category</label>
      <select id="mc" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{(st.data?.categories ?? []).map((c) => <option key={c}>{c}</option>)}</select>
    </div>
    <Async state={st}>{(d) => d.items.length === 0 ? <Empty title="No files yet" hint="Upload a logo, photo or PDF to get started." /> :
      <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' }}>
        {d.items.map((a) => <li key={a.id} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
          <button type="button" onClick={() => setSel(a)} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} aria-label={`Open ${a.name}`}>
            <div style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center', background: 'var(--surface-2)' }}>
              {a.isImage ? <img src={a.url} alt={a.altText ?? ''} loading="lazy" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span className="mono">PDF</span>}
            </div>
            <div style={{ padding: 10 }}><strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{a.name}</strong><span className="small muted">{a.category} · {kb(a.size)}</span></div>
          </button>
        </li>)}
      </ul>}</Async>
    <Modal open={adding} onClose={() => setAdding(false)} title="Upload a file">{adding && <UploadForm categories={st.data?.categories ?? []} onDone={() => { setAdding(false); st.reload(); toast('Uploaded'); }} />}</Modal>
    <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.name ?? 'File'}>{sel && <Detail a={sel} me={me} onChanged={() => { setSel(null); st.reload(); }} categories={st.data?.categories ?? []} />}</Modal>
  </Card>;
}

function UploadForm({ categories, onDone }: { categories: string[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [fe, setFe] = useState<Record<string, string>>({});
  return <form className="stack" noValidate onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setErr(null); setFe({});
    try { await api.upload('/admin/media', new FormData(e.currentTarget)); onDone(); }
    catch (x: any) { setFe(x?.fields ?? {}); setErr(errText(x)); } finally { setBusy(false); }
  }}>
    <FormError message={err} />
    <Field label="File" name="file" required hint="PNG, JPG, WebP or PDF, up to 8 MB." error={fe.file}>{(p) => <input {...p} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" />}</Field>
    <Field label="Name" name="name" hint="Leave empty to use the file name.">{(p) => <input {...p} maxLength={120} />}</Field>
    <Field label="Description for screen readers" name="altText" hint="Required for images. Say what the picture shows." error={fe.altText}>{(p) => <input {...p} maxLength={200} />}</Field>
    <Field label="Category" name="category" error={fe.category}>{(p) => <select {...p} defaultValue="Image">{categories.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={busy}>Upload</Button></div>
  </form>;
}

function Detail({ a, me, onChanged, categories }: { a: Asset; me: Me; onChanged: () => void; categories: string[] }) {
  const toast = useToast();
  const [name, setName] = useState(a.name); const [alt, setAlt] = useState(a.altText ?? ''); const [cat, setCat] = useState(a.category);
  const [busy, setBusy] = useState(false); const [fe, setFe] = useState<Record<string, string>>({});
  const full = typeof window !== 'undefined' ? window.location.origin + a.url : a.url;
  return <div className="stack">
    {a.isImage && <img src={a.url} alt={a.altText ?? ''} style={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain', alignSelf: 'center' }} />}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Badge>{a.category}</Badge><span className="small muted">{kb(a.size)} · added {dateFmt(a.createdAt)} · {a.filename}</span></div>
    <Field label="Address to use on the website" name="addr" hint="Paste this into any link or image field.">{(p) => <div className="row" style={{ gap: 8 }}><input {...p} readOnly value={a.url} onFocus={(e) => e.currentTarget.select()} /><Button type="button" onClick={async () => { try { await navigator.clipboard.writeText(full); toast('Copied'); } catch { toast('Select the address and copy it', 'bad'); } }}>Copy</Button></div>}</Field>
    {me.can('media', 'edit') && <>
      <Field label="Name" name="n">{(p) => <input {...p} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Description for screen readers" name="alt" error={fe.altText}>{(p) => <input {...p} value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} />}</Field>
      <Field label="Category" name="c">{(p) => <select {...p} value={cat} onChange={(e) => setCat(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
    </>}
    <div className="form-actions">
      {me.can('media', 'edit') && <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); setFe({}); try { await api.patch(`/admin/media/${a.id}`, { name, altText: alt, category: cat }); toast('Saved'); onChanged(); } catch (x: any) { setFe(x?.fields ?? {}); toast(errText(x), 'bad'); } finally { setBusy(false); } }}>Save</Button>}
      {me.can('media', 'delete') && <ConfirmButton variant="danger" label="Delete" message="Delete this file permanently? If a page still uses it, the delete is refused." onConfirm={async () => { await api.del(`/admin/media/${a.id}`); toast('Deleted'); onChanged(); }} />}
    </div>
  </div>;
}
