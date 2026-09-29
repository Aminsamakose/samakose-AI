'use client';
import { useState } from 'react';
import { api, ApiFail, dateFmt } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, FormError, Modal, useApi, useForm } from '@/components/ui';
import type { TabProps } from './types';
import { sevTone, useMe } from './clinical/common';

type Risk = { id: string; code: string; text: string; severity: string; status: string; createdAt: string };
const STATUS = ['Open', 'Mitigating', 'Accepted', 'Closed'];
const statusTone = (s: string) => (s === 'Open' ? 'warn' : s === 'Mitigating' ? 'info' : s === 'Closed' ? 'ok' : '');

export default function TabRisks({ caseId, reload }: TabProps) {
  const list = useApi<Risk[]>(`/cases/${caseId}/risks`);
  const { can } = useMe();
  const [form, setForm] = useState<{ risk?: Risk } | null>(null);
  const canEdit = can('risks', 'edit');
  return <Card title="Risks" actions={canEdit && <Button variant="primary" size="sm" onClick={() => setForm({})}>Add risk</Button>}>
    <Async state={list}>{(rows) => rows.length === 0 ? <Empty title="No risks recorded" hint="Risks from an approved diagnosis and any you add appear here." /> :
      <div className="table-wrap"><table><thead><tr><th>Code</th><th>Risk</th><th>Severity</th><th>Status</th><th>Recorded</th>{canEdit && <th>Update</th>}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="mono">{r.code}</td><td>{r.text}</td><td><Badge tone={sevTone(r.severity)}>{r.severity}</Badge></td><td><Badge tone={statusTone(r.status)}>{r.status}</Badge></td><td className="num">{dateFmt(r.createdAt)}</td>
          {canEdit && <td><Button size="sm" onClick={() => setForm({ risk: r })} aria-label={`Update ${r.code}`}>Update</Button></td>}</tr>)}</tbody></table></div>}</Async>
    <Modal open={!!form} onClose={() => setForm(null)} title={form?.risk ? `Update ${form.risk.code}` : 'Add a risk'}>
      {form && <RiskForm caseId={caseId} risk={form.risk} onCancel={() => setForm(null)} onDone={() => { setForm(null); list.reload(); reload(); }} />}
    </Modal>
  </Card>;
}

function RiskForm({ caseId, risk, onDone, onCancel }: { caseId: string; risk?: Risk; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ text: risk?.text ?? '', severity: risk?.severity ?? 'Medium', status: risk?.status ?? 'Open' }, async (v) => {
    if (v.text.trim().length < 3) throw new ApiFail(400, 'validation_failed', 'Please fix the highlighted fields', { text: 'Describe the risk' });
    return risk ? api.patch(`/risks/${risk.id}`, { text: v.text.trim(), severity: v.severity, status: v.status }) : api.post(`/cases/${caseId}/risks`, { text: v.text.trim(), severity: v.severity });
  }, { success: risk ? 'Risk updated' : 'Risk added', onDone });
  return <form className="stack" onSubmit={f.onSubmit} noValidate>
    <FormError message={f.formError} />
    <Field label="Risk" name="text" required error={f.errors.text}>{(p) => <textarea {...p} rows={3} {...f.input('text')} />}</Field>
    <div className="form-grid">
      <Field label="Severity" name="severity" error={f.errors.severity}>{(p) => <select {...p} {...f.input('severity')}><option>High</option><option>Medium</option><option>Low</option></select>}</Field>
      {risk && <Field label="Status" name="status" error={f.errors.status}>{(p) => <select {...p} {...f.input('status')}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select>}</Field>}
    </div>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{risk ? 'Save' : 'Add risk'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
