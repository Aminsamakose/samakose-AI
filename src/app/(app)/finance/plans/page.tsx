'use client';
import { useState } from 'react';
import { api, ghs } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Modal, PageHead, useApi, useToast } from '@/components/ui';
import { useMe, useTitle } from '@/components/finance/common';
import { PlanForm, type Plan } from '@/components/finance/PlanForm';

export default function PlansPage() {
  useTitle('Plans');
  const me = useMe(); const toast = useToast();
  const st = useApi<Plan[]>('/plans');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const canCreate = me.can('plans', 'create'), canEdit = me.can('plans', 'edit');
  const toggle = async (p: Plan) => {
    try { await api.patch(`/plans/${p.id}`, { active: !p.active }); toast(p.active ? 'Plan deactivated' : 'Plan reactivated'); st.reload(); }
    catch (e: any) { toast(e?.message ?? 'Could not update the plan', 'bad'); }
  };
  return <>
    <PageHead title="Service plans" sub="Plans are the price list that contracts are built from. Deactivated plans stay on existing contracts." actions={canCreate ? <Button variant="primary" onClick={() => setEditing('new')}>New plan</Button> : undefined} />
    <Card>
      <Async state={st}>{(rows) => rows.length === 0 ? <Empty title="No plans yet" hint={canCreate ? 'Create the first plan to start building contracts.' : 'A finance user needs to create plans first.'} action={canCreate ? <Button variant="primary" size="sm" onClick={() => setEditing('new')}>New plan</Button> : undefined} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Plan</th><th className="r">Price</th><th className="r">Interval</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id}>
            <td><strong>{p.name}</strong><div className="small muted mono">{p.code}</div>{p.description && <div className="small muted">{p.description}</div>}</td>
            <td className="r num">{ghs(p.priceGhs)}</td>
            <td className="r num">{p.intervalMonths} month{p.intervalMonths === 1 ? '' : 's'}</td>
            <td><Badge tone={p.active ? 'ok' : 'bad'}>{p.active ? 'Active' : 'Inactive'}</Badge></td>
            {canEdit && <td><span className="row"><Button size="sm" onClick={() => setEditing(p)}>Edit</Button>
              {p.active ? <Button size="sm" onClick={() => toggle(p)} aria-label={`Deactivate ${p.name}`}>Deactivate</Button> : <Button size="sm" onClick={() => toggle(p)} aria-label={`Reactivate ${p.name}`}>Reactivate</Button>}</span></td>}
          </tr>)}</tbody>
        </table></div>
      )}</Async>
    </Card>
    <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New plan' : 'Edit plan'}>
      {editing && <PlanForm plan={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); st.reload(); }} />}
    </Modal>
  </>;
}
