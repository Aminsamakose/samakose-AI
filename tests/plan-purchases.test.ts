import { beforeAll, describe, expect, it } from 'vitest';
import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';

/**
 * startPlanPurchase's find-or-create for the Draft contract and Sent invoice must serialize:
 * a double-click on checkout, or a client retry after a slow response, sends two concurrent
 * requests for the same org+plan. Without the pg_advisory_xact_lock on (orgId, planId), both
 * could pass the "no existing Draft contract" check before either insert committed, each
 * creating its own contract, Sent invoice, and ledger posting -- double-booking the revenue
 * for a single purchase.
 */
let finance: Session, admin: Session;
beforeAll(async () => { await ensureReference(); finance = await makeUser('FINANCE'); admin = await makeUser('ADMIN'); });

async function publishedPlan() {
  const c = await api(finance).post('/plans', { name: `Race plan ${uniq()}`, audience: 'Owners', entitlements: [{ key: 'ai_assisted_report', enabled: true }], priceGhs: 300, intervalMonths: 12 });
  expect(c.status).toBe(201);
  const r = await api(finance).patch(`/plans/${c.data.id}`, { publicationStatus: 'published', priceConfirmed: true });
  expect(r.status).toBe(200);
  return c.data.id as string;
}

describe('self-serve plan purchase (concurrent checkout race)', () => {
  it('two concurrent checkouts for the same org+plan never create two contracts or two invoices', async () => {
    const org = await api(admin).post('/organisations', { name: `Race org ${uniq()}`, type: 'SME', sector: 'Retail', region: 'Northern', district: 'Tamale', consent: true, consentBy: 'Test Owner' });
    expect(org.status).toBe(201);
    const owner = await makeUser('OWNER', { orgId: org.data.id });
    const planId = await publishedPlan();

    const [r1, r2] = await Promise.all([
      api(owner).post(`/plans/${planId}/purchase`, {}),
      api(owner).post(`/plans/${planId}/purchase`, {})
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const contracts = await db().select().from(schema.contracts).where(and(eq(schema.contracts.orgId, org.data.id), eq(schema.contracts.planId, planId), eq(schema.contracts.status, 'Draft')));
    expect(contracts).toHaveLength(1);

    const invoices = await db().select().from(schema.invoices).where(and(eq(schema.invoices.contractId, contracts[0].id), inArray(schema.invoices.status, ['Draft', 'Sent', 'Overdue'])));
    expect(invoices).toHaveLength(1);

    // Both requests started a payment against the same single invoice, never two separately-booked ones.
    expect(r1.data.reference).not.toBe(r2.data.reference); // two payment attempts are fine (retry-safe)
    const payments = await db().select().from(schema.payments).where(eq(schema.payments.invoiceId, invoices[0].id));
    expect(payments.length).toBeGreaterThanOrEqual(1);
    for (const p of payments) expect(p.invoiceId).toBe(invoices[0].id);
  });
});
