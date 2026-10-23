'use client';
import { useState } from 'react';
import { api, dateFmt, ghs } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Field, FormError, KV, useApi, useForm, useToast } from '@/components/ui';

type Version = {
  id: string; version: number; status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
  name: string; funder: string | null; startDate: string | null; endDate: string | null; budgetGhs: number | null;
  changeReason: string | null; rejectionReason: string | null; approvedAt: string | null;
};
type Current = { version: Version | null; governanceStatus: string };

const statusTone = (s: Version['status']) => (s === 'APPROVED' ? 'ok' : s === 'REJECTED' ? 'bad' : s === 'SUPERSEDED' ? '' : 'info');

function DraftForm({ programmeId, base, onDone, onCancel }: { programmeId: string; base?: Version; onDone: () => void; onCancel: () => void }) {
  const f = useForm({
    name: base?.name ?? '', funder: base?.funder ?? '', startDate: base?.startDate ?? '', endDate: base?.endDate ?? '',
    budgetGhs: base?.budgetGhs != null ? String(base.budgetGhs) : '', changeReason: ''
  }, (v) => api.post(`/programmes/${programmeId}/versions`, {
    name: v.name.trim() || undefined, funder: v.funder.trim() || null, startDate: v.startDate || null, endDate: v.endDate || null,
    budgetGhs: v.budgetGhs.trim() === '' ? null : Number(v.budgetGhs), changeReason: v.changeReason.trim() || undefined
  }), { onDone, success: 'Version draft created' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Create a version draft"><FormError message={f.formError} />
    <p className="small muted">A draft of the programme's core definition. Nothing changes on the live programme until this version is submitted and approved.</p>
    <div className="form-grid">
      <Field label="Name" name="name" error={f.errors.name}>{(p) => <input {...p} {...f.input('name')} maxLength={200} />}</Field>
      <Field label="Funder" name="funder" error={f.errors.funder}>{(p) => <input {...p} {...f.input('funder')} maxLength={200} />}</Field>
      <Field label="Start date" name="startDate" error={f.errors.startDate}>{(p) => <input {...p} {...f.input('startDate')} type="date" />}</Field>
      <Field label="End date" name="endDate" error={f.errors.endDate}>{(p) => <input {...p} {...f.input('endDate')} type="date" />}</Field>
      <Field label="Budget (GHS)" name="budgetGhs" error={f.errors.budgetGhs}>{(p) => <input {...p} {...f.input('budgetGhs')} inputMode="decimal" />}</Field>
    </div>
    <Field label="Reason for this change" name="changeReason" hint="Optional, shown alongside the draft.">{(p) => <textarea {...p} {...f.input('changeReason')} rows={2} maxLength={1000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save draft</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function RejectForm({ programmeId, version, onDone, onCancel }: { programmeId: string; version: number; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ reason: '' }, (v) => api.post(`/programmes/${programmeId}/versions/${version}/reject`, { reason: v.reason.trim() }), { onDone, success: 'Version rejected' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label={`Reject version ${version}`}><FormError message={f.formError} />
    <Field label="Reason for rejection" name="reason" error={f.errors.reason}>{(p) => <textarea {...p} {...f.input('reason')} rows={2} maxLength={1000} />}</Field>
    <div className="form-actions"><Button variant="danger" type="submit" loading={f.busy}>Reject</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

/** Programme version control: a formal draft -> submit -> approve/reject -> revise lifecycle for the programme's own core definition, separate from workspace configuration versioning. */
export function VersionsPanel({ programmeId, canEdit, canApprove }: { programmeId: string; canEdit: boolean; canApprove: boolean }) {
  const current = useApi<Current>(`/programmes/${programmeId}/version`);
  const list = useApi<Version[]>(`/programmes/${programmeId}/versions`);
  const toast = useToast();
  const [mode, setMode] = useState<null | 'draft' | string>(null);
  const done = () => { setMode(null); current.reload(); list.reload(); };
  const rows = list.data ?? [];
  const latest = rows[0];
  const canDraft = canEdit && (!latest || ['APPROVED', 'REJECTED', 'SUPERSEDED'].includes(latest.status));
  const reviseBase = rows.find((r) => r.status === 'REJECTED' && r.id === latest?.id);

  return <div className="stack">
    <Async state={current}>{(c) => <Card title="Current approved version">
      {c.version ? <KV items={[['Version', `v${c.version.version}`], ['Name', c.version.name], ['Funder', c.version.funder ?? '-'], ['Start date', dateFmt(c.version.startDate)], ['End date', dateFmt(c.version.endDate)], ['Budget', ghs(c.version.budgetGhs)], ['Approved', dateFmt(c.version.approvedAt)]]} /> :
        <Empty title="No approved version yet" hint="This programme's definition has not been through the version-approval workflow." />}
    </Card>}</Async>
    <Card title="Version history" actions={canDraft && mode !== 'draft' ? <Button variant="primary" onClick={() => setMode('draft')}>{reviseBase ? 'Revise rejected draft' : 'New draft'}</Button> : undefined}>
      {mode === 'draft' && <DraftForm programmeId={programmeId} base={reviseBase} onDone={done} onCancel={() => setMode(null)} />}
      <Async state={list}>{() => rows.length === 0 ? <Empty title="No versions yet" /> :
        <div className="table-wrap"><table><thead><tr><th>Version</th><th>Status</th><th>Name</th><th className="r">Budget</th><th>Reason</th>{(canEdit || canApprove) && <th><span className="sr">Actions</span></th>}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}>
            <td className="num">v{r.version}</td>
            <td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
            <td>{r.name}</td>
            <td className="r num">{ghs(r.budgetGhs)}</td>
            <td className="small muted">{r.status === 'REJECTED' ? r.rejectionReason : r.changeReason ?? '-'}</td>
            {(canEdit || canApprove) && <td><div className="row" style={{ gap: 6 }}>
              {canEdit && r.status === 'DRAFT' && <ConfirmButton size="sm" variant="primary" label="Submit" message={`Submit version v${r.version} for approval?`} onConfirm={async () => { await api.post(`/programmes/${programmeId}/versions/${r.version}/submit`, {}); toast('Version submitted'); done(); }} />}
              {canApprove && r.status === 'SUBMITTED' && <>
                <ConfirmButton size="sm" variant="primary" label="Approve" message={`Approve version v${r.version}? This becomes the programme's live definition.`} onConfirm={async () => { await api.post(`/programmes/${programmeId}/versions/${r.version}/approve`, {}); toast('Version approved'); done(); }} />
                {mode === r.id ? null : <Button size="sm" onClick={() => setMode(r.id)}>Reject</Button>}
              </>}
            </div></td>}
          </tr>)}</tbody></table></div>}
      </Async>
      {rows.filter((r) => r.id === mode).map((r) => <RejectForm key={r.id} programmeId={programmeId} version={r.version} onDone={done} onCancel={() => setMode(null)} />)}
    </Card>
  </div>;
}
