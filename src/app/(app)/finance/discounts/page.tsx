'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Empty, Modal, PageHead, Tabs, useApi, useToast } from '@/components/ui';
import { useMe, useTitle } from '@/components/finance/common';
import { DiscountRuleForm, PromoCampaignForm, PromoCodeForm, type DiscountRule, type PromoCampaign, type PromoCode } from '@/components/finance/DiscountForms';

const KIND_LABEL: Record<string, string> = { PERCENTAGE: 'Percentage off', FIXED: 'Fixed amount off', PROMOTIONAL_PRICE: 'New promotional price' };

function ruleValueLabel(r: DiscountRule) {
  return r.kind === 'PERCENTAGE' ? `${Number(r.value)}%` : `GHS ${Number(r.value).toFixed(2)}`;
}

function ApproveRule({ rule, onDone }: { rule: DiscountRule; onDone: () => void }) {
  const toast = useToast();
  return <ConfirmButton
    label="Approve" size="sm"
    message={`Approve this ${KIND_LABEL[rule.kind].toLowerCase()} discount rule (${ruleValueLabel(rule)})? Once approved, any campaign built on it can be used to redeem promo codes. You cannot approve a rule you created yourself.`}
    onConfirm={async () => { await api.post(`/discount-rules/${rule.id}/approve`); toast('Discount rule approved'); onDone(); }}
  />;
}

function RulesPanel({ rules, canCreate, canApprove, onReload, me }: { rules: ReturnType<typeof useApi<DiscountRule[]>>; canCreate: boolean; canApprove: boolean; onReload: () => void; me: ReturnType<typeof useMe> }) {
  const [creating, setCreating] = useState(false);
  return <Card>
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
      <p className="small muted">A discount rule defines how much to reduce an invoice by. It must be approved by someone other than its creator before a campaign can use it.</p>
      {canCreate && <Button variant="primary" size="sm" onClick={() => setCreating(true)}>New rule</Button>}
    </div>
    <Async state={rules}>{() => (rules.data ?? []).length === 0 ? <Empty title="No discount rules yet" hint={canCreate ? 'Propose the first discount rule.' : undefined} /> : (
      <div className="table-wrap"><table>
        <thead><tr><th>Type</th><th>Value</th><th>Status</th><th className="r">Created</th>{canApprove && <th>Actions</th>}</tr></thead>
        <tbody>{(rules.data ?? []).map((r) => <tr key={r.id}>
          <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
          <td className="num">{ruleValueLabel(r)}</td>
          <td>{!r.active ? <Badge tone="bad">Inactive</Badge> : r.approvedBy ? <Badge tone="ok">Approved</Badge> : <Badge>Pending approval</Badge>}</td>
          <td className="r small muted">{new Date(r.createdAt).toLocaleDateString('en-GB')}</td>
          {canApprove && <td>{!r.approvedBy && r.active && (r.createdBy !== me.data?.user.id ? <ApproveRule rule={r} onDone={onReload} /> : <span className="small muted">Awaiting another approver</span>)}</td>}
        </tr>)}</tbody>
      </table></div>
    )}</Async>
    <Modal open={creating} onClose={() => setCreating(false)} title="Propose discount rule">
      <DiscountRuleForm onCancel={() => setCreating(false)} onDone={() => { setCreating(false); onReload(); }} />
    </Modal>
  </Card>;
}

function CampaignsPanel({ campaigns, rules, canCreate, onReload }: { campaigns: ReturnType<typeof useApi<PromoCampaign[]>>; rules: DiscountRule[]; canCreate: boolean; onReload: () => void }) {
  const [creating, setCreating] = useState(false);
  const ruleLabel = (id: string) => { const r = rules.find((x) => x.id === id); return r ? `${KIND_LABEL[r.kind]} (${ruleValueLabel(r)})` : id; };
  return <Card>
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
      <p className="small muted">A campaign ties an approved discount rule to a time window. Promo codes are generated against a campaign.</p>
      {canCreate && <Button variant="primary" size="sm" onClick={() => setCreating(true)}>New campaign</Button>}
    </div>
    <Async state={campaigns}>{() => (campaigns.data ?? []).length === 0 ? <Empty title="No campaigns yet" hint={canCreate ? 'Create a campaign from an approved rule.' : undefined} /> : (
      <div className="table-wrap"><table>
        <thead><tr><th>Campaign</th><th>Discount rule</th><th>Window</th><th>Status</th></tr></thead>
        <tbody>{(campaigns.data ?? []).map((c) => <tr key={c.id}>
          <td><strong>{c.name}</strong></td>
          <td className="small">{ruleLabel(c.discountRuleId)}</td>
          <td className="small">{c.startDate ?? 'Any time'} – {c.endDate ?? 'No end'}</td>
          <td><Badge tone={c.active ? 'ok' : 'bad'}>{c.active ? 'Active' : 'Inactive'}</Badge></td>
        </tr>)}</tbody>
      </table></div>
    )}</Async>
    <Modal open={creating} onClose={() => setCreating(false)} title="New promo campaign">
      <PromoCampaignForm rules={rules} onCancel={() => setCreating(false)} onDone={() => { setCreating(false); onReload(); }} />
    </Modal>
  </Card>;
}

function CodesPanel({ codes, campaigns, canCreate, onReload }: { codes: ReturnType<typeof useApi<PromoCode[]>>; campaigns: PromoCampaign[]; canCreate: boolean; onReload: () => void }) {
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const campaignName = (id: string) => campaigns.find((c) => c.id === id)?.name ?? id;
  const copy = (code: string) => { navigator.clipboard?.writeText(code).then(() => { setCopied(code); setTimeout(() => setCopied(null), 1500); }).catch(() => {}); };
  return <Card>
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
      <p className="small muted">Codes are generated server-side and cannot be guessed. Share them with customers to redeem against a draft invoice.</p>
      {canCreate && <Button variant="primary" size="sm" onClick={() => setCreating(true)}>Generate code</Button>}
    </div>
    <Async state={codes}>{() => (codes.data ?? []).length === 0 ? <Empty title="No promo codes yet" hint={canCreate ? 'Generate a code against a campaign.' : undefined} /> : (
      <div className="table-wrap"><table>
        <thead><tr><th>Code</th><th>Campaign</th><th className="r">Redemptions</th><th>Limits</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{(codes.data ?? []).map((c) => <tr key={c.id}>
          <td className="mono"><strong>{c.code}</strong></td>
          <td className="small">{campaignName(c.campaignId)}</td>
          <td className="r num">{c.redemptions}{c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}</td>
          <td className="small muted">{c.perCustomerLimit ? `${c.perCustomerLimit} per customer` : 'No per-customer limit'}{c.expiresAt ? `, expires ${new Date(c.expiresAt).toLocaleDateString('en-GB')}` : ''}</td>
          <td><Badge tone={c.active ? 'ok' : 'bad'}>{c.active ? 'Active' : 'Inactive'}</Badge></td>
          <td><Button size="sm" onClick={() => copy(c.code)}>{copied === c.code ? 'Copied' : 'Copy'}</Button></td>
        </tr>)}</tbody>
      </table></div>
    )}</Async>
    <Modal open={creating} onClose={() => setCreating(false)} title="Generate promo code">
      <PromoCodeForm campaigns={campaigns} onCancel={() => setCreating(false)} onDone={() => { setCreating(false); onReload(); }} />
    </Modal>
  </Card>;
}

export default function DiscountsPage() {
  useTitle('Discounts & promos');
  const me = useMe();
  const [tab, setTab] = useState('rules');
  const rules = useApi<DiscountRule[]>('/discount-rules');
  const campaigns = useApi<PromoCampaign[]>('/promo-campaigns');
  const codes = useApi<PromoCode[]>('/promo-codes');
  const canCreate = me.can('discounts', 'create');
  const canApprove = me.can('discounts', 'approve');

  return <>
    <PageHead title="Discounts & promos" sub="Propose and approve discount rules, run them as time-bound campaigns, and generate redeemable promo codes. A discount rule needs a second person's approval before any code built on it can be used, and a code can only be redeemed against a draft invoice, before anything is posted to the ledger." />
    <Tabs tabs={[{ id: 'rules', label: 'Discount rules' }, { id: 'campaigns', label: 'Campaigns' }, { id: 'codes', label: 'Promo codes' }]} active={tab} onChange={setTab} />
    <div style={{ marginTop: 12 }}>
      {tab === 'rules' && <RulesPanel rules={rules} canCreate={canCreate} canApprove={canApprove} onReload={rules.reload} me={me} />}
      {tab === 'campaigns' && <CampaignsPanel campaigns={campaigns} rules={rules.data ?? []} canCreate={canCreate} onReload={() => { campaigns.reload(); rules.reload(); }} />}
      {tab === 'codes' && <CodesPanel codes={codes} campaigns={campaigns.data ?? []} canCreate={canCreate} onReload={() => { codes.reload(); campaigns.reload(); }} />}
    </div>
  </>;
}
