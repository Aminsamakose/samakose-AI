import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { randomToken, sha256 } from './crypto';
import type { AuthUser } from './context';
import { env } from './env';

export const COOKIE = () => (env.isProd ? '__Host-sk' : 'sk_session');
const IDLE_MS = 8 * 3600_000;         // sliding idle timeout
const ABSOLUTE_MS = 7 * 24 * 3600_000; // hard cap

export async function createSession(userId: string, ip: string, userAgent: string | null, mfaVerified: boolean) {
  const token = randomToken(32);
  await db().insert(schema.sessions).values({
    id: sha256(token), userId, ip, userAgent: userAgent?.slice(0, 300) ?? null, mfaVerified, expiresAt: new Date(Date.now() + IDLE_MS)
  });
  return token;
}

export async function loadSession(token: string | undefined | null): Promise<AuthUser | null> {
  if (!token) return null;
  const id = sha256(token);
  const rows = await db().select({ s: schema.sessions, u: schema.users }).from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date()))).limit(1);
  const row = rows[0];
  if (!row || !row.u.active) return null;
  if (Date.now() - row.s.createdAt.getTime() > ABSOLUTE_MS) { await destroySession(token); return null; }
  if (Date.now() - row.s.lastSeenAt.getTime() > 5 * 60_000) {
    await db().update(schema.sessions).set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + IDLE_MS) }).where(eq(schema.sessions.id, id));
  }
  const progs = await db().select({ p: schema.userProgrammes.programmeId }).from(schema.userProgrammes).where(eq(schema.userProgrammes.userId, row.u.id));
  return {
    id: row.u.id, email: row.u.email, name: row.u.name, role: row.u.role, orgId: row.u.orgId,
    programmeIds: progs.map((p) => p.p), mfaEnabled: row.u.mfaEnabled, mfaVerified: row.s.mfaVerified,
    sessionId: id, mustChangePassword: row.u.mustChangePassword
  };
}

export async function destroySession(token: string) {
  await db().delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
}
export async function destroyUserSessions(userId: string, exceptId?: string) {
  await db().delete(schema.sessions).where(exceptId ? and(eq(schema.sessions.userId, userId), sql`${schema.sessions.id} <> ${exceptId}`) : eq(schema.sessions.userId, userId));
}
export async function markMfaVerified(sessionId: string) {
  await db().update(schema.sessions).set({ mfaVerified: true }).where(eq(schema.sessions.id, sessionId));
}

export function cookieHeader(token: string | null): string {
  const base = `${COOKIE()}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax${env.isProd ? '; Secure' : ''}`;
  return token ? `${base}; Max-Age=${IDLE_MS / 1000}` : `${base}; Max-Age=0`;
}

/** Fixed-window rate limit kept in the database, so it holds across instances. Returns the count in the current window. */
export async function rateLimit(key: string, windowSec: number): Promise<number> {
  const r = await db().execute(sql`
    INSERT INTO rate_limits (key, count, window_start) VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSec}) THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSec}) THEN now() ELSE rate_limits.window_start END
    RETURNING count`);
  return Number((r.rows[0] as { count: number }).count);
}
export async function clearRateLimit(key: string) {
  await db().delete(schema.rateLimits).where(eq(schema.rateLimits.key, key));
}
