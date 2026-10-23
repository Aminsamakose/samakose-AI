'use client';
import { useState } from 'react';
import { api, dateFmt, errText } from '@/lib/client/api';
import { Async, Badge, Button, ConfirmButton, Empty, useApi, useToast } from '@/components/ui';
import { ImportBank, ReviewVersion } from './FrameworkReview';

type Consistency = { platform: string; completions: number; insufficientData: boolean; minRequired?: number; bandDistribution?: { classification: string; count: number; share: number }[]; dominantBandFlag?: { classification: string; share: number } | null; averagePairwiseCorrelation?: number | null; looksConsistent?: boolean };
type ConvergentPair = { resultId: string; platform: string; freeScore: number; freeClassification: string; orgCode: string; orgName: string; paidOverall: number | null; paidMaturity: string | null };

/** #127: the free assessment's provisional classification bands, surfaced for whoever is deciding whether they're ready to call validated. See that issue for what each step means and the recommended sequencing. */
export function AssessmentValidityPanel({ canEdit }: { canEdit: boolean }) {
  const ic = useApi<Consistency[]>('/settings/frameworks/internal-consistency');
  const cv = useApi<{ pairs: ConvergentPair[]; summary: { matched: number; withPaidScore: number; awaitingDiagnostic: number } }>('/settings/frameworks/convergent-validity');
  const toast = useToast();
  const rematch = async () => { try { const r = await api.post<{ matched: number }>('/settings/frameworks/convergent-validity/match', {}); toast(r.matched ? `${r.matched} new match(es) found` : 'No new matches'); cv.reload(); } catch (e) { toast(errText(e), 'bad'); } };
  return <section className="card stack" aria-label="Free assessment band validation (#127)">
    <div><b>Free assessment band validation</b><br /><span className="small muted">The Critical Attention / Needs Improvement / Developing / Strong Foundation bands are provisional, set by expert judgment. These checks are the cheap, data-available steps toward validating them -- not a verdict on their own.</span></div>
    <h4>Internal consistency (step 1)</h4>
    <Async state={ic} empty={(d) => d.length === 0}>{(list) => <div className="table-wrap"><table>
      <thead><tr><th>Platform</th><th>Completions</th><th>Band distribution</th><th>Avg. dimension correlation</th><th>Read</th></tr></thead>
      <tbody>{list.map((p) => <tr key={p.platform}>
        <td>{p.platform}</td><td className="num">{p.completions}</td>
        <td>{p.insufficientData ? <span className="small muted">Needs {p.minRequired}+ completions (have {p.completions})</span> : p.bandDistribution!.map((b) => `${b.classification}: ${Math.round(b.share * 100)}%`).join(', ')}</td>
        <td className="num">{p.insufficientData ? '—' : p.averagePairwiseCorrelation === null ? '—' : p.averagePairwiseCorrelation!.toFixed(2)}</td>
        <td>{p.insufficientData ? <Badge>Not enough data</Badge> : <Badge tone={p.looksConsistent ? 'ok' : 'warn'}>{p.looksConsistent ? 'Looks consistent' : 'Worth a closer look'}</Badge>}</td>
      </tr>)}</tbody></table></div>}</Async>
    <h4>Convergent validity against the paid diagnostic (step 2)</h4>
    <Async state={cv} empty={(d) => d.pairs.length === 0}>{(d) => <div className="stack">
      <p className="small muted">{d.summary.matched} business(es) matched by email to a free-assessment result; {d.summary.withPaidScore} have also been scored on the paid diagnostic.</p>
      {d.pairs.filter((p) => p.paidOverall !== null).length > 0 && <div className="table-wrap"><table>
        <thead><tr><th>Organisation</th><th>Free band</th><th>Free score</th><th>Paid maturity</th><th>Paid score</th></tr></thead>
        <tbody>{d.pairs.filter((p) => p.paidOverall !== null).map((p) => <tr key={p.resultId}><td>{p.orgName} <span className="mono small">{p.orgCode}</span></td><td>{p.freeClassification}</td><td className="num">{p.freeScore}</td><td>{p.paidMaturity}</td><td className="num">{p.paidOverall}</td></tr>)}</tbody>
      </table></div>}
    </div>}</Async>
    {canEdit && <Button size="sm" onClick={rematch}>Re-run email match</Button>}
  </section>;
}

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
        <thead><tr><th>Version</th><th>Status</th><th>Questions</th><th>Evidence trail</th><th>Published</th><th>Actions</th></tr></thead>
        <tbody>{f.versions.map((v) => <tr key={v.id}><td className="num">{v.version}</td><td><Badge tone={tone(v.status)}>{v.status}</Badge></td><td className="num">{v.questions}</td><td>{v.sources ? `${v.sourcesApproved} of ${v.sources} approved` : 'None'}</td><td>{v.publishedAt ? dateFmt(v.publishedAt) : 'Not published'}</td>
          <td><span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <ReviewVersion id={v.id} label={`${f.name}, version ${v.version}`} canEdit={canEdit} canApprove={canApprove} onChanged={st.reload} />
            {v.status === 'Draft' && canApprove && <Publish v={v} reload={st.reload} />}
            {v.status === 'Draft' && canEdit && <ConfirmButton size="sm" label="Discard" variant="danger" message={`Discard draft version ${v.version}?`} onConfirm={() => api.del(`/settings/frameworks/versions/${v.id}`).then(st.reload)} />}</span></td>
        </tr>)}</tbody></table></div>}
      {canCreate && !f.versions.some((v) => v.status === 'Draft') && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {f.isDefault && <Button size="sm" onClick={() => draftFromBank(f.code)}>Create draft from question bank</Button>}
        <ImportBank code={f.code} onDone={st.reload} /></div>}
    </section>)}</>}</Async>
    <AssessmentValidityPanel canEdit={canEdit} />
  </div>;
}
