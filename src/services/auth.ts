import QRCode from 'qrcode';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, fieldError, forbidden, tooMany, unauthorized } from '@/lib/errors';
import { decrypt, encrypt, hashPassword, hashRecoveryCode, isRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, passwordProblems, randomToken, sha256, verifyPassword, verifyTotp } from '@/lib/crypto';
import { clearRateLimit, cookieHeader, createSession, destroySession, destroyUserSessions, markMfaVerified, rateLimit } from '@/lib/session';
import { env } from '@/lib/env';
import { PERMISSIONS, ROLE_LABEL } from '@/lib/rbac';
import { queueTemplate } from '@/domain/notify';
import { switchOn } from './switches';
import { loadMapping } from './registration-config';
import { MODES, OTHER_ROLE, isKnownRole, platformForOrgType, type AssessmentMode } from '@/domain/routing';
import { need } from './common';
import { WITHDRAWN_MESSAGE, wasWithdrawn } from './invites';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const GENERIC = 'Email or password is incorrect';

export type NextStep = 'ok' | 'mfa' | 'mfa_setup' | 'change_password' | 'pending' | 'profile';
export function nextStep(u: { mfaEnabled: boolean; mfaVerified: boolean; mustChangePassword: boolean; role: string; approvalStatus?: string; profileRequired?: boolean }): NextStep {
  if (u.approvalStatus && u.approvalStatus !== 'approved') return 'pending';
  if (u.profileRequired) return 'profile';
  if (u.mfaEnabled && !u.mfaVerified) return 'mfa';
  if (u.mustChangePassword) return 'change_password';
  if (env.mfaRequiredRoles.includes(u.role) && !u.mfaEnabled) return 'mfa_setup';
  return 'ok';
}

export const publicUser = (u: { id: string; code?: string; email: string; name: string; role: string; orgId: string | null; mfaEnabled: boolean; approvalStatus?: string }) =>
  ({ approvalStatus: u.approvalStatus ?? 'approved', id: u.id, code: u.code, email: u.email, name: u.name, role: u.role, roleLabel: ROLE_LABEL[u.role as keyof typeof ROLE_LABEL], orgId: u.orgId, mfaEnabled: u.mfaEnabled });

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
  if (!u.emailVerified) throw new ApiError(403, 'email_not_verified', 'Confirm your email first. Use the link we sent, or ask for a new one on the sign-up page.');
  if (u.role !== 'ADMIN') {
    const rows = await db().select().from(schema.rules).where(inArray(schema.rules.key, ['switch.maintenance', 'switch.maintenance_block_signin']));
    const m = new Map(rows.map((r) => [r.key, r.value]));
    if (m.get('switch.maintenance') === '1' && m.get('switch.maintenance_block_signin') === '1') throw new ApiError(503, 'maintenance', 'The platform is being updated and sign-in is paused for a short while. Please try again later.');
  }
  await db().update(schema.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
  await clearRateLimit(key);
  const token = await createSession(u.id, ctx.ip, userAgent, !u.mfaEnabled);
  await audit({ ...ctx, user: { id: u.id, email: u.email } as any, db: db() }, 'auth.login', 'user', u.id);
  const step = nextStep({ mfaEnabled: u.mfaEnabled, mfaVerified: !u.mfaEnabled, mustChangePassword: u.mustChangePassword, role: u.role, approvalStatus: u.approvalStatus, profileRequired: u.profileRequired });
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
  let usedRecovery = false; let recoveryLeft: number | undefined;
  if (isRecoveryCode(code)) {
    // One-time use. The removal is a single atomic statement, so two requests cannot both spend the same code.
    const h = hashRecoveryCode(code);
    const r = await ctx.db.execute(sql`update users set mfa_recovery = array_remove(mfa_recovery, ${h}), updated_at = now() where id = ${u.id} and ${h} = any(mfa_recovery) returning cardinality(mfa_recovery) as remaining`);
    if (!r.rows.length) { await audit(ctx, 'auth.mfa_failed', 'user', u.id, undefined, { kind: 'recovery' }); throw fieldError({ code: 'That recovery code is not right or was already used' }); }
    usedRecovery = true; recoveryLeft = Number((r.rows[0] as { remaining: number }).remaining);
  } else if (!verifyTotp(decrypt(u.mfaSecret), code)) { await audit(ctx, 'auth.mfa_failed', 'user', u.id); throw fieldError({ code: 'That code is not right or has expired' }); }
  await markMfaVerified(c.user.id === u.id ? c.user.sessionId : '');
  await clearRateLimit('mfa:' + c.user.id);
  await audit(ctx, usedRecovery ? 'auth.mfa_recovery_used' : 'auth.mfa_verified', 'user', u.id, undefined, usedRecovery ? { left: recoveryLeft } : undefined);
  return { next: nextStep({ mfaEnabled: true, mfaVerified: true, mustChangePassword: u.mustChangePassword, role: u.role, approvalStatus: u.approvalStatus, profileRequired: u.profileRequired }), ...(usedRecovery ? { recoveryCodesLeft: recoveryLeft } : {}) };
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
  const recoveryCodes = newRecoveryCodes();
  await ctx.db.update(schema.users).set({ mfaEnabled: true, mfaRecovery: recoveryCodes.map(hashRecoveryCode), updatedAt: new Date() }).where(eq(schema.users.id, u.id));
  await markMfaVerified(c.user.sessionId);
  await audit(ctx, 'auth.mfa_enabled', 'user', u.id);
  return { mfaEnabled: true, recoveryCodes };
}
/** Replace the whole set. Needs a verified session, the password and a current authenticator code; the old codes stop working. */
export async function mfaNewRecoveryCodes(ctx: Ctx, password: string, code: string) {
  const c = need(ctx);
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, c.user.id)).limit(1);
  if (!u.mfaEnabled || !u.mfaSecret) throw new ApiError(422, 'invalid_state', 'Two-step verification is not on');
  if ((await rateLimit('mfa:' + u.id, 10 * 60)) > 10) throw tooMany();
  if (!(await verifyPassword(password, u.passwordHash))) throw fieldError({ password: 'Password is incorrect' });
  if (!verifyTotp(decrypt(u.mfaSecret), code)) throw fieldError({ code: 'That code is not right or has expired' });
  const recoveryCodes = newRecoveryCodes();
  await ctx.db.update(schema.users).set({ mfaRecovery: recoveryCodes.map(hashRecoveryCode), updatedAt: new Date() }).where(eq(schema.users.id, u.id));
  await audit(ctx, 'auth.mfa_recovery_regenerated', 'user', u.id);
  return { recoveryCodes };
}
export async function mfaDisable(ctx: Ctx, password: string, code: string) {
  const c = need(ctx);
  if (env.mfaRequiredRoles.includes(c.user.role)) throw forbidden('Your role must keep two-step verification on');
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, c.user.id)).limit(1);
  if (!u.mfaEnabled || !u.mfaSecret) throw new ApiError(422, 'invalid_state', 'Two-step verification is not on');
  if (!(await verifyPassword(password, u.passwordHash))) throw fieldError({ password: 'Password is incorrect' });
  if (!verifyTotp(decrypt(u.mfaSecret), code)) throw fieldError({ code: 'That code is not right or has expired' });
  await ctx.db.update(schema.users).set({ mfaEnabled: false, mfaSecret: null, mfaRecovery: [], updatedAt: new Date() }).where(eq(schema.users.id, u.id));
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
    await queueTemplate(ctx, u.email, 'password_reset', { user_name: u.name, link: `${env.appUrl}/reset-password?token=${token}` });
    await audit(ctx, 'auth.reset_requested', 'user', u.id);
  }
  return { ok: true }; // the same answer whether or not the account exists
}

async function badToken(ctx: Ctx, token: string, kind: 'reset' | 'invite') {
  if (kind === 'invite' && (await wasWithdrawn(ctx.db, token))) return new ApiError(400, 'invite_withdrawn', WITHDRAWN_MESSAGE);
  return new ApiError(400, 'bad_token', 'This link is invalid or has expired. Ask for a new one.');
}
async function takeToken(ctx: Ctx, token: string, kind: 'reset' | 'invite') {
  const [t] = await ctx.db.select().from(schema.userTokens)
    .where(and(eq(schema.userTokens.tokenHash, sha256(token)), eq(schema.userTokens.kind, kind), isNull(schema.userTokens.usedAt), gt(schema.userTokens.expiresAt, new Date()))).for('update').limit(1);
  if (!t) throw await badToken(ctx, token, kind);
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
/** What an invitation is for, shown before the person sets a password. Does not use up the link. */
export async function inviteInfo(ctx: Ctx, token: string) {
  const [t] = await ctx.db.select().from(schema.userTokens)
    .where(and(eq(schema.userTokens.tokenHash, sha256(token)), eq(schema.userTokens.kind, 'invite'), isNull(schema.userTokens.usedAt), gt(schema.userTokens.expiresAt, new Date()))).limit(1);
  if (!t) throw await badToken(ctx, token, 'invite');
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, t.userId)).limit(1);
  if (!u || !u.active) throw new ApiError(400, 'bad_token', 'This link is invalid or has expired. Ask for a new one.');
  if (u.role !== 'RESPONDENT' || !u.orgId) return { respondent: false as const };
  const [o] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, u.orgId)).limit(1);
  const [n] = await ctx.db.select({ text: schema.consentNotices.text, version: schema.consentNotices.version }).from(schema.consentNotices).where(and(eq(schema.consentNotices.purpose, 'account'), eq(schema.consentNotices.countryCode, o.countryCode), eq(schema.consentNotices.status, 'Published'))).limit(1);
  return { respondent: true as const, name: u.name, business: o.name, notice: n ?? null };
}

export async function acceptInvite(ctx: Ctx, token: string, password: string, name?: string, consent?: boolean) {
  const { t, u } = await takeToken(ctx, token, 'invite');
  const problems = passwordProblems(password, u.email, name ?? u.name);
  if (problems.length) throw fieldError({ password: problems.join('. ') });
  // A colleague is a person in their own right: they agree to the account wording themselves, and it is recorded against that exact wording.
  let notice: { id: string } | undefined;
  if (u.role === 'RESPONDENT' && u.orgId) {
    const [o] = await ctx.db.select({ c: schema.organisations.countryCode }).from(schema.organisations).where(eq(schema.organisations.id, u.orgId)).limit(1);
    [notice] = await ctx.db.select({ id: schema.consentNotices.id }).from(schema.consentNotices).where(and(eq(schema.consentNotices.purpose, 'account'), eq(schema.consentNotices.countryCode, o?.c ?? 'GH'), eq(schema.consentNotices.status, 'Published'))).limit(1);
    if (notice && !consent) throw fieldError({ consent: 'Please agree to create your account' });
  }
  await ctx.db.update(schema.users).set({ passwordHash: await hashPassword(password), name: name?.trim() || u.name, mustChangePassword: false, updatedAt: new Date() }).where(eq(schema.users.id, u.id));
  await ctx.db.update(schema.userTokens).set({ usedAt: new Date() }).where(eq(schema.userTokens.id, t.id));
  if (u.role === 'RESPONDENT') {
    if (notice) await ctx.db.insert(schema.consents).values({ userId: u.id, orgId: u.orgId, noticeId: notice.id, action: 'granted', source: 'invitation' });
    await ctx.db.update(schema.orgMembers).set({ status: 'active', updatedAt: new Date() }).where(and(eq(schema.orgMembers.userId, u.id), eq(schema.orgMembers.status, 'invited')));
  }
  await audit({ ...ctx, user: { id: u.id, email: u.email } as any }, 'auth.invite_accepted', 'user', u.id);
  return { ok: true };
}

export async function me(ctx: Ctx) {
  const c = need(ctx);
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, c.user.id)).limit(1);
  const unread = Number(((await ctx.db.execute(sql`select count(*)::int n from notifications where user_id=${c.user.id} and read_at is null`)).rows[0] as { n: number }).n);
  return { user: publicUser(u), permissions: PERMISSIONS[u.role], programmeIds: c.user.programmeIds, unreadNotifications: unread, next: nextStep(c.user), approvalStatus: u.approvalStatus, recoveryCodesLeft: u.mfaEnabled ? u.mfaRecovery.length : 0 };
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

/* ------------------------- self-registration ------------------------- */
export const SELF_ROLES = ['OWNER', 'EXPERT', 'PROGRAMME_MANAGER', 'FUNDER'] as const;
const VERIFY_HOURS = 48;

async function issueVerification(ctx: Ctx, userId: string, email: string, name: string) {
  const token = randomToken(32);
  await ctx.db.insert(schema.userTokens).values({ userId, kind: 'verify', tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_HOURS * 3600_000) });
  await queueTemplate(ctx, email, 'verify_email', { user_name: name, hours: String(VERIFY_HOURS), link: `${env.appUrl}/verify-email?token=${token}` });
}

export async function register(ctx: Ctx, b: { name: string; email: string; password: string; role: (typeof SELF_ROLES)[number]; orgName?: string; orgType?: 'SME' | 'AGRIFOOD' | 'ESO'; note?: string; consent: boolean; countryCode?: string; geoUnitId?: string | null; consentPurposes?: string[]; routing?: { jobRole: string; jobRoleOther?: string; responsibility?: string; assessmentMode: AssessmentMode } }) {
  if (!(await switchOn(ctx.db, 'switch.self_registration'))) throw forbidden('Registration is closed at the moment. Ask the team for an invitation.');
  if (b.role !== 'OWNER' && !(await switchOn(ctx.db, `switch.role.${b.role}`))) throw fieldError({ role: 'This kind of account is not open for self-registration. Ask the team for an invitation.' });
  const email = b.email.trim().toLowerCase();
  const name = b.name.trim();
  const problems = passwordProblems(b.password, email, name);
  if (problems.length) throw fieldError({ password: problems.join('. ') });
  if (!b.consent) throw fieldError({ consent: 'Please accept the terms and privacy notice' });
  const orgName = b.orgName?.trim();
  if (!orgName || orgName.length < 2) throw fieldError({ orgName: b.role === 'OWNER' ? 'Enter your business name' : 'Enter your organisation or employer' });
  const country = (b.countryCode ?? 'GH').toUpperCase();
  const [cs] = await ctx.db.select({ c: schema.countrySettings.countryCode }).from(schema.countrySettings).where(and(eq(schema.countrySettings.countryCode, country), eq(schema.countrySettings.active, true))).limit(1);
  if (!cs) throw fieldError({ countryCode: 'This country is not open yet' });
  if (b.geoUnitId) {
    const [g] = await ctx.db.select({ id: schema.geoUnits.id }).from(schema.geoUnits).where(and(eq(schema.geoUnits.id, b.geoUnitId), eq(schema.geoUnits.countryCode, country))).limit(1);
    if (!g) throw fieldError({ geoUnitId: 'Choose a location from the list for this country' });
  }
  if (b.routing) {
    if (!MODES.includes(b.routing.assessmentMode)) throw fieldError({ assessmentMode: 'Choose how the assessment will be answered' });
    if (!isKnownRole(await loadMapping(ctx.db), platformForOrgType(b.orgType), b.routing.jobRole)) throw fieldError({ jobRole: 'Choose your role from the list, or Other' });
    if (b.routing.jobRole === OTHER_ROLE && !b.routing.jobRoleOther?.trim()) throw fieldError({ jobRoleOther: 'Tell us your role' });
  }
  const [dupe] = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`).limit(1);
  // Same answer whether or not the address is already registered, so the form cannot be used to find who has an account.
  if (dupe) return { ok: true };
  let orgId: string | null = null;
  if (b.role === 'OWNER') {
    const [o] = await ctx.db.insert(schema.organisations).values({ name: orgName, type: b.orgType ?? 'SME', contactName: name, contactEmail: email, consentAt: new Date(), consentBy: email, status: 'Pending verification' }).returning({ id: schema.organisations.id });
    orgId = o.id;
  }
  const [row] = await ctx.db.insert(schema.users).values({
    email, name, role: b.role, orgId, passwordHash: await hashPassword(b.password), mustChangePassword: false,
    emailVerified: false, approvalStatus: 'pending', profileRequired: b.role === 'OWNER', signupOrgName: orgName, signupNote: b.note?.trim().slice(0, 1000) || null
  }).returning({ id: schema.users.id });
  if (orgId) await ctx.db.update(schema.organisations).set({ countryCode: country, geoUnitId: b.geoUnitId ?? null }).where(eq(schema.organisations.id, orgId));
  await recordRegistrationConsents(ctx, row.id, orgId, country, new Set(['account', ...(b.consentPurposes ?? [])]), b.routing && b.role === 'OWNER' ? { platform: platformForOrgType(b.orgType), ...b.routing } : undefined);
  await issueVerification(ctx, row.id, email, name);
  await audit({ ...ctx, user: { id: row.id, email } as any }, 'auth.registered', 'user', row.id, undefined, { role: b.role, orgId });
  return { ok: true };
}

/** Consent comes before data. A consent row is written only against a Published notice for that purpose and country, so the
 *  person's grant points at the exact wording they saw. Routing answers are stored only under a granted 'assessment' consent. */
async function recordRegistrationConsents(ctx: Ctx, userId: string, orgId: string | null, country: string, purposes: Set<string>, routing?: { platform: string; jobRole: string; jobRoleOther?: string; responsibility?: string; assessmentMode: string }) {
  const notices = await ctx.db.select().from(schema.consentNotices).where(and(eq(schema.consentNotices.countryCode, country), eq(schema.consentNotices.status, 'Published'), inArray(schema.consentNotices.purpose, ['account', 'assessment'])));
  const granted = new Set<string>();
  for (const n of notices) {
    if (!purposes.has(n.purpose)) continue;
    await ctx.db.insert(schema.consents).values({ userId, orgId, noticeId: n.id, action: 'granted', source: 'registration' });
    granted.add(n.purpose);
  }
  if (routing && granted.has('assessment')) {
    await ctx.db.insert(schema.registrationAnswers).values({ userId, orgId, platform: routing.platform, jobRole: routing.jobRole, jobRoleOther: routing.jobRole === OTHER_ROLE ? routing.jobRoleOther?.trim().slice(0, 120) ?? null : null, responsibility: routing.responsibility?.trim().slice(0, 300) || null, assessmentMode: routing.assessmentMode, suggestionSource: 'user' });
  }
}

export async function registrationOptions(ctx: Ctx, countryCode = 'GH') {
  const country = countryCode.toUpperCase();
  const [c] = await ctx.db.select().from(schema.countrySettings).where(and(eq(schema.countrySettings.countryCode, country), eq(schema.countrySettings.active, true))).limit(1);
  if (!c) throw fieldError({ countryCode: 'This country is not open yet' });
  const regions = await ctx.db.select({ id: schema.geoUnits.id, name: schema.geoUnits.name }).from(schema.geoUnits).where(and(eq(schema.geoUnits.countryCode, country), eq(schema.geoUnits.level, 1), eq(schema.geoUnits.active, true))).orderBy(schema.geoUnits.name);
  const notices = await ctx.db.select({ id: schema.consentNotices.id, purpose: schema.consentNotices.purpose, version: schema.consentNotices.version, text: schema.consentNotices.text }).from(schema.consentNotices).where(and(eq(schema.consentNotices.countryCode, country), eq(schema.consentNotices.status, 'Published')));
  return { country: { code: c.countryCode, name: c.name, levelLabels: c.levelLabels }, regions, notices, modes: MODES, roles: (await loadMapping(ctx.db)).roles, other: OTHER_ROLE };
}

/** Districts under a region, from the official-style list loaded in geo_units (level 2). */
export async function districtsFor(ctx: Ctx, countryCode: string, regionName: string) {
  const [r] = await ctx.db.select({ id: schema.geoUnits.id }).from(schema.geoUnits).where(and(eq(schema.geoUnits.countryCode, countryCode.toUpperCase()), eq(schema.geoUnits.level, 1), eq(schema.geoUnits.name, regionName), eq(schema.geoUnits.active, true))).limit(1);
  if (!r) return { districts: [] as string[] };
  const rows = await ctx.db.select({ name: schema.geoUnits.name }).from(schema.geoUnits).where(and(eq(schema.geoUnits.parentId, r.id), eq(schema.geoUnits.active, true))).orderBy(schema.geoUnits.name);
  return { districts: rows.map((x) => x.name) };
}

export async function resendVerification(ctx: Ctx, email: string) {
  if ((await rateLimit('verify:' + sha256(email.toLowerCase()), 3600)) > 3) return { ok: true };
  const [u] = await ctx.db.select().from(schema.users).where(and(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`, eq(schema.users.emailVerified, false), eq(schema.users.active, true))).limit(1);
  if (u) await issueVerification(ctx, u.id, u.email, u.name);
  return { ok: true };
}

export async function verifyEmail(ctx: Ctx, token: string) {
  const [t] = await ctx.db.select().from(schema.userTokens)
    .where(and(eq(schema.userTokens.tokenHash, sha256(token)), eq(schema.userTokens.kind, 'verify'), isNull(schema.userTokens.usedAt), gt(schema.userTokens.expiresAt, new Date()))).for('update').limit(1);
  if (!t) throw new ApiError(400, 'bad_token', 'This link is invalid or has expired. Ask for a new one on the sign-up page.');
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, t.userId)).limit(1);
  if (!u || !u.active) throw new ApiError(400, 'bad_token', 'This link is invalid or has expired.');
  // A business owner gets access to their own organisation once the email is confirmed. Everyone else stays
  // pending until an administrator approves them. Nobody sees other organisations, programmes or reports.
  const approve = u.role === 'OWNER' && u.approvalStatus === 'pending' && !(await switchOn(ctx.db, 'switch.owner_needs_approval'));
  await ctx.db.update(schema.users).set({ emailVerified: true, ...(approve ? { approvalStatus: 'approved' } : {}), updatedAt: new Date() }).where(eq(schema.users.id, u.id));
  await ctx.db.update(schema.userTokens).set({ usedAt: new Date() }).where(eq(schema.userTokens.id, t.id));
  await audit({ ...ctx, user: { id: u.id, email: u.email } as any }, 'auth.email_verified', 'user', u.id, undefined, { autoApproved: approve });
  return { ok: true, next: approve ? 'ok' : 'pending' };
}

/* ------------------------ business profile (owners) ------------------------ */
export async function getProfile(ctx: Ctx) {
  const c = need(ctx);
  if (c.user.role !== 'OWNER' || !c.user.orgId) throw forbidden();
  const [o] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, c.user.orgId)).limit(1);
  // The region chosen at registration is offered back as a suggestion. The owner confirms or changes it.
  let suggestedRegion: string | null = null;
  if (!o.region && o.geoUnitId) { const [g] = await ctx.db.select({ name: schema.geoUnits.name }).from(schema.geoUnits).where(eq(schema.geoUnits.id, o.geoUnitId)).limit(1); suggestedRegion = g?.name ?? null; }
  return { required: c.user.profileRequired, name: o.name, type: o.type, sector: o.sector, region: o.region, suggestedRegion, district: o.district, size: o.size, contactPhone: o.contactPhone, registrationNumber: o.registrationNumber, consentGiven: !!o.consentAt };
}

const DIGITS = /\d/g;
export async function saveProfile(ctx: Ctx, b: { name: string; type: 'SME' | 'AGRIFOOD' | 'ESO'; sector: string; region: string; district: string; size: string; contactPhone: string; registrationNumber?: string; consent: boolean }) {
  const c = need(ctx);
  if (c.user.role !== 'OWNER' || !c.user.orgId) throw forbidden();
  const [o] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, c.user.orgId)).for('update').limit(1);
  const errs: Record<string, string> = {};
  if (b.name.trim().length < 2) errs.name = 'Enter your business name';
  if (!b.sector.trim()) errs.sector = 'Choose or type your sector';
  if (!b.region.trim()) errs.region = 'Choose your region';
  if (!b.district.trim()) errs.district = 'Enter your district or town';
  if (!b.size.trim()) errs.size = 'Choose the number of people';
  if ((b.contactPhone.match(DIGITS) ?? []).length < 9) errs.contactPhone = 'Enter a phone number we can reach you on';
  if (!b.consent && !o.consentAt) errs.consent = 'Please agree so we can use your business information';
  if (Object.keys(errs).length) throw fieldError(errs);
  // Keep the location link in step with the region name, and note whether a suggestion was confirmed or changed.
  const [geo] = await ctx.db.select({ id: schema.geoUnits.id }).from(schema.geoUnits).where(and(eq(schema.geoUnits.countryCode, o.countryCode), eq(schema.geoUnits.level, 1), eq(schema.geoUnits.name, b.region.trim()))).limit(1);
  let suggestion: 'confirmed' | 'changed' | undefined;
  if (!o.region && o.geoUnitId) suggestion = geo?.id === o.geoUnitId ? 'confirmed' : 'changed';
  await ctx.db.update(schema.organisations).set({
    name: b.name.trim(), type: b.type, sector: b.sector.trim(), region: b.region.trim(), ...(geo ? { geoUnitId: geo.id } : {}), district: b.district.trim(), size: b.size.trim(),
    contactPhone: b.contactPhone.trim(), registrationNumber: b.registrationNumber?.trim() || null,
    ...(o.consentAt ? {} : { consentAt: new Date(), consentBy: c.user.email }), updatedAt: new Date()
  }).where(eq(schema.organisations.id, o.id));
  await ctx.db.update(schema.users).set({ profileRequired: false, updatedAt: new Date() }).where(eq(schema.users.id, c.user.id));
  await audit(ctx, 'user.profile_completed', 'organisation', o.id, undefined, suggestion ? { regionSuggestion: suggestion } : undefined);
  return { ok: true };
}
