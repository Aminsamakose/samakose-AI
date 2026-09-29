'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiFail, qs } from '@/lib/client/api';
import { useApi } from '@/components/ui';

export type Perms = Record<string, string[] | undefined>;
export type Me = { user: { role: string; email: string; name: string }; permissions: Perms };

/** Current user and what they may do. `can(resource, action)` is false until loaded. */
export function useMe() {
  const st = useApi<Me>('/auth/me');
  const perms = st.data?.permissions ?? {};
  return { ...st, role: st.data?.user.role, can: (res: string, act: string) => !!perms[res]?.includes(act) };
}

export function useTitle(t: string) { useEffect(() => { document.title = `${t} | Samakose`; }, [t]); }

export const today = () => new Date().toISOString().slice(0, 10);
export const daysUntil = (d: string | null | undefined) => d ? Math.ceil((new Date(d + 'T00:00:00').getTime() - new Date(today() + 'T00:00:00').getTime()) / 86400000) : null;

/** Parse a money input. Returns NaN when empty or invalid. */
export const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v));
export const checkMoney = (v: unknown, name: string): Record<string, string> => {
  const n = num(v);
  return !Number.isFinite(n) || n <= 0 ? { [name]: 'Enter an amount above zero' } : {};
};

/** Throw from a useForm submit to show client-side field errors the same way server ones show. */
export const clientFail = (fields: Record<string, string>) => new ApiFail(422, 'validation', 'Check the highlighted fields and try again.', fields);

export type OrgRow = { id: string; name: string; code: string };
/** Searchable organisation picker backed by GET /organisations. */
export function OrgSelect({ id, name, value, onChange, invalid, describedBy }: { id: string; name: string; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const st = useApi<{ items: OrgRow[] }>('/organisations' + qs({ q: dq, pageSize: 50, sort: 'name', dir: 'asc' }));
  const items = st.data?.items ?? [];
  return <div className="stack" style={{ gap: 6 }}>
    <input type="search" aria-label="Search organisations" placeholder="Search organisations" value={q} onChange={(e) => setQ(e.target.value)} />
    <select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}>
      <option value="">{st.loading && !st.data ? 'Loading organisations' : items.length ? 'Choose an organisation' : 'No organisations found'}</option>
      {items.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.code})</option>)}
    </select>
    {st.error && <span className="err" role="alert">{st.error}</span>}
  </div>;
}

/** Status filter select for list toolbars. */
export function StatusFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return <div className="row" style={{ gap: 6 }}>
    <label htmlFor={`f-${label}`} className="small muted">{label}</label>
    <select id={`f-${label}`} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto' }}>
      <option value="">All</option>{options.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  </div>;
}

export const Note = ({ children }: { children: ReactNode }) => <p className="small muted">{children}</p>;
export { api };
