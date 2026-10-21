'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiFail, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Modal, useApi, useToast } from '@/components/ui';
import type { TabProps } from './types';
import { CASE_STATE_ORDER, CLASS_TONE, MaturityBadge, pct, useMe } from './core/shared';

type Q = { code: string; dimension: string; text: string; weight: number; subDimension?: string; anchors?: (string | null)[]; evidence?: { requirement: string; method: string; examples?: string[] }; criticality?: string; applies?: string };
const isCond = (q: Q) => !!q.applies && q.applies.trim().toLowerCase() !== 'all';
type Diag = { id: string; code: string; status: string; source: string; completion: string | number; validationNotes: string | null; version: number; createdAt: string };
type Doc = { id: string; code: string; filename: string };
type Ans = { value: string; evidence: string; ref: string; note: string; na?: boolean };
const UPLOAD_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx', 'csv', 'txt'];
const UPLOAD_MAX_MB = 10;
type Gate = { ok: boolean; problems: string[]; completion: number };
type Done = { version: number; overall: number; maturity: string; confidenceClass: string; caseStatus: string };
type DraftAnswer = { value?: number; notApplicable?: boolean; evidence?: string; ref?: string | null; note?: string | null };
type Draft = { answers: Record<string, DraftAnswer>; updatedAt: string | null };
const AUTOSAVE_DEBOUNCE_MS = 1500;

const ALL_CLASSES = ['Self-reported', 'Document-supported', 'Verified', 'Unverified', 'Missing'];
const OWNER_CLASSES = ['Self-reported', 'Document-supported', 'Unverified', 'Missing'];
const SCALE = ['0', '1', '2', '3', '4'];
const blank = (): Ans => ({ value: '', evidence: 'Self-reported', ref: '', note: '' });

/**
 * Per-question status, derived only from the answer state that mirrors the persisted draft
 * (seeded from the server on load via draftToAns, kept in sync by the same autosave that writes
 * it) -- never from anything that exists only transiently in the UI (e.g. an open dropdown).
 * A Document-supported answer isn't done until its reference is actually attached.
 */
type QStatus = 'unanswered' | 'answered' | 'evidence-required' | 'evidence-complete';
function questionStatus(a: Ans): QStatus {
  if (a.na) return 'answered';
  if (a.value === '') return 'unanswered';
  if (a.evidence === 'Document-supported') return a.ref ? 'evidence-complete' : 'evidence-required';
  return 'answered';
}
const STATUS_LABEL: Record<QStatus, string> = {
  unanswered: 'Unanswered', answered: 'Answered', 'evidence-required': 'Answered — Evidence Required', 'evidence-complete': 'Answered — Evidence Complete'
};
const STATUS_TONE: Record<QStatus, string> = { unanswered: 'bad', answered: 'ok', 'evidence-required': 'warn', 'evidence-complete': 'ok' };
/** Icon and text together carry the status; color alone never does. */
function StatusBadge({ status }: { status: QStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export default function TabDiagnostic({ caseId, caseData, role, reload }: TabProps) {
  const { can, ready } = useMe();
  const qs = useApi<Q[]>(`/questions?caseId=${caseId}`);
  const hist = useApi<Diag[]>(`/cases/${caseId}/diagnostics`);
  const docs = useApi<Doc[]>(ready && can('documents', 'read') ? `/documents?caseId=${caseId}` : null);
  const canSubmit = can('diagnostics', 'create');
  const canUpload = ready && can('documents', 'create');
  const draft = useApi<Draft>(canSubmit ? `/cases/${caseId}/diagnostics/draft` : null);
  const stateOk = CASE_STATE_ORDER.indexOf(caseData.status) >= CASE_STATE_ORDER.indexOf('PROFILED');
  const latestValidated = (hist.data ?? []).find((d) => d.status === 'Validated');
  const draftReady = !canSubmit || !!draft.data || (!draft.loading && !!draft.error);
  return <div className="stack">
    {canSubmit && draftReady && <Async state={qs} empty={(q) => q.length === 0}>{(questions) => (
      <Form caseId={caseId} questions={questions} role={role} docs={docs.data ?? []} canUpload={canUpload} onDocsChanged={docs.reload} stateOk={stateOk} status={caseData.status} draft={draft.data ?? { answers: {}, updatedAt: null }}
        nextVersion={(hist.data ?? []).filter((d) => d.status === 'Validated').length ? Math.max(...(hist.data ?? []).filter((d) => d.status === 'Validated').map((d) => d.version)) + 1 : 1}
        canPrefill={can('scores', 'read') && role !== 'OWNER' && !!latestValidated}
        onSaved={() => { hist.reload(); reload(); draft.reload(); }} />
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

/** Server AnswerInput -> the form's own Ans shape (always a string value, never a bare number). */
function draftToAns(answers: Record<string, DraftAnswer>, classes: string[]): Record<string, Ans> {
  const out: Record<string, Ans> = {};
  for (const [code, a] of Object.entries(answers)) {
    if (a.notApplicable) { out[code] = { ...blank(), na: true, note: a.note ?? '' }; continue; }
    if (a.value === undefined) continue;
    out[code] = { value: String(a.value), evidence: a.evidence && classes.includes(a.evidence) ? a.evidence : 'Self-reported', ref: a.ref ?? '', note: a.note ?? '' };
  }
  return out;
}

/** Upload a document right from the question that needs it, instead of sending the person to the Evidence tab first. */
function QuestionUpload({ caseId, questionCode, onUploaded }: { caseId: string; questionCode: string; onUploaded: (d: Doc) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!UPLOAD_EXT.includes(ext)) { setErr(`This file type is not accepted. Use ${UPLOAD_EXT.join(', ')}`); if (input.current) input.current.value = ''; return; }
    if (file.size > UPLOAD_MAX_MB * 1048576) { setErr(`Files can be at most ${UPLOAD_MAX_MB} MB`); if (input.current) input.current.value = ''; return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('caseId', caseId);
      const r = await api.upload<Doc>('/documents', fd);
      onUploaded(r);
    } catch (x) { setErr(x instanceof ApiFail && x.fields?.file ? x.fields.file : errText(x)); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return <div className="stack" style={{ gap: 2, marginTop: 4 }}>
    <label className="row" style={{ gap: 6 }}>
      <input ref={input} type="file" accept={UPLOAD_EXT.map((x) => '.' + x).join(',')} disabled={busy} onChange={pick} aria-label={`Upload a document for ${questionCode}`} />
      {busy && <span className="small muted">Uploading…</span>}
    </label>
    {err && <span className="err" role="alert" style={{ color: 'var(--bad)', fontSize: '.86rem' }}>{err}</span>}
  </div>;
}

function Form({ caseId, questions, role, docs, canUpload, onDocsChanged, stateOk, status, nextVersion, canPrefill, draft, onSaved }: {
  caseId: string; questions: Q[]; role: string; docs: Doc[]; canUpload: boolean; onDocsChanged: () => void; stateOk: boolean; status: string; nextVersion: number; canPrefill: boolean; draft: Draft; onSaved: () => void;
}) {
  const toast = useToast();
  const classes = role === 'OWNER' ? OWNER_CLASSES : ALL_CLASSES;
  const [ans, setAns] = useState<Record<string, Ans>>(() => draftToAns(draft.answers, classes));
  const [errs, setErrs] = useState<Record<string, string>>({});
  // Documents uploaded directly from this form this session, merged ahead of the server list so a freshly
  // uploaded file is selectable immediately without waiting on the parent's own /documents reload.
  const [justUploaded, setJustUploaded] = useState<Doc[]>([]);
  const allDocs = useMemo(() => { const known = new Set(docs.map((d) => d.id)); return [...justUploaded.filter((d) => !known.has(d.id)), ...docs]; }, [docs, justUploaded]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(draft.updatedAt);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const skipNextAutosave = useRef(Object.keys(draft.answers).length === 0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const isDone = (q: Q) => { const a = get(q.code); return a.value !== '' || !!a.na; };
  const naCount = questions.filter((q) => get(q.code).na).length;
  const answered = questions.filter(isDone).length;
  // Not applicable questions leave the denominator, as on the server.
  const applicable = questions.length - naCount;
  const completion = applicable > 0 ? (answered - naCount) / applicable : 0;

  /** Per-question checks that mirror the server rules. */
  const validate = () => {
    const e: Record<string, string> = {};
    for (const q of questions) {
      const a = get(q.code);
      if (a.na) continue;
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
    const out: Record<string, { value?: number; notApplicable?: boolean; evidence?: string; ref?: string | null; note?: string | null }> = {};
    for (const q of questions) { const a = get(q.code); if (a.na && isCond(q)) { out[q.code] = { notApplicable: true, note: a.note.trim() || null }; continue; } if (a.value === '') continue; out[q.code] = { value: Number(a.value), evidence: a.evidence, ref: a.evidence === 'Document-supported' ? a.ref || null : null, note: a.note.trim() || null }; }
    return out;
  };

  // Debounced autosave: fires on every answer change, skipped once right after loading the draft itself.
  useEffect(() => {
    if (skipNextAutosave.current) { skipNextAutosave.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveState('saving');
      api.put<{ savedAt: string }>(`/cases/${caseId}/diagnostics/draft`, { answers: payload() })
        .then((r) => { setSaveState('saved'); setSavedAt(r.savedAt); })
        .catch(() => setSaveState('error'));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ans, caseId]);
  const retrySave = () => {
    setSaveState('saving');
    api.put<{ savedAt: string }>(`/cases/${caseId}/diagnostics/draft`, { answers: payload() })
      .then((r) => { setSaveState('saved'); setSavedAt(r.savedAt); })
      .catch(() => setSaveState('error'));
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
      uuid.current = crypto.randomUUID(); setGate(null); setBlocked(null); setConfirm(false); setSaveState('idle'); setSavedAt(null); onSaved();
    } catch (e) {
      setConfirm(false);
      if (e instanceof ApiFail && e.code === 'data_quality') { const d = e.fields as any; setBlocked({ problems: Array.isArray(d?.problems) ? d.problems : [e.message], completion: d?.completion }); }
      else if (e instanceof ApiFail && e.fields && Object.keys(e.fields).length) { setErrs(e.fields as Record<string, string>); setFormErr(e.message); }
      else setFormErr(errText(e));
    } finally { setBusy(''); }
  };
  const prefill = async () => {
    try {
      const r = await api.get<{ answers: { questionCode: string; value: number; notApplicable?: boolean; evidenceClass: string }[] }>(`/cases/${caseId}/scores`);
      const next: Record<string, Ans> = {}; let downgraded = 0;
      for (const a of r.answers ?? []) { if (a.notApplicable) { next[a.questionCode] = { ...blank(), na: true }; continue; } const doc = a.evidenceClass === 'Document-supported'; if (doc) downgraded++; next[a.questionCode] = { value: String(a.value), evidence: doc ? 'Self-reported' : classes.includes(a.evidenceClass) ? a.evidenceClass : 'Self-reported', ref: '', note: '' }; }
      setAns(next); setGate(null); setBlocked(null); setErrs({});
      setNote(Object.keys(next).length ? `Loaded ${Object.keys(next).length} answers from the latest version.${downgraded ? ' Answers that relied on a document were set to Self-reported. Choose the document again to restore them.' : ''}` : 'The latest version has no answers to load.');
    } catch (e) { setFormErr(errText(e)); }
  };

  return <div className="stack">
    <Card title={`Diagnostic questionnaire (this will be version ${nextVersion})`}
      actions={<div className="row" style={{ gap: 10 }}>
        <span className="small muted" role="status" aria-live="polite">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && `Saved${savedAt ? ` ${dateTime(savedAt)}` : ''}`}
          {saveState === 'error' && <span className="row" style={{ gap: 4, color: 'var(--bad)' }}>Unable to save <Button size="sm" variant="ghost" type="button" onClick={retrySave}>Retry</Button></span>}
        </span>
        {canPrefill && <Button size="sm" onClick={prefill}>Start from latest answers</Button>}
      </div>}>
      <p className="muted">Rate each statement from 0 (not in place) to 4 (fully in place). For every answer, say how well it is evidenced. Answers backed by verified or document evidence count for more in the score.</p>
      {!stateOk && <div className="alert warn" role="status">The business profile must be complete before a diagnostic can be taken. The case is currently {status}.</div>}
      {!resumeDismissed && Object.keys(draft.answers).length > 0 && <div className="alert info" role="status">
        Resumed your in-progress diagnostic ({Math.round(completion * 100)}% complete{draft.updatedAt ? `, last saved ${dateTime(draft.updatedAt)}` : ''}).
        <Button size="sm" variant="ghost" type="button" onClick={() => setResumeDismissed(true)} style={{ marginLeft: 8 }}>Dismiss</Button>
      </div>}
      <div className="row small" role="status" aria-live="polite"><strong>{answered} of {questions.length} answered</strong><span className="muted">({Math.round(completion * 100)}% complete)</span></div>
      <div className="bar-track" aria-hidden style={{ marginTop: 4 }}><div className="bar-fill" style={{ width: `${completion * 100}%` }} /></div>
      {note && <div className="alert info" role="status" style={{ marginTop: 10 }}>{note}</div>}
    </Card>
    {groups.map(([dim, list]) => <Card key={dim} title={dim} actions={<span className="small muted">{list.filter(isDone).length} of {list.length} answered</span>}>
      <div className="stack" style={{ gap: 18 }}>{list.map((q) => {
        const a = get(q.code); const err = errs[q.code]; const eid = `err-${q.code}`;
        const qStatus = questionStatus(a);
        return <fieldset key={q.code} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} aria-describedby={err ? eid : undefined}>
          <legend style={{ fontWeight: 600 }}><span className="mono muted">{q.code}</span> {q.text}{q.criticality === 'Gate' && <> <Badge tone="warn">Gate</Badge></>} <StatusBadge status={qStatus} /></legend>
          {isCond(q) && <p className="small muted" style={{ margin: '2px 0 0' }}>Applies to: {q.applies}</p>}
          <div className="row" role="radiogroup" style={{ marginTop: 6 }}>
            {SCALE.map((s) => <label key={s} className="row" style={{ gap: 4 }}><input type="radio" name={`v-${q.code}`} value={s} checked={a.value === s && !a.na} disabled={!!a.na} onChange={() => patch(q.code, { value: s })} aria-invalid={err ? true : undefined} /><span className="num">{s}</span></label>)}
            {a.value !== '' && !a.na && <Button size="sm" variant="ghost" type="button" onClick={() => patch(q.code, { value: '' })}>Clear<span className="sr"> answer for {q.code}</span></Button>}
            {isCond(q) && <label className="row" style={{ gap: 4, marginLeft: 8 }}><input type="checkbox" checked={!!a.na} onChange={(e) => patch(q.code, { na: e.target.checked, value: e.target.checked ? '' : a.value })} /><span>Does not apply to this business<span className="sr"> ({q.code})</span></span></label>}
          </div>
          {q.anchors && q.anchors.length === 5 && <>
            {a.value !== '' && !a.na && q.anchors[Number(a.value)] && <p className="small" style={{ margin: '6px 0 0' }}><strong>{a.value}:</strong> {q.anchors[Number(a.value)]}</p>}
            <details className="small muted" style={{ marginTop: 4 }}><summary>What each rating means</summary>
              <ol start={0} style={{ margin: '4px 0 0', paddingLeft: 22 }}>{q.anchors.map((t, i) => t ? <li key={i} value={i}>{t}</li> : null)}</ol></details></>}
          {q.evidence && <p className="small muted" style={{ margin: '6px 0 0' }}><strong>Evidence to look for ({q.evidence.method}):</strong> {q.evidence.requirement}{q.evidence.examples?.length ? ` For example: ${q.evidence.examples.join('; ')}.` : ''}</p>}
          {a.value !== '' && !a.na && <div className="form-grid" style={{ marginTop: 8 }}>
            <div className="field"><label htmlFor={`ev-${q.code}`}>Evidence type for {q.code}</label>
              <select id={`ev-${q.code}`} value={a.evidence} onChange={(e) => patch(q.code, { evidence: e.target.value, ref: '' })}>{classes.map((c) => <option key={c}>{c}</option>)}</select></div>
            {a.evidence === 'Document-supported' && <div className="field"><label htmlFor={`ref-${q.code}`}>Supporting document</label>
              <select id={`ref-${q.code}`} value={a.ref} onChange={(e) => patch(q.code, { ref: e.target.value })} aria-invalid={err ? true : undefined}>
                <option value="">{allDocs.length ? 'Choose a document' : 'No documents uploaded for this case'}</option>{allDocs.map((d) => <option key={d.id} value={d.code}>{d.filename} ({d.code})</option>)}</select>
              {canUpload && <QuestionUpload caseId={caseId} questionCode={q.code}
                onUploaded={(d) => { setJustUploaded((xs) => [d, ...xs]); patch(q.code, { ref: d.code }); onDocsChanged(); }} />}
              {!canUpload && allDocs.length === 0 && <span className="hint">Upload documents in the Evidence tab first.</span>}</div>}
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
