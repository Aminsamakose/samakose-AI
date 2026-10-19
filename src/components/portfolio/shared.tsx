'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/components/ui';
import { qs } from '@/lib/client/api';

export const REGIONS = ['Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra', 'North East', 'Northern', 'Oti', 'Savannah', 'Upper East', 'Upper West', 'Volta', 'Western', 'Western North'];
export const ORG_TYPES: { value: string; label: string }[] = [{ value: 'SME', label: 'SME' }, { value: 'AGRIFOOD', label: 'Agrifood' }, { value: 'ESO', label: 'Enterprise support organisation' }];
export const typeLabel = (t?: string | null) => ORG_TYPES.find((x) => x.value === t)?.label ?? t ?? '-';
export const SIZES = ['1-10', '11-50', '51-250', '251+'];
export const SECTORS = ['Agriculture', 'Agro-processing', 'Shea processing', 'Trading and retail', 'Manufacturing', 'Services', 'Food and beverage', 'Textiles and fashion', 'Construction', 'ICT', 'Education', 'Health'];

type Me = { user: { id: string; role: string; name: string }; permissions: Record<string, string[]> };
/** Current role and a can(resource, action) check based on /auth/me. The API stays the authority. */
export function usePerms() {
  const me = useApi<Me>('/auth/me');
  const can = (res: string, act: string) => !!me.data?.permissions?.[res]?.includes(act);
  return { ready: !!me.data, role: me.data?.user.role ?? null, can, me };
}
export function useTitle(t: string) { useEffect(() => { document.title = `${t} | Business Doctor by Samakose`; }, [t]); }
export const num = (v: string) => (v.trim() === '' ? null : Number(v));

export type UserRow = { id: string; name: string; email: string; role: string };
/** Searchable staff picker backed by GET /users. */
export function UserSelect({ id, name, value, onChange, invalid, describedBy }: { id: string; name: string; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const st = useApi<{ items: UserRow[] }>('/users' + qs({ q: dq, pageSize: 50, sort: 'name', dir: 'asc' }));
  const items = st.data?.items ?? [];
  return <div className="stack" style={{ gap: 6 }}>
    <input type="search" aria-label="Search people" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
    <select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}>
      <option value="">{st.loading && !st.data ? 'Loading people' : items.length ? 'Choose a person' : 'No one found'}</option>
      {items.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.email} ({u.role})</option>)}
    </select>
    {st.error && <span className="err" role="alert">{st.error}</span>}
  </div>;
}
