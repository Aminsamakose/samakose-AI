'use client';
import { useEffect, useState } from 'react';
import { api, errText } from '@/lib/client/api';
import { Async, Button, Card, Empty, FormError, useApi, useToast } from '@/components/ui';

type Q = { code: string; text: string; dimension: string; area: string | null; anchors?: (string | null)[]; applies?: string };
type Saved = { value: number | null; notApplicable: boolean; evidence: string; note: string | null };
type Mine = { business: string; round: null | { id: string; questions: Q[]; answers: Record<string, Saved> } };
type Draft = { value: string; na: boolean; evidence: string; note: string };
const EVIDENCE = ['Self-reported', 'Unverified', 'Missing'];
const isCond = (q: Q) => !!q.applies && q.applies.trim().toLowerCase() !== 'all';

/** The questions assigned to me in the open team assessment. Saved answers are drafts: nothing is scored until the owner submits. */
export function AnswerRound() {
  const st = useApi<Mine>('/me/round');
  return <Async state={st}>{(m) => {
    if (!m.round) return <Card><Empty title="Nothing to answer right now" hint={m.business ? `There is no open team assessment for ${m.business}. The owner starts one from My team.` : 'You have not been added to a business yet.'} /></Card>;
    if (m.round.questions.length === 0) return <Card><Empty title="No questions are assigned to you" hint="The business owner decides who answers each area. You will see your questions here once an area is assigned to you." /></Card>;
    return <Form business={m.business} round={m.round} onSaved={st.reload} />;
  }}</Async>;
}

function Form({ business, round, onSaved }: { business: string; round: NonNullable<Mine['round']>; onSaved: () => void }) {
  const toast = useToast();
  const start = (): Record<string, Draft> => Object.fromEntries(round.questions.map((q) => { const a = round.answers[q.code]; return [q.code, { value: a?.value != null ? String(a.value) : '', na: !!a?.notApplicable, evidence: a?.evidence ?? 'Self-reported', note: a?.note ?? '' }]; }));
  const [d, setD] = useState<Record<string, Draft>>(start);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);
  const patch = (c: string, p: Partial<Draft>) => { setD((x) => ({ ...x, [c]: { ...x[c], ...p } })); setDirty(true); setErrs((e) => { if (!e[c]) return e; const n = { ...e }; delete n[c]; return n; }); };
  const answered = round.questions.filter((q) => d[q.code].value !== '' || d[q.code].na).length;
  const groups = Array.from(round.questions.reduce((m, q) => m.set(q.area ?? 'Other questions', [...(m.get(q.area ?? 'Other questions') ?? []), q]), new Map<string, Q[]>()));

  const save = async () => {
    setFormErr(null);
    const body: Record<string, unknown> = {};
    for (const q of round.questions) {
      const x = d[q.code]; const saved = round.answers[q.code];
      if (x.na) body[q.code] = { notApplicable: true, note: x.note.trim() || null };
      else if (x.value !== '') body[q.code] = { value: Number(x.value), evidence: x.evidence, note: x.note.trim() || null };
      else if (saved) body[q.code] = null; // cleared
    }
    setBusy(true);
    try { const r = await api.put<{ saved: number; cleared: number }>(`/me/rounds/${round.id}/answers`, { answers: body }); toast(`Saved ${r.saved} answer${r.saved === 1 ? '' : 's'}`); setDirty(false); onSaved(); }
    catch (e: any) { if (e?.fields && typeof e.fields === 'object') setErrs(e.fields); setFormErr(errText(e)); } finally { setBusy(false); }
  };

  return <div className="stack">
    <Card title={`Your questions for ${business}`}>
      <p className="muted small">Rate each statement from 0 (not true at all) to 4 (fully true and in place). You see only the questions assigned to you. Your answers are saved as drafts and are not scored until the business owner submits the assessment.</p>
      <p className="small" aria-live="polite"><b>{answered}</b> of {round.questions.length} answered{dirty ? ' (unsaved changes)' : ''}</p>
    </Card>
    <FormError message={formErr} />
    {groups.map(([area, list]) => <Card key={area} title={area}><div className="stack">
      {list.map((q) => { const x = d[q.code]; const err = errs[q.code]; return <fieldset key={q.code} className="stack" style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={err ? `e-${q.code}` : undefined}>
        <legend><b className="mono small">{q.code}</b> {q.text}</legend>
        <div className="row" role="radiogroup" aria-label={`Rating for ${q.code}`}>{[0, 1, 2, 3, 4].map((n) => <label key={n} className="row" style={{ gap: 6 }} title={q.anchors?.[n] ?? undefined}>
          <input type="radio" name={`q-${q.code}`} value={n} checked={!x.na && x.value === String(n)} disabled={x.na} onChange={() => patch(q.code, { value: String(n) })} />{n}</label>)}
          {isCond(q) && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={x.na} onChange={(e) => patch(q.code, { na: e.target.checked, value: e.target.checked ? '' : x.value })} />Does not apply</label>}
          {(x.value !== '' || x.na) && <button type="button" className="btn sm" onClick={() => patch(q.code, { value: '', na: false })}>Clear</button>}
        </div>
        {x.value !== '' && q.anchors?.[Number(x.value)] && <p className="small muted" style={{ margin: 0 }}>{q.anchors[Number(x.value)]}</p>}
        <div className="row">
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor={`n-${q.code}`}>Note (optional)</label><input id={`n-${q.code}`} value={x.note} maxLength={500} onChange={(e) => patch(q.code, { note: e.target.value })} /></div>
          <div className="field"><label htmlFor={`ev-${q.code}`}>How do you know?</label><select id={`ev-${q.code}`} value={x.evidence} onChange={(e) => patch(q.code, { evidence: e.target.value })}>{EVIDENCE.map((c) => <option key={c}>{c}</option>)}</select></div>
        </div>
        {err && <p id={`e-${q.code}`} className="small" role="alert" style={{ color: 'var(--bad, #b42318)', margin: 0 }}>{err}</p>}
      </fieldset>; })}
    </div></Card>)}
    <div className="form-actions"><Button variant="primary" loading={busy} onClick={save}>Save my answers</Button></div>
  </div>;
}
