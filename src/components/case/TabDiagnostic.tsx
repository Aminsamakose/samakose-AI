'use client';
import { useMemo, useRef, useState } from 'react';
import { api, ApiFail, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Modal, useApi, useToast } from '@/components/ui';
import type { TabProps } from './types';
import { CASE_STATE_ORDER, CLASS_TONE, MaturityBadge, pct, useMe } from './core/shared';

type Q = { code: string; dimension: string; text: string; weight: number };
type Diag = { id: string; code: string; status: string; source: string; completion: string | number; validationNotes: string | null; version: number; createdAt: string };
type Doc = { id: string; code: string; filename: string };
type Ans = { value: string; evidence: string; ref: string; note: string };
type Gate = { ok: boolean; problems: string[]; completion: number };
type Done = { version: number; overall: number; maturity: string; confidenceClass: string; caseStatus: string };

const ALL_CLASSES = ['Self-reported', 'Document-supported', 'Verified', 'Unverified', 'Missing'];
const OWNER_CLASSES = ['Self-reported', 'Document-supported', 'Unverified', 'Missing'];
const SCALE = ['0', '1', '2', '3', '4'];
const blank = (): Ans => ({ value: '', evidence: 'Self-reported', ref: '', note: '' });

export default function TabDiagnostic({ caseId, caseData, role, reload }: TabProps) {
  const { can, ready } = useMe();
  const qs = useApi<Q[]>('/questions');
  const hist = useApi<Diag[]>(`/cases/${caseId}/diagnostics`);
  const docs = useApi<Doc[]>(ready && can('documents', 'read') ? `/documents?caseId=${caseId}` : null);
  const canSubmit = can('diagnostics', 'create');
  const stateOk = CASE_STATE_ORDER.indexOf(caseData.status) >= CASE_STATE_ORDER.indexOf('PROFILED');
  const latestValidated = (hist.data ?? []).find((d) => d.status === 'Validated');
  return <div className="stack">
    {canSubmit && <Async state={qs} empty={(q) => q.length === 0}>{(questions) => (
      <Form caseId={caseId} questions={questions} role={role} docs={docs.data ?? []} stateOk={stateOk} status={caseData.status}
        nextVersion={(hist.data ?? []).filter((d) => d.status === 'Validated').length ? Math.max(...(hist.data ?? []).filter((d) => d.status === 'Validated').map((d) => d.version)) + 1 : 1}
        canPrefill={can('scores', 'read') && role !== 'OWNER' && !!latestValidated}
        onSaved={() => { hist.reload(); reload(); }} />
    )}</Async>}
    <Card title="Previous versions">
      <Async state={hist} empty={(d) => d.length === 0}>{(rows) => (
        <div className="table-wrap"><table>
          <caption className="sr">Diagnostic submissions, newest first</caption>
          <thead><tr><th>Version</th><th>Reference</th><th>Status</th><th>Source</th><th className="r">Completion</th><th>Submitted</th><th>Notes</th></tr></thead>
          <tbody>{rows.map((d) => <tr key={d.id}>
            <td>{d.status === 'Validated' ? `v${d.version}` : '-'}{d.id === latestValidated?.id && <> <Badge tone="brand">Current</Badge></>}</td>
            <td className="mono">{d.code}</td>
            <td><Badge tone={d.status === 'Validated' ? 'ok' : 'bad'}>{d.status}</Badge></td>
            <td>{d.source === 'kobo' ? 'Field survey (Kobo)' : 'Web form'}</td>
            <td className="r num">{pct(d.completion)}</td>
            <td>{dateTime(d.createdAt)}</td>
            <td>{d.validationNotes ?? '-'}</td></tr>)}</tbody>
        </table></div>
      )}</Async>
      {hist.data && hist.data.length === 0 && <Empty title="No diagnostic has been submitted" hint={canSubmit ? 'Complete the questionnaire above to create the first version.' : 'A consultant or the business owner completes the questionnaire.'} />}
    </Card>
  </div>;
}

function Form({ caseId, questions, role, docs, stateOk, status, nextVersion, canPrefill, onSaved }: {
  caseId: string; questions: Q[]; role: string; docs: Doc[]; stateOk: boolean; status: string; nextVersion: number; canPrefill: boolean; onSaved: () => void;
}) {
  const toast = useToast();
  const classes = role === 'OWNER' ? OWNER_CLASSES : ALL_CLASSES;
  const [ans, setAns] = useState<Record<string, Ans>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [gate, setGate] = useState<Gate | null>(null);
  const [blocked, setBlocked] = useState<{ problems: string[]; completion?: number } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'check' | 'submit'>('');
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const uuid = useRef<string>(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()));

  const groups = useMemo(() => { const m = new Map<string, Q[]>(); questions.forEach((q) => m.set(q.dimension, [...(m.get(q.dimension) ?? []), q])); return [...m.entries()]; }, [questions]);
  const get = (c: string) => ans[c] ?? blank();
  const patch = (c: string, p: Partial<Ans>) => { setAns((a) => ({ ...a, [c]: { ...(a[c] ?? blank()), ...p } })); setErrs((e) => { if (!e[c]) return e; const n = { ...e }; delete n[c]; return n; }); setGate(null); setBlocked(null); };
  const answered = questions.filter((q) => get(q.code).value !== '').length;
  const completion = questions.length ? answered / questions.length : 0;

  /** Per-question checks that mirror the server rules. */
  const validate = () => {
    const e: Record<string, string> = {};
    for (const q of questions) {
      const a = get(q.code);
      if (a.value === '') { if (a.note || a.ref) e[q.code] = 'Choose a value from 0 to 4 or clear this answer'; continue; }
      const n = Number(a.value);
      if (!Number.isInteger(n) || n < 0 || n > 4) e[q.code] = 'The value must be a whole number from 0 to 4';
      else if (a.evidence === 'Document-supported' && !a.ref) e[q.code] = 'Choose the uploaded document that supports this answer';
      else if (!classes.includes(a.evidence)) e[q.code] = 'This evidence type is not available to your role';
      else if (a.note.length > 500) e[q.code] = 'Notes can be at most 500 characters';
    }
    setErrs(e);
    if (Object.keys(e).length) { setFormErr(`${Object.keys(e).length} answer${Object.keys(e).length === 1 ? ' needs' : 's need'} attention. See the highlighted questions.`); return false; }
    setFormErr(null); return true;
  };
  const payload = () => {
    const out: Record<string, { value: number; evidence: string; ref: string | null; note: string | null }> = {};
    for (const q of questions) { const a = get(q.code); if (a.value === '') continue; out[q.code] = { value: Number(a.value), evidence: a.evidence, ref: a.evidence === 'Document-supported' ? a.ref || null : null, note: a.note.trim() || null }; }
    return out;
  };

  const check = async () => {
    setDone(null); if (!validate()) return;
    setBusy('check');
    try { setGate(await api.post<Gate>(`/cases/${caseId}/diagnostics/validate`, { answers: payload() })); }
    catch (e) { setFormErr(errText(e)); } finally { setBusy(''); }
  };
  const submit = async () => {
    setBusy('submit');
    try {
      const r = await api.post<{ accepted: boolean; version: number; score: { overall: number; maturity: string; confidenceClass: string }; caseStatus: string }>(`/cases/${caseId}/diagnostics`, { answers: payload(), uuid: uuid.current });
      setDone({ version: r.version, overall: r.score.overall, maturity: r.score.maturity, confidenceClass: r.score.confidenceClass, caseStatus: r.caseStatus });
      toast(`Diagnostic v${r.version} submitted and scored`);
      uuid.current = crypto.randomUUID(); setGate(null); setBlocked(null); setConfirm(false); onSaved();
    } catch (e) {
      setConfirm(false);
      if (e instanceof ApiFail && e.code === 'data_quality') { const d = e.fields as any; setBlocked({ problems: Array.isArray(d?.problems) ? d.problems : [e.message], completion: d?.completion }); }
      else if (e instanceof ApiFail && e.fields && Object.keys(e.fields).length) { setErrs(e.fields as Record<string, string>); setFormErr(e.message); }
      else setFormErr(errText(e));
    } finally { setBusy(''); }
  };
  const prefill = async () => {
    try {
      const r = await api.get<{ answers: { questionCode: string; value: number; evidenceClass: string }[] }>(`/cases/${caseId}/scores`);
      const next: Record<string, Ans> = {}; let downgraded = 0;
      for (const a of r.answers ?? []) { const doc = a.evidenceClass === 'Document-supported'; if (doc) downgraded++; next[a.questionCode] = { value: String(a.value), evidence: doc ? 'Self-reported' : classes.includes(a.evidenceClass) ? a.evidenceClass : 'Self-reported', ref: '', note: '' }; }
      setAns(next); setGate(null); setBlocked(null); setErrs({});
      setNote(Object.keys(next).length ? `Loaded ${Object.keys(next).length} answers from the latest version.${downgraded ? ' Answers that relied on a document were set to Self-reported. Choose the document again to restore them.' : ''}` : 'The latest version has no answers to load.');
    } catch (e) { setFormErr(errText(e)); }
  };

  return <div className="stack">
    <Card title={`Diagnostic questionnaire (next version: v${nextVersion})`} actions={canPrefill ? <Button size="sm" onClick={prefill}>Start from latest answers</Button> : undefined}>
      <p className="muted">Rate each statement from 0 (not in place) to 4 (fully in place). For every answer, say how well it is evidenced. Answers backed by verified or document evidence count for more in the score.</p>
      {!stateOk && <div className="alert warn" role="status">The business profile must be complete before a diagnostic can be taken. The case is currently {status}.</div>}
      <div className="row small" role="status" aria-live="polite"><strong>{answered} of {questions.length} answered</strong><span className="muted">({Math.round(completion * 100)}% complete)</span></div>
      <div className="bar-track" aria-hidden style={{ marginTop: 4 }}><div className="bar-fill" style={{ width: `${completion * 100}%` }} /></div>
      {note && <div className="alert info" role="status" style={{ marginTop: 10 }}>{note}</div>}
    </Card>
    {groups.map(([dim, list]) => <Card key={dim} title={dim} actions={<span className="small muted">{list.filter((q) => get(q.code).value !== '').length} of {list.length} answered</span>}>
      <div className="stack" style={{ gap: 18 }}>{list.map((q) => {
        const a = get(q.code); const err = errs[q.code]; const eid = `err-${q.code}`;
        return <fieldset key={q.code} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} aria-describedby={err ? eid : undefined}>
          <legend style={{ fontWeight: 600 }}><span className="mono muted">{q.code}</span> {q.text}</legend>
          <div className="row" role="radiogroup" style={{ marginTop: 6 }}>
            {SCALE.map((s) => <label key={s} className="row" style={{ gap: 4 }}><input type="radio" name={`v-${q.code}`} value={s} checked={a.value === s} onChange={() => patch(q.code, { value: s })} aria-invalid={err ? true : undefined} /><span className="num">{s}</span></label>)}
            {a.value !== '' && <Button size="sm" variant="ghost" type="button" onClick={() => patch(q.code, { value: '' })}>Clear<span className="sr"> answer for {q.code}</span></Button>}
          </div>
          {a.value !== '' && <div className="form-grid" style={{ marginTop: 8 }}>
            <div className="field"><label htmlFor={`ev-${q.code}`}>Evidence type for {q.code}</label>
              <select id={`ev-${q.code}`} value={a.evidence} onChange={(e) => patch(q.code, { evidence: e.target.value, ref: '' })}>{classes.map((c) => <option key={c}>{c}</option>)}</select></div>
            {a.evidence === 'Document-supported' && <div className="field"><label htmlFor={`ref-${q.code}`}>Supporting document</label>
              <select id={`ref-${q.code}`} value={a.ref} onChange={(e) => patch(q.code, { ref: e.target.value })} aria-invalid={err ? true : undefined}>
                <option value="">{docs.length ? 'Choose a document' : 'No documents uploaded for this case'}</option>{docs.map((d) => <option key={d.id} value={d.code}>{d.filename} ({d.code})</option>)}</select>
              {docs.length === 0 && <span className="hint">Upload documents in the Evidence tab first.</span>}</div>}
            <div className="field"><label htmlFor={`note-${q.code}`}>Note (optional)</label><input id={`note-${q.code}`} maxLength={500} value={a.note} onChange={(e) => patch(q.code, { note: e.target.value })} /></div>
          </div>}
          {err && <span className="err" id={eid} role="alert" style={{ color: 'var(--bad)', fontWeight: 600, fontSize: '.86rem' }}>{q.code}: {err}</span>}
        </fieldset>;
      })}</div>
    </Card>)}
    <div className="stack" aria-live="polite">
      {formErr && <div className="alert bad" role="alert">{formErr}</div>}
      {gate && (gate.ok ? <div className="alert ok">The data quality check passed at {Math.round(gate.completion * 100)}% completion. This diagnostic can be submitted.</div>
        : <div className="alert warn"><strong>The data quality gate would block this submission.</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{gate.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>)}
      {blocked && <div className="alert bad" role="alert"><strong>Submission blocked by the data quality gate. Nothing was saved.</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{blocked.problems.map((p) => <li key={p}>{p}</li>)}</ul><p className="small" style={{ margin: '6px 0 0' }}>Answer the missing questions or correct the values, then check again.</p></div>}
      {done && <div className="alert ok" role="status">Diagnostic v{done.version} was accepted and scored: {done.overall.toFixed(1)} out of 100, confidence {done.confidenceClass}. <MaturityBadge value={done.maturity} /> The case is now in {done.caseStatus}.</div>}
    </div>
    <div className="form-actions">
      <Button type="button" loading={busy === 'check'} disabled={!stateOk || answered === 0} onClick={check}>Check data quality</Button>
      <Button variant="primary" type="button" disabled={!stateOk || answered === 0} onClick={() => { setDone(null); if (validate()) setConfirm(true); }}>Submit diagnostic</Button>
    </div>
    <Modal open={confirm} onClose={() => setConfirm(false)} title="Submit diagnostic">
      <p>This saves version {nextVersion} with {answered} of {questions.length} answers and scores it straight away. It replaces the current version for scoring, and earlier versions stay on record.</p>
      <div className="form-actions"><Button variant="primary" loading={busy === 'submit'} onClick={submit}>Confirm and submit</Button><Button onClick={() => setConfirm(false)}>Cancel</Button></div>
    </Modal>
  </div>;
}
