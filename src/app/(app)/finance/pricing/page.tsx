'use client';
import { useMemo, useState } from 'react';
import { api, ghs } from '@/lib/client/api';
import { Async, Badge, Button, Card, FormError, PageHead, Tabs, useApi, useToast } from '@/components/ui';
import { useMe, useTitle } from '@/components/finance/common';

const PLATFORMS = ['SME', 'AGRIFOOD', 'ESO'] as const;
const PLATFORM_LABEL: Record<string, string> = { SME: 'SME360', AGRIFOOD: 'AgriFood360', ESO: 'ESO360' };
const SETUPS = ['samakose_only', 'partner_only', 'both'] as const;
const SETUP_LABEL: Record<string, string> = { samakose_only: 'Samakose tool', partner_only: 'Partner tools', both: 'Both' };
const STATUS_TONE: Record<string, string | undefined> = { draft: undefined, pending_approval: undefined, approved: 'ok', rejected: 'bad', published: 'ok', superseded: 'bad' };
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', pending_approval: 'Pending approval', approved: 'Approved (not yet published)', rejected: 'Rejected', published: 'Published', superseded: 'Superseded' };

type Pkg = { key: string; name: string; durationLabel: string; durationDays: number | null; sortOrder: number; pricesGhs: Partial<Record<string, number>> };
type Rule = { setup: string; discountPct: number; oneSamakosePlatformOnly: boolean; partnerToolsNameRequired: boolean; customerFacingNote: string | null };
type IndivAssessment = { key: string; name: string; enabled: boolean; priceGhs: number | null };
type PricingData = { platforms: Record<string, { enabled: boolean }>; packages: Pkg[]; programmeRules: Rule[]; individualAssessments: IndivAssessment[]; tax: { mode: string; components: { name: string; pct: number }[]; confirmedBy: string | null; confirmedAt: string | null } };
type Config = { id: string; code: string; status: string; data: PricingData; isPublished: boolean; submittedBy: string | null; createdAt: string; updatedAt: string; rejectionReason: string | null };

function newPackageKey(existing: Pkg[]) { let n = existing.length + 1; while (existing.some((p) => p.key === `package_${n}`)) n++; return `package_${n}`; }

export default function PricingConsolePage() {
  useTitle('Pricing console');
  const me = useMe(); const toast = useToast();
  const canEdit = me.can('pricing', 'edit'), canApprove = me.can('pricing', 'approve');
  const draftState = useApi<Config>('/pricing/draft');
  const publishedState = useApi<Config | null>('/pricing/published');
  const historyState = useApi<Config[]>('/pricing/configs');
  const [tab, setTab] = useState('overview');
  const [local, setLocal] = useState<PricingData | null>(null);
  const [err, setErr] = useState<Record<string, string> | string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sampleParticipants, setSampleParticipants] = useState(30);
  const [sampleSetup, setSampleSetup] = useState<string>('samakose_only');
  const [samplePlatform, setSamplePlatform] = useState<string>('SME');
  const [samplePackage, setSamplePackage] = useState<string>('');

  const draft = draftState.data; const data = local ?? draft?.data ?? null;
  const isEditable = draft && (draft.status === 'draft' || draft.status === 'rejected');

  const setData = (updater: (d: PricingData) => PricingData) => { if (!data) return; setLocal(updater(data)); };

  const save = async () => {
    if (!draft || !data) return;
    setSaving(true); setErr(null);
    try { await api.patch(`/pricing/configs/${draft.id}`, { data }); toast('Draft saved'); draftState.reload(); }
    catch (e: any) { setErr(e?.fields ?? e?.message ?? 'Could not save the draft'); }
    finally { setSaving(false); }
  };
  const submit = async () => {
    if (!draft) return;
    await save();
    try { await api.post(`/pricing/configs/${draft.id}/submit`, {}); toast('Submitted for Finance approval'); draftState.reload(); historyState.reload(); }
    catch (e: any) { setErr(e?.fields ?? e?.message ?? 'Could not submit for approval'); }
  };
  const decide = async (id: string, action: 'approve' | 'reject', reason?: string) => {
    try { await api.post(`/pricing/configs/${id}/${action}`, action === 'reject' ? { reason } : {}); toast(action === 'approve' ? 'Approved' : 'Rejected'); draftState.reload(); historyState.reload(); }
    catch (e: any) { toast(e?.message ?? 'Could not record the decision', 'bad'); }
  };
  const publish = async (id: string) => {
    try { await api.post(`/pricing/configs/${id}/publish`, {}); toast('Published — now live on the customer pricing page'); publishedState.reload(); historyState.reload(); draftState.reload(); }
    catch (e: any) { toast(e?.message ?? 'Could not publish', 'bad'); }
  };

  const pendingForApproval = useMemo(() => (historyState.data ?? []).filter((c) => c.status === 'pending_approval'), [historyState.data]);
  const approvedNotPublished = useMemo(() => (historyState.data ?? []).filter((c) => c.status === 'approved'), [historyState.data]);

  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'platforms', label: 'Platforms' },
    { id: 'packages', label: 'Pricing & packages' },
    { id: 'programme', label: 'Programme rules' },
    { id: 'individual', label: 'Individual assessments' },
    { id: 'tax', label: 'Tax & checkout' },
    { id: 'history', label: 'Change history' },
    { id: 'team', label: 'Team & permissions' }
  ];

  return <>
    <PageHead title="Pricing & packages" sub="Manage list prices by platform, configure programme discounts and tax display, then submit for Finance approval before anything reaches customers."
      actions={<span className="row" style={{ gap: 8 }}>
        {draft && <Badge tone={STATUS_TONE[draft.status]}>{STATUS_LABEL[draft.status] ?? draft.status}</Badge>}
        {isEditable && canEdit && <Button onClick={save} loading={saving}>Save draft</Button>}
        {isEditable && canEdit && <Button variant="primary" onClick={submit} loading={saving}>Submit for approval</Button>}
      </span>} />
    {typeof err === 'string' && <FormError message={err} />}
    {err && typeof err === 'object' && <div className="alert bad" role="alert">{Object.values(err).join(' · ')}</div>}
    {draft?.status === 'rejected' && draft.rejectionReason && <div className="alert bad" role="note" style={{ marginBottom: 12 }}><strong>Rejected:</strong> {draft.rejectionReason}. Edit and resubmit below.</div>}
    {!canEdit && !canApprove && <div className="alert warn" role="note" style={{ marginBottom: 12 }}>You have read-only access to pricing. Ask an administrator or Finance approver for changes.</div>}

    <Tabs tabs={sections} active={tab} onChange={setTab} />

    <Async state={draftState}>{() => !data ? null : <>
      {tab === 'overview' && (
        <Card title="Status at a glance">
          <div className="grid" style={{ gap: 12 }}>
            <div><strong>Current draft:</strong> {STATUS_LABEL[draft!.status]} ({draft!.code}), last updated {new Date(draft!.updatedAt).toLocaleString('en-GB')}</div>
            <div><strong>Live published configuration:</strong> {publishedState.data ? `${publishedState.data.code}, published ${new Date((publishedState.data as any).publishedAt ?? publishedState.data.updatedAt).toLocaleString('en-GB')}` : 'Nothing published yet — customers see no live prices.'}</div>
            {pendingForApproval.length > 0 && <div className="alert warn" role="note">{pendingForApproval.length} submission{pendingForApproval.length === 1 ? '' : 's'} pending Finance approval.</div>}
            {approvedNotPublished.length > 0 && <div className="alert warn" role="note">{approvedNotPublished.length} approved configuration{approvedNotPublished.length === 1 ? '' : 's'} not yet published.</div>}
          </div>
        </Card>
      )}

      {tab === 'platforms' && (
        <Card title="Platforms">
          <p className="muted small">Enable or pause a platform for customer selection. Pausing hides it from new purchases; existing contracts are unaffected.</p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {PLATFORMS.map((p) => (
              <label key={p} className="card" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" disabled={!isEditable || !canEdit} checked={!!data.platforms[p]?.enabled}
                  onChange={(e) => setData((d) => ({ ...d, platforms: { ...d.platforms, [p]: { enabled: e.target.checked } } }))} />
                <span>{PLATFORM_LABEL[p]}</span>
              </label>
            ))}
          </div>
        </Card>
      )}

      {tab === 'packages' && (
        <Card title="Business packages" actions={isEditable && canEdit ? <Button size="sm" onClick={() => setData((d) => ({ ...d, packages: [...d.packages, { key: newPackageKey(d.packages), name: 'New package', durationLabel: '', durationDays: null, sortOrder: d.packages.length, pricesGhs: {} }] }))}>Add package</Button> : undefined}>
          <p className="muted small">Prices are in Ghana cedis. Duration is included in each package's price — no separate monthly charge is applied.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Package</th><th>Duration</th>{PLATFORMS.map((p) => <th key={p} className="r">{PLATFORM_LABEL[p]}</th>)}{isEditable && canEdit && <th /> }</tr></thead>
            <tbody>{data.packages.map((pkg, i) => (
              <tr key={pkg.key}>
                <td><input disabled={!isEditable || !canEdit} value={pkg.name} onChange={(e) => setData((d) => { const ps = [...d.packages]; ps[i] = { ...ps[i], name: e.target.value }; return { ...d, packages: ps }; })} style={{ width: 160 }} aria-label="Package name" /></td>
                <td><input disabled={!isEditable || !canEdit} value={pkg.durationLabel} placeholder="e.g. 30 days" onChange={(e) => setData((d) => { const ps = [...d.packages]; ps[i] = { ...ps[i], durationLabel: e.target.value }; return { ...d, packages: ps }; })} style={{ width: 120 }} aria-label="Duration label" /></td>
                {PLATFORMS.map((p) => (
                  <td key={p} className="r num">
                    <input disabled={!isEditable || !canEdit} type="number" min={0} step="0.01" value={pkg.pricesGhs[p] ?? ''} placeholder="Not priced"
                      onChange={(e) => setData((d) => { const ps = [...d.packages]; const price = e.target.value === '' ? undefined : Number(e.target.value); ps[i] = { ...ps[i], pricesGhs: { ...ps[i].pricesGhs, [p]: price } }; return { ...d, packages: ps }; })}
                      style={{ width: 100, textAlign: 'right' }} aria-label={`${pkg.name} price for ${PLATFORM_LABEL[p]}`} />
                  </td>
                ))}
                {isEditable && canEdit && <td><Button size="sm" variant="danger" onClick={() => setData((d) => ({ ...d, packages: d.packages.filter((_, j) => j !== i) }))}>Remove</Button></td>}
              </tr>
            ))}</tbody>
          </table></div>
          {!data.packages.length && <p className="muted small">No packages configured yet.</p>}
        </Card>
      )}

      {tab === 'programme' && (
        <Card title="Programme cohort discounts">
          <p className="muted small">Cohort subtotal = participant count × package price × (1 − discount). Tax, when shown, is applied after this discount.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Tool setup</th><th className="r">Discount</th><th>One Samakose platform only</th><th>Partner must be named</th><th>Customer-facing note</th></tr></thead>
            <tbody>{data.programmeRules.map((r, i) => (
              <tr key={r.setup}>
                <td>{SETUP_LABEL[r.setup]}</td>
                <td className="r"><input disabled={!isEditable || !canEdit} type="number" min={0} max={100} step="0.1" value={r.discountPct} style={{ width: 80, textAlign: 'right' }}
                  onChange={(e) => setData((d) => { const rs = [...d.programmeRules]; rs[i] = { ...rs[i], discountPct: Number(e.target.value) }; return { ...d, programmeRules: rs }; })} aria-label={`${SETUP_LABEL[r.setup]} discount percent`} />%</td>
                <td><input type="checkbox" checked={r.oneSamakosePlatformOnly} disabled readOnly /></td>
                <td><input type="checkbox" checked={r.partnerToolsNameRequired} disabled readOnly /></td>
                <td><input disabled={!isEditable || !canEdit} value={r.customerFacingNote ?? ''} style={{ width: 220 }} onChange={(e) => setData((d) => { const rs = [...d.programmeRules]; rs[i] = { ...rs[i], customerFacingNote: e.target.value || null }; return { ...d, programmeRules: rs }; })} aria-label={`${SETUP_LABEL[r.setup]} note`} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}

      {tab === 'individual' && (
        <Card title="Individual assessments (coming soon)" actions={isEditable && canEdit ? <Button size="sm" onClick={() => setData((d) => ({ ...d, individualAssessments: [...d.individualAssessments, { key: `indiv_${d.individualAssessments.length + 1}`, name: 'New assessment', enabled: false, priceGhs: null }] }))}>Add assessment type</Button> : undefined}>
          <p className="muted small">Configure future individual-entrepreneur diagnostics (e.g. SWOT, E-Readiness). An item stays unavailable for purchase until explicitly enabled with a real price.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Enabled for purchase</th><th className="r">Price (GH₵)</th>{isEditable && canEdit && <th />}</tr></thead>
            <tbody>{data.individualAssessments.map((a, i) => (
              <tr key={a.key}>
                <td><input disabled={!isEditable || !canEdit} value={a.name} onChange={(e) => setData((d) => { const xs = [...d.individualAssessments]; xs[i] = { ...xs[i], name: e.target.value }; return { ...d, individualAssessments: xs }; })} /></td>
                <td><input type="checkbox" disabled={!isEditable || !canEdit} checked={a.enabled} onChange={(e) => setData((d) => { const xs = [...d.individualAssessments]; xs[i] = { ...xs[i], enabled: e.target.checked }; return { ...d, individualAssessments: xs }; })} /></td>
                <td className="r"><input disabled={!isEditable || !canEdit} type="number" min={0} step="0.01" value={a.priceGhs ?? ''} onChange={(e) => setData((d) => { const xs = [...d.individualAssessments]; xs[i] = { ...xs[i], priceGhs: e.target.value === '' ? null : Number(e.target.value) }; return { ...d, individualAssessments: xs }; })} style={{ width: 100, textAlign: 'right' }} /></td>
                {isEditable && canEdit && <td><Button size="sm" variant="danger" onClick={() => setData((d) => ({ ...d, individualAssessments: d.individualAssessments.filter((_, j) => j !== i) }))}>Remove</Button></td>}
              </tr>
            ))}</tbody>
          </table></div>
          {!data.individualAssessments.length && <p className="muted small">Nothing configured — the customer flow will keep showing "Individual · Coming soon" with no price.</p>}
        </Card>
      )}

      {tab === 'tax' && (
        <Card title="Tax & checkout">
          <p className="muted small">Rates are editable assumptions, not tax advice. Confirm supplier registration, service treatment, calculation basis and effective date with Finance before switching to Confirmed. Tax is always calculated after the programme discount.</p>
          <div style={{ maxWidth: 320, marginBottom: 12 }}>
            <label className="small" htmlFor="taxmode">Tax display mode</label>
            <select id="taxmode" disabled={!isEditable || !canEdit} value={data.tax.mode} onChange={(e) => setData((d) => ({ ...d, tax: { ...d.tax, mode: e.target.value, confirmedBy: e.target.value === 'confirmed' ? d.tax.confirmedBy : null } }))}>
              <option value="estimate">Estimate only · not confirmed</option>
              <option value="confirmed">Confirmed and applied</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
          {data.tax.mode === 'confirmed' && (
            <div style={{ maxWidth: 320, marginBottom: 12 }}>
              <label className="small" htmlFor="confirmedby">Confirmed by (Finance)</label>
              <input id="confirmedby" disabled={!isEditable || !canEdit} value={data.tax.confirmedBy ?? ''} onChange={(e) => setData((d) => ({ ...d, tax: { ...d.tax, confirmedBy: e.target.value || null, confirmedAt: new Date().toISOString() } }))} />
            </div>
          )}
          {data.tax.mode !== 'hidden' && <div className="table-wrap"><table>
            <thead><tr><th>Component</th><th className="r">Rate</th>{isEditable && canEdit && <th />}</tr></thead>
            <tbody>{data.tax.components.map((c, i) => (
              <tr key={i}>
                <td><input disabled={!isEditable || !canEdit} value={c.name} onChange={(e) => setData((d) => { const cs = [...d.tax.components]; cs[i] = { ...cs[i], name: e.target.value }; return { ...d, tax: { ...d.tax, components: cs } }; })} style={{ width: 160 }} /></td>
                <td className="r"><input disabled={!isEditable || !canEdit} type="number" min={0} max={100} step="0.1" value={c.pct} onChange={(e) => setData((d) => { const cs = [...d.tax.components]; cs[i] = { ...cs[i], pct: Number(e.target.value) }; return { ...d, tax: { ...d.tax, components: cs } }; })} style={{ width: 80, textAlign: 'right' }} />%</td>
                {isEditable && canEdit && <td><Button size="sm" variant="danger" onClick={() => setData((d) => ({ ...d, tax: { ...d.tax, components: d.tax.components.filter((_, j) => j !== i) } }))}>Remove</Button></td>}
              </tr>
            ))}</tbody>
          </table></div>}
          {isEditable && canEdit && data.tax.mode !== 'hidden' && <Button size="sm" onClick={() => setData((d) => ({ ...d, tax: { ...d.tax, components: [...d.tax.components, { name: '', pct: 0 }] } }))}>Add tax component</Button>}
        </Card>
      )}

      {tab === 'history' && (
        <Async state={historyState}>{(rows) => <Card title="Change history">
          <div className="table-wrap"><table>
            <thead><tr><th>Code</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td className="mono small">{c.code}</td>
                <td><Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status] ?? c.status}</Badge>{c.rejectionReason && <div className="small muted">{c.rejectionReason}</div>}</td>
                <td className="small muted">{new Date(c.updatedAt).toLocaleString('en-GB')}</td>
                <td>{c.status === 'pending_approval' && canApprove && <span className="row" style={{ gap: 6 }}>
                  <Button size="sm" onClick={() => decide(c.id, 'approve')}>Approve</Button>
                  <Button size="sm" variant="danger" onClick={() => { const reason = window.prompt('Reason for rejecting this submission:'); if (reason) decide(c.id, 'reject', reason); }}>Reject</Button>
                </span>}
                  {c.status === 'approved' && canApprove && <Button size="sm" variant="primary" onClick={() => publish(c.id)}>Publish</Button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>}</Async>
      )}

      {tab === 'team' && (
        <Card title="Team & permissions">
          <p className="muted small">Who may edit a draft, approve a submission, and publish, as granted by role. The person who submits a draft may never approve or publish it themselves — enforced automatically, regardless of role.</p>
          <ul>
            <li><strong>Edit drafts:</strong> Admin, Finance</li>
            <li><strong>Approve / reject / publish:</strong> Admin, Finance, Executive (read-only for Executive)</li>
          </ul>
        </Card>
      )}
    </>}</Async>

    <Card title="Customer preview" className="mt">
      <p className="muted small">This mirrors what a customer would see from the active draft. Previewing never publishes anything.</p>
      {data && <PreviewPanel data={data} sampleParticipants={sampleParticipants} setSampleParticipants={setSampleParticipants} sampleSetup={sampleSetup} setSampleSetup={setSampleSetup} samplePlatform={samplePlatform} setSamplePlatform={setSamplePlatform} samplePackage={samplePackage || data.packages[0]?.key || ''} setSamplePackage={setSamplePackage} />}
    </Card>
  </>;
}

function PreviewPanel({ data, sampleParticipants, setSampleParticipants, sampleSetup, setSampleSetup, samplePlatform, setSamplePlatform, samplePackage, setSamplePackage }: {
  data: PricingData; sampleParticipants: number; setSampleParticipants: (n: number) => void; sampleSetup: string; setSampleSetup: (s: string) => void; samplePlatform: string; setSamplePlatform: (s: string) => void; samplePackage: string; setSamplePackage: (s: string) => void;
}) {
  const [mode, setMode] = useState<'one' | 'programme'>('programme');
  const pkg = data.packages.find((p) => p.key === samplePackage) ?? data.packages[0];
  const rule = data.programmeRules.find((r) => r.setup === sampleSetup);
  const applyTax = (subtotal: number) => {
    if (data.tax.mode === 'hidden') return { lines: [] as { name: string; amountGhs: number }[], taxGhs: 0, totalGhs: subtotal };
    const lines = data.tax.components.map((c) => ({ name: c.name, amountGhs: Math.round(subtotal * (c.pct / 100) * 100) / 100 }));
    const taxGhs = Math.round(lines.reduce((s, l) => s + l.amountGhs, 0) * 100) / 100;
    return { lines, taxGhs, totalGhs: Math.round((subtotal + taxGhs) * 100) / 100 };
  };

  if (!pkg) return <p className="muted small">Add a package to see a preview.</p>;

  const listPrice = pkg.pricesGhs[samplePlatform] ?? Object.values(pkg.pricesGhs)[0] ?? 0;
  let body: React.ReactNode;
  if (mode === 'one') {
    const tax = applyTax(listPrice);
    body = <div className="grid" style={{ gap: 4 }}>
      <div><strong>{pkg.name}</strong> · {PLATFORM_LABEL[samplePlatform]} · {pkg.durationLabel}</div>
      <div>Estimated subtotal before tax: {ghs(listPrice)}</div>
      {tax.lines.map((l) => <div key={l.name} className="small muted">{l.name}: {ghs(l.amountGhs)}</div>)}
      <div><strong>Estimated total including tax: {ghs(tax.totalGhs)}</strong></div>
      <div className="small muted">Final amount confirmed before payment.</div>
    </div>;
  } else {
    const listSubtotal = sampleParticipants * listPrice;
    const discountAmount = rule ? listSubtotal * (rule.discountPct / 100) : 0;
    const discounted = listSubtotal - discountAmount;
    const tax = applyTax(discounted);
    body = <div className="grid" style={{ gap: 4 }}>
      <div><strong>{pkg.name}</strong> · {pkg.durationLabel} · {sampleParticipants} businesses · {SETUP_LABEL[sampleSetup]}</div>
      <div>Estimated subtotal before tax: {ghs(listSubtotal)}</div>
      <div>Programme discount ({rule?.discountPct ?? 0}%): -{ghs(discountAmount)}</div>
      {tax.lines.map((l) => <div key={l.name} className="small muted">{l.name}: {ghs(l.amountGhs)}</div>)}
      <div><strong>Estimated total including tax: {ghs(tax.totalGhs)}</strong></div>
      <div className="small muted">Final amount confirmed before payment.</div>
    </div>;
  }

  return <div className="grid" style={{ gap: 10 }}>
    <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
      <select value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="one">One-business purchase</option><option value="programme">Programme cohort purchase</option></select>
      <select value={samplePackage} onChange={(e) => setSamplePackage(e.target.value)}>{data.packages.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
      <select value={samplePlatform} onChange={(e) => setSamplePlatform(e.target.value)}>{PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select>
      {mode === 'programme' && <>
        <select value={sampleSetup} onChange={(e) => setSampleSetup(e.target.value)}>{SETUPS.map((s) => <option key={s} value={s}>{SETUP_LABEL[s]}</option>)}</select>
        <input type="number" min={1} value={sampleParticipants} onChange={(e) => setSampleParticipants(Math.max(1, Number(e.target.value)))} style={{ width: 90 }} aria-label="Sample participant count" />
      </>}
    </div>
    {body}
  </div>;
}
