'use client';
import { useMemo, useState } from 'react';
import { api, ghs } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Modal, PageHead, useApi, useToast } from '@/components/ui';
import { useMe, useTitle } from '@/components/finance/common';
import { PlanForm, type Plan } from '@/components/finance/PlanForm';

const TIER_LABEL: Record<string, string> = { discovery: 'Discovery', diagnostic: 'Diagnostic', transform: 'Transform', growth: 'Growth', programme: 'Programme' };
const STATUS_TONE: Record<string, string> = { draft: undefined as any, published: 'ok', inactive: 'bad', archived: 'bad' };
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', published: 'Published', inactive: 'Inactive', archived: 'Archived' };

function priceLabel(p: Plan) {
  if (p.pricingModel === 'free') return 'Free';
  if (p.pricingModel === 'custom') return 'Priced by agreement';
  return p.priceConfirmed ? ghs(p.priceGhs) : `${ghs(p.priceGhs)} (not shown to visitors)`;
}

function DeletePlan({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const toast = useToast();
  const deps = useApi<{ totalContracts: number; activeContracts: number }>(`/plans/${plan.id}/dependencies`);
  const d = deps.data;
  const message = !d ? 'Checking this plan for subscriptions and billing history...' :
    d.totalContracts > 0
      ? `"${plan.name}" has ${d.totalContracts} contract${d.totalContracts === 1 ? '' : 's'} on record (${d.activeContracts} active). Deleting it would orphan that billing history, so it will be archived instead — hidden from customers and from new contracts, but kept for history. This is not permanent deletion.`
      : `"${plan.name}" has no contracts on record. This will permanently delete it. This cannot be undone.`;
  return <ConfirmButton
    label="Delete" variant="danger" size="sm" message={message}
    onConfirm={async () => {
      const r = await api.del<{ deleted: boolean; archived: boolean }>(`/plans/${plan.id}`);
      toast(r.archived ? `${plan.name} archived (had contract history)` : `${plan.name} deleted`);
      onDone();
    }}
  />;
}

export default function PlansPage() {
  useTitle('Plans');
  const me = useMe(); const toast = useToast();
  const st = useApi<Plan[]>('/plans');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [q, setQ] = useState(''); const [statusFilter, setStatusFilter] = useState('');
  const canCreate = me.can('plans', 'create'), canEdit = me.can('plans', 'edit'), canDelete = me.can('plans', 'delete');

  const setStatus = async (p: Plan, publicationStatus: string) => {
    try { await api.patch(`/plans/${p.id}`, { publicationStatus }); toast(`${p.name}: ${STATUS_LABEL[publicationStatus].toLowerCase()}`); st.reload(); }
    catch (e: any) { toast(e?.message ?? 'Could not update the plan', 'bad'); }
  };

  const rows = useMemo(() => (st.data ?? []).filter((p) =>
    (!q || p.name.toLowerCase().includes(q.toLowerCase())) &&
    (!statusFilter || p.publicationStatus === statusFilter)
  ), [st.data, q, statusFilter]);

  return <>
    <PageHead title="Service plans" sub="One place for service tier, features, duration and price. Deactivated or archived plans stay on existing contracts — nothing here changes a customer's current entitlements." actions={canCreate ? <Button variant="primary" onClick={() => setEditing('new')}>New plan</Button> : undefined} />
    <Card>
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <input type="search" placeholder="Search plans" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} aria-label="Search plans" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by availability">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <Async state={st}>{() => rows.length === 0 ? <Empty title="No plans found" hint={canCreate ? 'Create the first plan to start building contracts.' : 'A finance user needs to create plans first.'} action={canCreate ? <Button variant="primary" size="sm" onClick={() => setEditing('new')}>New plan</Button> : undefined} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Plan</th><th>Tier</th><th>Platforms</th><th className="r">Price</th><th>Availability</th><th className="r">Updated</th>{(canEdit || canDelete) && <th>Actions</th>}</tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id}>
            <td><strong>{p.name}</strong><div className="small muted mono">{p.code}</div>{p.audience && <div className="small muted">{p.audience}</div>}</td>
            <td>{p.serviceTier ? TIER_LABEL[p.serviceTier] ?? p.serviceTier : <span className="muted small">Legacy</span>}</td>
            <td className="small">{p.platforms?.length ? p.platforms.join(', ') : 'All'}</td>
            <td className="r num">{priceLabel(p)}</td>
            <td><Badge tone={STATUS_TONE[p.publicationStatus] as any}>{STATUS_LABEL[p.publicationStatus] ?? p.publicationStatus}</Badge></td>
            <td className="r num small muted">{new Date((p as any).updatedAt ?? Date.now()).toLocaleDateString('en-GB')}</td>
            {(canEdit || canDelete) && <td><span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {canEdit && <Button size="sm" onClick={() => setEditing(p)}>Edit</Button>}
              {canEdit && p.publicationStatus !== 'published' && p.publicationStatus !== 'archived' && <Button size="sm" onClick={() => setStatus(p, 'published')}>Publish</Button>}
              {canEdit && p.publicationStatus === 'published' && <Button size="sm" onClick={() => setStatus(p, 'inactive')}>Deactivate</Button>}
              {canEdit && p.publicationStatus === 'inactive' && <Button size="sm" onClick={() => setStatus(p, 'published')}>Reactivate</Button>}
              {canEdit && p.publicationStatus !== 'archived' && <Button size="sm" onClick={() => setStatus(p, 'archived')}>Archive</Button>}
              {canDelete && <DeletePlan plan={p} onDone={st.reload} />}
            </span></td>}
          </tr>)}</tbody>
        </table></div>
      )}</Async>
    </Card>
    <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New plan' : 'Edit plan'}>
      {editing && <PlanForm plan={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); st.reload(); }} />}
    </Modal>
  </>;
}
