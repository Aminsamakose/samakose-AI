'use client';
import { useRef, useState } from 'react';
import { api, dateFmt, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, ConfirmButton, Field, FormError, useApi, useToast } from '@/components/ui';
import { Avatar } from '@/components/Avatar';

/* ------------------------------ photo ------------------------------ */
export function PhotoCard({ name, photoUrl, userId, onChanged }: { name: string; photoUrl: string | null; userId?: string; onChanged: () => void }) {
  const toast = useToast(); const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [preview, setPreview] = useState<string | null>(null);
  const base = userId ? `/users/${userId}/photo` : '/me/photo';
  const pick = (f: File | undefined) => {
    setErr(null); if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setErr('Choose a PNG, JPEG or WebP image.'); return; }
    if (f.size > 4 * 1024 * 1024) { setErr('The photo is larger than 4 MB. Choose a smaller one.'); return; }
    setPreview(URL.createObjectURL(f));
  };
  const save = async () => {
    const f = input.current?.files?.[0]; if (!f) return;
    setBusy(true); setErr(null);
    try { const fd = new FormData(); fd.append('file', f); await api.upload(base, fd); toast('Photo saved'); setPreview(null); if (input.current) input.current.value = ''; onChanged(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return <Card title="Profile photo">
    <div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
      <Avatar name={name} src={preview ?? photoUrl} size={96} decorative={false} />
      <div className="stack" style={{ flex: 1, minWidth: 220 }}>
        <p className="small muted">A clear, recent photo of your face helps colleagues and clients recognise you. It is cropped square and shown on your cases, team lists and reviews. PNG, JPEG or WebP, up to 4 MB.</p>
        <FormError message={err} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="sr" htmlFor="photo-file">Choose a profile photo</label>
          <input id="photo-file" ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files?.[0])} />
          {preview && <Button variant="primary" loading={busy} onClick={save}>Save photo</Button>}
          {preview && <Button onClick={() => { setPreview(null); if (input.current) input.current.value = ''; }}>Cancel</Button>}
          {!preview && photoUrl && <ConfirmButton label="Remove photo" message="Your photo will be removed and initials shown instead." onConfirm={async () => { await api.del(base); toast('Photo removed'); onChanged(); }} />}
        </div>
      </div>
    </div>
  </Card>;
}

/* ---------------------------- list pickers ---------------------------- */
export function Chips({ label, options, value, onChange, allowOther }: { label: string; options: readonly string[]; value: string[]; onChange: (v: string[]) => void; allowOther?: boolean }) {
  const [other, setOther] = useState('');
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  const extra = value.filter((v) => !options.includes(v));
  const add = () => { const t = other.trim().slice(0, 60); if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]); setOther(''); };
  return <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
    <legend style={{ fontWeight: 600, marginBottom: 6 }}>{label}</legend>
    <div className="chips">{[...options, ...extra].map((o) => <button type="button" key={o} className="chip-btn" aria-pressed={value.includes(o)} onClick={() => toggle(o)}>{o}</button>)}</div>
    {allowOther && <div className="row" style={{ gap: 8 }}>
      <label className="sr" htmlFor={`other-${label}`}>Add another {label.toLowerCase()}</label>
      <input id={`other-${label}`} value={other} maxLength={60} placeholder="Add your own" onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
      <Button type="button" onClick={add}>Add</Button>
    </div>}
  </fieldset>;
}
const LANGS = ['English', 'Dagbani', 'Twi', 'Ewe', 'Ga', 'Hausa', 'Frisian', 'Gonja', 'French'];
const REGIONS = ['Northern', 'Savannah', 'North East', 'Upper East', 'Upper West', 'Bono', 'Ashanti', 'Greater Accra', 'Volta', 'Western', 'Central', 'Eastern', 'Oti', 'Ahafo', 'Bono East', 'Western North'];
const SECTORS = ['Agriculture', 'Agro-processing', 'Retail and trade', 'Manufacturing', 'Services', 'Hospitality', 'Education', 'Health', 'Technology', 'Construction', 'Energy', 'Finance'];
const SIZES = ['Micro', 'Small', 'Medium'];
const DIMS = ['Finance', 'Market and sales', 'Operations', 'People and governance', 'Records and systems', 'Compliance and finance access'];
const AVAIL = ['Available', 'Limited', 'Unavailable'];
const tone = (s: string) => s === 'Approved' ? 'ok' : s === 'Submitted' ? 'info' : s === 'Rejected' || s === 'Suspended' ? 'bad' : 'warn';

/* ----------------------- the practitioner's own profile ----------------------- */
export function PractitionerProfileCard({ onPhotoChange }: { onPhotoChange?: () => void }) {
  const st = useApi<any>('/me/practitioner'); const lst = useApi<any>('/practitioners'); const conf = useApi<any>('/me/practitioner/conflicts');
  const toast = useToast();
  return <Async state={st}>{(p) => <PractitionerForm key={p.userId + (p.completeness?.percent ?? '')} p={p} options={lst.data?.options} conduct={lst.data?.conduct} conflicts={conf} reload={() => { st.reload(); onPhotoChange?.(); }} toast={toast} />}</Async>;
}

function PractitionerForm({ p, options, conduct, conflicts, reload, toast }: { p: any; options: any; conduct: any; conflicts: any; reload: () => void; toast: (m: string, t?: any) => void }) {
  const [v, setV] = useState({
    headline: p.headline ?? '', bio: p.bio ?? '', functions: p.functions as string[], specialisations: p.specialisations as string[], strengths: p.strengths as string[], sectors: p.sectors as string[],
    platforms: p.platforms as string[], businessSizes: p.businessSizes as string[], languages: p.languages as string[], regions: p.regions as string[], deliveryModes: p.deliveryModes as string[],
    yearsExperience: p.yearsExperience == null ? '' : String(p.yearsExperience), maxActive: String(p.maxActive ?? 5), availability: p.availability as string, rateNote: p.rateNote ?? '', credentials: (p.credentials ?? []) as any[], acceptConduct: !!p.conductAcceptedAt
  });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((o) => ({ ...o, [k]: x }));
  const body = () => ({
    headline: v.headline.trim() || null, bio: v.bio.trim() || null, functions: v.functions as any, specialisations: v.specialisations, strengths: v.strengths, sectors: v.sectors, platforms: v.platforms, businessSizes: v.businessSizes,
    languages: v.languages, regions: v.regions, deliveryModes: v.deliveryModes, yearsExperience: v.yearsExperience === '' ? null : Number(v.yearsExperience), maxActive: Number(v.maxActive) || 5, availability: v.availability,
    rateNote: v.rateNote.trim() || null, credentials: v.credentials.filter((c) => c.title?.trim()).map((c) => ({ type: c.type || 'Qualification', title: c.title.trim(), ...(c.issuer ? { issuer: c.issuer } : {}), ...(c.year ? { year: Number(c.year) } : {}) })), acceptConduct: v.acceptConduct
  });
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setErr(null); try { await fn(); toast(ok); reload(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  const c = p.completeness ?? { percent: 0, missing: [], canSubmit: false };
  const locked = p.vettingStatus === 'Submitted';
  return <Card title="Your practitioner profile" actions={<Badge tone={tone(p.vettingStatus)}>{p.vettingStatus}</Badge>}>
    <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); run(() => api.patch('/me/practitioner', body()), 'Profile saved'); }}>
      <p className="small muted">This is how programme managers find and match you to businesses. Only approved profiles can be assigned work. Your headline, biography, specialisations and photo are visible to colleagues; your availability and capacity are visible to programme managers.</p>
      {p.vettingNote && ['Rejected', 'Suspended', 'Draft'].includes(p.vettingStatus) && <div className="alert warn" role="status"><strong>Note from the administrator:</strong> {p.vettingNote}</div>}
      <div><div className="row" style={{ justifyContent: 'space-between' }}><strong>Profile {c.percent}% complete</strong>{c.canSubmit ? <Badge tone="ok">Ready to submit</Badge> : <Badge tone="warn">Required items missing</Badge>}</div>
        <div className="meter" role="progressbar" aria-valuenow={c.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness"><span style={{ width: `${c.percent}%` }} /></div>
        {c.missing.length > 0 && <details className="small muted"><summary>What is still missing</summary><ul>{c.missing.map((m: string) => <li key={m}>{m}</li>)}</ul></details>}</div>
      <FormError message={err} />
      <div className="form-grid">
        <Field label="Headline" name="headline" required hint="One line, for example: Agribusiness finance adviser, Tamale">{(q) => <input {...q} value={v.headline} maxLength={140} onChange={(e) => set('headline', e.target.value)} />}</Field>
        <Field label="Years of experience" name="years" required>{(q) => <input {...q} type="number" min={0} max={70} value={v.yearsExperience} onChange={(e) => set('yearsExperience', e.target.value)} />}</Field>
      </div>
      <Field label="Short biography" name="bio" required hint="At least 40 characters. What you have done and who you help.">{(q) => <textarea {...q} rows={4} maxLength={2000} value={v.bio} onChange={(e) => set('bio', e.target.value)} />}</Field>
      <Chips label="I work as" options={['expert', 'coach']} value={v.functions} onChange={(x) => set('functions', x)} />
      <Chips label="Specialisations" options={options?.specialisations ?? []} value={v.specialisations} onChange={(x) => set('specialisations', x)} allowOther />
      <Chips label="Assessment areas I am strong in" options={DIMS} value={v.strengths} onChange={(x) => set('strengths', x)} />
      <Chips label="Platforms" options={options?.platforms ?? ['SME360', 'AGRIFOOD360', 'ESO360']} value={v.platforms} onChange={(x) => set('platforms', x)} />
      <Chips label="Sectors" options={SECTORS} value={v.sectors} onChange={(x) => set('sectors', x)} allowOther />
      <Chips label="Business sizes" options={SIZES} value={v.businessSizes} onChange={(x) => set('businessSizes', x)} />
      <Chips label="Regions I can serve" options={REGIONS} value={v.regions} onChange={(x) => set('regions', x)} />
      <Chips label="Languages" options={LANGS} value={v.languages} onChange={(x) => set('languages', x)} allowOther />
      <Chips label="How I deliver" options={options?.deliveryModes ?? ['In person', 'Remote', 'Hybrid']} value={v.deliveryModes} onChange={(x) => set('deliveryModes', x)} />
      <div className="form-grid">
        <Field label="Availability" name="avail">{(q) => <select {...q} value={v.availability} onChange={(e) => set('availability', e.target.value)}>{AVAIL.map((a) => <option key={a}>{a}</option>)}</select>}</Field>
        <Field label="Most cases at one time" name="max" hint="Programme managers are warned when you reach this.">{(q) => <input {...q} type="number" min={1} max={50} value={v.maxActive} onChange={(e) => set('maxActive', e.target.value)} />}</Field>
      </div>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Qualifications and certifications</legend>
        {v.credentials.map((cr, i) => <div key={i} className="form-grid" style={{ alignItems: 'end' }}>
          <Field label="Title" name={`c-t-${i}`}>{(q) => <input {...q} value={cr.title ?? ''} maxLength={160} onChange={(e) => set('credentials', v.credentials.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />}</Field>
          <Field label="Issued by" name={`c-i-${i}`}>{(q) => <input {...q} value={cr.issuer ?? ''} maxLength={120} onChange={(e) => set('credentials', v.credentials.map((x, j) => j === i ? { ...x, issuer: e.target.value } : x))} />}</Field>
          <Field label="Year" name={`c-y-${i}`}>{(q) => <input {...q} type="number" min={1950} max={2100} value={cr.year ?? ''} onChange={(e) => set('credentials', v.credentials.map((x, j) => j === i ? { ...x, year: e.target.value } : x))} />}</Field>
          <Button type="button" size="sm" aria-label={`Remove qualification ${i + 1}`} onClick={() => set('credentials', v.credentials.filter((_, j) => j !== i))}>Remove</Button>
        </div>)}
        <div><Button type="button" onClick={() => set('credentials', [...v.credentials, { type: 'Qualification', title: '' }])}>Add a qualification</Button></div>
        <p className="small muted">Changing qualifications or your role after approval sends the profile back for review.</p>
      </fieldset>
      <Field label="Notes on fees or rates (private)" name="rate" hint="Seen only by you and the administrator.">{(q) => <textarea {...q} rows={2} maxLength={500} value={v.rateNote} onChange={(e) => set('rateNote', e.target.value)} />}</Field>
      <div className="card stack" style={{ padding: 14 }}>
        <strong>Code of conduct</strong>
        <ul className="small">{(conduct?.text ?? []).map((t: string) => <li key={t}>{t}</li>)}</ul>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.acceptConduct} onChange={(e) => set('acceptConduct', e.target.checked)} /> I have read and accept the code of conduct{p.conductAcceptedAt ? ` (accepted ${dateFmt(p.conductAcceptedAt)})` : ''}</label>
      </div>
      <div className="form-actions row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary" type="submit" loading={busy}>Save profile</Button>
        {['Draft', 'Rejected'].includes(p.vettingStatus) && <Button type="button" disabled={busy || !c.canSubmit} onClick={() => run(async () => { await api.patch('/me/practitioner', body()); await api.post('/me/practitioner/submit', {}); }, 'Submitted for review')}>Save and submit for review</Button>}
        {locked && <span className="small muted">Submitted {dateFmt(p.submittedAt)}. You will be told when the administrator decides.</span>}
      </div>
    </form>
    <hr />
    <ConflictList state={conflicts} toast={toast} />
  </Card>;
}

function ConflictList({ state, toast }: { state: any; toast: (m: string, t?: any) => void }) {
  const orgs = useApi<any>('/organisations?pageSize=100&sort=name&dir=asc');
  const [orgId, setOrgId] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const add = async () => {
    setErr(null); if (!orgId) { setErr('Choose the business'); return; } if (reason.trim().length < 5) { setErr('Say briefly what the conflict is'); return; }
    setBusy(true); try { await api.post('/me/practitioner/conflicts', { orgId, reason: reason.trim() }); toast('Conflict declared'); setOrgId(''); setReason(''); state.reload(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const rows: any[] = orgs.data?.items ?? [];
  return <div className="stack"><strong>Conflicts of interest</strong>
    <p className="small muted">Declare any business you must not serve, for example one you own, work for or are related to. You will not be matched to it. Only an administrator can remove a declaration.</p>
    <Async state={state} empty={(d: any) => !d.items.length}>{(d: any) => <ul>{d.items.map((c: any) => <li key={c.id}><strong>{c.org}</strong>: {c.reason}</li>)}</ul>}</Async>
    <FormError message={err} />
    <div className="form-grid" style={{ alignItems: 'end' }}>
      <Field label="Business" name="c-org">{(q) => <select {...q} value={orgId} onChange={(e) => setOrgId(e.target.value)}><option value="">Choose</option>{rows.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}</Field>
      <Field label="Reason" name="c-reason">{(q) => <input {...q} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}</Field>
      <Button type="button" loading={busy} onClick={add}>Declare conflict</Button>
    </div>
  </div>;
}
