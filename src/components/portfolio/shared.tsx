'use client';
import { useEffect } from 'react';
import { useApi } from '@/components/ui';

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
export function useTitle(t: string) { useEffect(() => { document.title = `${t} | Samakose`; }, [t]); }
export const num = (v: string) => (v.trim() === '' ? null : Number(v));
