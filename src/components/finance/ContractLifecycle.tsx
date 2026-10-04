'use client';
import { useState } from 'react';
import { api, dateFmt, dateTime, ghs } from '@/lib/client/api';
import { Async, Badge, Button, Field, FormError, KV, Modal, useApi, useForm, useToast } from '@/components/ui';

type Detail = {
  id: string; code: string; org: string; status: string; startDate: string | null; endDate: string | null; amountGhs: string;
  acceptance: { accepted: boolean; acceptedAt: string | null; signatoryName: string | null; signatoryTitle: string | null; method: string | null; acceptedBy: string | null; note?: string | null };
  needsAcceptance: boolean; amendments: { id: string; previousEnd: string | null; newEnd: string | null; previousAmount: string; newAmount: string; reason: string; createdAt: string }[];
  invoices: { billed: number; paid: number }; renewalOf: string | null; renewedBy: { id: string; code: string; status: string } | null;
};

function AcceptForm({ id, staff, onDone, onCancel }: { id: string; staff: boolean; onDone: () => void; onCancel: () => void }) {
  const [agree, setAgree] = useState(false); const [agreeErr, setAgreeErr] = useState<string | undefined>();
  const f = useForm({ signatoryName: '', signatoryTitle: '', note: '' }, (v) => {
    if (!staff && !agree) { setAgreeErr('Tick the box to confirm'); throw new Error('Tick the box to confirm'); }
    setAgreeErr(undefined);
    return api.post(`/contracts/${id}/accept`, { signatoryName: v.signatoryName, signatoryTitle: v.signatoryTitle || null, note: v.note || null });
  }, { onDone, success: staff ? 'Signed copy recorded' : 'Contract accepted' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label={staff ? 'Record a signed copy' : 'Accept the contract'}>
    <FormError message={f.formError} />
    <div className="form-grid">
      <Field label="Full name of the person accepting" name="signatoryName" required error={f.errors.signatoryName}>{(p) => <input {...p} {...f.input('signatoryName')} autoComplete="name" />}</Field>
      <Field label="Title or role" name="signatoryTitle" error={f.errors.signatoryTitle}>{(p) => <input {...p} {...f.input('signatoryTitle')} />}</Field>
    </div>
    {staff && <Field label="How was the signature received?" name="note" required error={f.errors.note}>{(p) => <input {...p} {...f.input('note')} placeholder="For example: signed copy filed on 4 October" />}</Field>}
    {!staff && <Field label="" name="agree" error={agreeErr}>{(p) => <label className="row" style={{ gap: 8 }}><input {...p} type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span className="small">I confirm I am authorised to accept this contract for the business, on the terms shown.</span></label>}</Field>}
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>{staff ? 'Record signed copy' : 'Accept contract'}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function AmendForm({ c, onDone, onCancel }: { c: Detail; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ endDate: c.endDate ?? '', amountGhs: String(Number(c.amountGhs)), reason: '' }, (v) => api.post(`/contracts/${c.id}/amend`, { ...(v.endDate && v.endDate !== c.endDate ? { endDate: v.endDate } : {}), ...(Number(v.amountGhs) !== Number(c.amountGhs) ? { amountGhs: Number(v.amountGhs) } : {}), reason: v.reason }), { onDone, success: 'Amendment recorded. The business is asked to accept it' });
  return <form className="stack" noValidate onSubmit={f.onSubmit} aria-label="Amend the contract">
    <FormError message={f.formError} />
    <p className="small muted">An amendment can extend the end date or change the amount. It is kept on the contract and the business is asked to accept the new terms. Invoiced so far: {ghs(c.invoices.billed)}.</p>
    <div className="form-grid">
      <Field label="New end date" name="endDate" error={f.errors.endDate}>{(p) => <input {...p} {...f.input('endDate')} type="date" min={c.endDate ?? undefined} />}</Field>
      <Field label="New amount (GHS)" name="amountGhs" error={f.errors.amountGhs}>{(p) => <input {...p} {...f.input('amountGhs')} type="number" inputMode="decimal" min="0" step="0.01" />}</Field>
    </div>
    <Field label="Reason" name="reason" required error={f.errors.reason}>{(p) => <input {...p} {...f.input('reason')} placeholder="Why the contract is being amended" />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Record amendment</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

/** Acceptance, amendments and renewal for one contract. Staff with edit rights see the actions. */
export function ContractLifecycle({ id, canEdit, canCreate, onChanged }: { id: string; canEdit: boolean; canCreate: boolean; onChanged: () => void }) {
  const st = useApi<Detail>(`/contracts/${id}`); const toast = useToast();
  const [modal, setModal] = useState<'accept' | 'amend' | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const done = () => { setModal(null); st.reload(); onChanged(); };
  return <Async state={st}>{(c) => <div className="stack">
    <h3 style={{ margin: 0 }}>Agreement</h3>
    <KV items={[
      ['Accepted', c.acceptance.accepted ? <>{c.acceptance.signatoryName}{c.acceptance.signatoryTitle ? `, ${c.acceptance.signatoryTitle}` : ''} on {dateTime(c.acceptance.acceptedAt)} <Badge>{c.acceptance.method === 'recorded' ? 'Signed copy recorded' : 'Online'}</Badge></> : 'Not yet'],
      ['Invoiced', `${ghs(c.invoices.billed)} of ${ghs(c.amountGhs)}, ${ghs(c.invoices.paid)} paid`],
      ...(c.renewalOf ? [['Renewal of', 'An earlier contract'] as [string, any]] : []),
      ...(c.renewedBy ? [['Renewed as', `${c.renewedBy.code} (${c.renewedBy.status})`] as [string, any]] : [])
    ]} />
    {c.needsAcceptance && <div className="alert warn" role="note">{c.acceptance.accepted ? 'The contract was amended after it was last accepted.' : 'This contract has not been accepted yet.'}</div>}
    {c.amendments.length > 0 && <div className="table-wrap"><table><caption className="sr">Amendments</caption><thead><tr><th>When</th><th>End date</th><th className="r">Amount</th><th>Reason</th></tr></thead>
      <tbody>{c.amendments.map((a) => <tr key={a.id}><td>{dateFmt(a.createdAt)}</td><td>{dateFmt(a.previousEnd)} to {dateFmt(a.newEnd)}</td><td className="r num">{ghs(a.previousAmount)} to {ghs(a.newAmount)}</td><td>{a.reason}</td></tr>)}</tbody></table></div>}
    <FormError message={err} />
    {c.status === 'Active' && (canEdit || canCreate) && <div className="form-actions">
      {canEdit && c.needsAcceptance && <Button onClick={() => setModal('accept')}>Record signed copy</Button>}
      {canEdit && <Button onClick={() => setModal('amend')}>Amend</Button>}
      {canCreate && !c.renewedBy && <Button loading={busy} onClick={async () => { setBusy(true); setErr(null); try { await api.post(`/contracts/${c.id}/renew`, {}); toast('Renewal created as a draft'); done(); } catch (e: any) { setErr(e?.message ?? 'Could not renew'); } finally { setBusy(false); } }}>Start renewal</Button>}
    </div>}
    {c.status === 'Expired' && canCreate && !c.renewedBy && <div className="form-actions"><Button loading={busy} onClick={async () => { setBusy(true); setErr(null); try { await api.post(`/contracts/${c.id}/renew`, {}); toast('Renewal created as a draft'); done(); } catch (e: any) { setErr(e?.message ?? 'Could not renew'); } finally { setBusy(false); } }}>Start renewal</Button></div>}
    <Modal open={modal === 'accept'} onClose={() => setModal(null)} title="Record a signed copy">{modal === 'accept' && <AcceptForm id={c.id} staff onDone={done} onCancel={() => setModal(null)} />}</Modal>
    <Modal open={modal === 'amend'} onClose={() => setModal(null)} title="Amend contract">{modal === 'amend' && <AmendForm c={c} onDone={done} onCancel={() => setModal(null)} />}</Modal>
  </div>}</Async>;
}

/** The business owner's own contract: terms, what has been invoiced, and a button to accept. */
export function OwnerContracts() {
  const st = useApi<{ items: { id: string; code: string; status: string }[] }>('/contracts?pageSize=5&sort=end&dir=desc');
  return <Async state={st}>{(d) => d.items.length === 0 ? <p className="muted">No contract has been shared with you yet.</p> : <div className="stack">{d.items.map((x) => <OwnerContract key={x.id} id={x.id} />)}</div>}</Async>;
}
function OwnerContract({ id }: { id: string }) {
  const st = useApi<Detail>(`/contracts/${id}`); const [open, setOpen] = useState(false);
  return <Async state={st}>{(c) => <div className="stack">
    <KV items={[['Contract', <><span className="mono">{c.code}</span> <Badge tone={c.status === 'Active' ? 'ok' : ''}>{c.status}</Badge></>], ['Period', `${dateFmt(c.startDate)} to ${dateFmt(c.endDate)}`], ['Amount', ghs(c.amountGhs)], ['Invoiced', `${ghs(c.invoices.billed)}, of which ${ghs(c.invoices.paid)} paid`],
      ['Accepted', c.acceptance.accepted ? `${c.acceptance.signatoryName} on ${dateTime(c.acceptance.acceptedAt)}` : 'Not yet']]} />
    {c.amendments.length > 0 && <ul className="timeline">{c.amendments.map((a) => <li key={a.id}><div><strong>Amended {dateFmt(a.createdAt)}</strong><div className="small muted">{a.reason}. End date {dateFmt(a.previousEnd)} to {dateFmt(a.newEnd)}, amount {ghs(a.previousAmount)} to {ghs(a.newAmount)}.</div></div></li>)}</ul>}
    {c.needsAcceptance && <div className="stack"><div className="alert warn" role="note">{c.acceptance.accepted ? 'This contract was amended. Please review the change and accept it.' : 'Please read the contract and accept it.'}</div><div><Button variant="primary" onClick={() => setOpen(true)}>Accept contract</Button></div></div>}
    <Modal open={open} onClose={() => setOpen(false)} title="Accept contract">{open && <AcceptForm id={c.id} staff={false} onCancel={() => setOpen(false)} onDone={() => { setOpen(false); st.reload(); }} />}</Modal>
  </div>}</Async>;
}
