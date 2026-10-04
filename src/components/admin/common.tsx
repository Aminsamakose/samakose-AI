'use client';
import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ROLE_LABEL, type Resource } from '@/lib/rbac';
import { ApiFail, qs, titleCase } from '@/lib/client/api';
import { Badge, Empty, ErrorState, Field, Loading, PageHead, useApi } from '@/components/ui';

export type Me = { user: { id: string; role: string; name: string; email: string }; permissions: Record<string, string[]> };
export const ROLE_OPTIONS = Object.entries(ROLE_LABEL) as [string, string][];
export const roleLabel = (r: string) => (ROLE_LABEL as Record<string, string>)[r] ?? titleCase(r);
export const DIMENSIONS = ['Finance', 'Market and sales', 'Operations', 'People and governance', 'Records and systems', 'Compliance and finance access'];

export const userStatus = (u: { active: boolean; invited: boolean; lockedUntil: string | null }) => !u.active ? 'Inactive' : u.invited ? 'Invited' : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? 'Locked' : 'Active';
export const statusTone = (s: string) => s === 'Invited' ? 'info' : s === 'Locked' ? 'warn' : undefined;

export function useDocTitle(t: string) { useEffect(() => { document.title = `${t} | Business Doctor by Samakose`; }, [t]); }

/** Current user with a `can` helper. The API remains the authority. */
export function useMe() {
  const st = useApi<Me>('/auth/me');
  const can = (resource: Resource, action: string) => !!st.data?.permissions?.[resource]?.includes(action);
  return { ...st, can };
}

/** Shows a page only to roles holding the permission; otherwise a plain explanation. */
export function Guard({ resource, action, title, children }: { resource: Resource; action: string; title: string; children: (me: ReturnType<typeof useMe>) => ReactNode }) {
  const me = useMe();
  useDocTitle(title);
  if (me.loading && !me.data) return <Loading />;
  if (me.error && !me.data) return <ErrorState message={me.error} retry={me.reload} />;
  if (!me.can(resource, action)) return <><PageHead title={title} /><Empty title="You do not have access to this page" hint="Ask an administrator if you need it." /></>;
  return <>{children(me)}</>;
}

export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
/** Throw this from a form submit to show client-side field errors the same way server errors are shown. */
export const fieldFail = (fields: Record<string, string>) => new ApiFail(422, 'validation', 'Check the highlighted fields and try again.', fields);

/* ---------- organisation picker (search then choose) ---------- */
type OrgRow = { id: string; name: string; code: string };
export function OrgPicker({ value, onChange, error, required, label = 'Organisation' }: { value: string; onChange: (id: string) => void; error?: string; required?: boolean; label?: string }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const list = useApi<{ items: OrgRow[] }>('/organisations' + qs({ q: dq, pageSize: 25, sort: 'name', dir: 'asc' }));
  const current = useApi<OrgRow>(value ? `/organisations/${value}` : null);
  const options = useMemo(() => {
    const items = list.data?.items ?? [];
    const cur = current.data && !items.some((o) => o.id === current.data!.id) ? [current.data] : [];
    return [...cur, ...items];
  }, [list.data, current.data]);
  const sid = useId();
  return <div className="stack" style={{ gap: 8 }}>
    <div className="field"><label htmlFor={sid}>Find an organisation</label><input id={sid} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or code" /></div>
    <Field label={label} name="orgId" error={error} required={required} hint={list.error ? list.error : list.loading ? 'Searching' : options.length ? `${options.length} shown. Search to narrow the list.` : 'No organisations match.'}>
      {(p) => <select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose an organisation</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.code})</option>)}
      </select>}
    </Field>
  </div>;
}

/* ---------- programme multi-select ---------- */
type ProgRow = { id: string; name: string; code: string; status?: string };
export function ProgrammePicker({ value, onChange, error }: { value: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const st = useApi<{ items: ProgRow[]; total: number }>('/programmes' + qs({ pageSize: 100, sort: 'name', dir: 'asc' }));
  const [f, setF] = useState('');
  const fid = useId();
  if (st.loading && !st.data) return <Loading rows={2} />;
  if (st.error && !st.data) return <ErrorState message={st.error} retry={st.reload} />;
  const items = st.data?.items ?? [];
  if (!items.length) return <Empty title="No programmes exist yet" hint="Create a programme first, then assign it here." />;
  const shown = items.filter((p) => !f || `${p.name} ${p.code}`.toLowerCase().includes(f.toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return <fieldset style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 12, minWidth: 0 }}>
    <legend style={{ fontWeight: 600, fontSize: '.88rem', padding: '0 6px' }}>Programmes ({value.length} selected)</legend>
    {items.length > 8 && <div className="field" style={{ marginBottom: 8 }}><label className="sr" htmlFor={fid}>Filter programmes</label><input id={fid} type="search" placeholder="Filter programmes" value={f} onChange={(e) => setF(e.target.value)} /></div>}
    <div className="stack" style={{ gap: 6, maxHeight: 220, overflowY: 'auto' }}>
      {shown.length === 0 ? <span className="muted small">No programmes match.</span> : shown.map((p) => <label key={p.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
        <span>{p.name} <span className="muted small">{p.code}{p.status ? ` · ${p.status}` : ''}</span></span>
      </label>)}
    </div>
    {st.data && st.data.total > items.length && <p className="small muted" style={{ marginTop: 8 }}>Showing the first {items.length} of {st.data.total} programmes.</p>}
    {error && <span className="err" role="alert" style={{ color: 'var(--bad)', fontWeight: 600, fontSize: '.84rem' }}>{error}</span>}
  </fieldset>;
}

/* ---------- readable before/after diff ---------- */
type Flat = Record<string, string>;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const scalar = (v: unknown): string => v === null || v === undefined ? '\u0000empty' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v === '' ? '\u0000blank' : String(v);
function flatten(v: unknown, prefix: string, out: Flat) {
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (!keys.length && prefix) { out[prefix] = '\u0000none'; return; }
    for (const k of keys) flatten(v[k], prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(v)) {
    if (!v.length) out[prefix || '(list)'] = '\u0000none';
    else if (v.every((x) => !x || typeof x !== 'object')) out[prefix || '(list)'] = v.map((x) => scalar(x).replace(/^\u0000.*/, '(empty)')).join(', ');
    else v.forEach((x, i) => flatten(x, `${prefix}[${i + 1}]`, out));
  } else out[prefix || '(value)'] = scalar(v);
}
const show = (s: string | undefined): ReactNode => s === undefined ? <span className="muted">Not present</span> : s === '\u0000empty' ? <span className="muted">(empty)</span> : s === '\u0000blank' ? <span className="muted">(blank)</span> : s === '\u0000none' ? <span className="muted">(none)</span> : <span style={{ overflowWrap: 'anywhere' }}>{s}</span>;

/** Before/after comparison as a table of fields. With only one side it lists the recorded values. */
export function DiffView({ before, after, single }: { before?: unknown; after?: unknown; single?: boolean }) {
  const [all, setAll] = useState(false);
  const id = useId();
  const rows = useMemo(() => {
    const b: Flat = {}, a: Flat = {};
    if (before !== null && before !== undefined) flatten(before, '', b);
    if (after !== null && after !== undefined) flatten(after, '', a);
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
    return keys.map((k) => {
      const kind = b[k] === undefined ? 'Added' : a[k] === undefined ? 'Removed' : b[k] === a[k] ? 'Unchanged' : 'Changed';
      return { k, b: b[k], a: a[k], kind };
    });
  }, [before, after]);
  if (!rows.length) return <p className="muted small">No field details were recorded for this entry.</p>;
  const unchanged = rows.filter((r) => r.kind === 'Unchanged').length;
  const vis = all || single ? rows : rows.filter((r) => r.kind !== 'Unchanged');
  const tone = (k: string) => k === 'Added' ? 'ok' : k === 'Removed' ? 'bad' : k === 'Changed' ? 'warn' : '';
  return <div className="stack" style={{ gap: 8 }}>
    {!single && unchanged > 0 && <label className="row small" style={{ gap: 6 }} htmlFor={id}><input id={id} type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show {unchanged} unchanged field{unchanged === 1 ? '' : 's'}</label>}
    <div className="table-wrap"><table>
      <thead><tr><th>Field</th>{single ? <th>Value</th> : <><th>Before</th><th>After</th><th>Change</th></>}</tr></thead>
      <tbody>{vis.map((r) => <tr key={r.k}>
        <td className="mono" style={{ overflowWrap: 'anywhere' }}>{r.k}</td>
        {single ? <td>{show(r.a ?? r.b)}</td> : <><td>{show(r.b)}</td><td>{show(r.a)}</td><td><Badge tone={tone(r.kind)}>{r.kind}</Badge></td></>}
      </tr>)}</tbody>
    </table></div>
  </div>;
}

/* ---------- paged log table with expandable rows ---------- */
export type LogCol<R> = { key: string; label: string; sort?: string; render: (r: R) => ReactNode };
export function LogTable<R extends { id: string | number }>({ endpoint, columns, params, detail, exportable, pageSize = 20, searchable = true, placeholder = 'Search', emptyTitle, toolbar, defaultSort }: {
  endpoint: string; columns: LogCol<R>[]; params?: Record<string, unknown>; detail: (r: R) => ReactNode; exportable?: boolean; pageSize?: number; searchable?: boolean; placeholder?: string; emptyTitle: string; toolbar?: ReactNode; defaultSort?: { key: string; dir: 'asc' | 'desc' };
}) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const [open, setOpen] = useState<Set<string | number>>(new Set());
  const base = useId();
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const pj = JSON.stringify(params ?? {});
  useEffect(() => { setPage(1); }, [pj]);
  const query = { ...(params ?? {}), q: dq || (params as any)?.q, sort: sort?.key, dir: sort?.dir };
  const path = endpoint + qs({ ...query, page, pageSize });
  const st = useApi<{ items: R[]; total: number; pages: number }>(path);
  const d = st.data;
  const toggle = (id: string | number) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return <div className="stack">
    <div className="toolbar">
      {searchable && <div className="search-box"><label className="sr" htmlFor={`${base}-q`}>Search</label><input id={`${base}-q`} type="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      {toolbar}
      {exportable && <a className="btn right" href={'/api/v1' + endpoint + qs({ ...query, format: 'csv' })} download>Export CSV</a>}
    </div>
    <div aria-live="polite">
    {st.error && !d ? <ErrorState message={st.error} retry={st.reload} /> : !d ? <Loading rows={5} /> : d.items.length === 0 ? (
      <div className="table-wrap"><Empty title={dq ? 'No matches' : emptyTitle} hint={dq || pj !== '{}' ? 'Try a different search or clear the filters.' : undefined} /></div>
    ) : <>
      <div className="table-wrap" aria-busy={st.loading}>
        <table>
          <thead><tr>{columns.map((c) => <th key={c.key} aria-sort={c.sort && sort?.key === c.sort ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
            {c.sort ? <button onClick={() => setSort(c.sort && sort?.key === c.sort ? { key: c.sort!, dir: sort!.dir === 'asc' ? 'desc' : 'asc' } : { key: c.sort!, dir: 'desc' })}>{c.label}<span aria-hidden>{c.sort && sort?.key === c.sort ? (sort!.dir === 'asc' ? '▲' : '▼') : ''}</span></button> : c.label}</th>)}<th>Details</th></tr></thead>
          <tbody>{d.items.map((r) => {
            const isOpen = open.has(r.id); const did = `${base}-d-${r.id}`;
            return <Fragment key={r.id}>
              <tr>{columns.map((c) => <td key={c.key}>{c.render(r)}</td>)}
                <td><button className="btn sm" aria-expanded={isOpen} aria-controls={did} onClick={() => toggle(r.id)}>{isOpen ? 'Hide' : 'Show'}</button></td></tr>
              {isOpen && <tr id={did}><td colSpan={columns.length + 1} style={{ background: 'var(--surface-2)' }}>{detail(r)}</td></tr>}
            </Fragment>;
          })}</tbody>
        </table>
      </div>
      <div className="pager"><span className="muted">{d.total.toLocaleString()} record{d.total === 1 ? '' : 's'}</span>
        <span className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="num">Page {page} of {d.pages}</span><button className="btn sm" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>Next</button></span></div>
    </>}
    </div>
  </div>;
}

