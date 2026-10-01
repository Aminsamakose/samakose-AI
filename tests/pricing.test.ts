import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import { loadForTest } from './site-load';

let admin: Session, manager: Session, editor: Session, finance: Session;
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); manager = await makeUser('SITE_MANAGER'); editor = await makeUser('CONTENT_EDITOR'); finance = await makeUser('FINANCE'); });

const plan = (o: Record<string, unknown> = {}) => ({ data: { name: `Plan ${uniq()}`, audience: 'Growing firms', features: 'Full assessment\nCoaching', priceGhs: '', priceUsd: '', period: '', ctaLabel: '', ctaHref: '', highlighted: false, ...o } });
const settingsDoc = async () => (await api(admin).get('/admin/content/kind/pricing_settings')).data.items[0];

describe('public pricing display', () => {
  it('ships with prices off, GHS default, and the coming-soon banner', async () => {
    const s = await loadForTest();
    expect(s.pricing.confirmed).toBe(false); expect(s.pricing.currency).toBe('GHS'); expect(s.pricing.banner).toMatch(/approved/i);
    const d = await settingsDoc(); expect(d.data.pricesConfirmed).toBe(false); expect(d.data.showUsdReference).toBe(false);
  });
  it('lets a site manager build cards but only an administrator enter prices', async () => {
    const c = await api(manager).post('/admin/content/kind/pricing_plan', plan());
    expect(c.status).toBe(201);
    expect((await api(manager).post('/admin/content/kind/pricing_plan', plan({ priceGhs: '1500' }))).status).toBe(403);
    expect((await api(manager).put(`/admin/content/${c.data.id}`, plan({ priceGhs: '1500' }))).status).toBe(403);
    expect((await api(editor).post('/admin/content/kind/pricing_plan', plan())).status).toBe(201);
    expect((await api(admin).put(`/admin/content/${c.data.id}`, plan({ priceGhs: 'abc' }))).status).toBe(400);
    expect((await api(admin).put(`/admin/content/${c.data.id}`, { data: { ...c.data.data, priceGhs: '1,500.50', priceUsd: '120' } })).status).toBe(200);
    // a manager cannot publish a draft whose price has not gone live
    expect((await api(manager).post(`/admin/content/${c.data.id}/publish`, {})).status).toBe(403);
    expect((await api(admin).post(`/admin/content/${c.data.id}/publish`, {})).status).toBe(200);
  });
  it('keeps prices hidden until an administrator approves them with a reference', async () => {
    const before = await loadForTest();
    expect(before.pricing.plans.some((p) => p.price)).toBe(false);
    const d = await settingsDoc();
    expect((await api(manager).put(`/admin/content/${d.id}`, { data: { ...d.data, pricesConfirmed: true, approvalRef: 'x' } })).status).toBe(403);
    expect((await api(admin).put(`/admin/content/${d.id}`, { data: { ...d.data, pricesConfirmed: true, approvalRef: '' } })).status).toBe(200);
    expect((await api(admin).post(`/admin/content/${d.id}/publish`, {})).status).toBe(400); // no approval reference
    expect((await api(admin).put(`/admin/content/${d.id}`, { data: { ...d.data, pricesConfirmed: true, approvalRef: 'Finance approval, 12 Nov 2026', showUsdReference: true } })).status).toBe(200);
    expect((await api(admin).post(`/admin/content/${d.id}/publish`, {})).status).toBe(200);
    const live = await loadForTest();
    expect(live.pricing.confirmed).toBe(true);
    const p = live.pricing.plans.find((x) => x.price);
    expect(p?.price).toBe('GH₵1,500.5'); expect(p?.reference).toBe('US$120');
    // switching approval off hides them again
    expect((await api(admin).put(`/admin/content/${d.id}`, { data: { ...d.data, pricesConfirmed: false, approvalRef: '' } })).status).toBe(200);
    expect((await api(admin).post(`/admin/content/${d.id}/publish`, {})).status).toBe(200);
    const off = await loadForTest(); expect(off.pricing.confirmed).toBe(false); expect(off.pricing.plans.every((x) => x.price === null && x.reference === null)).toBe(true);
  });
  it('never touches billing: finance tables are unchanged by pricing edits', async () => {
    const snap = async () => JSON.stringify([await db().execute(sql`select count(*)::int n, coalesce(max(updated_at)::text,'') u from plans`), await db().execute(sql`select count(*)::int n, coalesce(max(updated_at)::text,'') u from contracts`), await db().execute(sql`select count(*)::int n, coalesce(max(updated_at)::text,'') u from invoices`), await db().select().from(schema.rules).where(sql`key like 'billing.%'`)]);
    const a = await snap();
    const c = await api(admin).post('/admin/content/kind/pricing_plan', plan({ priceGhs: '999' }));
    await api(admin).post(`/admin/content/${c.data.id}/publish`, {});
    await api(admin).put(`/admin/content/${c.data.id}`, { data: { ...c.data.data, priceGhs: '1999' } });
    expect(await snap()).toBe(a);
  });
});

describe('billing configuration', () => {
  it('defaults to GHS with tax off and is administrator only', async () => {
    expect((await api(manager).get('/settings/billing')).status).toBe(403);
    expect((await api(finance).put('/settings/billing', { currency: 'USD' })).status).toBe(403);
    const b = (await api(admin).get('/settings/billing')).data;
    expect(b.currency).toBe('GHS'); expect(b.taxEnabled).toBe(false); expect(b.usdReferenceEnabled).toBe(false); expect(b.invoicePrefix).toBe('INV');
  });
  it('will not switch tax on without a rate, registration number and Finance confirmation', async () => {
    expect((await api(admin).put('/settings/billing', { taxEnabled: true })).status).toBe(400);
    expect((await api(admin).put('/settings/billing', { taxEnabled: true, taxRatePercent: 15, taxRegistrationNumber: 'C0001234567' })).status).toBe(400);
    const ok = await api(admin).put('/settings/billing', { taxEnabled: true, taxRatePercent: 15, taxRegistrationNumber: 'C0001234567', taxConfirmationRef: 'Finance, 20 Nov 2026' });
    expect(ok.status).toBe(200); expect(ok.data.taxEnabled).toBe(true);
    expect((await api(admin).put('/settings/billing', { taxEnabled: false })).data.taxEnabled).toBe(false);
    expect((await api(admin).put('/settings/billing', { invoicePrefix: 'ab' })).status).toBe(400);
    expect((await api(admin).put('/settings/billing', { paymentTermsDays: 400 })).status).toBe(400);
    const log = await db().select().from(schema.auditLog).where(sql`action = 'settings.billing_changed'`); expect(log.length).toBeGreaterThan(1);
  });
  it('reports payment readiness without exposing keys', async () => {
    expect((await api(manager).get('/admin/system/payments')).status).toBe(403);
    const r = await api(admin).get('/admin/system/payments'); expect(r.status).toBe(200);
    expect(r.data.ready).toBe(false); expect(JSON.stringify(r.data)).not.toMatch(/sk_(live|test)_[A-Za-z0-9]/);
  });
});
