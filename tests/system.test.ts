import { beforeAll, describe, expect, it } from 'vitest';
import { api, call, ensureReference, makeUser, PASSWORD, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { loadForTest } from './site-load';

let admin: Session, manager: Session, coach: Session;
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); manager = await makeUser('SITE_MANAGER'); coach = await makeUser('EXPERT'); });

describe('maintenance mode', () => {
  it('is admin only, shows on the public loader, and pauses non-admin sign-in on request', async () => {
    expect((await api(manager).put('/settings/maintenance', { on: true, blockSignin: false, message: '' })).status).toBe(403);
    expect((await api(admin).put('/settings/maintenance', { on: true, blockSignin: true, message: 'Back at noon' })).status).toBe(200);
    const s = await loadForTest(); expect(s.maintenance).toEqual({ on: true, message: 'Back at noon' });
    const r = await call('POST', '/auth/login', { body: { email: coach.email, password: PASSWORD } });
    expect(r.status).toBe(503); expect(r.error.code).toBe('maintenance');
    const a = await call('POST', '/auth/login', { body: { email: admin.email, password: PASSWORD } });
    expect(a.status).toBe(200);
    await api(admin).put('/settings/maintenance', { on: false, blockSignin: false, message: '' });
    expect((await loadForTest()).maintenance.on).toBe(false);
    expect((await call('POST', '/auth/login', { body: { email: coach.email, password: PASSWORD } })).status).toBe(200);
    expect((await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, 'settings.maintenance_changed'))).length).toBeGreaterThan(1);
  });
});

describe('analytics settings', () => {
  it('validates ids and only publishes when valid', async () => {
    const doc = (await api(manager).get('/admin/content/kind/analytics')).data.items[0];
    expect((await api(manager).put(`/admin/content/${doc.id}`, { data: { ga4Id: 'UA-123', plausibleDomain: '' } })).status).toBe(400);
    expect((await api(manager).put(`/admin/content/${doc.id}`, { data: { ga4Id: '', plausibleDomain: 'https://x.com' } })).status).toBe(400);
    expect((await api(manager).put(`/admin/content/${doc.id}`, { data: { ga4Id: "g-abc123xyz4", plausibleDomain: 'samakose.com' } })).status).toBe(200);
    expect((await api(manager).post(`/admin/content/${doc.id}/publish`, {})).status).toBe(200);
    const s = await loadForTest(); expect(s.analytics.ga4Id).toBe('G-ABC123XYZ4'); expect(s.analytics.plausibleDomain).toBe('samakose.com');
  });
});

describe('integration tests and logs', () => {
  it('lets an administrator test and read the email log, and nobody else', async () => {
    expect((await api(coach).post('/admin/system/test/database', {})).status).toBe(403);
    expect((await api(manager).get('/admin/system/emails')).status).toBe(403);
    expect((await api(admin).post('/admin/system/test/database', {})).data.ok).toBe(true);
    expect((await api(admin).post('/admin/system/test/storage', {})).data.ok).toBe(true);
    expect((await api(admin).post('/admin/system/test/email', {})).data.ok).toBe(false); // log-only in tests
    expect((await api(admin).post('/admin/system/test/nope', {})).status).toBe(400);
    const log = await api(admin).get('/admin/system/emails'); expect(log.status).toBe(200); expect(Array.isArray(log.data.items)).toBe(true);
    const [m] = await db().insert(schema.outboxEmails).values({ to: `x${uniq()}@example.org`, subject: 'Test', body: 'b', status: 'Failed', lastError: 'boom' }).returning();
    expect((await api(admin).post(`/admin/system/emails/${m.id}/retry`, {})).status).toBe(200);
    expect((await api(admin).post(`/admin/system/emails/${m.id}/retry`, {})).status).toBe(409);
  });
  it('gives administrators a security overview', async () => {
    expect((await api(coach).get('/settings/security')).status).toBe(403);
    const r = await api(admin).get('/settings/security'); expect(r.status).toBe(200); expect(r.data.counts.activeAdmins).toBeGreaterThan(0);
  });
});

describe('configuration transfer', () => {
  it('exports, validates and imports as drafts, and never switches off a safety rule', async () => {
    expect((await api(manager).get('/settings/config/export')).status).toBe(403);
    const ex = await api(admin).get('/settings/config/export'); expect(ex.status).toBe(200);
    const bundle = JSON.parse(ex.text); expect(bundle.format).toBe('samakose-config');
    const q = `Imported question ${uniq()}`;
    const mine = { ...bundle, content: [{ kind: 'faq', title: q, status: 'Published', sortOrder: 0, data: { question: q, answer: 'An answer that is long enough.' } }], emailTemplates: [], switches: { 'switch.self_registration': true }, reportText: {} };
    const dry = await api(admin).post('/settings/config/import', { bundle: mine, dryRun: true }); expect(dry.status).toBe(200); expect(dry.data.drafts).toBe(1);
    expect((await db().select().from(schema.contentDocs).where(eq(schema.contentDocs.title, q))).length).toBe(0);
    expect((await api(admin).post('/settings/config/import', { bundle: mine, dryRun: false })).status).toBe(200);
    const [row] = await db().select().from(schema.contentDocs).where(eq(schema.contentDocs.title, q));
    expect(row.status).toBe('Draft'); expect(row.live).toBeNull();
    expect((await loadForTest()).faqs.some((f) => f.question === q)).toBe(false);
    const bad = { ...mine, switches: { 'switch.report_requires_verified_org': false } };
    const r = await api(admin).post('/settings/config/import', { bundle: bad, dryRun: false }); expect(r.status).toBe(400);
    expect((await api(admin).post('/settings/config/import', { bundle: { format: 'other' }, dryRun: true })).status).toBe(400);
    expect((await api(admin).post('/settings/config/import', { bundle: { ...mine, content: [{ kind: 'nope', data: {} }] }, dryRun: true })).status).toBe(400);
  });
});
