'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiFail, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Field, FormError, useApi, useToast } from '@/components/ui';

type Rule = { key: string; value: number | string; default: number | string; note: string | null; changed: boolean; updatedAt: string | null };
const GROUPS: { id: string; title: string; about: string; match: (k: string) => boolean }[] = [
  { id: 'evidence', title: 'Evidence weighting', about: 'How much of an owner\'s answer counts toward a score, depending on how well it is backed by evidence. Use values from 0 to 1.', match: (k) => k.startsWith('evidence.') },
  { id: 'validation', title: 'Data quality gate', about: 'A diagnostic below this completion level is rejected instead of scored. Use a value from 0.5 to 1.', match: (k) => k.startsWith('validation.') },
  { id: 'maturity', title: 'Maturity bands', about: 'Score thresholds between Critical, Fragile, Developing and Strong. Critical must be below Fragile, and Fragile below Developing.', match: (k) => k.startsWith('maturity.') },
  { id: 'confidence', title: 'Confidence levels', about: 'How much verified evidence a score needs before it is called High or Medium confidence. The High share must be above the Medium share.', match: (k) => k.startsWith('confidence.') },
  { id: 'prescription', title: 'Prescription deadlines', about: 'Limits on action deadlines in whole days, from 1 to 730. The longest must be at least the shortest.', match: (k) => k.startsWith('prescription.') },
  { id: 'session', title: 'Coaching', about: 'How many held coaching sessions are needed before a case moves to monitoring. Use a whole number from 1 to 12.', match: (k) => k.startsWith('session.') },
  { id: 'privacy', title: 'Privacy', about: 'Funder views hide any group smaller than this. Use a value from 3 to 50.', match: (k) => k.startsWith('privacy.') }
];
const labelOf = (k: string) => {
  if (k.startsWith('evidence.multiplier.')) return `${k.slice('evidence.multiplier.'.length)} evidence`;
  const last = k.split('.').pop()!;
  return last.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
};
const RANGES: [(k: string) => boolean, (n: number) => boolean, string, boolean?][] = [
  [(k) => k.startsWith('evidence.multiplier.'), (n) => n >= 0 && n <= 1, 'Use a value from 0 to 1'],
  [(k) => k === 'validation.min_completion', (n) => n >= 0.5 && n <= 1, 'Use a value from 0.5 to 1'],
  [(k) => k.startsWith('maturity.'), (n) => n > 0 && n < 100, 'Use a value between 0 and 100'],
  [(k) => k.startsWith('confidence.'), (n) => n > 0 && n <= 1, 'Use a value above 0 and up to 1'],
  [(k) => k === 'privacy.min_cell_size', (n) => n >= 3 && n <= 50, 'Use a value from 3 to 50'],
  [(k) => k.startsWith('prescription.'), (n) => Number.isInteger(n) && n >= 1 && n <= 730, 'Use whole days from 1 to 730'],
  [(k) => k === 'session.min_for_monitoring', (n) => Number.isInteger(n) && n >= 1 && n <= 12, 'Use a whole number from 1 to 12']
];

function RulesForm({ rules, canEdit, reload }: { rules: Rule[]; canEdit: boolean; reload: () => void }) {
  const toast = useToast();
  const initial = useMemo(() => Object.fromEntries(rules.map((r) => [r.key, String(r.value)])), [rules]);
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setVals(initial); }, [initial]);
  const changedKeys = rules.filter((r) => vals[r.key].trim() !== String(r.value)).map((r) => r.key);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(null);
    const errs: Record<string, string> = {}; const values: Record<string, number> = {};
    for (const k of changedKeys) {
      const raw = vals[k].trim(); const n = Number(raw);
      if (raw === '' || Number.isNaN(n)) { errs[k] = 'Enter a number'; continue; }
      const rg = RANGES.find(([m]) => m(k)); if (rg && !rg[1](n)) { errs[k] = rg[2]; continue; }
      values[k] = n;
    }
    setErrors(errs);
    if (Object.keys(errs).length) { setFormError('Some values are not valid. Check the highlighted rules.'); return; }
    setBusy(true);
    try { const r = await api.put<{ changed: number }>('/settings/rules', { values }); toast(`${r.changed} rule${r.changed === 1 ? '' : 's'} saved`); reload(); }
    catch (err) { if (err instanceof ApiFail && err.fields) setErrors(err.fields); setFormError(errText(err)); }
    finally { setBusy(false); }
  };
  const seen = new Set<string>();
  return <form onSubmit={submit} noValidate className="stack">
    <div className="alert info">Rule changes apply to new scores and reviews straight away, and every change is recorded in the audit trail with the old and new value.</div>
    <FormError message={formError} />
    {GROUPS.map((g) => {
      const items = rules.filter((r) => g.match(r.key)); items.forEach((r) => seen.add(r.key));
      return items.length ? <Card key={g.id} title={g.title}>
        <p className="muted small" style={{ marginBottom: 12 }}>{g.about}</p>
        <div className="stack" style={{ gap: 16 }}>{items.map((r) => <RuleRow key={r.key} r={r} value={vals[r.key] ?? ''} error={errors[r.key]} canEdit={canEdit} onChange={(v) => { setVals((x) => ({ ...x, [r.key]: v })); setErrors((x) => { const n = { ...x }; delete n[r.key]; return n; }); }} />)}</div>
      </Card> : null;
    })}
    {rules.filter((r) => !seen.has(r.key)).length > 0 && <Card title="Other rules"><div className="stack" style={{ gap: 16 }}>{rules.filter((r) => !seen.has(r.key)).map((r) => <RuleRow key={r.key} r={r} value={vals[r.key] ?? ''} error={errors[r.key]} canEdit={canEdit} onChange={(v) => setVals((x) => ({ ...x, [r.key]: v }))} />)}</div></Card>}
    {canEdit ? <div className="form-actions"><Button type="submit" variant="primary" loading={busy} disabled={!changedKeys.length}>Save {changedKeys.length ? `${changedKeys.length} change${changedKeys.length === 1 ? '' : 's'}` : 'changes'}</Button>{changedKeys.length > 0 && <Button onClick={() => { setVals(initial); setErrors({}); setFormError(null); }}>Discard changes</Button>}</div> : <p className="muted small">You can view rules but not change them.</p>}
  </form>;
}

function RuleRow({ r, value, error, canEdit, onChange }: { r: Rule; value: string; error?: string; canEdit: boolean; onChange: (v: string) => void }) {
  const differs = value.trim() !== String(r.default);
  return <div className="form-grid" style={{ alignItems: 'start' }}>
    <Field label={labelOf(r.key)} name={r.key} error={error} hint={r.note ?? undefined}>
      {(p) => <input {...p} inputMode="decimal" value={value} disabled={!canEdit} onChange={(e) => onChange(e.target.value)} />}
    </Field>
    <div className="stack" style={{ gap: 4, paddingTop: 24 }}>
      <span className="small muted">Default <span className="num">{String(r.default)}</span>{r.changed && r.updatedAt ? ` · changed ${dateTime(r.updatedAt)}` : ''}</span>
      <span className="row">{r.changed && <Badge tone="info">Changed from default</Badge>}{canEdit && differs && <Button size="sm" onClick={() => onChange(String(r.default))}>Use default</Button>}</span>
    </div>
  </div>;
}

export function RulesEditor({ canEdit }: { canEdit: boolean }) {
  const st = useApi<Rule[]>('/settings/rules');
  return <Async state={st} empty={(d) => d.length === 0}>{(d) => <RulesForm rules={d} canEdit={canEdit} reload={st.reload} />}</Async>;
}
