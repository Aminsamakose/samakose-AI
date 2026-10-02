'use client';
import { useMemo, useRef, useState } from 'react';
import { api, dateFmt, errText } from '@/lib/client/api';
import { Async, Badge, Button, Modal, useApi, useToast } from '@/components/ui';

type Src = { component: string; source: string; rationale: string; adaptation: string; approval: 'Proposed' | 'Approved' | 'Rejected'; approvedAt?: string | null };
type Q = { code: string; dimension: string; text: string; weight: number; subDimension?: string; criticality?: string; readiness?: string[]; applies?: string };
type Meta = { subDimensions?: { code: string; name: string }[]; readiness?: { code: string; name: string; purpose?: string }[]; consistencyChecks?: unknown[] };
type Detail = { id: string; version: number; status: string; questions: Q[]; dimensions: string[]; sources: Src[]; meta: Meta | null; note: string | null; framework: { code: string; name: string } };
const ATONE: Record<string, string> = { Approved: 'ok', Rejected: 'bad', Proposed: 'warn' };

/** What a version contains and its evidence trail. Approving a source is a sign-off and is recorded with the date and the approver. */
export function ReviewVersion({ id, label, canEdit, canApprove, onChanged }: { id: string; label: string; canEdit: boolean; canApprove: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false); const changed = useRef(false);
  // The list behind the dialog refreshes when the dialog closes, so the dialog is not unmounted while someone is working in it.
  const close = () => { setOpen(false); if (changed.current) { changed.current = false; onChanged(); } };
  return <>
    <Button size="sm" onClick={() => setOpen(true)}>Review</Button>
    <Modal open={open} onClose={close} title={label}>
      {open && <Body id={id} canEdit={canEdit} canApprove={canApprove} onChanged={() => { changed.current = true; }} />}
    </Modal>
  </>;
}

function Body({ id, canEdit, canApprove, onChanged }: { id: string; canEdit: boolean; canApprove: boolean; onChanged: () => void }) {
  const st = useApi<Detail>(`/settings/frameworks/versions/${id}`);
  return <Async state={st}>{(d) => <Inner d={d} canEdit={canEdit} canApprove={canApprove} reload={() => { st.reload(); onChanged(); }} />}</Async>;
}

function Inner({ d, canEdit, canApprove, reload }: { d: Detail; canEdit: boolean; canApprove: boolean; reload: () => void }) {
  const toast = useToast(); const [busy, setBusy] = useState(false); const [confirmAll, setConfirmAll] = useState(false);
  const draft = d.status === 'Draft';
  const stat = useMemo(() => {
    const gates = d.questions.filter((q) => q.criticality === 'Gate').length, cond = d.questions.filter((q) => q.applies && q.applies.toLowerCase() !== 'all').length;
    const byDim = d.dimensions.map((x) => ({ name: x, n: d.questions.filter((q) => q.dimension === x).length, w: d.questions.filter((q) => q.dimension === x).reduce((a, q) => a + q.weight, 0) }));
    const total = byDim.reduce((a, x) => a + x.w, 0) || 1;
    return { gates, cond, byDim, total };
  }, [d]);
  const setApproval = async (idx: number[], approval: Src['approval']) => {
    setBusy(true);
    try {
      const sources = d.sources.map((s, i) => ({ component: s.component, source: s.source, rationale: s.rationale, adaptation: s.adaptation, approval: idx.includes(i) ? approval : s.approval }));
      await api.patch(`/settings/frameworks/versions/${d.id}`, { sources });
      toast(idx.length > 1 ? `${idx.length} sources updated` : 'Source updated'); reload();
    } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(false); }
  };
  const proposed = d.sources.map((s, i) => (s.approval === 'Proposed' ? i : -1)).filter((i) => i >= 0);
  return <div className="stack">
    <p className="small muted">{d.framework.name}, version {d.version} ({d.status}). {d.questions.length} questions in {d.dimensions.length} dimensions{d.meta?.subDimensions ? `, ${d.meta.subDimensions.length} sub-dimensions` : ''}. {stat.gates} gate questions, {stat.cond} conditional.</p>
    <div className="table-wrap"><table>
      <caption className="sr">Questions and weight by dimension</caption>
      <thead><tr><th>Dimension</th><th className="r">Questions</th><th className="r">Share of total weight</th></tr></thead>
      <tbody>{stat.byDim.map((x) => <tr key={x.name}><td>{x.name}</td><td className="r num">{x.n}</td><td className="r num">{Math.round((x.w / stat.total) * 100)}%</td></tr>)}</tbody>
    </table></div>
    {d.meta?.readiness && d.meta.readiness.length > 0 && <div>
      <b>Readiness indices</b>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{d.meta.readiness.map((r) => <li key={r.code}><span className="mono">{r.code}</span> {r.name} <span className="muted small">({d.questions.filter((q) => q.readiness?.includes(r.code)).length} questions)</span></li>)}</ul>
    </div>}
    <div>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <b>Evidence trail ({d.sources.filter((s) => s.approval === 'Approved').length} of {d.sources.length} approved)</b>
        {draft && canApprove && proposed.length > 1 && (confirmAll
          ? <div className="callout" role="group" aria-label="Confirm sign-off" style={{ flexBasis: '100%' }}>
            <p className="small" style={{ margin: '0 0 8px' }}>{`This signs off ${proposed.length} sources as the evidence behind this version, in your name and dated today. Only do this after you have read them. You can still reject or withdraw any single source before the version is published.`}</p>
            <div className="row" style={{ gap: 8 }}>
              <Button size="sm" onClick={() => { setConfirmAll(false); setApproval(proposed, 'Approved'); }}>Confirm sign-off</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>Cancel</Button>
            </div>
          </div>
          : <Button size="sm" onClick={() => setConfirmAll(true)}>{`Approve all ${proposed.length} proposed`}</Button>)}
      </div>
      {d.sources.length === 0 ? <p className="small muted">No sources recorded.</p> : <div className="table-wrap" style={{ marginTop: 6 }}><table>
        <caption className="sr">Sources behind this version</caption>
        <thead><tr><th>Component and source</th><th>Why it is used</th><th>Status</th>{draft && canApprove && <th>Sign-off</th>}</tr></thead>
        <tbody>{d.sources.map((s, i) => <tr key={i}>
          <td><b>{s.component}</b><div className="small muted" style={{ overflowWrap: 'anywhere' }}>{s.source}</div></td>
          <td className="small">{s.rationale}</td>
          <td><Badge tone={ATONE[s.approval]}>{s.approval}</Badge>{s.approvedAt && <div className="small muted">{dateFmt(s.approvedAt)}</div>}</td>
          {draft && canApprove && <td><span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {s.approval !== 'Approved' && <Button size="sm" variant="primary" disabled={busy} onClick={() => setApproval([i], 'Approved')}>Approve</Button>}
            {s.approval !== 'Rejected' && <Button size="sm" disabled={busy} onClick={() => setApproval([i], 'Rejected')}>Reject</Button>}
            {s.approval !== 'Proposed' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setApproval([i], 'Proposed')}>Reset</Button>}</span></td>}
        </tr>)}</tbody></table></div>}
      {!draft && <p className="small muted">Published versions are permanent, so their evidence trail cannot be changed.</p>}
      {draft && !canApprove && <p className="small muted">Only an administrator can approve sources.</p>}
    </div>
    {d.note && <p className="small muted">Note: {d.note}</p>}
  </div>;
}

/** Load a bank file (the JSON the bank export produces) as a new draft. Nothing goes live until it is approved and published. */
export function ImportBank({ code, onDone }: { code: string; onDone: () => void }) {
  const toast = useToast(); const ref = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return; setBusy(true);
    try {
      const j = JSON.parse(await f.text());
      if (!Array.isArray(j.questions) || !Array.isArray(j.dimensions)) throw new Error('This file is not a bank export. It needs questions and dimensions.');
      await api.post(`/settings/frameworks/${code}/versions`, { questions: j.questions, dimensions: j.dimensions, rules: j.rules ?? null, sources: j.sources ?? [], meta: j.meta ?? null, note: j.note ?? null });
      toast(`Draft created from ${f.name} with ${j.questions.length} questions`); onDone();
    } catch (e) { toast(e instanceof SyntaxError ? 'The file is not valid JSON' : errText(e), 'bad'); }
    finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return <span>
    <input ref={ref} type="file" accept="application/json,.json" className="sr" id={`imp-${code}`} onChange={(e) => pick(e.target.files?.[0])} />
    <Button size="sm" loading={busy} onClick={() => ref.current?.click()}>Import bank file</Button>
  </span>;
}
