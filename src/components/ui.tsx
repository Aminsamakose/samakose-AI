'use client';
import { CountUp } from './site/motion';
import { Icon } from './Icon';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { api, ApiFail, errText, qs, titleCase } from '@/lib/client/api';

/* ---------- data loading ---------- */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    const ac = new AbortController();
    setLoading(true);
    api.get<T>(path, ac.signal).then((d) => { setData(d); setError(null); }).catch((e) => { if (ac.signal.aborted) return; setError(errText(e)); }).finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [path, tick]);
  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Render loading, error, empty, then content. */
export function Async<T>({ state, children, empty }: { state: { data: T | null; error: string | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; empty?: (d: T) => boolean }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error && !state.data) return <ErrorState message={state.error} retry={state.reload} />;
  if (!state.data) return null;
  if (empty?.(state.data)) return <Empty title="Nothing here yet" />;
  return <>{children(state.data)}</>;
}
export const Loading = ({ rows = 3 }: { rows?: number }) => (
  <div className="stack" role="status" aria-live="polite" aria-label="Loading">
    {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%`, height: 18 }} />)}
    <span className="sr">Loading</span>
  </div>
);
export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="empty"><Icon name="inbox" className="lg" /><strong style={{ color: 'var(--fg)' }}>{title}</strong>{hint && <span className="small">{hint}</span>}{action}</div>
);
export const ErrorState = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div className="errbox" role="alert"><strong>{message}</strong>{retry && <button className="btn sm" onClick={retry}>Try again</button>}</div>
);

/* ---------- toasts ---------- */
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'bad') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const push = useCallback((msg: string, kind: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 5000);
  }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" role="status" aria-live="polite">{items.map((i) => <div key={i.id} className={`toast ${i.kind === 'bad' ? 'bad' : ''}`}>{i.msg}</div>)}</div></ToastCtx.Provider>;
}

/* ---------- basic pieces ---------- */
export function Button({ variant, size, loading, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost'; size?: 'sm'; loading?: boolean }) {
  return <button {...rest} disabled={rest.disabled || loading} className={`btn ${variant ?? ''} ${size ?? ''} ${rest.className ?? ''}`}>{loading ? <span className="spin" style={{ width: 14, height: 14, borderWidth: 2 }} aria-hidden /> : null}{children}</button>;
}
export const LinkButton = ({ href, children, variant, size }: { href: string; children: ReactNode; variant?: 'primary'; size?: 'sm' }) => <Link href={href} className={`btn ${variant ?? ''} ${size ?? ''}`}>{children}</Link>;

const TONES: Record<string, string> = {
  // good
  Validated: 'ok', Done: 'ok', Paid: 'ok', Succeeded: 'ok', Active: 'ok', APPROVED: 'ok', Reviewed: 'ok', Released: 'ok', Held: 'ok', Verified: 'ok', Published: 'ok', GRADUATED: 'ok', Green: 'ok', Low: 'ok', High: 'ok', Completed: 'ok', Open: 'info',
  // in progress
  'IN REVIEW': 'info', 'In progress': 'info', Sent: 'info', Pending: 'info', 'In review': 'info', Scheduled: 'info', Draft: '', Generating: 'info', MONITORING: 'brand', COACHING: 'brand', PRESCRIBED: 'brand', DIAGNOSED: 'brand', SCORED: 'brand', 'FOLLOW-UP': 'brand',
  // attention
  RETURNED: 'warn', Returned: 'warn', Overdue: 'warn', Amber: 'warn', Medium: 'warn', Blocked: 'warn', Unverified: 'warn', Expiring: 'warn', Rejected: 'bad',
  // bad
  Failed: 'bad', Red: 'bad', Cancelled: 'bad', Void: 'bad', Suspended: 'bad', Critical: 'bad', Inactive: 'bad', Dead: 'bad'
};
export const Badge = ({ children, tone }: { children: ReactNode; tone?: string }) => {
  const t = tone ?? (typeof children === 'string' ? TONES[children] : '') ?? '';
  const g = t === 'ok' ? 'ok' : t === 'warn' ? 'warn' : t === 'bad' ? 'bad' : t === 'info' ? 'pending' : null;
  return <span className={`badge ${t}`}>{g && <Icon name={g} />}{children}</span>;
};
export const Card = ({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`card ${className ?? ''}`}>{(title || actions) && <div className="card-head">{title && <h2>{title}</h2>}{actions && <div className="row">{actions}</div>}</div>}{children}</section>
);
/** Whole numbers count up once; anything else (money, scores with decimals, text) is shown as it is. */
export function AnimatedValue({ value }: { value: ReactNode }) {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  if (/^\d{1,3}(,\d{3})*$|^\d+$/.test(raw) && Number(raw.replace(/,/g, '')) < 1e9) return <CountUp to={Number(raw.replace(/,/g, ''))} onChangeOnly />;
  return <>{value}</>;
}
export const Tile = ({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: string }) => (
  <div className="tile"><span className="l">{label}</span><span className="v" style={tone ? { color: `var(--${tone})` } : undefined}><AnimatedValue value={value} /></span>{hint && <span className="small muted">{hint}</span>}</div>
);
export const PageHead = ({ title, sub, crumbs, actions }: { title: ReactNode; sub?: ReactNode; crumbs?: ReactNode; actions?: ReactNode }) => (
  <div className="page-head"><div>{crumbs && <div className="crumbs">{crumbs}</div>}<h1>{title}</h1>{sub && <p className="muted" style={{ marginTop: 4 }}>{sub}</p>}</div>{actions && <div className="actions">{actions}</div>}</div>
);
export const KV = ({ items }: { items: [string, ReactNode][] }) => (
  <dl className="kv">{items.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v ?? '-'}</dd></div>)}</dl>
);

/* ---------- dialog ---------- */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return <dialog ref={ref} onClose={onClose} aria-label={title} onClick={(e) => { if (e.target === ref.current) onClose(); }}>{open && <div className="dlg"><div className="card-head"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Close">Close</button></div>{children}</div>}</dialog>;
}
/** Confirm step for anything destructive or hard to undo. */
export function ConfirmButton({ label, message, onConfirm, variant, size }: { label: string; message: string; onConfirm: () => Promise<unknown> | void; variant?: 'danger' | 'primary'; size?: 'sm' }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const toast = useToast();
  return <>
    <Button variant={variant} size={size} onClick={() => setOpen(true)}>{label}</Button>
    <Modal open={open} onClose={() => setOpen(false)} title={label}>
      <p>{message}</p>
      <div className="form-actions"><Button variant={variant ?? 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); setOpen(false); } catch (e) { toast(errText(e), 'bad'); } finally { setBusy(false); } }}>Confirm</Button><Button onClick={() => setOpen(false)}>Cancel</Button></div>
    </Modal>
  </>;
}

/* ---------- forms ---------- */
export function Field({ label, name, error, hint, children, required }: { label: string; name: string; error?: string; hint?: string; children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; name: string }) => ReactNode; required?: boolean }) {
  const id = useId(); const eid = `${id}-e`; const hid = `${id}-h`;
  return <div className="field"><label htmlFor={id}>{label}{required && <span aria-hidden style={{ color: 'var(--bad)' }}> *</span>}</label>
    {children({ id, name, 'aria-invalid': error ? true : undefined, 'aria-describedby': [error && eid, hint && hid].filter(Boolean).join(' ') || undefined })}
    {hint && <span className="hint" id={hid}>{hint}</span>}{error && <span className="err" id={eid} role="alert">{error}</span>}</div>;
}
/** Form state with server-side field errors mapped back to the inputs. */
export function useForm<T extends Record<string, any>>(initial: T, submit: (v: T) => Promise<unknown>, opts?: { onDone?: (r: any) => void; success?: string }) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k: keyof T, v: any) => { setValues((x) => ({ ...x, [k]: v })); if (errors[k as string]) setErrors((e) => { const n = { ...e }; delete n[k as string]; return n; }); };
  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true); setErrors({}); setFormError(null);
    try { const r = await submit(values); if (opts?.success) toast(opts.success); opts?.onDone?.(r); }
    catch (err) {
      if (err instanceof ApiFail && err.fields && Object.keys(err.fields).length) { setErrors(err.fields); setFormError(err.message); }
      else setFormError(errText(err));
    } finally { setBusy(false); }
  };
  const input = (k: keyof T) => ({ value: values[k] ?? '', onChange: (e: React.ChangeEvent<any>) => set(k, e.target.value) });
  return { values, set, setValues, errors, setErrors, formError, busy, onSubmit, input };
}
export const FormError = ({ message }: { message: string | null }) => message ? <div className="alert bad" role="alert">{message}</div> : null;

/* ---------- data table (server paged, sorted, searched, exportable) ---------- */
export type Col<R> = { key: string; label: string; sort?: string; render?: (r: R) => ReactNode; align?: 'r' };
export function DataTable<R extends Record<string, any>>({ endpoint, columns, params, rowHref, exportable, searchable = true, placeholder = 'Search', empty, toolbar, defaultSort, pageSize = 20, refreshKey }: {
  endpoint: string; columns: Col<R>[]; params?: Record<string, unknown>; rowHref?: (r: R) => string; exportable?: boolean; searchable?: boolean; placeholder?: string;
  empty?: { title: string; hint?: string; action?: ReactNode }; toolbar?: ReactNode; defaultSort?: { key: string; dir: 'asc' | 'desc' }; pageSize?: number; refreshKey?: number;
}) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const pj = JSON.stringify(params ?? {});
  useEffect(() => { setPage(1); }, [pj]);
  const path = useMemo(() => endpoint + qs({ ...(params ?? {}), q: dq, page, pageSize, sort: sort?.key, dir: sort?.dir }), [endpoint, pj, dq, page, sort, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useApi<{ items: R[]; total: number; pages: number }>(path + (refreshKey ? `&_=${refreshKey}` : ''));
  const d = st.data;
  const csv = '/api/v1' + endpoint + qs({ ...(params ?? {}), q: dq, sort: sort?.key, dir: sort?.dir, format: 'csv' });
  return <div className="stack">
    <div className="toolbar">
      {searchable && <div className="search-box"><label className="sr" htmlFor={endpoint + 's'}>Search</label><input id={endpoint + 's'} type="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      {toolbar}
      {exportable && <a className="btn right" href={csv} download>Export CSV</a>}
    </div>
    {st.error && !d ? <ErrorState message={st.error} retry={st.reload} /> : !d ? <Loading rows={5} /> : d.items.length === 0 ? (
      <div className="table-wrap"><Empty title={dq ? 'No matches' : (empty?.title ?? 'Nothing here yet')} hint={dq ? 'Try a different search or clear filters.' : empty?.hint} action={dq ? <button className="btn sm" onClick={() => setQ('')}>Clear search</button> : empty?.action} /></div>
    ) : <>
      <div className="table-wrap" aria-busy={st.loading}>
        <table>
          <thead><tr>{columns.map((c) => <th key={c.key} className={c.align} aria-sort={c.sort && sort?.key === c.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
            {c.sort ? <button onClick={() => setSort(sort && sort.key === c.sort ? { key: c.sort!, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.sort!, dir: 'asc' })}>{c.label}<span aria-hidden>{sort && sort.key === c.sort ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span></button> : c.label}</th>)}</tr></thead>
          <tbody>{d.items.map((r, i) => <tr key={r.id ?? i}>{columns.map((c, j) => <td key={c.key} className={c.align}>{j === 0 && rowHref ? <Link href={rowHref(r)}>{c.render ? c.render(r) : String(r[c.key] ?? '-')}</Link> : c.render ? c.render(r) : (r[c.key] ?? '-')}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="pager"><span className="muted">{d.total.toLocaleString()} record{d.total === 1 ? '' : 's'}</span>
        <span className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="num">Page {page} of {d.pages}</span><button className="btn sm" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>Next</button></span></div>
    </>}
  </div>;
}

/* ---------- tabs ---------- */
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button type="button" key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)}>{t.label}</button>)}</div>;
}

/* ---------- charts (SVG, each with a text alternative) ---------- */
export function BarList({ data, max, format }: { data: { label: string; value: number }[]; max?: number; format?: (n: number) => string }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <Empty title="No data yet" />;
  return <div className="bars" role="list">{data.map((d) => <div className="bar-row" role="listitem" key={d.label}><span>{titleCase(d.label)}</span><div className="bar-track" aria-hidden><div className="bar-fill" style={{ width: `${Math.min(100, (d.value / m) * 100)}%` }} /></div><span className="num" style={{ textAlign: 'right' }}>{format ? format(d.value) : d.value}</span></div>)}</div>;
}
export function LineChart({ points, label, min = 0, max = 100 }: { points: { x: string; y: number }[]; label: string; min?: number; max?: number }) {
  const W = 520, H = 180, P = 32;
  if (points.length < 1) return <Empty title="No history yet" />;
  const xs = (i: number) => P + (points.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (points.length - 1));
  const ys = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.y).toFixed(1)}`).join(' ');
  return <div><svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${points.map((p) => `${p.x} ${p.y}`).join(', ')}`} style={{ width: '100%', height: 'auto' }}>
    {[min, (min + max) / 2, max].map((t) => <g key={t}><line x1={P} x2={W - P} y1={ys(t)} y2={ys(t)} stroke="var(--line)" /><text x={P - 6} y={ys(t) + 4} textAnchor="end">{Math.round(t)}</text></g>)}
    <path className="draw" pathLength={1} d={line} fill="none" stroke="var(--brand)" strokeWidth="2.5" />
    {points.map((p, i) => <g key={i}><circle cx={xs(i)} cy={ys(p.y)} r="4" fill="var(--brand)" />{(points.length <= 8 || i % Math.ceil(points.length / 8) === 0) && <text x={xs(i)} y={H - 10} textAnchor="middle">{p.x}</text>}</g>)}
  </svg>
  <details className="small muted"><summary>View as table</summary><table><thead><tr><th>Period</th><th className="r">Value</th></tr></thead><tbody>{points.map((p) => <tr key={p.x}><td>{p.x}</td><td className="r num">{p.y}</td></tr>)}</tbody></table></details></div>;
}
