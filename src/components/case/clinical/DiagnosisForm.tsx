'use client';
import { ApiFail, api } from '@/lib/client/api';
import { Button, Field, FormError, useForm, useApi } from '@/components/ui';
import { ErrorList } from './common';

export type Diagnosis = {
  id: string; code: string; version: number; status: string; summary: string; priority: string; current: boolean; aiDrafted: boolean; createdAt: string;
  rootCauses: { cause: string; evidence_ids: string[] }[]; risks: { text: string; severity: string }[]; modelConfidence: string | null;
};
type Ev = { id: string; code: string; class: string; description: string };
type V = { summary: string; priority: string; rootCauses: { cause: string; evidence_ids: string[] }[]; risks: { text: string; severity: string }[] };

/** Create a diagnosis by hand (no `from`) or save an edited copy as a new version (`from` set). */
export default function DiagnosisForm({ caseId, from, onDone, onCancel }: { caseId: string; from?: Diagnosis; onDone: () => void; onCancel: () => void }) {
  const evidence = useApi<Ev[]>(`/cases/${caseId}/evidence`);
  const f = useForm<V>({
    summary: from?.summary ?? '', priority: from?.priority ?? 'Medium',
    rootCauses: from?.rootCauses.map((r) => ({ ...r })) ?? [{ cause: '', evidence_ids: [] }],
    risks: from?.risks.map((r) => ({ ...r })) ?? []
  }, async (v) => {
    const e: Record<string, string> = {};
    if (v.summary.trim().length < 20) e.summary = 'Write at least 20 characters';
    v.rootCauses.forEach((r, i) => { if (r.cause.trim().length < 3) e[`cause${i}`] = 'Describe the cause'; else if (!r.evidence_ids.length) e[`cause${i}`] = 'Tick at least one evidence item'; });
    v.risks.forEach((r, i) => { if (r.text.trim().length < 3) e[`risk${i}`] = 'Describe the risk or remove it'; });
    if (Object.keys(e).length) throw new ApiFail(400, 'validation_failed', 'Please fix the highlighted fields', e);
    return from ? api.post(`/diagnoses/${from.id}/revise`, v) : api.post(`/cases/${caseId}/diagnoses`, v);
  }, { success: from ? 'New version saved' : 'Diagnosis saved', onDone });
  const v = f.values;
  const setRc = (i: number, patch: Partial<V['rootCauses'][number]>) => f.set('rootCauses', v.rootCauses.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setRisk = (i: number, patch: Partial<V['risks'][number]>) => f.set('risks', v.risks.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <Field label="Summary" name="summary" required error={f.errors.summary} hint="What is wrong and why, in plain language.">{(p) => <textarea {...p} rows={4} value={f.values.summary} onChange={(e) => f.set('summary', e.target.value)} />}</Field>
    <Field label="Priority" name="priority">{(p) => <select {...p} value={f.values.priority} onChange={(e) => f.set('priority', e.target.value)}><option>High</option><option>Medium</option><option>Low</option></select>}</Field>
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend><strong>Root causes</strong></legend>
      {v.rootCauses.map((r, i) => <div key={i} className="card stack" style={{ padding: 12 }}>
        <Field label={`Cause ${i + 1}`} name={`cause${i}`} required error={f.errors[`cause${i}`]}>{(p) => <input {...p} value={r.cause} onChange={(e) => setRc(i, { cause: e.target.value })} />}</Field>
        <div role="group" aria-label={`Evidence for cause ${i + 1}`}>
          <span className="small muted">Evidence supporting this cause</span>
          {evidence.loading ? <p className="small muted">Loading evidence</p> : evidence.error ? <p className="small">{evidence.error}</p> : !evidence.data?.length ? <p className="small">This case has no evidence yet. Add evidence first.</p> :
            <div className="stack" style={{ gap: 4 }}>{evidence.data.map((e) => <label key={e.id} className="row small" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <input type="checkbox" style={{ width: 'auto', minHeight: 0, marginTop: 4 }} checked={r.evidence_ids.includes(e.code)} onChange={(x) => setRc(i, { evidence_ids: x.target.checked ? [...r.evidence_ids, e.code] : r.evidence_ids.filter((c) => c !== e.code) })} />
              <span><span className="mono">{e.code}</span> ({e.class}) {e.description}</span></label>)}</div>}
        </div>
        {v.rootCauses.length > 1 && <div><Button size="sm" type="button" onClick={() => f.set('rootCauses', v.rootCauses.filter((_, j) => j !== i))}>Remove cause {i + 1}</Button></div>}
      </div>)}
      {v.rootCauses.length < 10 && <div><Button size="sm" type="button" onClick={() => f.set('rootCauses', [...v.rootCauses, { cause: '', evidence_ids: [] }])}>Add a cause</Button></div>}
    </fieldset>
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend><strong>Risks</strong></legend>
      {v.risks.map((r, i) => <div key={i} className="form-grid" style={{ alignItems: 'end' }}>
        <Field label={`Risk ${i + 1}`} name={`risk${i}`} error={f.errors[`risk${i}`]}>{(p) => <input {...p} value={r.text} onChange={(e) => setRisk(i, { text: e.target.value })} />}</Field>
        <Field label="Severity" name={`sev${i}`}>{(p) => <select {...p} value={r.severity} onChange={(e) => setRisk(i, { severity: e.target.value })}><option>High</option><option>Medium</option><option>Low</option></select>}</Field>
        <div><Button size="sm" type="button" onClick={() => f.set('risks', v.risks.filter((_, j) => j !== i))}>Remove risk {i + 1}</Button></div>
      </div>)}
      {v.risks.length < 20 && <div><Button size="sm" type="button" onClick={() => f.set('risks', [...v.risks, { text: '', severity: 'Medium' }])}>Add a risk</Button></div>}
    </fieldset>
    <ErrorList errors={f.errors} skip={['summary', ...v.rootCauses.map((_, i) => `cause${i}`), ...v.risks.map((_, i) => `risk${i}`)]} />
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{from ? 'Save as new version' : 'Save diagnosis'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
