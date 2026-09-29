'use client';
import { useRef, useState } from 'react';
import { api, ApiFail, dateFmt, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, Modal, useApi, useForm, useToast } from '@/components/ui';
import type { TabProps } from './types';
import { CLASS_TONE, useMe } from './core/shared';

type Ev = { id: string; code: string; class: string; description: string; link: string | null; responseId: string | null; documentId: string | null; verifiedAt: string | null; createdAt: string };
type Doc = { id: string; code: string; filename: string; mime: string; size: number; createdAt: string };
const ALLOWED = ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx', 'csv', 'txt'];
const MAX_MB = 10;
const CLASSES = ['Verified', 'Document-supported', 'Self-reported', 'Unverified', 'Missing'];
const kb = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export default function TabEvidence({ caseId, role, reload }: TabProps) {
  const { can, ready } = useMe();
  const toast = useToast();
  const ev = useApi<Ev[]>(`/cases/${caseId}/evidence`);
  const canDocs = ready && can('documents', 'read');
  const docs = useApi<Doc[]>(canDocs ? `/documents?caseId=${caseId}` : null);
  const canEdit = can('evidence', 'edit');
  const docById = new Map((docs.data ?? []).map((d) => [d.id, d]));
  const refresh = () => { ev.reload(); docs.reload(); reload(); };

  const rescore = async () => {
    const r = await api.post<{ overall: number; maturity: string; run: number }>(`/cases/${caseId}/rescore`);
    toast(`Scored again: ${r.overall.toFixed(1)} (${r.maturity}), run ${r.run}`); refresh();
  };

  return <div className="stack">
    <Card title="Evidence" actions={canEdit ? <ConfirmButton label="Rescore now" message="This scores the latest diagnostic again using the evidence as it stands now and adds a new entry to the score history. Nothing is deleted." onConfirm={rescore} variant="primary" size="sm" /> : undefined}>
      <p className="muted">Evidence shows how well each diagnostic answer is backed up. Verified and document-supported evidence counts more in the score than self-reported claims.{canEdit ? ' Changing an item\'s type rescores the case automatically. Use Rescore now to recalculate without changing anything.' : ''}</p>
      <Async state={ev} empty={(d) => d.length === 0}>{(rows) => (
        <div className="table-wrap"><table>
          <caption className="sr">Evidence items</caption>
          <thead><tr><th>Ref</th><th>Type</th><th>Description</th><th>Source</th><th>Added</th>{canEdit && <th>Actions</th>}</tr></thead>
          <tbody>{rows.map((r) => {
            const d = r.documentId ? docById.get(r.documentId) : null;
            return <tr key={r.id}>
              <td className="mono">{r.code}</td>
              <td><Badge tone={CLASS_TONE[r.class]}>{r.class}</Badge>{r.verifiedAt && <div className="small muted">Verified {dateFmt(r.verifiedAt)}</div>}</td>
              <td>{r.description}</td>
              <td>{r.documentId ? <a href={`/api/v1/documents/${r.documentId}/download`}>{d ? d.filename : 'Download document'}</a> : null}{r.documentId && r.link ? <br /> : null}{r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer">Open link<span className="sr"> (opens in a new tab)</span></a> : null}{!r.documentId && !r.link && (r.responseId ? <span className="muted">Diagnostic answer</span> : '-')}</td>
              <td>{dateFmt(r.createdAt)}</td>
              {canEdit && <td><RowActions ev={r} role={role} onDone={refresh} /></td>}
            </tr>;
          })}</tbody>
        </table></div>
      )}</Async>
      {ev.data && ev.data.length === 0 && <Empty title="No evidence yet" hint="Evidence appears when a diagnostic is submitted, or when you add it below." />}
    </Card>
    <div className="grid two">
      {can('evidence', 'create') && <AddEvidence caseId={caseId} role={role} docs={docs.data ?? []} canDocs={canDocs} onDone={refresh} />}
      {can('documents', 'create') && <Upload caseId={caseId} onDone={docs.reload} />}
    </div>
    {canDocs && <Card title="Documents">
      <Async state={docs} empty={(d) => d.length === 0}>{(rows) => <div className="table-wrap"><table>
        <caption className="sr">Documents for this case</caption>
        <thead><tr><th>Ref</th><th>File</th><th>Size</th><th>Uploaded</th></tr></thead>
        <tbody>{rows.map((d) => <tr key={d.id}><td className="mono">{d.code}</td><td><a href={`/api/v1/documents/${d.id}/download`}>{d.filename}</a></td><td className="num">{kb(d.size)}</td><td>{dateTime(d.createdAt)}</td></tr>)}</tbody>
      </table></div>}</Async>
      {docs.data && docs.data.length === 0 && <Empty title="No documents uploaded" hint="Upload receipts, registrations or records to support diagnostic answers." />}
    </Card>}
  </div>;
}

function RowActions({ ev, role, onDone }: { ev: Ev; role: string; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const set = async (cls: string, msg: string) => { await api.patch(`/evidence/${ev.id}`, { class: cls }); toast(msg); onDone(); };
  const allowed = CLASSES.filter((c) => c !== ev.class && (c !== 'Verified' || role === 'CONSULTANT'));
  const f = useForm({ cls: allowed[0] ?? '' }, (v) => api.patch(`/evidence/${ev.id}`, { class: v.cls }), { success: 'Evidence type changed and the case rescored', onDone: () => { setOpen(false); onDone(); } });
  return <div className="row">
    {role === 'CONSULTANT' && ev.class !== 'Verified' && <ConfirmButton size="sm" label="Verify" variant="primary" message={`Mark ${ev.code} as verified? You are confirming you have checked it. The score is recalculated.`} onConfirm={() => set('Verified', `${ev.code} verified`)} />}
    {ev.class !== 'Missing' && <ConfirmButton size="sm" label="Reject" variant="danger" message={`Reject ${ev.code}? It will be recorded as Missing, which carries the lowest weight, and the score is recalculated.`} onConfirm={() => set('Missing', `${ev.code} rejected`)} />}
    <Button size="sm" onClick={() => setOpen(true)}>Change type</Button>
    <Modal open={open} onClose={() => setOpen(false)} title={`Change type of ${ev.code}`}>
      <form className="stack" onSubmit={f.onSubmit} noValidate>
        <FormError message={f.formError} />
        <Field label="New evidence type" name="class" error={f.errors.class}>{(p) => <select {...p} {...f.input('cls')}>{allowed.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
        <p className="small muted">The score is recalculated when the type changes. Only the consultant on the case can set Verified.</p>
        <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save</Button><Button type="button" onClick={() => setOpen(false)}>Cancel</Button></div>
      </form>
    </Modal>
  </div>;
}

function AddEvidence({ caseId, role, docs, canDocs, onDone }: { caseId: string; role: string; docs: Doc[]; canDocs: boolean; onDone: () => void }) {
  const classes = role === 'OWNER' ? ['Unverified', 'Self-reported'] : CLASSES.filter((c) => c !== 'Verified' || role === 'CONSULTANT');
  const f = useForm({ description: '', cls: role === 'OWNER' ? 'Unverified' : 'Unverified', documentId: '', link: '' }, async (v) => {
    const e: Record<string, string> = {};
    if (v.description.trim().length < 3) e.description = 'Describe the evidence in at least 3 characters';
    if (v.link && !/^https?:\/\//i.test(v.link)) e.link = 'Links must start with http:// or https://';
    if (Object.keys(e).length) throw new ApiFail(422, 'validation', 'Please correct the highlighted fields', e);
    return api.post(`/cases/${caseId}/evidence`, { description: v.description.trim(), class: v.cls, documentId: v.documentId || null, link: v.link.trim() || null });
  }, { success: 'Evidence added', onDone: () => { f.setValues({ description: '', cls: 'Unverified', documentId: '', link: '' }); onDone(); } });
  return <Card title="Add evidence">
    <form className="stack" onSubmit={f.onSubmit} noValidate>
      <FormError message={f.formError} />
      <Field label="Description" name="description" required error={f.errors.description} hint="What the evidence shows, for example: cash book for January to June">{(p) => <textarea {...p} maxLength={500} {...f.input('description')} />}</Field>
      <Field label="Evidence type" name="class" error={f.errors.class} hint={role === 'OWNER' ? 'Your consultant will check and upgrade this.' : 'With a document attached, Unverified becomes Document-supported.'}>{(p) => <select {...p} {...f.input('cls')}>{classes.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
      {canDocs && <Field label="Linked document (optional)" name="documentId" error={f.errors.documentId} hint={docs.length ? undefined : 'Upload a document first to link it here.'}>{(p) => <select {...p} {...f.input('documentId')}><option value="">No document</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.filename} ({d.code})</option>)}</select>}</Field>}
      <Field label="Web link (optional)" name="link" error={f.errors.link}>{(p) => <input type="url" inputMode="url" {...p} {...f.input('link')} placeholder="https://" />}</Field>
      <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Add evidence</Button></div>
    </form>
  </Card>;
}

function Upload({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!file) { setErr('Choose a file to upload'); return; }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED.includes(ext)) { setErr(`This file type is not accepted. Use ${ALLOWED.join(', ')}`); return; }
    if (file.size > MAX_MB * 1048576) { setErr(`Files can be at most ${MAX_MB} MB`); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('caseId', caseId);
      const r = await api.upload<{ filename: string }>('/documents', fd);
      toast(`${r.filename} uploaded`); setFile(null); if (input.current) input.current.value = ''; onDone();
    } catch (x) { setErr(x instanceof ApiFail && x.fields?.file ? x.fields.file : errText(x)); } finally { setBusy(false); }
  };
  return <Card title="Upload a document">
    <form className="stack" onSubmit={go} noValidate>
      <FormError message={err} />
      <Field label="File" name="file" required hint={`Accepted: ${ALLOWED.join(', ')}. Maximum ${MAX_MB} MB. The file content must match its type.`}>{(p) => <input {...p} ref={input} type="file" accept={ALLOWED.map((x) => '.' + x).join(',')} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }} />}</Field>
      <div className="form-actions"><Button variant="primary" type="submit" loading={busy}>Upload</Button></div>
    </form>
  </Card>;
}
