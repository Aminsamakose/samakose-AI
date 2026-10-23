'use client';
import { useEffect, useState } from 'react';
import { api, dateFmt, qs } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, KV, useApi, useForm, useToast } from '@/components/ui';

type Definition = { id: string; name: string; unit: string; reportingPeriod: string | null; source: string | null; verificationRequired: boolean };
type Record_ = {
  id: string; caseId: string; baselineValue: number | null; baselineDate: string | null; followupValue: number | null; followupDate: string | null;
  evidenceClass: string; attributionNote: string | null; status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'SUPERSEDED';
  decision: string | null; reason: string | null; supersedesId: string | null;
};
type CaseRow = { id: string; code: string; orgName: string };

const EVIDENCE_CLASSES = ['Verified', 'Document-supported', 'Self-reported', 'Unverified', 'Missing'];
const statusTone = (s: Record_['status']) => (s === 'VERIFIED' ? 'ok' : s === 'REJECTED' ? 'bad' : s === 'SUPERSEDED' ? '' : 'info');

function CaseSelect({ programmeId, value, onChange }: { programmeId: string; value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const st = useApi<{ items: CaseRow[] }>('/cases' + qs({ programmeId, q: dq, pageSize: 50, sort: 'code', dir: 'asc' }));
  const items = st.data?.items ?? [];
  return <div className="stack" style={{ gap: 6 }}>
    <input type="search" aria-label="Search enterprises" placeholder="Search by case code or organisation" value={q} onChange={(e) => setQ(e.target.value)} />
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{st.loading && !st.data ? 'Loading enterprises' : items.length ? 'Choose an enterprise' : 'No enterprises found'}</option>
      {items.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.orgName}</option>)}
    </select>
  </div>;
}

function DefinitionForm({ programmeId, base, onDone, onCancel }: { programmeId: string; base?: Definition; onDone: () => void; onCancel: () => void }) {
  const f: any = useForm({ name: base?.name ?? '', unit: base?.unit ?? '', reportingPeriod: base?.reportingPeriod ?? '', source: base?.source ?? '', verificationRequired: base?.verificationRequired ?? true },
    (v) => base
      ? api.patch(`/outcome-definitions/${base.id}`, { name: v.name.trim(), unit: v.unit.trim(), reportingPeriod: v.reportingPeriod.trim() || null, source: v.source.trim() || null, verificationRequired: v.verificationRequired })
      : api.post(`/programmes/${programmeId}/outcome-definitions`, { name: v.name.trim(), unit: v.unit.trim(), reportingPeriod: v.reportingPeriod.trim() || null, source: v.source.trim() || null, verificationRequired: v.verificationRequired }),
    { onDone, success: base ? 'Outcome definition updated' : 'Outcome definition created' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Define an outcome"><FormError message={f.formError} />
    <p className="small muted">A real-world outcome this programme is funded to produce, measured per enterprise as a baseline and a followup result.</p>
    <div className="form-grid">
      <Field label="Name" name="name" error={f.errors.name}>{(p) => <input {...p} {...f.input('name')} placeholder="For example: Monthly revenue" maxLength={160} />}</Field>
      <Field label="Unit" name="unit" error={f.errors.unit}>{(p) => <input {...p} {...f.input('unit')} placeholder="For example: GHS" maxLength={60} />}</Field>
      <Field label="Reporting period (optional)" name="reportingPeriod">{(p) => <input {...p} {...f.input('reportingPeriod')} placeholder="For example: Quarterly" maxLength={120} />}</Field>
      <Field label="Source (optional)" name="source">{(p) => <input {...p} {...f.input('source')} placeholder="How this is measured" maxLength={200} />}</Field>
    </div>
    <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.verificationRequired} onChange={(e) => f.set('verificationRequired', e.target.checked)} />Results require verification before counting as evidence</label>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{base ? 'Save changes' : 'Define outcome'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function RecordForm({ programmeId, definitionId, onDone, onCancel }: { programmeId: string; definitionId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ caseId: '', baselineValue: '', baselineDate: '', followupValue: '', followupDate: '', evidenceClass: 'Self-reported', attributionNote: '' },
    (v) => api.post(`/outcome-definitions/${definitionId}/records`, {
      caseId: v.caseId, baselineValue: v.baselineValue.trim() === '' ? null : Number(v.baselineValue), baselineDate: v.baselineDate || null,
      followupValue: v.followupValue.trim() === '' ? null : Number(v.followupValue), followupDate: v.followupDate || null,
      evidenceClass: v.evidenceClass, attributionNote: v.attributionNote.trim() || null
    }), { onDone, success: 'Result recorded' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Record a result"><FormError message={f.formError} />
    <Field label="Enterprise" name="caseId" error={f.errors.caseId}>{() => <CaseSelect programmeId={programmeId} value={f.values.caseId} onChange={(v) => f.set('caseId', v)} />}</Field>
    <div className="form-grid">
      <Field label="Baseline value (optional)" name="baselineValue" error={f.errors.baselineValue}>{(p) => <input {...p} {...f.input('baselineValue')} inputMode="decimal" />}</Field>
      <Field label="Baseline date (optional)" name="baselineDate">{(p) => <input {...p} {...f.input('baselineDate')} type="date" />}</Field>
      <Field label="Followup value (optional)" name="followupValue">{(p) => <input {...p} {...f.input('followupValue')} inputMode="decimal" />}</Field>
      <Field label="Followup date (optional)" name="followupDate">{(p) => <input {...p} {...f.input('followupDate')} type="date" />}</Field>
      <Field label="Evidence class" name="evidenceClass">{() => <select value={f.values.evidenceClass} onChange={(e) => f.set('evidenceClass', e.target.value)}>
        {EVIDENCE_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>}</Field>
    </div>
    <Field label="Attribution note (optional)" name="attributionNote">{(p) => <textarea {...p} {...f.input('attributionNote')} rows={2} maxLength={1000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Record result</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function VerifyForm({ record, decision, onDone, onCancel }: { record: Record_; decision: 'VERIFIED' | 'REJECTED'; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ reason: '' }, (v) => api.post(`/outcome-records/${record.id}/verify`, { decision, reason: v.reason.trim() }), { onDone, success: decision === 'VERIFIED' ? 'Result verified' : 'Result rejected' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label={`${decision === 'VERIFIED' ? 'Verify' : 'Reject'} result`}><FormError message={f.formError} />
    <Field label="Reason" name="reason" error={f.errors.reason}>{(p) => <textarea {...p} {...f.input('reason')} rows={2} maxLength={1000} />}</Field>
    <div className="form-actions"><Button variant={decision === 'VERIFIED' ? 'primary' : 'danger'} type="submit" loading={f.busy}>{decision === 'VERIFIED' ? 'Verify' : 'Reject'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function CorrectForm({ programmeId, record, onDone, onCancel }: { programmeId: string; record: Record_; onDone: () => void; onCancel: () => void }) {
  const f = useForm({
    baselineValue: record.baselineValue != null ? String(record.baselineValue) : '', baselineDate: record.baselineDate ?? '',
    followupValue: record.followupValue != null ? String(record.followupValue) : '', followupDate: record.followupDate ?? '',
    evidenceClass: record.evidenceClass, attributionNote: record.attributionNote ?? '', reason: ''
  }, (v) => api.post(`/outcome-records/${record.id}/correct`, {
    baselineValue: v.baselineValue.trim() === '' ? null : Number(v.baselineValue), baselineDate: v.baselineDate || null,
    followupValue: v.followupValue.trim() === '' ? null : Number(v.followupValue), followupDate: v.followupDate || null,
    evidenceClass: v.evidenceClass, attributionNote: v.attributionNote.trim() || null, reason: v.reason.trim()
  }), { onDone, success: 'Result corrected' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Correct a decided result"><FormError message={f.formError} />
    <p className="small muted">The original decided record is kept exactly as it was; a new pending record is created superseding it.</p>
    <div className="form-grid">
      <Field label="Baseline value (optional)" name="baselineValue">{(p) => <input {...p} {...f.input('baselineValue')} inputMode="decimal" />}</Field>
      <Field label="Baseline date (optional)" name="baselineDate">{(p) => <input {...p} {...f.input('baselineDate')} type="date" />}</Field>
      <Field label="Followup value (optional)" name="followupValue">{(p) => <input {...p} {...f.input('followupValue')} inputMode="decimal" />}</Field>
      <Field label="Followup date (optional)" name="followupDate">{(p) => <input {...p} {...f.input('followupDate')} type="date" />}</Field>
      <Field label="Evidence class" name="evidenceClass">{() => <select value={f.values.evidenceClass} onChange={(e) => f.set('evidenceClass', e.target.value)}>
        {EVIDENCE_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>}</Field>
    </div>
    <Field label="Reason for correction" name="reason" error={f.errors.reason}>{(p) => <textarea {...p} {...f.input('reason')} rows={2} maxLength={1000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Correct</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function RecordsSection({ programmeId, def, canEdit }: { programmeId: string; def: Definition; canEdit: boolean }) {
  const recs = useApi<Record_[]>(`/outcome-definitions/${def.id}/records`);
  const [mode, setMode] = useState<null | 'new' | string>(null);
  const done = () => { setMode(null); recs.reload(); };
  const rows = recs.data ?? [];
  return <Card title={`Results — ${def.name}`} actions={canEdit && mode !== 'new' ? <Button onClick={() => setMode('new')}>Record result</Button> : undefined}>
    {mode === 'new' && <RecordForm programmeId={programmeId} definitionId={def.id} onDone={done} onCancel={() => setMode(null)} />}
    <Async state={recs}>{() => rows.length === 0 ? <Empty title="No results recorded" hint={canEdit ? `Record each enterprise's baseline and/or followup ${def.unit} result.` : undefined} /> :
      <div className="table-wrap"><table><thead><tr><th>Baseline</th><th>Followup</th><th>Evidence</th><th>Status</th><th>Reason</th>{canEdit && <th><span className="sr">Actions</span></th>}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td>{r.baselineValue ?? '-'}{r.baselineDate ? ` (${dateFmt(r.baselineDate)})` : ''}</td>
          <td>{r.followupValue ?? '-'}{r.followupDate ? ` (${dateFmt(r.followupDate)})` : ''}</td>
          <td>{r.evidenceClass}</td>
          <td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
          <td className="small muted">{r.reason ?? '-'}</td>
          {canEdit && <td><div className="row" style={{ gap: 6 }}>
            {r.status === 'PENDING' && mode !== `v${r.id}` && mode !== `r${r.id}` && <>
              <Button size="sm" variant="primary" onClick={() => setMode(`v${r.id}`)}>Verify</Button>
              <Button size="sm" onClick={() => setMode(`r${r.id}`)}>Reject</Button>
            </>}
            {r.status !== 'PENDING' && r.status !== 'SUPERSEDED' && mode !== `c${r.id}` && <Button size="sm" onClick={() => setMode(`c${r.id}`)}>Correct</Button>}
          </div></td>}
        </tr>)}</tbody></table></div>}
    </Async>
    {rows.filter((r) => mode === `v${r.id}`).map((r) => <VerifyForm key={r.id} record={r} decision="VERIFIED" onDone={done} onCancel={() => setMode(null)} />)}
    {rows.filter((r) => mode === `r${r.id}`).map((r) => <VerifyForm key={r.id} record={r} decision="REJECTED" onDone={done} onCancel={() => setMode(null)} />)}
    {rows.filter((r) => mode === `c${r.id}`).map((r) => <CorrectForm key={r.id} programmeId={programmeId} record={r} onDone={done} onCancel={() => setMode(null)} />)}
  </Card>;
}

/** Donor-facing outcome verification: define a funded real-world outcome, record baseline/followup results per enterprise, and verify, reject or correct them -- distinct from the KPI/indicators panel. */
export function OutcomesPanel({ programmeId, canEdit }: { programmeId: string; canEdit: boolean }) {
  const defs = useApi<Definition[]>(`/programmes/${programmeId}/outcome-definitions`);
  const toast = useToast();
  const [mode, setMode] = useState<null | 'new' | string>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const done = () => { setMode(null); defs.reload(); };
  const rows = defs.data ?? [];

  return <div className="stack">
    <Card title="Outcome definitions" actions={canEdit && mode !== 'new' ? <Button variant="primary" onClick={() => setMode('new')}>Define outcome</Button> : undefined}>
      {mode === 'new' && <DefinitionForm programmeId={programmeId} onDone={done} onCancel={() => setMode(null)} />}
      <Async state={defs}>{() => rows.length === 0 ? <Empty title="No outcomes defined" hint={canEdit ? 'Define the real-world outcomes this programme is funded to produce.' : undefined} /> :
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Unit</th><th>Reporting period</th><th>Verification</th>{canEdit && <th><span className="sr">Actions</span></th>}</tr></thead>
          <tbody>{rows.map((d) => <tr key={d.id} aria-selected={selected === d.id}>
            <td><Button size="sm" onClick={() => setSelected(selected === d.id ? null : d.id)}>{selected === d.id ? '▾ ' : '▸ '}{d.name}</Button></td>
            <td>{d.unit}</td>
            <td>{d.reportingPeriod ?? '-'}</td>
            <td>{d.verificationRequired ? <Badge tone="info">Required</Badge> : <Badge>Not required</Badge>}</td>
            {canEdit && <td><div className="row" style={{ gap: 6 }}>
              {mode !== `e${d.id}` && <Button size="sm" onClick={() => setMode(`e${d.id}`)}>Edit</Button>}
              <ConfirmButton size="sm" label="Remove" message={`Remove the outcome definition "${d.name}"? Only possible if it has no recorded results.`} onConfirm={async () => { try { await api.del(`/outcome-definitions/${d.id}`); toast('Outcome definition removed'); defs.reload(); } catch (e) { toast(String((e as any)?.message ?? e)); } }} />
            </div></td>}
          </tr>)}</tbody></table></div>}
      </Async>
      {rows.filter((d) => mode === `e${d.id}`).map((d) => <DefinitionForm key={d.id} programmeId={programmeId} base={d} onDone={done} onCancel={() => setMode(null)} />)}
    </Card>
    {selected && rows.filter((d) => d.id === selected).map((d) => <RecordsSection key={d.id} programmeId={programmeId} def={d} canEdit={canEdit} />)}
  </div>;
}
