'use client';
import { useState } from 'react';
import { api, dateTime } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Modal, useApi, useToast } from '@/components/ui';
import type { TabProps } from './types';
import { JobStatus, rxLabel, rxTone, useJob, useMe } from './clinical/common';
import PrescriptionForm, { type Lib, type Rx } from './clinical/PrescriptionForm';
import ReasonModal from './clinical/ReasonModal';

const FLOW = ['DRAFT', 'IN REVIEW', 'APPROVED'];

export default function TabPrescription({ caseId, caseData, reload }: TabProps) {
  const list = useApi<Rx[]>(`/cases/${caseId}/prescriptions`);
  const diagnoses = useApi<{ status: string }[]>(`/cases/${caseId}/diagnoses`);
  const { me, ready, can } = useMe();
  const library = useApi<Lib[]>(ready && can('settings', 'read') ? '/settings/library' : null);
  const toast = useToast();
  const [form, setForm] = useState<{ from?: Rx } | null>(null);
  const refresh = () => { list.reload(); reload(); };
  const job = useJob(refresh);
  const canCreate = can('prescriptions', 'create'), canEdit = can('prescriptions', 'edit'), canApprove = can('prescriptions', 'approve');
  const diagApproved = diagnoses.data?.[0]?.status === 'Reviewed';
  const generate = () => job.start(`/cases/${caseId}/prescriptions/generate`);
  const cur = list.data?.[0];
  const open = cur && ['DRAFT', 'IN REVIEW', 'RETURNED'].includes(cur.status);

  /** Four-eyes: the assigned reviewer, who did not write the work and is not the consultant. */
  const blockReason = (r: Rx) => {
    if (!me) return null;
    if (caseData.reviewerId !== me.id) return 'Only the reviewer assigned to this case can approve or return a prescription.';
    if (r.createdBy === me.id || caseData.consultantId === me.id) return 'You wrote this work or are responsible for the case, so someone else must review it (four-eyes rule).';
    return null;
  };

  return <div className="stack">
    <Card title="Prescription" actions={canCreate && (!cur || !open) && <>
      <Button variant="primary" size="sm" onClick={generate} loading={job.running} disabled={!diagApproved}>Generate draft</Button>
      {library.data && <Button size="sm" onClick={() => setForm({})} disabled={!diagApproved}>Write by hand</Button>}
    </>}>
      <p className="muted">A prescription picks interventions from the approved library and sets actions with owners and deadlines. It moves from draft to review to approved. <strong>When it is approved, its interventions become actions with owners and due dates, and indicators to watch.</strong></p>
      {canCreate && !diagApproved && !diagnoses.loading && <div className="alert warn" style={{ marginTop: 10 }}>Approve the diagnosis first. A prescription is written from an approved diagnosis.</div>}
      <div style={{ marginTop: 10 }}><JobStatus job={job} label="The prescription draft" retry={generate} /></div>
    </Card>
    <Async state={list}>{(rows) => {
      if (!rows.length) return <Empty title="No prescription yet" hint={canCreate ? 'Generate a draft once the diagnosis is approved.' : 'Your adviser will share the plan here once it is approved.'} />;
      const [c, ...older] = rows;
      const block = blockReason(c);
      return <>
        <Card title="Current version" actions={<Badge tone={rxTone(c.status)}>{rxLabel(c.status)}</Badge>}>
          <ol className="row" style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }} aria-label="Approval flow">
            {FLOW.map((s, i) => <li key={s} aria-current={c.status === s || (c.status === 'RETURNED' && s === 'DRAFT') ? 'step' : undefined} className="row" style={{ gap: 6 }}>
              <Badge tone={c.status === s ? rxTone(s) || 'brand' : ''}>{i + 1}. {rxLabel(s)}{c.status === s ? ' (now)' : ''}</Badge>{i < 2 && <span aria-hidden className="muted">{'>'}</span>}</li>)}
            {c.status === 'RETURNED' && <li><Badge tone="warn">Returned for changes (now)</Badge></li>}
          </ol>
          <Items rx={c} />
          {c.status === 'RETURNED' && c.reviewerNote && <div className="alert warn" style={{ marginTop: 10 }}><strong>Reviewer said:</strong> {c.reviewerNote}</div>}
          {c.status === 'APPROVED' && <div className="alert ok" style={{ marginTop: 10 }}>Approved. These interventions were turned into actions and indicators. See the Actions and KPIs tabs.</div>}
          {c.status === 'IN REVIEW' && (canApprove
            ? (block ? <div className="alert info" style={{ marginTop: 10 }}>{block}</div> :
              <div className="form-actions">
                <ConfirmButton variant="primary" size="sm" label="Approve prescription" message="Approving turns every intervention into actions with owners and due dates. This cannot be undone. Continue?" onConfirm={async () => { await api.post(`/prescriptions/${c.id}/review`, { decision: 'APPROVED' }); toast('Prescription approved. Actions were created.'); refresh(); }} />
                <ReasonModal label="Return for changes" prompt="Say what must change. The consultant will see this." fieldLabel="What must change" submit={(reason) => api.post(`/prescriptions/${c.id}/review`, { decision: 'RETURNED', reason })} onDone={refresh} success="Prescription returned" />
              </div>)
            : <div className="alert info" style={{ marginTop: 10 }}>Waiting for the case reviewer. Reviewers cannot approve work they wrote or are responsible for, so a second person always checks it.</div>)}
          {canEdit && (c.status === 'DRAFT' || c.status === 'RETURNED') && <div className="form-actions">
            <ConfirmButton variant="primary" size="sm" label="Send for review" message="Send this version to the reviewer? You cannot edit it while it is in review." onConfirm={async () => { await api.post(`/prescriptions/${c.id}/submit`); toast('Sent to the reviewer'); refresh(); }} />
            <Button size="sm" onClick={() => setForm({ from: c })}>Edit as new version</Button>
          </div>}
          <p className="small muted" style={{ marginTop: 10 }}>Version {c.version}, {c.code}, {c.aiDrafted ? 'AI drafted' : 'written by a person'}, {dateTime(c.createdAt)}</p>
        </Card>
        {older.length > 0 && <Card title="Earlier versions"><div className="stack">{older.map((r) => <details key={r.id}><summary>Version {r.version} <Badge tone={rxTone(r.status)}>{rxLabel(r.status)}</Badge> <span className="small muted">{dateTime(r.createdAt)}</span></summary>
          <div style={{ marginTop: 8 }}><Items rx={r} />{r.reviewerNote && <p className="small" style={{ marginTop: 6 }}>Reviewer note: {r.reviewerNote}</p>}</div></details>)}</div></Card>}
      </>;
    }}</Async>
    <Modal open={!!form} onClose={() => setForm(null)} title={form?.from ? `Edit version ${form.from.version}` : 'Write a prescription'}>
      {form && <PrescriptionForm caseId={caseId} from={form.from} library={library.data} onCancel={() => setForm(null)} onDone={() => { setForm(null); refresh(); }} />}
    </Modal>
  </div>;
}

const OWNER_LABEL: Record<string, string> = { OWNER: 'Business owner', COACH: 'Coach', CONSULTANT: 'Consultant' };
function Items({ rx }: { rx: Rx }) {
  return <div className="stack">{rx.items.map((it, i) => <div key={i} className="stack" style={{ gap: 4 }}>
    <h3 style={{ fontSize: '1rem' }}><span className="mono">{it.library_id}</span> {it.title}{it.dimension && <span className="small muted"> ({it.dimension})</span>}</h3>
    <div className="table-wrap"><table><thead><tr><th>Action</th><th>Owner</th><th className="r">Days</th></tr></thead>
      <tbody>{it.actions.map((a, j) => <tr key={j}><td>{a.text}</td><td>{OWNER_LABEL[a.owner_role] ?? a.owner_role}</td><td className="r num">{a.deadline_days}</td></tr>)}</tbody></table></div>
  </div>)}</div>;
}
