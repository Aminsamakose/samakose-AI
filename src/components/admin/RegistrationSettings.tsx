'use client';
import { useState } from 'react';
import { api, dateTime, errText } from '@/lib/client/api';
import { Async, Badge, Button, Card, Empty, Field, Tabs, useApi, useToast } from '@/components/ui';

const tone = (s: string) => s === 'Published' ? 'ok' : s === 'Draft' ? 'info' : '';
const LABEL: Record<string, string> = { account: 'Account (required)', assessment: 'Business assessment', team_invites: 'Colleague invitations', demographics: 'Demographics', disability: 'Disability status', funder_aggregate: 'Anonymous totals for funders' };

export function RegistrationSettings({ canEdit, canApprove }: { canEdit: boolean; canApprove: boolean }) {
  const [tab, setTab] = useState('consent');
  return <div className="stack">
    <Tabs tabs={[{ id: 'consent', label: 'Consent notices' }, { id: 'mapping', label: 'Role mapping' }, { id: 'reach', label: 'Reach totals' }]} active={tab} onChange={setTab} />
    {tab === 'consent' ? <Notices canEdit={canEdit} canApprove={canApprove} /> : tab === 'mapping' ? <Mappings canEdit={canEdit} canApprove={canApprove} /> : <Reach />}
  </div>;
}

/* ------------------------------- consent notices ------------------------------- */
function Notices({ canEdit, canApprove }: { canEdit: boolean; canApprove: boolean }) {
  const st = useApi<any>('/admin/consent-notices?country=GH');
  return <Async state={st}>{(d) => <div className="stack">
    <p className="muted small">Ghana. Everyone who agrees is recorded against the exact version they saw. Publishing a new version asks people again and keeps the old record.</p>
    {d.purposes.map((p: string) => <Purpose key={p} purpose={p} items={d.items.filter((n: any) => n.purpose === p)} canEdit={canEdit} canApprove={canApprove} reload={st.reload} />)}
  </div>}</Async>;
}

function Purpose({ purpose, items, canEdit, canApprove, reload }: { purpose: string; items: any[]; canEdit: boolean; canApprove: boolean; reload: () => void }) {
  const toast = useToast(); const live = items.find((n) => n.status === 'Published'); const draft = items.find((n) => n.status === 'Draft');
  const [text, setText] = useState<string | null>(null); const [busy, setBusy] = useState('');
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); try { await fn(); toast(ok); setText(null); reload(); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(''); } };
  const history = items.filter((n) => n !== live && n !== draft);
  return <Card title={LABEL[purpose] ?? purpose} actions={live ? <Badge tone="ok">v{live.version} live</Badge> : <Badge>Not published</Badge>}>
    <div className="stack">
      {live ? <div><p className="small muted">Live since {dateTime(live.effective_from)}. {live.grants} {live.grants === 1 ? 'person has' : 'people have'} agreed to this version.</p><blockquote style={{ margin: 0 }}>{live.text}</blockquote></div> : <p className="muted">Nothing is published for this purpose. People are not asked for it.</p>}
      {draft && <div className="stack">
        <div className="row" style={{ gap: 8 }}><Badge tone="info">Draft v{draft.version}</Badge></div>
        <Field label="Draft wording" name={`draft-${purpose}`} hint="This is exactly what people will see beside the tick box.">{(p) => <textarea {...p} rows={6} value={text ?? draft.text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} />}</Field>
        <div className="row">
          {canEdit && <Button loading={busy === 'save'} disabled={text === null || text === draft.text} onClick={() => run('save', () => api.patch(`/admin/consent-notices/${draft.id}`, { text }), 'Draft saved')}>Save draft</Button>}
          {canApprove && <Button variant="primary" loading={busy === 'pub'} disabled={text !== null && text !== draft.text} onClick={() => run('pub', () => api.post(`/admin/consent-notices/${draft.id}/publish`), `Version ${draft.version} published`)}>Publish v{draft.version}</Button>}
        </div>
        {text !== null && text !== draft.text && <p className="small muted">Save the draft before publishing.</p>}
      </div>}
      {!draft && canEdit && <div><Button loading={busy === 'new'} onClick={() => run('new', () => api.post('/admin/consent-notices', { purpose, countryCode: 'GH', text: live?.text ?? 'I agree that Samakose may use my information for this purpose. Write the full wording here before publishing.' }), 'New draft created')}>{live ? 'Start a new version' : 'Write the first version'}</Button></div>}
      {history.length > 0 && <details><summary className="small">Earlier versions ({history.length})</summary><ul className="small">{history.map((n) => <li key={n.id}>v{n.version}, {n.status}, agreed by {n.grants}</li>)}</ul></details>}
    </div>
  </Card>;
}

/* -------------------------------- role mapping --------------------------------- */
function Mappings({ canEdit, canApprove }: { canEdit: boolean; canApprove: boolean }) {
  const st = useApi<any>('/admin/role-mappings');
  return <Async state={st}>{(d) => <div className="stack">
    <p className="muted small">Job role is not permission. This mapping only suggests who answers which area. The assessment owner confirms every assignment. Until a version is published, the reviewed default that ships with the platform is used.</p>
    {d.frameworks.map((f: string) => <Framework key={f} code={f} items={d.items.filter((m: any) => m.frameworkCode === f)} canEdit={canEdit} canApprove={canApprove} reload={st.reload} />)}
  </div>}</Async>;
}

function Framework({ code, items, canEdit, canApprove, reload }: { code: string; items: any[]; canEdit: boolean; canApprove: boolean; reload: () => void }) {
  const toast = useToast(); const live = items.find((m) => m.status === 'Published'); const draft = items.find((m) => m.status === 'Draft'); const [busy, setBusy] = useState('');
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); try { await fn(); toast(ok); reload(); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(''); } };
  return <Card title={code} actions={live ? <Badge tone="ok">v{live.version} live</Badge> : <Badge>Shipped default in use</Badge>}>
    <div className="stack">
      {live && <p className="small muted">Approved {dateTime(live.approvedAt)}.</p>}
      {draft ? <DraftMapping id={draft.id} version={draft.version} canEdit={canEdit} canApprove={canApprove} busy={busy} run={run} /> :
        canEdit ? <div><Button loading={busy === 'new'} onClick={() => run('new', () => api.post('/admin/role-mappings', { frameworkCode: code }), 'Draft created from the reviewed default')}>Start a draft</Button></div> : <Empty title="No draft" />}
    </div>
  </Card>;
}

function DraftMapping({ id, version, canEdit, canApprove, busy, run }: { id: string; version: number; canEdit: boolean; canApprove: boolean; busy: string; run: (k: string, fn: () => Promise<unknown>, ok: string) => void }) {
  const st = useApi<any>(`/admin/role-mappings/${id}`);
  const [edits, setEdits] = useState<Record<string, { primary: string; contributor: string }>>({});
  return <Async state={st}>{(m) => {
    const data = m.data; const areas = Object.keys(data.map);
    const val = (a: string, k: 'primary' | 'contributor') => edits[a]?.[k] ?? data.map[a][k].join(', ');
    const dirty = Object.keys(edits).length > 0;
    const parse = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const next = () => ({ ...data, map: Object.fromEntries(areas.map((a) => [a, { primary: parse(val(a, 'primary')), contributor: parse(val(a, 'contributor')) }])) });
    return <div className="stack">
      <Badge tone="info">Draft v{version}</Badge>
      <details><summary className="small">Role codes</summary><ul className="small">{Object.entries(data.roles).map(([k, l]) => <li key={k}><b>{k}</b>: {String(l)}{k === data.fallback ? ' (fallback: answers when no one else is on the team)' : ''}</li>)}</ul></details>
      <div className="table-wrap"><table><caption className="sr">Assessment areas and the roles that answer them</caption>
        <thead><tr><th>Area</th><th>Primary roles, in order</th><th>Can help</th></tr></thead>
        <tbody>{areas.map((a) => <tr key={a}><td>{a}</td>
          <td><input aria-label={`Primary roles for ${a}`} value={val(a, 'primary')} disabled={!canEdit} onChange={(e) => setEdits({ ...edits, [a]: { primary: e.target.value, contributor: val(a, 'contributor') } })} /></td>
          <td><input aria-label={`Helping roles for ${a}`} value={val(a, 'contributor')} disabled={!canEdit} onChange={(e) => setEdits({ ...edits, [a]: { primary: val(a, 'primary'), contributor: e.target.value } })} /></td></tr>)}</tbody></table></div>
      <div className="row">
        {canEdit && <Button loading={busy === 'save'} disabled={!dirty} onClick={() => run('save', async () => { await api.patch(`/admin/role-mappings/${id}`, { data: next() }); setEdits({}); st.reload(); }, 'Draft saved')}>Save draft</Button>}
        {canApprove && <Button variant="primary" loading={busy === 'pub'} disabled={dirty} onClick={() => run('pub', () => api.post(`/admin/role-mappings/${id}/publish`), `Version ${version} published and approved by you`)}>Approve and publish v{version}</Button>}
      </div>
      {dirty && <p className="small muted">Save the draft before publishing.</p>}
    </div>;
  }}</Async>;
}

/* ------------------------------- reach totals ------------------------------- */
function Reach() {
  const st = useApi<any>('/admin/demographics');
  const cell = (n: number | null) => n === null ? 'Hidden (small group)' : n;
  const Table = ({ title, rows }: { title: string; rows: { key: string; n: number | null }[] }) => <div><h3 style={{ marginTop: 0 }}>{title}</h3>{rows.length === 0 ? <p className="muted small">No answers yet.</p> : <div className="table-wrap"><table><thead><tr><th>Answer</th><th>People</th></tr></thead><tbody>{rows.map((r) => <tr key={r.key}><td>{r.key}</td><td>{cell(r.n)}</td></tr>)}</tbody></table></div>}</div>;
  return <Async state={st}>{(d) => <div className="stack">
    <p className="muted small">Totals only, from people who chose to answer. Any group smaller than {d.minGroupSize} is hidden. None of this is used in a score.</p>
    <p><strong>People who answered gender and age:</strong> {cell(d.demographics.total)}. <strong>Disability question:</strong> {cell(d.disability.total)}.</p>
    <Table title="Gender" rows={d.demographics.gender} /><Table title="Age band" rows={d.demographics.ageBand} /><Table title="Disability" rows={d.disability.status} />
  </div>}</Async>;
}
