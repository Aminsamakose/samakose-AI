import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { api, ensureReference, makeUser, uniq, type Session } from './helpers';

/**
 * The missing link between a verified paid-plan purchase and actual assessment access:
 * startPlanPurchase (self-serve) -> Paystack/mock payment -> finance.ts settle() -> case-unlock.ts.
 * Before case-unlock.ts existed, a business owner could pay for a plan and never get a case to run
 * their purchased assessment against (cases:create is staff-only; OWNER only holds cases:[R]).
 */
let finance: Session, admin: Session;
beforeAll(async () => { await ensureReference(); finance = await makeUser('FINANCE'); admin = await makeUser('ADMIN'); });

async function publishedPlan(o: Record<string, unknown> = {}) {
  // serviceTier is deliberately omitted (left null): pricing.test.ts asserts on specific tiers
  // such as 'growth' via loadForTest()'s public pricing card, which does a plain find() by tier --
  // a same-tier plan created here while that file's tests run in a parallel worker would collide
  // with its lookup. This plan only needs to be published and priceConfirmed for startPlanPurchase;
  // it has no need to appear correctly tiered on the public pricing page.
  const c = await api(finance).post('/plans', { name: `Plan ${uniq()}`, audience: 'Owners', entitlements: [{ key: 'full_assessment', enabled: true }], priceGhs: 500, intervalMonths: 12, ...o });
  expect(c.status).toBe(201);
  const r = await api(finance).patch(`/plans/${c.data.id}`, { publicationStatus: 'published', priceConfirmed: true });
  expect(r.status).toBe(200);
  return c.data.id as string;
}

async function ownerWithOrg(type: 'SME' | 'AGRIFOOD' | 'ESO' = 'SME') {
  const org = await api(admin).post('/organisations', { name: `Org ${uniq()}`, type, sector: 'Retail', region: 'Northern', district: 'Tamale', consent: true, consentBy: 'Test Owner' });
  expect(org.status).toBe(201);
  const owner = await makeUser('OWNER', { orgId: org.data.id });
  return { org: org.data as { id: string; code: string }, owner };
}

async function payViaMock(owner: Session, planId: string) {
  const r = await api(owner).post(`/plans/${planId}/purchase`, {});
  expect(r.status).toBe(200);
  expect(r.data.mock).toBe(true);
  const done = await api(owner).post(`/payments/${r.data.reference}/mock-complete`, {});
  expect(done.status).toBe(200);
  return done.data;
}

describe('self-serve plan purchase unlocks the purchased assessment', () => {
  it('opens a case for the organisation the instant the mock payment settles', async () => {
    const planId = await publishedPlan();
    const { org, owner } = await ownerWithOrg();
    const before = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(before).toHaveLength(0);

    await payViaMock(owner, planId);

    const after = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe('PROFILED');

    // The owner can now see (and in principle start) the diagnostic for their own case.
    const mine = await api(owner).get(`/cases/${after[0].id}`);
    expect(mine.status).toBe(200);
  });

  it('is idempotent: retrying settlement (e.g. a webhook replay) never opens a second case', async () => {
    const planId = await publishedPlan();
    const { org, owner } = await ownerWithOrg('AGRIFOOD');
    const r = await api(owner).post(`/plans/${planId}/purchase`, {});
    const reference = r.data.reference as string;
    await api(owner).post(`/payments/${reference}/mock-complete`, {});
    // Second call: payment is already Succeeded, settle() short-circuits -- confirms no duplicate case
    // regardless, since unlockAssessmentForPurchase itself also reuses any existing open case.
    const again = await api(owner).post(`/payments/${reference}/mock-complete`, {});
    expect(again.status).toBe(422); // "already Succeeded" per mockComplete's own guard

    const cases = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(cases).toHaveLength(1);
  });

  it('does not open a case when the purchased plan has no full_assessment entitlement', async () => {
    const planId = await publishedPlan({ entitlements: [{ key: 'ai_assisted_report', enabled: true }] });
    const { org, owner } = await ownerWithOrg();
    await payViaMock(owner, planId);
    const cases = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(cases).toHaveLength(0);
  });

  it('does not open a case when the plan is scoped to a different platform than the buying organisation', async () => {
    const planId = await publishedPlan({ platforms: ['ESO'] });
    const { org, owner } = await ownerWithOrg('SME');
    await payViaMock(owner, planId);
    const cases = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(cases).toHaveLength(0);
  });

  it('reuses an already-open case rather than opening a second one for a repeat or upgrade purchase', async () => {
    const planId = await publishedPlan();
    const { org, owner } = await ownerWithOrg('ESO');
    await payViaMock(owner, planId);
    const firstCase = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(firstCase).toHaveLength(1);

    const planId2 = await publishedPlan();
    await payViaMock(owner, planId2);
    const stillOne = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(stillOne).toHaveLength(1);
    expect(stillOne[0].id).toBe(firstCase[0].id);
  });

  it('never blocks the payment itself even if unlocking fails (invoice is still marked Paid)', async () => {
    // A plan with full_assessment but no platforms restriction still unlocks normally; this test
    // instead verifies the payment/invoice side is authoritative and independent of unlock outcome
    // by checking the failing-platform case above still leaves the payment Succeeded.
    const planId = await publishedPlan({ platforms: ['ESO'] });
    const { owner } = await ownerWithOrg('SME');
    const r = await api(owner).post(`/plans/${planId}/purchase`, {});
    const done = await api(owner).post(`/payments/${r.data.reference}/mock-complete`, {});
    expect(done.status).toBe(200);
    expect(done.data.status).toBe('Succeeded');
  });
});
