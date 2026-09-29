'use client';
/** Browser side of the REST API. One place for errors, redirects on session problems, and CSV links. */
export class ApiFail extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>, public requestId?: string) { super(message); }
}
const GATES: Record<string, string> = { mfa_required: '/mfa', mfa_setup_required: '/mfa-setup', password_change_required: '/change-password' };

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch('/api/v1' + path, {
    method, signal, credentials: 'same-origin',
    headers: body === undefined || isForm ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body)
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const e = json?.error;
    if (typeof window !== 'undefined') {
      if (res.status === 401 && !path.startsWith('/auth/login') && !window.location.pathname.match(/^\/(login|forgot|reset|accept)/)) window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      if (e?.code && GATES[e.code] && window.location.pathname !== GATES[e.code]) window.location.href = GATES[e.code];
    }
    throw new ApiFail(res.status, e?.code ?? 'error', e?.message ?? 'Something went wrong. Please try again.', e?.details && typeof e.details === 'object' ? e.details : undefined, e?.requestId);
  }
  return (json?.data ?? json) as T;
}
export const api = {
  get: <T = any>(p: string, s?: AbortSignal) => call<T>('GET', p, undefined, s),
  post: <T = any>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  patch: <T = any>(p: string, b: unknown) => call<T>('PATCH', p, b),
  put: <T = any>(p: string, b: unknown) => call<T>('PUT', p, b),
  del: <T = any>(p: string) => call<T>('DELETE', p),
  upload: <T = any>(p: string, f: FormData) => call<T>('POST', p, f)
};
export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
};
/** Human-safe message for anything thrown. */
export const errText = (e: unknown) => (e instanceof ApiFail ? e.message : 'Something went wrong. Please try again.');

export const ghs = (n: number | string | null | undefined) => n === null || n === undefined || n === '' ? '-' : 'GHS ' + Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dateFmt = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
export const dateTime = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
export const titleCase = (s: string) => s.replace(/[_-]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
