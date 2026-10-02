import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { api, call, ensureReference, lastEmailTo, login, makeOrg, makeUser, PASSWORD, tokenFrom, uniq } from './helpers';
import { db, schema } from '@/db/client';
import { drainJobs } from '@/domain/jobs';
import { totp } from '@/lib/crypto';
import { decrypt } from '@/lib/crypto';

beforeAll(ensureReference);

describe('sign in', () => {
  it('signs in and returns the user, next step and a hardened cookie', async () => {
    const u = await makeUser('EXPERT');
    const r = await call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
    expect(r.status).toBe(200);
    expect(r.data.next).toBe('ok');
    const c = r.headers.get('set-cookie')!;
    expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/SameSite=Lax/);
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash|secret/i);
  });
  it('gives one message for wrong password and unknown user', async () => {
    const u = await makeUser('EXPERT');
    const a = await call('POST', '/auth/login', { body: { email: u.email, password: 'Wrong-Password-99' } });
    const b = await call('POST', '/auth/login', { body: { email: `nobody-${uniq()}@x.test`, password: 'Wrong-Password-99' } });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.error.message).toBe(b.error.message);
  });
  it('locks the account after five failures, even for the right password, and an admin can unlock', async () => {
    const admin = await makeUser('ADMIN');
    const u = await makeUser('EXPERT');
    for (let i = 0; i < 5; i++) expect((await call('POST', '/auth/login', { body: { email: u.email, password: 'Wrong-Password-99' } })).status).toBe(401);
    expect((await call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } })).status).toBe(401);
    expect((await api(admin).post(`/users/${u.userId}/unlock`)).status).toBe(200);
    expect((await call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } })).status).toBe(200);
  });
  it('rejects a deactivated user and ends their session at once', async () => {
    const admin = await makeUser('ADMIN');
    const u = await makeUser('EXPERT');
    expect((await api(u).get('/auth/me')).status).toBe(200);
    expect((await api(admin).patch(`/users/${u.userId}`, { active: false })).status).toBe(200);
    expect((await api(u).get('/auth/me')).status).toBe(401);
    expect((await call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } })).status).toBe(401);
  });
  it('requires a session for protected routes and rejects tampered cookies', async () => {
    expect((await call('GET', '/cases')).status).toBe(401);
    expect((await call('GET', '/cases', { cookie: 'sk_session=not-a-real-token' })).status).toBe(401);
  });
  it('logout destroys the session', async () => {
    const u = await makeUser('EXPERT');
    expect((await api(u).post('/auth/logout')).status).toBe(200);
    expect((await api(u).get('/auth/me')).status).toBe(401);
  });
  it('blocks cross-site writes by Origin', async () => {
    const u = await makeUser('ADMIN');
    const r = await call('POST', '/organisations', { cookie: u.cookie, headers: { origin: 'https://evil.example', host: 'localhost' }, body: { name: 'X Org', consent: true, consentBy: 'Someone' } });
    expect(r.status).toBe(403);
  });
  it('validates the body and names the fields', async () => {
    const r = await call('POST', '/auth/login', { body: { email: 'not-an-email', password: '' } });
    expect(r.status).toBe(400); expect(r.error.code).toBe('validation_failed'); expect(Object.keys(r.error.details)).toEqual(expect.arrayContaining(['email', 'password']));
    expect((await call('POST', '/auth/login', { raw: '{oops' })).error.code).toBe('bad_json');
  });
});

describe('password flows', () => {
  it('changes the password, enforces the policy and signs out other sessions', async () => {
    const u = await makeUser('EXPERT');
    const other = await login(u.email);
    const bad = await api(u).post('/auth/change-password', { current: PASSWORD, next: 'short1' });
    expect(bad.status).toBe(400);
    expect((await api(u).post('/auth/change-password', { current: 'Wrong-Password-99', next: 'Brand-New-Passw0rd-7' })).status).toBe(400);
    expect((await api(u).post('/auth/change-password', { current: PASSWORD, next: 'Brand-New-Passw0rd-7' })).status).toBe(200);
    expect((await api(other).get('/auth/me')).status).toBe(401);
    expect((await api(u).get('/auth/me')).status).toBe(200);
    expect((await call('POST', '/auth/login', { body: { email: u.email, password: 'Brand-New-Passw0rd-7' } })).status).toBe(200);
  });
  it('resets a password by email link once only, and does not reveal unknown accounts', async () => {
    const u = await makeUser('EXPERT');
    expect((await call('POST', '/auth/forgot', { body: { email: `ghost-${uniq()}@x.test` } })).status).toBe(202);
    expect((await call('POST', '/auth/forgot', { body: { email: u.email } })).status).toBe(202);
    const mail = await lastEmailTo(u.email);
    const token = tokenFrom(mail.body);
    expect((await call('POST', '/auth/reset', { body: { token, password: 'weak' } })).status).toBe(400);
    expect((await call('POST', '/auth/reset', { body: { token, password: 'Reset-Passw0rd-2026' } })).status).toBe(200);
    expect((await call('POST', '/auth/reset', { body: { token, password: 'Another-Passw0rd-2026' } })).status).toBe(400);
    expect((await call('POST', '/auth/login', { body: { email: u.email, password: 'Reset-Passw0rd-2026' } })).status).toBe(200);
    const stored = await db().select().from(schema.userTokens).where(eq(schema.userTokens.userId, u.userId));
    expect(stored.every((t) => t.tokenHash !== token)).toBe(true); // only a hash is kept
  });
  it('invites a user, who sets a password from the link and signs in', async () => {
    const admin = await makeUser('ADMIN');
    const email = `invitee-${uniq()}@x.test`;
    const inv = await api(admin).post('/users', { email, name: 'New Consultant', role: 'EXPERT' });
    expect(inv.status).toBe(201);
    expect((await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).status).toBe(401);
    const token = tokenFrom((await lastEmailTo(email)).body);
    expect((await call('POST', '/auth/accept-invite', { body: { token, password: 'Invite-Passw0rd-2026' } })).status).toBe(200);
    expect((await call('POST', '/auth/login', { body: { email, password: 'Invite-Passw0rd-2026' } })).status).toBe(200);
    expect((await call('POST', '/auth/accept-invite', { body: { token, password: 'Invite-Passw0rd-2027' } })).status).toBe(400);
  });
  it('drains the outbox in log-only mode', async () => {
    await drainJobs();
    const pending = await db().select().from(schema.outboxEmails).where(eq(schema.outboxEmails.status, 'Pending'));
    expect(pending.length).toBe(0);
  });
});

describe('two-step verification', () => {
  it('sets up, requires the code at sign-in, and gates the API until verified', async () => {
    const u = await makeUser('EXPERT');
    const setup = await api(u).post('/auth/mfa/setup');
    expect(setup.status).toBe(200); expect(setup.data.qr).toMatch(/^data:image\/png/);
    expect((await api(u).post('/auth/mfa/enable', { code: '000000' })).status).toBe(400);
    expect((await api(u).post('/auth/mfa/enable', { code: totp(setup.data.secret) })).status).toBe(200);
    const s = await call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
    expect(s.data.next).toBe('mfa');
    const cookie = s.headers.get('set-cookie')!.split(';')[0];
    const gated = await call('GET', '/cases', { cookie });
    expect(gated.status).toBe(403); expect(gated.error.code).toBe('mfa_required');
    expect((await call('POST', '/auth/mfa/verify', { cookie, body: { code: '123456' } })).status).toBe(400);
    expect((await call('POST', '/auth/mfa/verify', { cookie, body: { code: totp(setup.data.secret) } })).status).toBe(200);
    expect((await call('GET', '/cases', { cookie })).status).toBe(200);
    const [row] = await db().select().from(schema.users).where(eq(schema.users.id, u.userId));
    expect(row.mfaSecret).not.toContain(setup.data.secret); // stored encrypted
    expect(decrypt(row.mfaSecret!)).toBe(setup.data.secret);
  });
  it('admin can reset a lost authenticator', async () => {
    const admin = await makeUser('ADMIN'); const u = await makeUser('EXPERT');
    const setup = await api(u).post('/auth/mfa/setup'); await api(u).post('/auth/mfa/enable', { code: totp(setup.data.secret) });
    expect((await api(admin).post(`/users/${u.userId}/reset-mfa`)).status).toBe(200);
    const r = await call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
    expect(r.data.next).toBe('ok');
  });
  it('forces setup for roles listed in MFA_REQUIRED_ROLES', async () => {
    process.env.MFA_REQUIRED_ROLES = 'ADMIN';
    try {
      const a = await makeUser('ADMIN');
      const r = await api(a).get('/cases');
      expect(r.status).toBe(403); expect(r.error.code).toBe('mfa_setup_required');
      expect((await api(a).get('/auth/me')).data.next).toBe('mfa_setup');
      const setup = await api(a).post('/auth/mfa/setup');
      await api(a).post('/auth/mfa/enable', { code: totp(setup.data.secret) });
      expect((await api(a).get('/cases')).status).toBe(200);
      const off = await api(a).post('/auth/mfa/disable', { password: PASSWORD, code: totp(setup.data.secret) });
      expect(off.status).toBe(403);
    } finally { process.env.MFA_REQUIRED_ROLES = ''; }
  });
});

describe('user administration', () => {
  it('keeps at least one active administrator and blocks self role changes', async () => {
    const admin = await makeUser('ADMIN');
    expect((await api(admin).patch(`/users/${admin.userId}`, { role: 'EXPERT' })).status).toBe(409);
    expect((await api(admin).patch(`/users/${admin.userId}`, { active: false })).status).toBe(409);
  });
  it('requires an organisation for owners and only for owners', async () => {
    const admin = await makeUser('ADMIN');
    const org = await makeOrg(admin);
    expect((await api(admin).post('/users', { email: `o-${uniq()}@x.test`, name: 'Owner One', role: 'OWNER' })).status).toBe(400);
    expect((await api(admin).post('/users', { email: `o-${uniq()}@x.test`, name: 'Owner One', role: 'OWNER', orgId: org.id })).status).toBe(201);
    expect((await api(admin).post('/users', { email: `c-${uniq()}@x.test`, name: 'Consult One', role: 'EXPERT', orgId: org.id })).status).toBe(400);
  });
  it('rejects duplicate emails regardless of case', async () => {
    const admin = await makeUser('ADMIN'); const email = `dup-${uniq()}@x.test`;
    expect((await api(admin).post('/users', { email, name: 'First User', role: 'EXPERT' })).status).toBe(201);
    expect((await api(admin).post('/users', { email: email.toUpperCase(), name: 'Second User', role: 'EXPERT' })).status).toBe(400);
  });
  it('lists with search, filter, sort and pagination, and exports CSV', async () => {
    const admin = await makeUser('ADMIN');
    for (let i = 0; i < 3; i++) await makeUser('EXPERT', { name: `Zed Coach ${i}` });
    const p1 = await api(admin).get('/users?role=EXPERT&q=Zed%20Coach&pageSize=2&sort=name&dir=asc');
    expect(p1.data.items).toHaveLength(2); expect(p1.data.total).toBe(3); expect(p1.data.pages).toBe(2);
    expect(p1.data.items[0].name <= p1.data.items[1].name).toBe(true);
    expect(JSON.stringify(p1.data)).not.toMatch(/passwordHash|mfaSecret/);
    const csv = await call('GET', '/users?format=csv&q=Zed', { cookie: admin.cookie });
    expect(csv.status).toBe(200); expect(csv.headers.get('content-type')).toContain('text/csv'); expect(csv.text).toContain('Zed Coach');
    const bad = await api(admin).get('/users?sort=passwordHash');
    expect(bad.status).toBe(200); // unknown sort key falls back safely
  });
  it('only administrators see clients and funders in user lists', async () => {
    const pm = await makeUser('PROGRAMME_MANAGER');
    const r = await api(pm).get('/users?pageSize=100');
    expect(r.data.items.every((x: any) => !['OWNER', 'FUNDER'].includes(x.role))).toBe(true);
    expect((await api(pm).post('/users', { email: `x-${uniq()}@x.test`, name: 'Should Fail', role: 'EXPERT' })).status).toBe(403);
  });
  it('writes an audit row for each admin change', async () => {
    const admin = await makeUser('ADMIN'); const u = await makeUser('EXPERT');
    await api(admin).patch(`/users/${u.userId}`, { role: 'REVIEWER' });
    const rows = await db().select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, u.userId), eq(schema.auditLog.action, 'user.role_changed')));
    expect(rows).toHaveLength(1); expect(rows[0].actorEmail).toBe(admin.email);
  });
});
