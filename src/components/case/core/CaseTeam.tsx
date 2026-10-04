'use client';
import { useState } from 'react';
import { api, dateFmt, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Field, FormError, Modal, useApi, useToast } from '@/components/ui';
import { Person } from '@/components/Avatar';
import type { CaseData } from '@/components/case/types';

/* ------------------------------ ratings ------------------------------ */
export function RatingModal({ assignmentId, onClose, onDone }: { assignmentId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const st = useApi<any>(`/assignments/${assignmentId}/rating`);
  const [scores, setScores] = useState<Record<string, number>>({}); const [comment, setComment] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const send = async (d: any) => {
    const missing = d.criteria.filter((c: any) => !scores[c.key]); if (missing.length) { setErr(`Rate every item. Still to rate: ${missing.map((m: any) => m.label).join(', ')}`); return; }
    setBusy(true); setErr(null);
    try { await api.post(`/assignments/${assignmentId}/rating`, { scores, comment: comment.trim() || null }); toast('Thank you. Your rating is recorded'); onDone(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} title="Rate this engagement"><Async state={st}>{(d) => <div className="stack">
    <p>You are rating <strong>{d.practitioner}</strong> on case {d.caseCode}. Ratings cannot be edited; a later rating replaces the earlier one in the figures and both stay on record. Practitioners see their results as a summary.</p>
    {d.previous && <div className="alert info" role="status">You rated this on {dateFmt(d.previous.at)}. Saving again records a correction.</div>}
    {!d.canRate.ok && <div className="alert warn" role="status">{d.canRate.reason}</div>}
    <FormError message={err} />
    {d.criteria.map((c: any) => <fieldset key={c.key} style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600 }}>{c.label}</legend><span className="small muted">{c.help}</span>
      <div className="row" style={{ gap: 6, marginTop: 6 }} role="radiogroup" aria-label={c.label}>{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} className="chip-btn" role="radio" aria-checked={scores[c.key] === n} aria-pressed={scores[c.key] === n} aria-label={`${n} out of 5`} onClick={() => setScores((s) => ({ ...s, [c.key]: n }))}>{n}</button>)}</div>
    </fieldset>)}
    <span className="small muted">1 is poor, 5 is excellent.</span>
    <Field label="Comment (optional)" name="rcomment" hint="Seen only by the administrator and, as part of a summary, the practitioner.">{(q) => <textarea {...q} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}</Field>
    <div className="form-actions row" style={{ gap: 8 }}><Button variant="primary" loading={busy} disabled={!d.canRate.ok} onClick={() => send(d)}>Save rating</Button><Button onClick={onClose}>Cancel</Button></div>
  </div>}</Async></Modal>;
}

/* ------------------------------ the team ------------------------------ */
const RATERS = ['OWNER', 'REVIEWER', 'PROGRAMME_MANAGER'];
export function CaseTeamCard({ caseId, role, reload, refreshKey }: { caseId: string; role: string; reload: () => void; refreshKey?: number }) {
  const st = useApi<any>(`/cases/${caseId}/team${refreshKey ? `?_=${refreshKey}` : ''}`);
  const toast = useToast(); const [rate, setRate] = useState<string | null>(null); const [decline, setDecline] = useState<any>(null);
  const staff = !['OWNER', 'RESPONDENT', 'FUNDER'].includes(role);
  const respond = async (id: string, decision: 'accept' | 'decline', reason?: string) => { try { await api.post(`/assignments/${id}/respond`, { decision, reason: reason ?? null }); toast(decision === 'accept' ? 'Assignment accepted' : 'Assignment declined'); setDecline(null); st.reload(); reload(); } catch (e) { toast(errText(e), 'bad'); } };
  return <Card title={staff ? 'Who is on this case' : 'Your team'}>
    <Async state={st} empty={(d) => !d.items.length}>{(d) => {
      const active = d.items.filter((x: any) => x.status === 'Active'); const past = d.items.filter((x: any) => x.status !== 'Active');
      return <div className="stack">
        {!active.length && <p className="muted">Nobody is assigned yet.</p>}
        {active.map((x: any) => <div key={x.id} className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Person name={x.name} src={x.photoUrl} size={44} sub={`${x.label}${x.specialisation ? `, ${x.specialisation}` : ''}${x.headline ? ` · ${x.headline}` : ''}`} />
            {staff && <div className="small muted" style={{ marginLeft: 54 }}>{x.acknowledgedAt ? `Accepted ${dateFmt(x.acknowledgedAt)}` : x.acknowledgeBy ? `Awaiting acceptance, respond by ${dateFmt(x.acknowledgeBy)}` : ''}{x.matchScore != null ? ` · match ${x.matchScore}` : ''}</div>}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {x.mine && !x.acknowledgedAt && x.fn !== 'reviewer' && <><Button size="sm" variant="primary" onClick={() => respond(x.id, 'accept')}>Accept</Button><Button size="sm" onClick={() => setDecline(x)}>Decline</Button></>}
            {RATERS.includes(role) && !x.mine && x.fn !== 'reviewer' && <Button size="sm" onClick={() => setRate(x.id)}>{x.rated ? 'Rate again' : 'Rate'}</Button>}
          </div>
        </div>)}
        {staff && past.length > 0 && <details className="small"><summary>Earlier assignments ({past.length})</summary><ul>{past.map((x: any) => <li key={x.id}><strong>{x.name}</strong>, {x.label}: {x.status.toLowerCase()} {x.endedAt ? dateFmt(x.endedAt) : ''}{x.declineReason ? `. Reason: ${x.declineReason}` : ''}</li>)}</ul></details>}
      </div>;
    }}</Async>
    {rate && <RatingModal assignmentId={rate} onClose={() => setRate(null)} onDone={() => { setRate(null); st.reload(); }} />}
    {decline && <DeclineModal name={decline.label} onClose={() => setDecline(null)} onSubmit={(r) => respond(decline.id, 'decline', r)} />}
  </Card>;
}
function DeclineModal({ name, onClose, onSubmit }: { name: string; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [r, setR] = useState(''); const [err, setErr] = useState<string | null>(null);
  return <Modal open onClose={onClose} title={`Decline the ${name.toLowerCase()} role`}><div className="stack"><FormError message={err} />
    <Field label="Reason" name="dr" hint="Programme managers see this and will assign someone else.">{(q) => <textarea {...q} rows={3} maxLength={500} value={r} onChange={(e) => setR(e.target.value)} />}</Field>
    <div className="form-actions row" style={{ gap: 8 }}><Button variant="danger" onClick={() => { if (r.trim().length < 5) { setErr('Give a short reason'); return; } onSubmit(r.trim()); }}>Decline</Button><Button onClick={onClose}>Cancel</Button></div></div></Modal>;
}

/* ------------------------- assigning (managers) ------------------------- */
type Slot = { key: 'consultantId' | 'coachId' | 'reviewerId' | 'specialist'; fn: 'lead' | 'coach' | 'reviewer' | 'specialist'; label: string };
const SLOTS: Slot[] = [{ key: 'consultantId', fn: 'lead', label: 'Lead expert' }, { key: 'coachId', fn: 'coach', label: 'Coaching expert' }, { key: 'reviewerId', fn: 'reviewer', label: 'Reviewer' }, { key: 'specialist', fn: 'specialist', label: 'Specialist' }];

export function AssignPanel({ c, reload }: { c: CaseData; reload: () => void }) {
  const [slot, setSlot] = useState<Slot | null>(null); const [tick, setTick] = useState(0);
  const toast = useToast(); const team = useApi<any>(`/cases/${c.id}/team?_=${tick}`);
  const current = (s: Slot) => (team.data?.items ?? []).filter((x: any) => x.status === 'Active' && x.fn === s.fn);
  const done = (msg: string, warnings?: string[]) => { toast(msg); (warnings ?? []).forEach((w) => toast(w)); setSlot(null); setTick((t) => t + 1); reload(); };
  return <Card title="Assign people" actions={<span className="small muted">Matches are recommendations. You decide.</span>}>
    <div className="stack">
      {SLOTS.map((s) => <div key={s.key} className="row" style={{ gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}><strong>{s.label}{s.fn === 'specialist' ? 's' : ''}</strong>
          <div>{current(s).length ? current(s).map((x: any) => <span key={x.id} style={{ marginRight: 14 }}><Person name={x.name} src={x.photoUrl} size={28} sub={x.specialisation ?? undefined} />{s.fn === 'specialist' && <Button size="sm" aria-label={`Remove ${x.name}`} onClick={() => setSlot({ ...s, label: `remove:${x.userId}:${x.name}` })}>Remove</Button>}</span>) : <span className="muted small">None</span>}</div></div>
        {slot?.label.startsWith('remove') ? null : <Button size="sm" aria-label={`${s.fn === 'specialist' ? 'Add' : current(s).length ? 'Change' : 'Choose'} ${s.label.toLowerCase()}`} onClick={() => setSlot(s)}>{s.fn === 'specialist' ? 'Add' : current(s).length ? 'Change' : 'Choose'}</Button>}
      </div>)}
    </div>
    {slot && !slot.label.startsWith('remove') && <ChooseModal c={c} slot={slot} replacing={current(slot).length > 0 && slot.fn !== 'specialist'} onClose={() => setSlot(null)} onDone={done} />}
    {slot?.label.startsWith('remove') && <RemoveModal caseId={c.id} userId={slot.label.split(':')[1]!} name={slot.label.split(':')[2] ?? ''} onClose={() => setSlot(null)} onDone={() => done('Specialist removed')} />}
    <p className="small muted" style={{ marginTop: 10 }}>The reviewer must be a different person from the lead expert. Only approved, available experts without a declared conflict are recommended. Changes need a reason and are recorded.</p>
  </Card>;
}

function RemoveModal({ caseId, userId, name, onClose, onDone }: { caseId: string; userId: string; name: string; onClose: () => void; onDone: () => void }) {
  const [r, setR] = useState(''); const [err, setErr] = useState<string | null>(null);
  const go = async () => { if (r.trim().length < 5) { setErr('Give a short reason'); return; } try { await api.del(`/cases/${caseId}/specialists/${userId}?reason=${encodeURIComponent(r.trim())}`); onDone(); } catch (e) { setErr(errText(e)); } };
  return <Modal open onClose={onClose} title={`Remove ${name}`}><div className="stack"><FormError message={err} /><Field label="Reason" name="rr">{(q) => <textarea {...q} rows={3} maxLength={500} value={r} onChange={(e) => setR(e.target.value)} />}</Field>
    <div className="form-actions row" style={{ gap: 8 }}><Button variant="danger" onClick={go}>Remove</Button><Button onClick={onClose}>Cancel</Button></div></div></Modal>;
}

const tone = (m: any) => !m.eligible ? 'bad' : m.score >= 70 ? 'ok' : m.score >= 45 ? 'info' : 'warn';
function ChooseModal({ c, slot, replacing, onClose, onDone }: { c: CaseData; slot: Slot; replacing: boolean; onClose: () => void; onDone: (m: string, w?: string[]) => void }) {
  const reviewers = useApi<any[]>(slot.fn === 'reviewer' ? '/users/assignable' : null);
  const matches = useApi<any>(slot.fn !== 'reviewer' ? `/cases/${c.id}/matches?fn=${slot.fn}` : null);
  const [pick, setPick] = useState<string>(''); const [spec, setSpec] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [showIneligible, setShow] = useState(false);
  const submit = async () => {
    if (!pick) { setErr('Choose a person'); return; }
    if (replacing && reason.trim().length < 5) { setErr('Say why you are changing this assignment'); return; }
    setBusy(true); setErr(null);
    try {
      if (slot.fn === 'specialist') { await api.post(`/cases/${c.id}/specialists`, { userId: pick, specialisation: spec.trim() || null, reason: reason.trim() || null }); onDone('Specialist added'); }
      else { const r = await api.post<{ warnings: string[] }>(`/cases/${c.id}/assign`, { [slot.key]: pick, reason: reason.trim() || null }); onDone(`${slot.label} assigned`, r.warnings); }
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const items: any[] = matches.data?.items ?? [];
  return <Modal open onClose={onClose} title={`${replacing ? 'Change' : 'Choose'} ${slot.label.toLowerCase()}`}><div className="stack">
    <FormError message={err} />
    {slot.fn === 'reviewer' ? <Async state={reviewers}>{(list) => <Field label="Reviewer" name="rev">{(q) => <select {...q} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Choose</option>{list.filter((p) => p.role === 'REVIEWER').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</Field>}</Async>
      : <Async state={matches}>{(d) => <div className="stack">
        <p className="small muted">Weakest areas for this business: {d.need.weakDimensions.length ? d.need.weakDimensions.join(', ') : 'not scored yet'}. {d.note}</p>
        {slot.fn === 'specialist' && <Field label="Specialisation needed" name="spec" hint="For example: Financial management. Improves the ranking.">{(q) => <input {...q} value={spec} maxLength={80} onChange={(e) => setSpec(e.target.value)} />}</Field>}
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showIneligible} onChange={(e) => setShow(e.target.checked)} /> Also show people who cannot be assigned, with the reason</label>
        <div role="radiogroup" aria-label="Recommended people" className="stack">
          {items.filter((m) => m.eligible || showIneligible).map((m) => <label key={m.userId} className="card" style={{ padding: 12, cursor: m.eligible ? 'pointer' : 'default', opacity: m.eligible ? 1 : 0.7, borderColor: pick === m.userId ? 'var(--brand)' : undefined }}>
            <div className="row" style={{ gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span className="row" style={{ gap: 10 }}><input type="radio" name="pick" disabled={!m.eligible} checked={pick === m.userId} onChange={() => setPick(m.userId)} /><Person name={m.name} src={m.photoUrl} sub={m.headline ?? undefined} /></span>
              <Badge tone={tone(m)}>{m.eligible ? `Match ${m.score}` : 'Not available'}</Badge>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>{m.active} of {m.maxActive} cases</div>
            {!m.eligible ? <div className="small" style={{ marginTop: 4 }}>{m.exclusions.join('. ')}</div>
              : <details className="small" style={{ marginTop: 4 }}><summary>Why this score</summary><ul>{m.factors.map((f: any) => <li key={f.key}>{f.label}: {f.points} of {f.max}. {f.note}</li>)}</ul><p className="muted">{m.evidence}</p></details>}
          </label>)}
          {!items.some((m) => m.eligible) && <p className="muted">Nobody is currently eligible. Check that experts have submitted profiles and that an administrator has approved them.</p>}
        </div>
      </div>}</Async>}
    <Field label={replacing ? 'Reason for the change' : 'Reason (optional)'} name="areason">{(q) => <input {...q} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}</Field>
    <div className="form-actions row" style={{ gap: 8 }}><Button variant="primary" loading={busy} onClick={submit}>{replacing ? 'Change' : 'Assign'}</Button><Button onClick={onClose}>Cancel</Button></div>
  </div></Modal>;
}
