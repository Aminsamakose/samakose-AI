import { randomUUID } from 'node:crypto';
import '@/api/routes';
import { dispatch } from '@/api/framework';
import { db, schema } from '@/db/client';
import { hashPassword, sha256 } from '@/lib/crypto';
import { seedReference } from '@/db/seed';
import { drainJobs } from '@/domain/jobs';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Role } from '@/db/schema';

export const PASSWORD = 'Correct-Horse-Battery-42';
let hash: string | null = null;
export const uniq = () => randomUUID().slice(0, 8);

export type Session = { cookie: string; userId: string; email: string; role: Role };
export type Res<T = any> = { status: number; body: any; data: T; error: any; headers: Headers; text: string };

export async function call(method: string, path: string, o: { body?: unknown; cookie?: string; headers?: Record<string, string>; raw?: string; form?: FormData } = {}): Promise<Res> {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = o.cookie;
  let body: any;
  if (o.form) body = o.form;
  else if (o.raw !== undefined) { body = o.raw; headers['content-type'] ??= 'application/json'; }
  else if (o.body !== undefined) { body = JSON.stringify(o.body); headers['content-type'] = 'application/json'; }
  const res = await dispatch(new Request('http://localhost/api/v1' + path, { method, headers, body }));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* csv or file */ }
  return { status: res.status, body: json, data: json?.data, error: json?.error, headers: res.headers, text };
}
export const api = (s: Session | null) => ({
  get: (p: string) => call('GET', p, { cookie: s?.cookie }),
  post: (p: string, b: unknown = {}) => call('POST', p, { cookie: s?.cookie, body: b }),
  patch: (p: string, b: unknown) => call('PATCH', p, { cookie: s?.cookie, body: b }),
  put: (p: string, b: unknown) => call('PUT', p, { cookie: s?.cookie, body: b }),
  del: (p: string) => call('DELETE', p, { cookie: s?.cookie })
});

export async function ensureReference() { await seedReference(); }

/** Insert a user directly (fast) and sign in through the real login endpoint. */
export async function makeUser(role: Role, o: { orgId?: string; name?: string; programmeIds?: string[]; email?: string } = {}): Promise<Session & { name: string }> {
  hash ??= await hashPassword(PASSWORD);
  const email = o.email ?? `${role.toLowerCase()}-${uniq()}@test.samakose.test`;
  const [u] = await db().insert(schema.users).values({ email, name: o.name ?? `${role} ${uniq()}`, role, orgId: o.orgId ?? null, passwordHash: hash }).returning();
  for (const p of o.programmeIds ?? []) await db().insert(schema.userProgrammes).values({ userId: u.id, programmeId: p });
  // Test experts are vetted, so the assignment rules apply to them as they would to a real approved practitioner.
  if (role === 'EXPERT') await db().insert(schema.practitionerProfiles).values({ userId: u.id, functions: ['expert', 'coach'], vettingStatus: 'Approved', maxActive: 50 }).onConflictDoNothing();
  const s = await login(email);
  return { ...s, name: u.name };
}
export async function login(email: string, password = PASSWORD): Promise<Session> {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${r.text}`);
  const sc = r.headers.get('set-cookie')!;
  const cookie = sc.split(';')[0];
  return { cookie, userId: r.data.user.id, email, role: r.data.user.role };
}

export async function makeOrg(admin: Session, region = 'Northern') {
  const r = await api(admin).post('/organisations', { name: `Org ${uniq()}`, type: 'AGRIFOOD', sector: 'Grains', region, district: 'Tamale', consent: true, consentBy: 'Test Owner' });
  if (r.status !== 201) throw new Error('org ' + r.text);
  return r.data as { id: string; code: string };
}

/** Full answer sheet: value per question code, optional evidence class. */
export async function answerSheet(value: number | ((code: string, i: number) => number), evidence?: string) {
  const qs = await db().select().from(schema.questions).where(eq(schema.questions.active, true)).orderBy(schema.questions.code);
  const a: Record<string, unknown> = {};
  qs.forEach((q, i) => { const v = typeof value === 'function' ? value(q.code, i) : value; a[q.code] = evidence ? { value: v, evidence } : v; });
  return a;
}

export async function drain() { return drainJobs(); }
export async function jobOf(id: string) { const [j] = await db().select().from(schema.jobs).where(eq(schema.jobs.id, id)); return j; }
export async function lastEmailTo(email: string) { const [m] = await db().select().from(schema.outboxEmails).where(eq(schema.outboxEmails.to, email)).orderBy(desc(schema.outboxEmails.createdAt)).limit(1); return m; }
export const tokenFrom = (body: string) => /token=([\w-]+)/.exec(body)![1];
export const auditActions = async (entityId: string) => (await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId))).map((r) => r.action);
export const sql_ = sql; export { and, eq, sha256 };
