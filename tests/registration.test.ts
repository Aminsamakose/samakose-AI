import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, call, ensureReference, lastEmailTo, makeUser, PASSWORD, tokenFrom, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

let admin: Session;
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); });

const reg = (o: Record<string, unknown> = {}) => ({ name: 'Kofi Boateng', email: `kofi.${uniq()}@example.org`, password: PASSWORD, role: 'OWNER', orgName: 'Boateng Shea Ltd', orgType: 'AGRIFOOD', consent: true, ...o });
const signIn = async (email: string) => { const r = await call('POST', '/auth/login', { body: { email, password: PASSWORD } }); return { r, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] }; };
const verify = async (email: string) => { const m = await lastEmailTo(email); return call('POST', '/auth/verify-email', { body: { token: tokenFrom(m.body) } }); };

describe('self-registration', () => {
  it('cannot sign in before the email is confirmed', async () => {
    const b = reg(); expect((await call('POST', '/auth/register', { body: b })).status).toBe(200);
    const r = await call('POST', '/auth/login', { body: { email: b.email, password: PASSWORD } });
    expect(r.status).toBe(403); expect(r.error.code).toBe('email_not_verified');
  });
  it('an owner gets their own organisation after confirming, which stays unverified', async () => {
    const b = reg(); await call('POST', '/auth/register', { body: b });
    expect((await verify(b.email)).data.next).toBe('ok');
    const [u] = await db().select().from(schema.users).where(eq(schema.users.email, b.email));
    expect(u.approvalStatus).toBe('approved'); expect(u.orgId).toBeTruthy();
    const [o] = await db().select().from(schema.organisations).where(eq(schema.organisations.id, u.orgId!));
    expect(o.status).toBe('Pending verification');
    const { cookie } = await signIn(b.email);
    expect((await call('GET', '/auth/me', { cookie })).status).toBe(200);
  });
  it('a consultant stays pending and cannot read any data', async () => {
    const b = reg({ role: 'EXPERT', orgName: 'Tamale Advisory' }); await call('POST', '/auth/register', { body: b });
    expect((await verify(b.email)).data.next).toBe('pending');
    const { r, cookie } = await signIn(b.email);
    expect(r.data.next).toBe('pending');
    for (const p of ['/cases', '/organisations', '/programmes', '/actions', '/users']) {
      const x = await call('GET', p, { cookie });
      expect(x.status, p).toBe(403); expect(x.error.code).toBe('approval_pending');
    }
    expect((await call('GET', '/auth/me', { cookie })).data.approvalStatus).toBe('pending');
  });
  it('cannot register as admin or executive', async () => {
    expect((await call('POST', '/auth/register', { body: reg({ role: 'ADMIN' }) })).status).toBe(400);
    expect((await call('POST', '/auth/register', { body: reg({ role: 'EXECUTIVE' }) })).status).toBe(400);
  });
  it('gives the same answer for an address that already exists', async () => {
    const b = reg(); await call('POST', '/auth/register', { body: b });
    const again = await call('POST', '/auth/register', { body: b });
    expect(again.status).toBe(200);
  });
  it('requires consent and an organisation', async () => {
    expect((await call('POST', '/auth/register', { body: reg({ consent: false }) })).status).toBe(400);
    expect((await call('POST', '/auth/register', { body: reg({ orgName: '' }) })).status).toBe(400);
  });
  it('admin approves a pending consultant, who can then read; non-admins cannot decide', async () => {
    const b = reg({ role: 'EXPERT' }); await call('POST', '/auth/register', { body: b }); await verify(b.email);
    const [u] = await db().select().from(schema.users).where(eq(schema.users.email, b.email));
    const list = await api(admin).get('/users?approval=pending');
    expect(list.data.rows?.some?.((x: any) => x.id === u.id) ?? JSON.stringify(list.body).includes(u.id)).toBe(true);
    const coach = await makeUser('EXPERT');
    expect((await api(coach).post(`/users/${u.id}/approve`, {})).status).toBe(403);
    expect((await api(admin).post(`/users/${u.id}/approve`, { role: 'ADMIN' })).status).toBeGreaterThanOrEqual(400);
    expect((await api(admin).post(`/users/${u.id}/approve`, {})).status).toBe(200);
    const { cookie } = await signIn(b.email);
    expect((await call('GET', '/cases', { cookie })).status).not.toBe(403);
    expect((await api(admin).post(`/users/${u.id}/approve`, {})).status).toBe(422);
  });
  it('a rejected registration cannot sign in', async () => {
    const b = reg({ role: 'FUNDER' }); await call('POST', '/auth/register', { body: b }); await verify(b.email);
    const [u] = await db().select().from(schema.users).where(eq(schema.users.email, b.email));
    expect((await api(admin).post(`/users/${u.id}/reject`, { reason: 'Not a known partner' })).status).toBe(200);
    expect((await call('POST', '/auth/login', { body: { email: b.email, password: PASSWORD } })).status).toBe(401);
  });
});

describe('required business profile for new owners', () => {
  const profile = (o: Record<string, unknown> = {}) => ({ name: 'Boateng Shea Ltd', type: 'AGRIFOOD', sector: 'Shea processing', region: 'Northern', district: 'Tamale', size: '11-50', contactPhone: '+233 55 858 9254', consent: true, ...o });
  it('blocks every data route until the profile is complete, then opens them', async () => {
    const b = reg(); await call('POST', '/auth/register', { body: b }); await verify(b.email);
    const { r, cookie } = await signIn(b.email);
    expect(r.data.next).toBe('profile');
    for (const p of ['/cases', '/organisations', '/actions']) { const x = await call('GET', p, { cookie }); expect(x.status, p).toBe(403); expect(x.error.code).toBe('profile_incomplete'); }
    expect((await call('GET', '/auth/me', { cookie })).data.next).toBe('profile');
    const missing = await call('PUT', '/auth/profile', { cookie, body: profile({ contactPhone: '123' }) });
    expect(missing.status).toBe(400); expect(missing.error.details.contactPhone).toBeTruthy();
    expect((await call('PUT', '/auth/profile', { cookie, body: profile() })).status).toBe(200);
    expect((await call('GET', '/cases', { cookie })).status).not.toBe(403);
    expect((await call('GET', '/auth/me', { cookie })).data.next).toBe('ok');
  });
  it('only business owners can use the profile endpoint', async () => {
    const coach = await makeUser('EXPERT');
    expect((await api(coach).get('/auth/profile')).status).toBe(403);
  });
});

describe('Google sign-in rules', () => {
  const claims = (o: Record<string, unknown> = {}) => ({ sub: `g-${uniq()}`, email: `g.${uniq()}@example.org`, email_verified: true, name: 'Esi Owusu', aud: 'client-123', iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 600, ...o });
  const ctx = () => ({ user: null, ip: '10.0.0.1', requestId: 'r', db: db(), after: () => {} }) as any;
  beforeAll(() => { process.env.GOOGLE_CLIENT_ID = 'client-123'; process.env.GOOGLE_CLIENT_SECRET = 'secret'; });

  it('rejects unverified emails, wrong audience and expired tokens', async () => {
    const { claimsOk } = await import('@/services/google');
    expect(claimsOk(claims())).toBe(true);
    expect(claimsOk(claims({ email_verified: false }))).toBe(false);
    expect(claimsOk(claims({ aud: 'someone-else' }))).toBe(false);
    expect(claimsOk(claims({ exp: 1 }))).toBe(false);
    expect(claimsOk(claims({ iss: 'https://evil.example' }))).toBe(false);
  });
  it('creates a new owner who still has to complete the profile and whose organisation is unverified', async () => {
    const { signInWithGoogle } = await import('@/services/google');
    const c = claims(); const r: any = await signInWithGoogle(ctx(), c, 'test');
    expect(r.step).toBe('profile'); expect(r.token).toBeTruthy();
    const [u] = await db().select().from(schema.users).where(eq(schema.users.googleSub, c.sub));
    expect(u.role).toBe('OWNER'); expect(u.profileRequired).toBe(true); expect(u.emailVerified).toBe(true);
    const [o] = await db().select().from(schema.organisations).where(eq(schema.organisations.id, u.orgId!));
    expect(o.status).toBe('Pending verification');
  });
  it('never signs staff or partners in with Google', async () => {
    const { signInWithGoogle } = await import('@/services/google');
    const staff = await makeUser('EXPERT');
    const r: any = await signInWithGoogle(ctx(), claims({ email: staff.email }), 'test');
    expect(r.error).toBe('google_not_allowed'); expect(r.token).toBeUndefined();
  });
  it('links an existing owner by verified email and signs them in', async () => {
    const { signInWithGoogle } = await import('@/services/google');
    const org = await db().insert(schema.organisations).values({ name: 'Linked Co ' + uniq(), consentAt: new Date(), consentBy: 'x' }).returning();
    const owner = await makeUser('OWNER', { orgId: org[0].id });
    const c = claims({ email: owner.email }); const r: any = await signInWithGoogle(ctx(), c, 'test');
    expect(r.step).toBe('ok');
    const [u] = await db().select().from(schema.users).where(eq(schema.users.id, owner.userId));
    expect(u.googleSub).toBe(c.sub);
  });
  it('rejects a callback with a missing or wrong state', async () => {
    const r = await call('GET', '/auth/google/callback?code=abc&state=nope');
    expect([302, 307]).toContain(r.status);
    expect(r.headers.get('location')).toContain('/login?error=google_failed');
  });
});
