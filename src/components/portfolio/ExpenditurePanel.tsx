'use client';
import { useState } from 'react';
import { api, dateFmt, ghs } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, FormError, KV, useApi, useForm, useToast } from '@/components/ui';

type Overview = { budget: number | null; committed: number; actual: number; available: number | null };
type Line = { id: string; category: string };
type BudgetOverview = { lines: Line[] };
type Tx = {
  id: string; budgetLineId: string | null; payee: string; category: string; purpose: string | null;
  amountGhs: number; date: string; reference: string | null; evidenceClass: string; evidenceRef: string | null;
  type: 'COMMITMENT' | 'PAYMENT' | 'REVERSAL'; status: 'ACTIVE' | 'SETTLED' | 'REVERSED';
  settlesCommitmentId: string | null; reversalOfId: string | null;
};

const EVIDENCE_CLASSES = ['Verified', 'Document-supported', 'Self-reported', 'Unverified', 'Missing'];

function LineSelect({ lines, value, onChange }: { lines: Line[]; value: string; onChange: (v: string) => void }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">No budget line</option>
    {lines.map((l) => <option key={l.id} value={l.id}>{l.category}</option>)}
  </select>;
}

function TxFields({ f, lines }: { f: any; lines: Line[] }) {
  return <>
    <div className="form-grid">
      <Field label="Payee" name="payee" error={f.errors.payee}>{(p) => <input {...p} {...f.input('payee')} maxLength={160} />}</Field>
      <Field label="Category" name="category" error={f.errors.category}>{(p) => <input {...p} {...f.input('category')} placeholder="For example: Coaching and mentoring" maxLength={120} />}</Field>
      <Field label="Amount (GHS)" name="amountGhs" error={f.errors.amountGhs}>{(p) => <input {...p} {...f.input('amountGhs')} inputMode="decimal" />}</Field>
      <Field label="Date" name="date" error={f.errors.date}>{(p) => <input {...p} {...f.input('date')} type="date" />}</Field>
      <Field label="Budget line" name="budgetLineId">{() => <LineSelect lines={lines} value={f.values.budgetLineId} onChange={(v) => f.set('budgetLineId', v)} />}</Field>
      <Field label="Reference (optional)" name="reference" hint="The payee's invoice or receipt number.">{(p) => <input {...p} {...f.input('reference')} maxLength={120} />}</Field>
      <Field label="Evidence class" name="evidenceClass">{() => <select value={f.values.evidenceClass} onChange={(e) => f.set('evidenceClass', e.target.value)}>
        {EVIDENCE_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>}</Field>
      <Field label="Evidence reference (optional)" name="evidenceRef" hint="A file name, link or description of the supporting document.">{(p) => <input {...p} {...f.input('evidenceRef')} maxLength={500} />}</Field>
    </div>
    <Field label="Purpose (optional)" name="purpose">{(p) => <textarea {...p} {...f.input('purpose')} rows={2} maxLength={500} />}</Field>
  </>;
}

function CommitmentForm({ programmeId, lines, onDone, onCancel }: { programmeId: string; lines: Line[]; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ payee: '', category: '', amountGhs: '', date: new Date().toISOString().slice(0, 10), budgetLineId: '', reference: '', evidenceClass: 'Document-supported', evidenceRef: '', purpose: '' },
    (v) => api.post(`/programmes/${programmeId}/expenditure/commitments`, {
      payee: v.payee.trim(), category: v.category.trim(), amountGhs: Number(v.amountGhs), date: v.date,
      budgetLineId: v.budgetLineId || null, reference: v.reference.trim() || null, evidenceClass: v.evidenceClass,
      evidenceRef: v.evidenceRef.trim() || null, purpose: v.purpose.trim() || null
    }), { onDone, success: 'Commitment recorded' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Record a commitment"><FormError message={f.formError} />
    <p className="small muted">An approved spend not yet paid out.</p>
    <TxFields f={f} lines={lines} />
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Record commitment</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function PaymentForm({ programmeId, lines, commitments, onDone, onCancel }: { programmeId: string; lines: Line[]; commitments: Tx[]; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ payee: '', category: '', amountGhs: '', date: new Date().toISOString().slice(0, 10), budgetLineId: '', reference: '', evidenceClass: 'Document-supported', evidenceRef: '', purpose: '', settlesCommitmentId: '' },
    (v) => api.post(`/programmes/${programmeId}/expenditure/payments`, {
      payee: v.payee.trim(), category: v.category.trim(), amountGhs: Number(v.amountGhs), date: v.date,
      budgetLineId: v.budgetLineId || null, reference: v.reference.trim() || null, evidenceClass: v.evidenceClass,
      evidenceRef: v.evidenceRef.trim() || null, purpose: v.purpose.trim() || null, settlesCommitmentId: v.settlesCommitmentId || null
    }), { onDone, success: 'Payment recorded' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Record a payment"><FormError message={f.formError} />
    <p className="small muted">Money actually paid out, optionally settling an open commitment.</p>
    {commitments.length > 0 && <Field label="Settles commitment (optional)" name="settlesCommitmentId">{() => <select value={f.values.settlesCommitmentId} onChange={(e) => f.set('settlesCommitmentId', e.target.value)}>
      <option value="">Not settling a commitment</option>
      {commitments.map((c) => <option key={c.id} value={c.id}>{c.payee} — {ghs(c.amountGhs)} on {dateFmt(c.date)}</option>)}
    </select>}</Field>}
    <TxFields f={f} lines={lines} />
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Record payment</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function ReverseForm({ tx, onDone, onCancel }: { tx: Tx; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ reason: '' }, (v) => api.post(`/expenditure-transactions/${tx.id}/reverse`, { reason: v.reason.trim() }), { onDone, success: 'Transaction reversed' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label={`Reverse transaction for ${tx.payee}`}><FormError message={f.formError} />
    <p className="small muted">The original transaction is kept exactly as recorded; a new reversal row is created pointing back at it.</p>
    <Field label="Reason for reversal" name="reason" error={f.errors.reason}>{(p) => <textarea {...p} {...f.input('reason')} rows={2} maxLength={1000} />}</Field>
    <div className="form-actions"><Button variant="danger" type="submit" loading={f.busy}>Reverse</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

const typeTone = (t: Tx['type']) => (t === 'COMMITMENT' ? 'info' : t === 'REVERSAL' ? 'bad' : '');
const statusTone = (s: Tx['status']) => (s === 'ACTIVE' ? '' : s === 'SETTLED' ? 'ok' : 'bad');

/** Programme expenditure ledger: commitments, payments and reversals against the budget, kept separate from BudgetPanel's lines/tranches. */
export function ExpenditurePanel({ programmeId, canEdit }: { programmeId: string; canEdit: boolean }) {
  const ov = useApi<Overview>(`/programmes/${programmeId}/expenditure`);
  const txs = useApi<Tx[]>(`/programmes/${programmeId}/expenditure/transactions`);
  const budget = useApi<BudgetOverview>(`/programmes/${programmeId}/budget`);
  const toast = useToast();
  const [mode, setMode] = useState<null | 'commitment' | 'payment' | string>(null);
  const done = () => { setMode(null); ov.reload(); txs.reload(); };
  const lines = budget.data?.lines ?? [];
  const rows = txs.data ?? [];
  const openCommitments = rows.filter((t) => t.type === 'COMMITMENT' && t.status === 'ACTIVE');

  return <div className="stack">
    <Async state={ov}>{(o) => <Card title="Expenditure position">
      <KV items={[['Approved budget', ghs(o.budget)], ['Committed (not yet paid)', ghs(o.committed)], ['Actual expenditure', ghs(o.actual)], ['Available', ghs(o.available)]]} />
      {o.budget === null && <p className="muted small">Set the programme budget on the Overview tab to see what remains available.</p>}
    </Card>}</Async>
    <Card title="Transactions" actions={canEdit && !mode ? <div className="row" style={{ gap: 8 }}><Button onClick={() => setMode('commitment')}>Record commitment</Button><Button variant="primary" onClick={() => setMode('payment')}>Record payment</Button></div> : undefined}>
      {mode === 'commitment' && <CommitmentForm programmeId={programmeId} lines={lines} onDone={done} onCancel={() => setMode(null)} />}
      {mode === 'payment' && <PaymentForm programmeId={programmeId} lines={lines} commitments={openCommitments} onDone={done} onCancel={() => setMode(null)} />}
      <Async state={txs}>{() => rows.length === 0 ? <Empty title="No transactions recorded" hint={canEdit ? 'Record a commitment or a payment to start the ledger.' : undefined} /> :
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Payee</th><th>Category</th><th className="r">Amount</th><th>Reference</th><th>Evidence</th><th>Status</th>{canEdit && <th><span className="sr">Actions</span></th>}</tr></thead>
          <tbody>{rows.map((t) => <tr key={t.id}>
            <td>{dateFmt(t.date)}</td>
            <td><Badge tone={typeTone(t.type)}>{t.type}</Badge></td>
            <td>{t.payee}</td>
            <td>{t.category}</td>
            <td className="r num">{ghs(t.amountGhs)}</td>
            <td>{t.reference ?? '-'}</td>
            <td>{t.evidenceClass}</td>
            <td><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
            {canEdit && <td>{t.type !== 'REVERSAL' && t.status === 'ACTIVE' && mode !== t.id && <Button size="sm" onClick={() => setMode(t.id)}>Reverse</Button>}</td>}
          </tr>)}</tbody></table></div>}
      </Async>
      {rows.filter((t) => t.id === mode).map((t) => <ReverseForm key={t.id} tx={t} onDone={done} onCancel={() => setMode(null)} />)}
    </Card>
  </div>;
}
