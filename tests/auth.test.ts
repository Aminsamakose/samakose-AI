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
  it('an admin can unsend a staff invitation; the link then says withdrawn, and inviting again reuses the record', async () => {
    const admin = await makeUser('ADMIN');
    const email = `cancel-${uniq()}@x.test`;
    const inv = await api(admin).post('/users', { email, name: 'Second Admin', role: 'ADMIN' }); expect(inv.status).toBe(201);
    const link1 = tokenFrom((await lastEmailTo(email)).body);
    expect((await api(admin).post(`/users/${inv.data.id}/cancel-invite`)).status).toBe(200);
    const info = await call('GET', `/auth/invite-info?token=${encodeURIComponent(link1)}`);
    expect(info.status).toBe(400); expect(info.error.code).toBe('invite_withdrawn'); expect(info.error.message).toMatch(/withdrawn/);
    expect((await call('POST', '/auth/accept-invite', { body: { token: link1, password: 'Invite-Passw0rd-2026' } })).status).toBe(400);
    expect((await api(admin).post(`/users/${inv.data.id}/cancel-invite`)).status).toBe(422); // already cancelled
    expect((await api(admin).post(`/users/${inv.data.id}/resend-invite`)).status).toBe(200); // resend alone does not revive it
    const [row] = await db().select().from(schema.users).where(eq(schema.users.id, inv.data.id));
    expect(row.active).toBe(false);
    const again = await api(admin).post('/users', { email, name: 'Second Admin', role: 'EXPERT' }); expect(again.status).toBe(201);
    expect(again.data.id).toBe(inv.data.id);
    const link2 = tokenFrom((await lastEmailTo(email)).body);
    expect((await call('POST', '/auth/accept-invite', { body: { token: link1, password: 'Invite-Passw0rd-2026' } })).status).toBe(400);
    expect((await call('POST', '/auth/accept-invite', { body: { token: link2, password: 'Invite-Passw0rd-2026' } })).status).toBe(200);
    const log = (await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, inv.data.id))).map((l) => l.action);
    expect(log).toEqual(expect.arrayContaining(['user.invited', 'user.invite_cancelled', 'user.invite_reissued']));
  });
  it('a cancelled invitation can be deleted for good, an active one or an accepted person cannot', async () => {
    const admin = await makeUser('ADMIN'); const email = `del-${uniq()}@x.test`;
    const inv = await api(admin).post('/users', { email, name: 'Gone Soon', role: 'EXPERT' });
    expect((await api(admin).del(`/users/${inv.data.id}/invitation`)).status).toBe(422); // cancel first
    await api(admin).post(`/users/${inv.data.id}/cancel-invite`);
    const expert = await makeUser('EXPERT'); expect((await api(expert).del(`/users/${inv.data.id}/invitation`)).status).toBe(403);
    expect((await api(admin).del(`/users/${inv.data.id}/invitation`)).status).toBe(200);
    expect((await api(admin).get(`/users/${inv.data.id}`)).status).toBe(404);
    expect((await db().select().from(schema.users).where(eq(schema.users.id, inv.data.id))).length).toBe(0);
    const log = (await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, inv.data.id))).map((l) => l.action);
    expect(log).toEqual(expect.arrayContaining(['user.invited', 'user.invite_cancelled', 'user.invite_deleted']));
    // the address is free again
    expect((await api(admin).post('/users', { email, name: 'Fresh Start', role: 'EXPERT' })).status).toBe(201);
    // someone who accepted can never be deleted this way
    const e2 = `acc2-${uniq()}@x.test`; const i2 = await api(admin).post('/users', { email: e2, name: 'Real Person', role: 'EXPERT' });
    await call('POST', '/auth/accept-invite', { body: { token: tokenFrom((await lastEmailTo(e2)).body), password: 'Invite-Passw0rd-2026' } });
    await api(admin).patch(`/users/${i2.data.id}`, { active: false });
    expect((await api(admin).del(`/users/${i2.data.id}/invitation`)).status).toBe(422);
  });
  it('refuses to unsend an invitation that was accepted, and needs permission', async () => {
    const admin = await makeUser('ADMIN'); const email = `acc-${uniq()}@x.test`;
    const inv = await api(admin).post('/users', { email, name: 'Active Person', role: 'EXPERT' });
    await call('POST', '/auth/accept-invite', { body: { token: tokenFrom((await lastEmailTo(email)).body), password: 'Invite-Passw0rd-2026' } });
    expect((await api(admin).post(`/users/${inv.data.id}/cancel-invite`)).status).toBe(422);
    const pending = await api(admin).post('/users', { email: `p-${uniq()}@x.test`, name: 'Pending Person', role: 'EXPERT' });
    const expert = await makeUser('EXPERT'); expect((await api(expert).post(`/users/${pending.data.id}/cancel-invite`)).status).toBe(403);
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
  it('issues ten one-time recovery codes at enrolment, stores only hashes, and a code signs in once', async () => {
    const u = await makeUser('EXPERT');
    const setup = await api(u).post('/auth/mfa/setup');
    const on = await api(u).post('/auth/mfa/enable', { code: totp(setup.data.secret) });
    expect(on.status).toBe(200);
    const codes: string[] = on.data.recoveryCodes;
    expect(codes).toHaveLength(10); expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const [row] = await db().select().from(schema.users).where(eq(schema.users.id, u.userId));
    expect(row.mfaRecovery).toHaveLength(10);
    for (const c of codes) expect(row.mfaRecovery.join(' ')).not.toContain(c.replace('-', ''));
    expect((await api(u).get('/auth/me')).data.recoveryCodesLeft).toBe(10);

    const signIn = async () => { const s = await call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } }); return s.headers.get('set-cookie')!.split(';')[0]; };
    const c1 = await signIn();
    const used = await call('POST', '/auth/mfa/verify', { cookie: c1, body: { code: codes[0].toLowerCase() } }); // case and the dash do not matter
    expect(used.status).toBe(200); expect(used.data.recoveryCodesLeft).toBe(9);
    expect((await call('GET', '/cases', { cookie: c1 })).status).toBe(200);
    const c2 = await signIn();
    const again = await call('POST', '/auth/mfa/verify', { cookie: c2, body: { code: codes[0] } });
    expect(again.status).toBe(400); // already spent
    expect((await call('POST', '/auth/mfa/verify', { cookie: c2, body: { code: 'AAAAA-AAAAA' } })).status).toBe(400);
    expect((await call('POST', '/auth/mfa/verify', { cookie: c2, body: { code: codes[1].replace('-', '') } })).status).toBe(200);
    const log = await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, u.userId));
    expect(log.some((l) => l.action === 'auth.mfa_recovery_used')).toBe(true);
  });
  it('replaces the whole set only with the password and a current code, and clears it on reset', async () => {
    const admin = await makeUser('ADMIN'); const u = await makeUser('EXPERT');
    const setup = await api(u).post('/auth/mfa/setup');
    const first: string[] = (await api(u).post('/auth/mfa/enable', { code: totp(setup.data.secret) })).data.recoveryCodes;
    expect((await api(u).post('/auth/mfa/recovery-codes', { password: 'wrong-password-123', code: totp(setup.data.secret) })).status).toBe(400);
    expect((await api(u).post('/auth/mfa/recovery-codes', { password: PASSWORD, code: '000000' })).status).toBe(400);
    const fresh = await api(u).post('/auth/mfa/recovery-codes', { password: PASSWORD, code: totp(setup.data.secret) });
    expect(fresh.status).toBe(200); expect(fresh.data.recoveryCodes).toHaveLength(10);
    const s = await call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
    const cookie = s.headers.get('set-cookie')!.split(';')[0];
    expect((await call('POST', '/auth/mfa/verify', { cookie, body: { code: first[0] } })).status).toBe(400); // old set is dead
    expect((await call('POST', '/auth/mfa/verify', { cookie, body: { code: fresh.data.recoveryCodes[0] } })).status).toBe(200);
    expect((await api(admin).post(`/users/${u.userId}/reset-mfa`)).status).toBe(200);
    const [row] = await db().select().from(schema.users).where(eq(schema.users.id, u.userId));
    expect(row.mfaRecovery).toHaveLength(0);
  });
  it('does not let a session that has not passed the second step make new codes', async () => {
    const u = await makeUser('EXPERT');
    const setup = await api(u).post('/auth/mfa/setup'); await api(u).post('/auth/mfa/enable', { code: totp(setup.data.secret) });
    const s = await call('POST', '/auth/login', { body: { email: u.email, password: PASSWORD } });
    const cookie = s.headers.get('set-cookie')!.split(';')[0];
    const r = await call('POST', '/auth/mfa/recovery-codes', { cookie, body: { password: PASSWORD, code: totp(setup.data.secret) } });
    expect(r.status).toBe(403); expect(r.error.code).toBe('mfa_required');
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
