import QRCode from 'qrcode';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, fieldError, forbidden, tooMany, unauthorized } from '@/lib/errors';
import { decrypt, encrypt, hashPassword, newTotpSecret, otpauthUrl, passwordProblems, randomToken, sha256, verifyPassword, verifyTotp } from '@/lib/crypto';
import { clearRateLimit, cookieHeader, createSession, destroySession, destroyUserSessions, markMfaVerified, rateLimit } from '@/lib/session';
import { env } from '@/lib/env';
import { PERMISSIONS, ROLE_LABEL } from '@/lib/rbac';
import { queueEmail } from '@/domain/notify';
import { need } from './common';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const GENERIC = 'Email or password is incorrect';

export type NextStep = 'ok' | 'mfa' | 'mfa_setup' | 'change_password';
export function nextStep(u: { mfaEnabled: boolean; mfaVerified: boolean; mustChangePassword: boolean; role: string }): NextStep {
  if (u.mfaEnabled && !u.mfaVerified) return 'mfa';
  if (u.mustChangePassword) return 'change_password';
  if (env.mfaRequiredRoles.includes(u.role) && !u.mfaEnabled) return 'mfa_setup';
  return 'ok';
}

export const publicUser = (u: { id: string; code?: string; email: string; name: string; role: string; orgId: string | null; mfaEnabled: boolean }) =>
  ({ id: u.id, code: u.code, email: u.email, name: u.name, role: u.role, roleLabel: ROLE_LABEL[u.role as keyof typeof ROLE_LABEL], orgId: u.orgId, mfaEnabled: u.mfaEnabled });

const json = (data: unknown, cookie?: string) =>
  new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) } });

export async function login(ctx: Ctx, email: string, password: string, userAgent: string | null) {
  const key = 'login:e:' + sha256(email.toLowerCase());
  if ((await rateLimit(key, 15 * 60)) > 10) throw tooMany('Too many sign-in attempts for this account. Try again in a few minutes.');
  const [u] = await db().select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`).limit(1);
  const locked = !!u?.lockedUntil && u.lockedUntil > new Date();
  const ok = await verifyPassword(password, u?.passwordHash ?? null);
  if (!u || !u.active || locked || !ok) {
    if (u && !locked && u.active && u.passwordHash) {
      const fails = u.failedLogins + 1;
      await db().update(schema.users).set({ failedLogins: fails, lockedUntil: fails >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null }).where(eq(schema.users.id, u.id));
      await audit({ ...ctx, user: null, db: db() }, fails >= LOCK_AFTER ? 'auth.locked' : 'auth.login_failed', 'user', u.id, undefined, { email });
    } else {
      await audit({ ...ctx, user: null, db: db() }, locked ? 'auth.login_while_locked' : 'auth.login_failed', 'user', u?.id ?? null, undefined, { email });
    }
    throw unauthorized(GENERIC);
  }
  await db().update(schema.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
  await clearRateLimit(key);
  const token = await createSession(u.id, ctx.ip, userAgent, !u.mfaEnabled);
  await audit({ ...ctx, user: { id: u.id, email: u.email } as any, db: db() }, 'auth.login', 'user', u.id);
  const step = nextStep({ mfaEnabled: u.mfaEnabled, mfaVerified: !u.mfaEnabled, mustChangePassword: u.mustChangePassword, role: u.role });
  return json({ user: publicUser(u), next: step }, cookieHeader(token));
}

export async function logout(ctx: Ctx, token: string | undefined) {
  if (token) await destroySession(token);
  if (ctx.user) await audit(ctx, 'auth.logout', 'user', ctx.user.id);
  return json({ ok: true }, cookieHeader(null));
}

export async function verifyMfa(ctx: Ctx, code: string) {
  const c = need(ctx);
  if ((await rateLimit('mfa:' + c.user.id, 10 * 60)) > 10) throw tooMany('Too many codes tried. Wait a few minutes.');
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, c.user.id)).limit(1);
  if (!u?.mfaEnabled || !u.mfaSecret) throw new ApiError(422, 'invalid_state', 'Two-step verification is not turned on');
  if (!verifyTotp(decrypt(u.mfaSecret), code)) { await audit(ctx, 'auth.mfa_failed', 'user', u.id); throw fieldError({ code: 'That code is not right or has expired' }); }
  await markMfaVerified(c.user.id === u.id ? c.user.sessionId : '');
  await clearRateLimit('mfa:' + c.user.id);
  await audit(ctx, 'auth.mfa_verified', 'user', u.id);
  return { next: nextStep({ mfaEnabled: true, mfaVerified: true, mustChangePassword: u.mustChangePassword, role: u.role }) };
}

export async function mfaSetup(ctx: Ctx) {
  const c = need(ctx);
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, c.user.id)).limit(1);
  if (u.mfaEnabled) throw new ApiError(409, 'conflict', 'Two-step verification is already on');
  const secret = newTotpSecret();
  await ctx.db.update(schema.users).set({ mfaSecret: encrypt(secret), updatedAt: new Date() }).where(eq(schema.users.id, u.id));
  const url = otpauthUrl(u.email, secret);
  await audit(ctx, 'auth.mfa_setup_started', 'user', u.id);
  return { secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}
export async function mfaEnable(ctx: Ctx, code: string) {
  const c = need(ctx);
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, c.user.id)).limit(1);
  if (u.mfaEnabled) throw new ApiError(409, 'conflict', 'Two-step verification is already on');
  if (!u.mfaSecret) throw new ApiError(422, 'invalid_state', 'Start setup first');
  if ((await rateLimit('mfa:' + u.id, 10 * 60)) > 10) throw tooMany();
  if (!verifyTotp(decrypt(u.mfaSecret), code)) throw fieldError({ code: 'That code is not right or has expired' });
  await ctx.db.update(schema.users).set({ mfaEnabled: true, updatedAt: new Date() }).where(eq(schema.users.id, u.id));
  await markMfaVerified(c.user.sessionId);
  await audit(ctx, 'auth.mfa_enabled', 'user', u.id);
  return { mfaEnabled: true };
}
export async function mfaDisable(ctx: Ctx, password: string, code: string) {
  const c = need(ctx);
  if (env.mfaRequiredRoles.includes(c.user.role)) throw forbidden('Your role must keep two-step verification on');
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, c.user.id)).limit(1);
  if (!u.mfaEnabled || !u.mfaSecret) throw new ApiError(422, 'invalid_state', 'Two-step verification is not on');
  if (!(await verifyPassword(password, u.passwordHash))) throw fieldError({ password: 'Password is incorrect' });
  if (!verifyTotp(decrypt(u.mfaSecret), code)) throw fieldError({ code: 'That code is not right or has expired' });
  await ctx.db.update(schema.users).set({ mfaEnabled: false, mfaSecret: null, updatedAt: new Date() }).where(eq(schema.users.id, u.id));
  await audit(ctx, 'auth.mfa_disabled', 'user', u.id);
  return { mfaEnabled: false };
}

export async function changePassword(ctx: Ctx, current: string, next: string) {
  const c = need(ctx);
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, c.user.id)).limit(1);
  if (!(await verifyPassword(current, u.passwordHash))) throw fieldError({ current: 'Current password is incorrect' });
  const problems = passwordProblems(next, u.email, u.name);
  if (current === next) problems.push('Choose a password you have not used just now');
  if (problems.length) throw fieldError({ password: problems.join('. ') });
  await ctx.db.update(schema.users).set({ passwordHash: await hashPassword(next), mustChangePassword: false, updatedAt: new Date() }).where(eq(schema.users.id, u.id));
  await destroyUserSessions(u.id, c.user.sessionId);
  await audit(ctx, 'auth.password_changed', 'user', u.id);
  return { ok: true };
}

export async function forgotPassword(ctx: Ctx, email: string) {
  if ((await rateLimit('forgot:' + sha256(email.toLowerCase()), 3600)) > 5) return { ok: true };
  const [u] = await ctx.db.select().from(schema.users).where(and(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`, eq(schema.users.active, true))).limit(1);
  if (u) {
    const token = randomToken(32);
    await ctx.db.insert(schema.userTokens).values({ userId: u.id, kind: 'reset', tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) });
    await queueEmail(ctx, u.email, 'Reset your Samakose password', `Use this link within one hour to choose a new password:\n${env.appUrl}/reset-password?token=${token}\n\nIf you did not ask for this, ignore this email.`);
    await audit(ctx, 'auth.reset_requested', 'user', u.id);
  }
  return { ok: true }; // the same answer whether or not the account exists
}

async function takeToken(ctx: Ctx, token: string, kind: 'reset' | 'invite') {
  const [t] = await ctx.db.select().from(schema.userTokens)
    .where(and(eq(schema.userTokens.tokenHash, sha256(token)), eq(schema.userTokens.kind, kind), isNull(schema.userTokens.usedAt), gt(schema.userTokens.expiresAt, new Date()))).for('update').limit(1);
  if (!t) throw new ApiError(400, 'bad_token', 'This link is invalid or has expired. Ask for a new one.');
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, t.userId)).limit(1);
  if (!u || !u.active) throw new ApiError(400, 'bad_token', 'This link is invalid or has expired. Ask for a new one.');
  return { t, u };
}
export async function resetPassword(ctx: Ctx, token: string, password: string) {
  const { t, u } = await takeToken(ctx, token, 'reset');
  const problems = passwordProblems(password, u.email, u.name);
  if (problems.length) throw fieldError({ password: problems.join('. ') });
  await ctx.db.update(schema.users).set({ passwordHash: await hashPassword(password), mustChangePassword: false, failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(schema.users.id, u.id));
  await ctx.db.update(schema.userTokens).set({ usedAt: new Date() }).where(eq(schema.userTokens.id, t.id));
  await destroyUserSessions(u.id);
  await audit({ ...ctx, user: { id: u.id, email: u.email } as any }, 'auth.password_reset', 'user', u.id);
  return { ok: true };
}
export async function acceptInvite(ctx: Ctx, token: string, password: string, name?: string) {
  const { t, u } = await takeToken(ctx, token, 'invite');
  const problems = passwordProblems(password, u.email, name ?? u.name);
  if (problems.length) throw fieldError({ password: problems.join('. ') });
  await ctx.db.update(schema.users).set({ passwordHash: await hashPassword(password), name: name?.trim() || u.name, mustChangePassword: false, updatedAt: new Date() }).where(eq(schema.users.id, u.id));
  await ctx.db.update(schema.userTokens).set({ usedAt: new Date() }).where(eq(schema.userTokens.id, t.id));
  await audit({ ...ctx, user: { id: u.id, email: u.email } as any }, 'auth.invite_accepted', 'user', u.id);
  return { ok: true };
}

export async function me(ctx: Ctx) {
  const c = need(ctx);
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, c.user.id)).limit(1);
  const unread = Number(((await ctx.db.execute(sql`select count(*)::int n from notifications where user_id=${c.user.id} and read_at is null`)).rows[0] as { n: number }).n);
  return { user: publicUser(u), permissions: PERMISSIONS[u.role], programmeIds: c.user.programmeIds, unreadNotifications: unread, next: nextStep(c.user) };
}
export async function updateMe(ctx: Ctx, name: string) {
  const c = need(ctx);
  await ctx.db.update(schema.users).set({ name: name.trim(), updatedAt: new Date() }).where(eq(schema.users.id, c.user.id));
  await audit(ctx, 'user.profile_updated', 'user', c.user.id, { name: c.user.name }, { name: name.trim() });
  return { ok: true };
}
export async function logoutOthers(ctx: Ctx) {
  const c = need(ctx);
  await destroyUserSessions(c.user.id, c.user.sessionId);
  await audit(ctx, 'auth.logout_others', 'user', c.user.id);
  return { ok: true };
}
