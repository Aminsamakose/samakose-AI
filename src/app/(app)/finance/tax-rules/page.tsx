'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Modal, PageHead, useApi, useForm } from '@/components/ui';
import { useMe, useTitle, today } from '@/components/finance/common';
import { TaxRuleForm } from '@/components/finance/TaxRuleForm';

type TaxRule = { id: string; type: 'VAT' | 'WITHHOLDING' | 'OTHER'; rate: string; jurisdiction: string; inclusiveOfPrice: boolean; ruleVersion: number; effectiveFrom: string; effectiveTo: string | null; createdAt: string };

const TYPE_LABEL: Record<string, string> = { VAT: 'VAT', WITHHOLDING: 'Withholding tax', OTHER: 'Other' };

function CloseRule({ rule, onDone }: { rule: TaxRule; onDone: () => void }) {
  const f = useForm({ effectiveTo: today() }, async (v) => api.patch(`/tax-rules/${rule.id}/close`, { effectiveTo: v.effectiveTo }), { success: 'Tax rule closed', onDone });
  return <form onSubmit={f.onSubmit} className="stack" style={{ gap: 4 }}>
    <div className="row" style={{ gap: 6 }}>
      <input type="date" value={f.values.effectiveTo} onChange={(e) => f.set('effectiveTo', e.target.value)} aria-label="Close effective to" style={{ width: 150 }} min={rule.effectiveFrom} />
      <Button size="sm" type="submit" loading={f.busy}>Close</Button>
    </div>
    {f.formError && <span className="err small" role="alert">{f.formError}</span>}
  </form>;
}

export default function TaxRulesPage() {
  useTitle('Tax rules');
  const me = useMe();
  const rules = useApi<TaxRule[]>('/tax-rules');
  const [creating, setCreating] = useState(false);
  const canCreate = me.can('tax_rules', 'create'), canEdit = me.can('tax_rules', 'edit');
  const todayStr = today();

  return <>
    <PageHead title="Tax rules" sub="VAT and withholding rates by jurisdiction. A rate change always opens a new version — history is never rewritten, so every past tax line keeps pointing at the exact rule version it used." actions={canCreate ? <Button variant="primary" onClick={() => setCreating(true)}>New tax rule</Button> : undefined} />
    <Card>
      <Async state={rules}>{() => (rules.data ?? []).length === 0 ? <Empty title="No tax rules configured yet" hint={canCreate ? 'Open the first rule for a jurisdiction.' : undefined} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Type</th><th>Jurisdiction</th><th className="r">Rate</th><th>Basis</th><th>Version</th><th>Effective</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
          <tbody>{(rules.data ?? []).map((r) => {
            const active = r.effectiveFrom <= todayStr && (!r.effectiveTo || r.effectiveTo >= todayStr);
            return <tr key={r.id}>
              <td>{TYPE_LABEL[r.type] ?? r.type}</td>
              <td className="mono">{r.jurisdiction}</td>
              <td className="r num">{Number(r.rate).toFixed(2)}%</td>
              <td className="small">{r.inclusiveOfPrice ? 'Inclusive' : 'Exclusive'}</td>
              <td className="num">v{r.ruleVersion}</td>
              <td className="small">{r.effectiveFrom} – {r.effectiveTo ?? 'open'}</td>
              <td><Badge tone={active ? 'ok' : r.effectiveTo ? 'bad' : undefined}>{active ? 'In force' : r.effectiveTo ? 'Closed' : 'Scheduled'}</Badge></td>
              {canEdit && <td>{!r.effectiveTo && <CloseRule rule={r} onDone={rules.reload} />}</td>}
            </tr>;
          })}</tbody>
        </table></div>
      )}</Async>
    </Card>
    <Modal open={creating} onClose={() => setCreating(false)} title="New tax rule">
      <TaxRuleForm onCancel={() => setCreating(false)} onDone={() => { setCreating(false); rules.reload(); }} />
    </Modal>
  </>;
}
