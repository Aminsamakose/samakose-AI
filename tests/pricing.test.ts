import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';
import { loadForTest } from './site-load';

let admin: Session, manager: Session, finance: Session;
beforeAll(async () => { await ensureReference(); admin = await makeUser('ADMIN'); manager = await makeUser('SITE_MANAGER'); finance = await makeUser('FINANCE'); });

const plan = (o: Record<string, unknown> = {}) => ({ name: `Plan ${uniq()}`, audience: 'Growing firms', serviceTier: 'growth', entitlements: [{ key: 'full_assessment', enabled: true }], priceGhs: 1500, intervalMonths: 12, ...o });
const settingsDoc = async () => (await api(admin).get('/admin/content/kind/pricing_settings')).data.items[0];

/**
 * The public pricing page has exactly one authoritative source: Published rows in the `plans`
 * table (Finance → Plans). There is no separate CMS pricing-card system any more - that duplication
 * is what the "simplify plan management" work removed. A site manager/content editor cannot touch
 * plans at all; only Finance and Administrators can, same as any other billing configuration.
 */
describe('public pricing display', () => {
  it('ships with prices off, GHS default, and the coming-soon banner, and five tier + three duration placeholders', async () => {
    const s = await loadForTest();
    expect(s.pricing.confirmed).toBe(false); expect(s.pricing.currency).toBe('GHS'); expect(s.pricing.banner).toMatch(/approved/i);
    const d = await settingsDoc(); expect(d.data.pricesConfirmed).toBe(false);
  });
  it('a site manager cannot create or edit plans - that is Finance/Admin territory', async () => {
    expect((await api(manager).post('/plans', plan())).status).toBe(403);
    expect((await api(manager).get('/plans')).status).toBe(403);
  });
  it('a new plan starts as an unpublished draft and never appears on the public page until published', async () => {
    const before = await loadForTest();
    const name = `Plan ${uniq()}`;
    const c = await api(finance).post('/plans', plan({ name, serviceTier: 'growth' }));
    expect(c.status).toBe(201);
    const created = (await api(finance).get('/plans')).data.find((p: any) => p.id === c.data.id);
    expect(created.publicationStatus).toBe('draft'); expect(created.active).toBe(false);
    const stillHidden = await loadForTest();
    expect(stillHidden.pricing.plans.some((p: any) => p.name === name)).toBe(false);
    expect(stillHidden.pricing.plans.length).toBe(before.pricing.plans.length); // still just the 5 tier + 3 duration slots
    await api(finance).patch(`/plans/${c.data.id}`, { publicationStatus: 'published' });
    const live = await loadForTest();
    const card = live.pricing.plans.find((p: any) => p.serviceTier === 'growth');
    expect(card?.name).toBe(name);
    expect(card?.features).toContain('Full 360 assessment');
  });
  it('keeps actual GHS figures hidden until BOTH the site-wide approval and that plan\'s own price are confirmed, even for a published plan', async () => {
    const name = `Plan ${uniq()}`;
    const c = await api(finance).post('/plans', plan({ name, serviceTier: 'diagnostic', priceGhs: 1500 }));
    await api(finance).patch(`/plans/${c.data.id}`, { publicationStatus: 'published' });
    const before = await loadForTest();
    const card0 = before.pricing.plans.find((p: any) => p.serviceTier === 'diagnostic');
    expect(card0?.price).toBeNull();
    expect(card0?.priceStatus).toBe('pending');
    const d = await settingsDoc();
    expect((await api(manager).put(`/admin/content/${d.id}`, { data: { ...d.data, pricesConfirmed: true, approvalRef: 'x' } })).status).toBe(403);
    expect((await api(admin).put(`/admin/content/${d.id}`, { data: { ...d.data, pricesConfirmed: true, approvalRef: 'Finance approval, 12 Nov 2026' } })).status).toBe(200);
    await api(admin).post(`/admin/content/${d.id}/publish`, {});
    // Site-wide approval alone is not enough - this plan's own price is still unconfirmed, so the
    // figure stays hidden. Per-plan confirmation is the point of this gate, not a global switch.
    const stillPending = await loadForTest();
    const cardPending = stillPending.pricing.plans.find((p: any) => p.serviceTier === 'diagnostic');
    expect(cardPending?.price).toBeNull();
    expect(cardPending?.priceStatus).toBe('pending');
    expect((await api(manager).patch(`/plans/${c.data.id}`, { priceConfirmed: true })).status).toBe(403);
    await api(finance).patch(`/plans/${c.data.id}`, { priceConfirmed: true });
    const live = await loadForTest();
    expect(live.pricing.confirmed).toBe(true);
    const card1 = live.pricing.plans.find((p: any) => p.serviceTier === 'diagnostic');
    expect(card1?.price).toBe('GH₵1,500');
    expect(card1?.priceStatus).toBe('confirmed');
    // switching site-wide approval off hides the figure again, without touching the plan's own confirmation
    await api(admin).put(`/admin/content/${d.id}`, { data: { ...d.data, pricesConfirmed: false, approvalRef: '' } });
    await api(admin).post(`/admin/content/${d.id}/publish`, {});
    const off = await loadForTest();
    expect(off.pricing.confirmed).toBe(false);
    expect(off.pricing.plans.every((p: any) => p.price === null || p.price === 'Free' || p.price === 'Priced by agreement')).toBe(true);
  });
  it('a plan cannot be confirmed as priced unless it is actually fixed-price', async () => {
    const free = await api(finance).post('/plans', plan({ name: `Free ${uniq()}`, serviceTier: 'discovery', pricingModel: 'free', priceGhs: 0 }));
    expect((await api(finance).patch(`/plans/${free.data.id}`, { priceConfirmed: true })).status).toBe(400);
  });
  it('two published plans can have independent price-confirmation states under the same site approval', async () => {
    const d = await settingsDoc();
    await api(admin).put(`/admin/content/${d.id}`, { data: { ...d.data, pricesConfirmed: true, approvalRef: 'Finance approval, 12 Nov 2026' } });
    await api(admin).post(`/admin/content/${d.id}/publish`, {});
    const a = await api(finance).post('/plans', plan({ name: `A ${uniq()}`, serviceTier: 'transform', priceGhs: 1200 }));
    const b = await api(finance).post('/plans', plan({ name: `B ${uniq()}`, serviceTier: 'growth', priceGhs: 7500 }));
    await api(finance).patch(`/plans/${a.data.id}`, { publicationStatus: 'published', priceConfirmed: true });
    await api(finance).patch(`/plans/${b.data.id}`, { publicationStatus: 'published' }); // left unconfirmed
    const live = await loadForTest();
    expect(live.pricing.plans.find((p: any) => p.serviceTier === 'transform')?.price).toBe('GH₵1,200');
    expect(live.pricing.plans.find((p: any) => p.serviceTier === 'growth')?.price).toBeNull();
  });
  it('a free or custom-priced plan shows its model regardless of the price-approval toggle', async () => {
    const free = await api(finance).post('/plans', plan({ name: `Free ${uniq()}`, serviceTier: 'discovery', pricingModel: 'free', priceGhs: 0 }));
    await api(finance).patch(`/plans/${free.data.id}`, { publicationStatus: 'published' });
    const custom = await api(finance).post('/plans', plan({ name: `Prog ${uniq()}`, serviceTier: 'programme', pricingModel: 'custom', priceGhs: 1 }));
    await api(finance).patch(`/plans/${custom.data.id}`, { publicationStatus: 'published' });
    const live = await loadForTest();
    expect(live.pricing.plans.find((p: any) => p.serviceTier === 'discovery')?.price).toBe('Free');
    expect(live.pricing.plans.find((p: any) => p.serviceTier === 'programme')?.price).toBe('Priced by agreement');
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
  });
  it('reports payment readiness without exposing keys', async () => {
    expect((await api(manager).get('/admin/system/payments')).status).toBe(403);
    const r = await api(admin).get('/admin/system/payments'); expect(r.status).toBe(200);
    expect(r.data.ready).toBe(false); expect(JSON.stringify(r.data)).not.toMatch(/sk_(live|test)_[A-Za-z0-9]/);
  });
});
