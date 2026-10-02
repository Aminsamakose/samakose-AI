'use client';
import { useState } from 'react';
import { api, dateFmt, errText } from '@/lib/client/api';
import { Async, Badge, Button, ConfirmButton, Empty, useApi, useToast } from '@/components/ui';

type Ver = { id: string; version: number; status: 'Draft' | 'Published' | 'Retired'; questions: number; dimensions: number; sources: number; sourcesApproved: number; note: string | null; publishedAt: string | null };
type Fw = { id: string; code: string; name: string; orgType: string | null; description: string | null; isDefault: boolean; currentVersion: number | null; unpublishedBankChanges: boolean; versions: Ver[] };
const tone = (s: string) => (s === 'Published' ? 'ok' : s === 'Draft' ? 'warn' : undefined);

function Publish({ v, reload }: { v: Ver; reload: () => void }) {
  const toast = useToast(); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await api.post(`/settings/frameworks/versions/${v.id}/publish`, { note }); toast(`Version ${v.version} published`); reload(); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(false); } };
  return <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
    <label className="sr" htmlFor={`n-${v.id}`}>Approval note for version {v.version}</label>
    <input id={`n-${v.id}`} value={note} placeholder="Approval note (required)" onChange={(e) => setNote(e.target.value)} />
    <Button size="sm" variant="primary" loading={busy} disabled={note.trim().length < 5} onClick={go}>Approve and publish</Button>
  </span>;
}

export function FrameworksPanel({ canCreate, canEdit, canApprove }: { canCreate: boolean; canEdit: boolean; canApprove: boolean }) {
  const st = useApi<Fw[]>('/settings/frameworks'); const toast = useToast();
  const draftFromBank = async (code: string) => { try { await api.post(`/settings/frameworks/${code}/versions`, { fromBank: true }); toast('Draft created from the question bank'); st.reload(); } catch (e) { toast(errText(e), 'bad'); } };
  return <div className="stack">
    <p className="muted small">A framework version is a frozen copy of the questions and rules a diagnostic is scored under. Edits in the Questions tab change the working bank only. They reach new diagnostics when a version is approved and published here. Published versions never change, so past scores stay explainable.</p>
    <Async state={st} empty={(d) => d.length === 0}>{(list) => <>{list.map((f) => <section key={f.id} className="card stack" aria-label={f.name}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div><b>{f.name}</b> <span className="mono small">{f.code}</span><br /><span className="small muted">{f.description}</span></div>
        <div>{f.currentVersion ? <Badge tone="ok">Live: version {f.currentVersion}</Badge> : <Badge>No approved version</Badge>}</div>
      </div>
      {f.unpublishedBankChanges && <p role="status" className="small"><b>Unpublished changes.</b> The question bank differs from the live version. New diagnostics still use version {f.currentVersion} until you publish.</p>}
      {!f.isDefault && !f.currentVersion && <p className="small muted">AgriFood360 and ESO360 content is not production-authoritative until the evidence trail is approved and Amin Yahaya signs it off. New diagnostics for these organisation types use the baseline framework until then.</p>}
      {f.versions.length === 0 ? <Empty title="No versions yet" /> : <div className="table-wrap"><table>
        <thead><tr><th>Version</th><th>Status</th><th>Questions</th><th>Evidence trail</th><th>Published</th>{(canEdit || canApprove) && <th>Actions</th>}</tr></thead>
        <tbody>{f.versions.map((v) => <tr key={v.id}><td className="num">{v.version}</td><td><Badge tone={tone(v.status)}>{v.status}</Badge></td><td className="num">{v.questions}</td><td>{v.sources ? `${v.sourcesApproved} of ${v.sources} approved` : 'None'}</td><td>{v.publishedAt ? dateFmt(v.publishedAt) : 'Not published'}</td>
          {(canEdit || canApprove) && <td>{v.status === 'Draft' && <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {canApprove && <Publish v={v} reload={st.reload} />}
            {canEdit && <ConfirmButton size="sm" label="Discard" variant="danger" message={`Discard draft version ${v.version}?`} onConfirm={() => api.del(`/settings/frameworks/versions/${v.id}`).then(st.reload)} />}</span>}</td>}
        </tr>)}</tbody></table></div>}
      {canCreate && f.isDefault && !f.versions.some((v) => v.status === 'Draft') && <div><Button size="sm" onClick={() => draftFromBank(f.code)}>Create draft from question bank</Button></div>}
    </section>)}</>}</Async>
  </div>;
}
