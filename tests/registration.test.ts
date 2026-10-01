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
    const b = reg({ role: 'CONSULTANT', orgName: 'Tamale Advisory' }); await call('POST', '/auth/register', { body: b });
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
    const b = reg({ role: 'CONSULTANT' }); await call('POST', '/auth/register', { body: b }); await verify(b.email);
    const [u] = await db().select().from(schema.users).where(eq(schema.users.email, b.email));
    const list = await api(admin).get('/users?approval=pending');
    expect(list.data.rows?.some?.((x: any) => x.id === u.id) ?? JSON.stringify(list.body).includes(u.id)).toBe(true);
    const coach = await makeUser('COACH');
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
