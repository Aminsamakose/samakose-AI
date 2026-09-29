'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, dateFmt, dateTime, ghs, titleCase } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, KV, Modal, PageHead, useApi, useToast } from '@/components/ui';
import { useMe, useTitle } from '@/components/finance/common';
import { InvoiceEditDraft, ManualPayment } from '@/components/finance/InvoiceForms';

type Payment = { id: string; code: string; provider: string; reference: string; amountGhs: string; status: string; createdAt: string };
type Invoice = { id: string; code: string; orgId: string; org: string; contractId: string | null; amountGhs: string; status: string; dueDate: string; issuedAt: string | null; paidAt: string | null; daysOverdue: number; payments: Payment[] };

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const me = useMe(); const toast = useToast();
  const st = useApi<Invoice>(`/invoices/${id}`);
  useTitle(st.data ? `Invoice ${st.data.code}` : 'Invoice');
  const [modal, setModal] = useState<'edit' | 'manual' | null>(null);
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>, ok: string) => { await api.patch(`/invoices/${id}`, body); toast(ok); st.reload(); };
  const payOnline = async () => {
    setPaying(true);
    try { const r = await api.post<{ authorizationUrl: string }>(`/invoices/${id}/pay`); window.location.href = r.authorizationUrl; }
    catch (e: any) { toast(e?.message ?? 'Could not start the payment', 'bad'); setPaying(false); }
  };
  const verify = async (p: Payment) => {
    setVerifying(p.reference);
    try {
      const r = await api.post<{ status: string }>(`/payments/${encodeURIComponent(p.reference)}/verify`);
      toast(r.status === 'Succeeded' ? 'Payment confirmed' : r.status === 'Pending' ? 'The provider has not confirmed this payment yet' : `Payment ${r.status.toLowerCase()}`, r.status === 'Failed' ? 'bad' : 'ok');
      st.reload();
    } catch (e: any) { toast(e?.message ?? 'Could not verify the payment', 'bad'); }
    finally { setVerifying(null); }
  };

  return <Async state={st}>{(i) => {
    const owner = me.role === 'OWNER';
    const open = i.status === 'Sent' || i.status === 'Overdue';
    const canEdit = me.can('invoices', 'edit');
    const canPay = me.can('payments', 'create');
    const late = open && i.daysOverdue > 0;
    const hasPending = i.payments.some((p) => p.status === 'Pending');
    return <>
      <PageHead crumbs={<Link href="/finance/invoices">Invoices</Link>} title={<>Invoice <span className="mono">{i.code}</span> <Badge>{i.status}</Badge></>}
        sub={owner ? undefined : i.org}
        actions={<>
          {canEdit && i.status === 'Draft' && <Button onClick={() => setModal('edit')}>Edit draft</Button>}
          {canEdit && i.status === 'Draft' && <ConfirmButton variant="primary" label="Mark as sent" message={`Send invoice ${i.code} for ${ghs(i.amountGhs)} to ${i.org}? Business owners in the organisation are notified by email and in the app.`} onConfirm={() => patch({ status: 'Sent' }, 'Invoice marked as sent')} />}
          {canEdit && ['Draft', 'Sent', 'Overdue'].includes(i.status) && <ConfirmButton variant="danger" label="Void invoice" message={`Void invoice ${i.code}? A void invoice cannot be paid or reopened. This cannot be undone.`} onConfirm={() => patch({ status: 'Void' }, 'Invoice voided')} />}
          {canPay && !owner && open && <Button onClick={() => setModal('manual')}>Record manual payment</Button>}
          {canPay && open && <Button variant="primary" loading={paying} onClick={payOnline}>Pay online</Button>}
        </>} />
      {late && <div className="alert warn" role="status"><strong>Overdue by {i.daysOverdue} day{i.daysOverdue === 1 ? '' : 's'}.</strong> This invoice was due on {dateFmt(i.dueDate)}.</div>}
      {i.status === 'Paid' && <div className="alert ok" role="status">Paid on {dateTime(i.paidAt)}. Thank you.</div>}
      {i.status === 'Void' && <div className="alert info" role="status">This invoice was voided and can no longer be paid.</div>}
      <div className="grid two">
        <Card title="Invoice details">
          <KV items={[
            ['Invoice number', <span className="mono" key="c">{i.code}</span>],
            ...(owner ? [] : [['Organisation', i.org] as [string, React.ReactNode]]),
            ['Amount', <strong className="num" key="a">{ghs(i.amountGhs)}</strong>],
            ['Status', <Badge key="s">{i.status}</Badge>],
            ['Due date', dateFmt(i.dueDate)],
            ['Issued', dateFmt(i.issuedAt)],
            ['Paid', dateFmt(i.paidAt)]
          ]} />
        </Card>
        <Card title="Payments" >
          {i.payments.length === 0 ? <Empty title="No payments yet" hint={open && canPay ? 'Use Pay online to pay by card or mobile money.' : undefined} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Payment</th><th>Method</th><th className="r">Amount</th><th>Status</th><th>Date</th>{canPay && hasPending && <th>Action</th>}</tr></thead>
              <tbody>{i.payments.map((p) => <tr key={p.id}>
                <td><span className="mono">{p.code}</span><div className="small muted mono">{p.reference}</div></td>
                <td>{p.provider === 'manual' ? 'Manual' : titleCase(p.provider)}</td>
                <td className="r num">{ghs(p.amountGhs)}</td>
                <td><Badge>{p.status}</Badge></td>
                <td>{dateTime(p.createdAt)}</td>
                {canPay && hasPending && <td>{p.status === 'Pending' && p.provider !== 'manual' ? <Button size="sm" loading={verifying === p.reference} onClick={() => verify(p)} aria-label={`Check payment ${p.code} with the provider`}>Check status</Button> : null}</td>}
              </tr>)}</tbody>
            </table></div>
          )}
          {hasPending && <p className="small muted" style={{ marginTop: 8 }}>A pending payment was started but not yet confirmed. Check its status to update the invoice.</p>}
        </Card>
      </div>
      <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit draft invoice">
        {modal === 'edit' && <InvoiceEditDraft id={i.id} amountGhs={i.amountGhs} dueDate={i.dueDate} onCancel={() => setModal(null)} onDone={() => { setModal(null); st.reload(); }} />}
      </Modal>
      <Modal open={modal === 'manual'} onClose={() => setModal(null)} title="Record manual payment">
        {modal === 'manual' && <ManualPayment id={i.id} amountGhs={i.amountGhs} onCancel={() => setModal(null)} onDone={() => { setModal(null); st.reload(); }} />}
      </Modal>
    </>;
  }}</Async>;
}
