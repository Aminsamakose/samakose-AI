'use client';
import { api, ApiFail } from '@/lib/client/api';
import { Button, Field, FormError, useForm } from '@/components/ui';

const clientFail = (fields: Record<string, string>) => new ApiFail(422, 'validation', 'Check the highlighted fields and try again.', fields);
const PROVIDER_SOURCES = [{ value: 'SAMAKOSE_NETWORK', label: 'Samakose network' }, { value: 'BRING_YOUR_OWN', label: "Bring your own (the funder's own providers)" }, { value: 'HYBRID', label: 'Hybrid' }];

function parseJsonField(raw: string, field: string, errs: Record<string, string>, fallback: unknown) {
  if (!raw.trim()) return fallback;
  try { return JSON.parse(raw); } catch { errs[field] = 'Must be valid JSON'; return fallback; }
}

export function CreateWorkspaceForm({ programmeId, onDone, onCancel }: { programmeId: string; onDone: () => void; onCancel: () => void }) {
  const f = useForm({ name: '', providerSource: 'SAMAKOSE_NETWORK', participantConsentRequired: true, funderReportingEnabled: false }, async (v) => {
    return api.post(`/programmes/${programmeId}/workspace`, {
      name: v.name.trim() || undefined, providerSource: v.providerSource, participantConsentRequired: v.participantConsentRequired, funderReportingEnabled: v.funderReportingEnabled
    });
  }, { success: 'Workspace created — you are its first programme manager', onDone });

  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <p className="small muted">Opens the single delivery workspace for this programme and makes you its first programme manager. A programme can only have one workspace.</p>
    <Field label="Workspace name" name="name" hint="Defaults to the programme's own name.">{(p) => <input {...p} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} maxLength={160} />}</Field>
    <Field label="Provider source" name="providerSource">{() => <select value={f.values.providerSource} onChange={(e) => f.set('providerSource', e.target.value)}>
      {PROVIDER_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>}</Field>
    <Field label="Participant consent" name="participantConsentRequired">{() => <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.participantConsentRequired} onChange={(e) => f.set('participantConsentRequired', e.target.checked)} />Require participant consent before onboarding</label>}</Field>
    <Field label="Funder reporting" name="funderReportingEnabled">{() => <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.funderReportingEnabled} onChange={(e) => f.set('funderReportingEnabled', e.target.checked)} />Enable funder-facing reporting</label>}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Create workspace</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

export type ConfigDraft = {
  configuration: Record<string, unknown>; objectives: unknown[]; eligibilityRules: Record<string, unknown>;
  deliveryModel: Record<string, unknown>; reporting: Record<string, unknown>; entitlements: unknown[];
  frameworkVersionId: string | null; participantConsentRequired: boolean; funderReportingEnabled: boolean;
};

/** Creates a new configuration draft, either fresh or pre-filled from a rejected version (revise). */
export function ConfigurationDraftForm({ workspaceId, initial, onDone, onCancel }: { workspaceId: string; initial?: ConfigDraft; onDone: () => void; onCancel: () => void }) {
  const j = (v: unknown) => JSON.stringify(v ?? (Array.isArray(v) ? [] : {}), null, 2);
  const f = useForm({
    configuration: initial ? j(initial.configuration) : '', objectives: initial ? j(initial.objectives) : '',
    eligibilityRules: initial ? j(initial.eligibilityRules) : '', deliveryModel: initial ? j(initial.deliveryModel) : '',
    reporting: initial ? j(initial.reporting) : '', entitlements: initial ? j(initial.entitlements) : '',
    frameworkVersionId: initial?.frameworkVersionId ?? '', participantConsentRequired: initial?.participantConsentRequired ?? true,
    funderReportingEnabled: initial?.funderReportingEnabled ?? false, changeReason: ''
  }, async (v) => {
    const errs: Record<string, string> = {};
    const configuration = parseJsonField(v.configuration, 'configuration', errs, {});
    const objectives = parseJsonField(v.objectives, 'objectives', errs, []);
    const eligibilityRules = parseJsonField(v.eligibilityRules, 'eligibilityRules', errs, {});
    const deliveryModel = parseJsonField(v.deliveryModel, 'deliveryModel', errs, {});
    const reporting = parseJsonField(v.reporting, 'reporting', errs, {});
    const entitlements = parseJsonField(v.entitlements, 'entitlements', errs, []);
    if (Object.keys(errs).length) throw clientFail(errs);
    return api.post(`/programme-workspaces/${workspaceId}/configurations`, {
      configuration, objectives, eligibilityRules, deliveryModel, reporting, entitlements,
      frameworkVersionId: v.frameworkVersionId.trim() || null,
      participantConsentRequired: v.participantConsentRequired, funderReportingEnabled: v.funderReportingEnabled,
      changeReason: v.changeReason.trim() || undefined
    });
  }, { success: 'Configuration draft created', onDone });

  return <form onSubmit={f.onSubmit} className="stack" noValidate>
    <FormError message={f.formError} />
    <p className="small muted">A draft is not used until it is submitted and approved by a reviewer or administrator. Fields left blank default to an empty object or list.</p>
    <Field label="Objectives (JSON list)" name="objectives" error={f.errors.objectives}>{(p) => <textarea {...p} value={f.values.objectives} onChange={(e) => f.set('objectives', e.target.value)} rows={3} className="mono" placeholder="[]" />}</Field>
    <Field label="Eligibility rules (JSON)" name="eligibilityRules" error={f.errors.eligibilityRules}>{(p) => <textarea {...p} value={f.values.eligibilityRules} onChange={(e) => f.set('eligibilityRules', e.target.value)} rows={3} className="mono" placeholder="{}" />}</Field>
    <Field label="Delivery model (JSON)" name="deliveryModel" error={f.errors.deliveryModel}>{(p) => <textarea {...p} value={f.values.deliveryModel} onChange={(e) => f.set('deliveryModel', e.target.value)} rows={3} className="mono" placeholder="{}" />}</Field>
    <Field label="Reporting (JSON)" name="reporting" error={f.errors.reporting}>{(p) => <textarea {...p} value={f.values.reporting} onChange={(e) => f.set('reporting', e.target.value)} rows={3} className="mono" placeholder="{}" />}</Field>
    <Field label="Entitlements (JSON list)" name="entitlements" error={f.errors.entitlements} hint='e.g. [{"key":"EXPERT","limit":5}]'>{(p) => <textarea {...p} value={f.values.entitlements} onChange={(e) => f.set('entitlements', e.target.value)} rows={3} className="mono" placeholder="[]" />}</Field>
    <Field label="General configuration (JSON)" name="configuration" error={f.errors.configuration}>{(p) => <textarea {...p} value={f.values.configuration} onChange={(e) => f.set('configuration', e.target.value)} rows={3} className="mono" placeholder="{}" />}</Field>
    <Field label="Framework version ID" name="frameworkVersionId" hint="Optional.">{(p) => <input {...p} value={f.values.frameworkVersionId} onChange={(e) => f.set('frameworkVersionId', e.target.value)} maxLength={40} />}</Field>
    <Field label="Participant consent" name="participantConsentRequired">{() => <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.participantConsentRequired} onChange={(e) => f.set('participantConsentRequired', e.target.checked)} />Require participant consent before onboarding</label>}</Field>
    <Field label="Funder reporting" name="funderReportingEnabled">{() => <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.values.funderReportingEnabled} onChange={(e) => f.set('funderReportingEnabled', e.target.checked)} />Enable funder-facing reporting</label>}</Field>
    <Field label="Reason for this change" name="changeReason" hint="Optional, shown alongside the draft.">{(p) => <textarea {...p} value={f.values.changeReason} onChange={(e) => f.set('changeReason', e.target.value)} rows={2} maxLength={1000} />}</Field>
    <div className="form-actions"><Button variant="primary" type="submit" loading={f.busy}>Save draft</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
