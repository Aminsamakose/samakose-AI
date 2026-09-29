'use client';
import { useState } from 'react';
import { api, dateTime } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Modal, useApi, useToast } from '@/components/ui';
import type { TabProps } from './types';
import { JobStatus, sevTone, useJob, useMe } from './clinical/common';
import DiagnosisForm, { type Diagnosis } from './clinical/DiagnosisForm';
import ReasonModal from './clinical/ReasonModal';

const statusLabel = (s: string) => (s === 'Reviewed' ? 'Approved' : s === 'Rejected' ? 'Rejected' : 'Draft');
const statusTone = (s: string) => (s === 'Reviewed' ? 'ok' : s === 'Rejected' ? 'bad' : '');

export default function TabDiagnosis({ caseId, caseData, reload }: TabProps) {
  const list = useApi<Diagnosis[]>(`/cases/${caseId}/diagnoses`);
  const { can } = useMe();
  const toast = useToast();
  const [form, setForm] = useState<{ from?: Diagnosis } | null>(null);
  const refresh = () => { list.reload(); reload(); };
  const job = useJob(refresh);
  const canCreate = can('diagnoses', 'create'), canEdit = can('diagnoses', 'edit');
  const scored = !!caseData.score;
  const generate = () => job.start(`/cases/${caseId}/diagnoses/generate`);

  return <div className="stack">
    <Card title="Diagnosis" actions={canCreate && <>
      <Button variant="primary" size="sm" onClick={generate} loading={job.running} disabled={!scored}>Generate draft</Button>
      <Button size="sm" onClick={() => setForm({})} disabled={!scored}>Write by hand</Button>
    </>}>
      <p className="muted">The diagnosis explains the weakest areas and their root causes, each tied to evidence. A draft must be approved before a prescription can be written.</p>
      {canCreate && !scored && <div className="alert warn" style={{ marginTop: 10 }}>Score the diagnostic first. A diagnosis is built from the score.</div>}
      <div style={{ marginTop: 10 }}><JobStatus job={job} label="The diagnosis draft" retry={generate} /></div>
    </Card>
    <Async state={list}>{(rows) => {
      if (!rows.length) return <Empty title="No diagnosis yet" hint={canCreate ? 'Generate a draft or write one by hand.' : 'Your consultant will add this after the diagnostic is scored.'} />;
      const [cur, ...older] = rows;
      return <>
        <Version d={cur} headline>
          {canEdit && cur.status === 'Draft' && <div className="form-actions">
            <ConfirmButton variant="primary" size="sm" label="Approve diagnosis" message="Approving confirms the root causes and lets you write the prescription. Continue?" onConfirm={async () => { await api.post(`/diagnoses/${cur.id}/review`, { decision: 'Reviewed' }); toast('Diagnosis approved'); refresh(); }} />
            <ReasonModal label="Reject diagnosis" prompt="Say what is wrong so the next version can fix it." fieldLabel="Reason for rejecting" submit={(note) => api.post(`/diagnoses/${cur.id}/review`, { decision: 'Rejected', note })} onDone={refresh} success="Diagnosis rejected" />
          </div>}
          {canCreate && cur.status !== 'Draft' && <p className="small muted">{cur.status === 'Reviewed' ? 'This version is approved. Writing a new version replaces it and needs a fresh approval.' : 'This version was rejected. Generate or write a new one.'}</p>}
          {canEdit && cur.status !== 'Reviewed' && <div className="form-actions"><Button size="sm" onClick={() => setForm({ from: cur })}>Edit as new version</Button></div>}
        </Version>
        {older.length > 0 && <Card title="Earlier versions">
          <div className="stack">{older.map((d) => <details key={d.id}><summary>Version {d.version} <Badge tone={statusTone(d.status)}>{statusLabel(d.status)}</Badge> <span className="small muted">{dateTime(d.createdAt)}</span></summary><Version d={d} /></details>)}</div>
        </Card>}
      </>;
    }}</Async>
    <Modal open={!!form} onClose={() => setForm(null)} title={form?.from ? `Edit version ${form.from.version}` : 'Write a diagnosis'}>
      {form && <DiagnosisForm caseId={caseId} from={form.from} onCancel={() => setForm(null)} onDone={() => { setForm(null); refresh(); }} />}
    </Modal>
  </div>;
}

function Version({ d, headline, children }: { d: Diagnosis; headline?: boolean; children?: React.ReactNode }) {
  const body = <div className="stack">
    <div className="row">
      <Badge tone={statusTone(d.status)}>{statusLabel(d.status)}</Badge>
      <Badge tone={sevTone(d.priority)}>{d.priority} priority</Badge>
      <Badge tone={d.aiDrafted ? 'info' : ''}>{d.aiDrafted ? 'AI drafted' : 'Written by a person'}</Badge>
      {d.modelConfidence !== null && d.aiDrafted && <span className="small muted">Model confidence {Math.round(Number(d.modelConfidence) * 100)}%</span>}
      <span className="small muted">Version {d.version}, {d.code}, {dateTime(d.createdAt)}</span>
    </div>
    <p style={{ whiteSpace: 'pre-wrap' }}>{d.summary}</p>
    <div><h3 style={{ fontSize: '1rem' }}>Root causes and evidence</h3>
      <ol className="stack" style={{ margin: '6px 0 0', paddingLeft: 20 }}>{d.rootCauses.map((r, i) => <li key={i}>{r.cause}<div className="small muted">Evidence: {r.evidence_ids.map((e) => <span key={e} className="mono" style={{ marginRight: 8 }}>{e}</span>)}</div></li>)}</ol></div>
    {d.risks.length > 0 && <div><h3 style={{ fontSize: '1rem' }}>Risks noted</h3>
      <ul className="stack" style={{ margin: '6px 0 0', paddingLeft: 20 }}>{d.risks.map((r, i) => <li key={i}>{r.text} <Badge tone={sevTone(r.severity)}>{r.severity}</Badge></li>)}</ul></div>}
    {children}
  </div>;
  return headline ? <Card title="Current version">{body}</Card> : <div style={{ marginTop: 10 }}>{body}</div>;
}
