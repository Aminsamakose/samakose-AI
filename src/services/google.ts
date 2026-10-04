import { switchOn } from './switches';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { cookieHeader, createSession, rateLimit } from '@/lib/session';
import { randomToken, sha256 } from '@/lib/crypto';
import { env } from '@/lib/env';
import { nextStep } from './auth';

/* Google sign-in (authorization code flow, server side). Business owners only: staff and partners keep
   invitation, password and two-step verification, so Google follows the same approval switch as password sign-up and cannot skip administrator approval. */

const STATE_COOKIE = () => (env.isProd ? '__Host-sk-oauth' : 'sk_oauth');
export const googleEnabled = () => !!env.googleClientId && !!env.googleClientSecret;
const redirectUri = () => `${env.appUrl}/api/v1/auth/google/callback`;
const redirect = (to: string, cookies: string[] = []) => {
  const h = new Headers({ location: to.startsWith('/') ? env.appUrl + to : to, 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
};
const stateCookie = (v: string | null) => `${STATE_COOKIE()}=${v ?? ''}; Path=/; HttpOnly; SameSite=Lax${env.isProd ? '; Secure' : ''}; Max-Age=${v ? 600 : 0}`;

export function startGoogle() {
  if (!googleEnabled()) return redirect('/login?error=google_off');
  const state = randomToken(24);
  const q = new URLSearchParams({ client_id: env.googleClientId, redirect_uri: redirectUri(), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, [stateCookie(sha256(state))]);
}

export type GoogleClaims = { sub: string; email: string; email_verified: boolean; name?: string; aud: string; iss: string; exp: number };

/** The id_token comes straight from Google's token endpoint over TLS, so its claims are trusted after these checks. */
export function claimsOk(c: GoogleClaims) {
  return c.aud === env.googleClientId && (c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com') && c.exp * 1000 > Date.now() && c.email_verified === true && !!c.email && !!c.sub;
}

/** Decides what a verified Google identity may do. Pure data in, session out, so it can be tested without Google. */
export async function signInWithGoogle(ctx: Ctx, c: GoogleClaims, userAgent: string | null) {
  const email = c.email.toLowerCase();
  const [bySub] = await ctx.db.select().from(schema.users).where(eq(schema.users.googleSub, c.sub)).limit(1);
  const [byEmail] = bySub ? [bySub] : await ctx.db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`).limit(1);
  let u = byEmail;
  if (u) {
    if (u.role !== 'OWNER') return { error: 'google_not_allowed' as const };
    if (!u.active || u.approvalStatus === 'rejected') return { error: 'google_not_allowed' as const };
    if (!u.googleSub) {
      await ctx.db.update(schema.users).set({ googleSub: c.sub, emailVerified: true, updatedAt: new Date() }).where(eq(schema.users.id, u.id));
      await audit({ ...ctx, user: { id: u.id, email: u.email } as any }, 'auth.google_linked', 'user', u.id);
    }
  } else {
    if (!(await switchOn(ctx.db, 'switch.google_signin')) || !(await switchOn(ctx.db, 'switch.self_registration'))) return { error: 'google_not_allowed' as const };
    const name = (c.name ?? email.split('@')[0]).trim().slice(0, 160) || 'New owner';
    const [o] = await ctx.db.insert(schema.organisations).values({ name: `${name} (business name to confirm)`, type: 'SME', contactName: name, contactEmail: email, status: 'Pending verification' }).returning({ id: schema.organisations.id });
    [u] = await ctx.db.insert(schema.users).values({ email, name, role: 'OWNER', orgId: o.id, googleSub: c.sub, emailVerified: true, approvalStatus: (await switchOn(ctx.db, 'switch.owner_needs_approval')) ? 'pending' : 'approved', profileRequired: true, mustChangePassword: false }).returning();
    await audit({ ...ctx, user: { id: u.id, email } as any }, 'auth.registered', 'user', u.id, undefined, { role: 'OWNER', via: 'google', orgId: o.id });
  }
  const token = await createSession(u.id, ctx.ip, userAgent, !u.mfaEnabled);
  await audit({ ...ctx, user: { id: u.id, email: u.email } as any }, 'auth.login', 'user', u.id, undefined, { via: 'google' });
  const step = nextStep({ mfaEnabled: u.mfaEnabled, mfaVerified: !u.mfaEnabled, mustChangePassword: u.mustChangePassword, role: u.role, approvalStatus: u.approvalStatus, profileRequired: u.profileRequired });
  return { token, step };
}

const where = { ok: '/dashboard', mfa: '/mfa', mfa_setup: '/mfa-setup', change_password: '/change-password', pending: '/pending', profile: '/complete-profile' } as const;

export async function googleCallback(ctx: Ctx, q: { code?: string; state?: string; error?: string }, cookie: string | undefined, userAgent: string | null) {
  const clear = stateCookie(null);
  if (!googleEnabled()) return redirect('/login?error=google_off', [clear]);
  if (q.error || !q.code || !q.state || !cookie || sha256(q.state) !== cookie) return redirect('/login?error=google_failed', [clear]);
  if ((await rateLimit('google:' + ctx.ip, 600)) > 20) return redirect('/login?error=google_failed', [clear]);
  let claims: GoogleClaims;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: q.code, client_id: env.googleClientId, client_secret: env.googleClientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code' }) });
    if (!r.ok) return redirect('/login?error=google_failed', [clear]);
    const { id_token } = (await r.json()) as { id_token?: string };
    if (!id_token) return redirect('/login?error=google_failed', [clear]);
    claims = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString('utf8'));
  } catch { return redirect('/login?error=google_failed', [clear]); }
  if (!claimsOk(claims)) return redirect('/login?error=google_failed', [clear]);
  const res = await signInWithGoogle({ ...ctx, user: null, db: db() }, claims, userAgent);
  if ('error' in res) return redirect(`/login?error=${res.error}`, [clear]);
  return redirect(where[res.step], [clear, cookieHeader(res.token)]);
}
