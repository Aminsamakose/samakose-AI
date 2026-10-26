import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { api, drain, ensureReference, makeUser, uniq, type Session } from './helpers';

/**
 * The missing link between a verified paid-plan purchase and actual assessment access:
 * startPlanPurchase (self-serve) -> product-readiness gate -> Paystack/mock payment ->
 * finance.ts settle() -> case-unlock.ts. Before case-unlock.ts existed, a business owner could pay
 * for a plan and never get a case to run their purchased assessment against (cases:create is
 * staff-only; OWNER only holds cases:[R]). Before the readiness gate existed, a customer could pay
 * for an assessment on a platform (AgriFood360, ESO360) whose paid framework is still Draft -- see
 * frameworks.test.ts for that Draft-vs-Published state -- and have nothing to show for it.
 *
 * Only SME organisations are used for the "succeeds" paths here: SME360 is the one paid framework
 * with a Published version in this environment. AgriFood360 and ESO360 purchases are exercised
 * through the readiness-gate tests below, which expect checkout itself to refuse them.
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
    const { org, owner } = await ownerWithOrg();
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

  it('reuses an already-open case rather than opening a second one for a repeat or upgrade purchase', async () => {
    const planId = await publishedPlan();
    const { org, owner } = await ownerWithOrg();
    await payViaMock(owner, planId);
    const firstCase = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(firstCase).toHaveLength(1);

    const planId2 = await publishedPlan();
    await payViaMock(owner, planId2);
    const stillOne = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(stillOne).toHaveLength(1);
    expect(stillOne[0].id).toBe(firstCase[0].id);
  });

  it('leaves the payment Succeeded even when unlocking fails (e.g. consent missing) -- a bug in unlock must never undo a real payment', async () => {
    const planId = await publishedPlan();
    const { org, owner } = await ownerWithOrg();
    // Simulate a precondition slipping after the org was created (consent withdrawn, say) -- something
    // checkPlanReadiness at checkout time cannot see, so this can only surface at settlement.
    await db().update(schema.organisations).set({ consentAt: null }).where(eq(schema.organisations.id, org.id));
    const done = await payViaMock(owner, planId);
    expect(done.status).toBe('Succeeded');
    const cases = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(cases).toHaveLength(0); // unlock declined (org_consent_missing), but the money still moved
  });
});

describe('concurrent settlement cannot open two cases for one organisation', () => {
  it('two purchases for the same org settling at the same instant still land on a single case', async () => {
    const { org, owner } = await ownerWithOrg();
    const planA = await publishedPlan();
    const planB = await publishedPlan();

    const refA = (await api(owner).post(`/plans/${planA}/purchase`, {})).data.reference as string;
    const refB = (await api(owner).post(`/plans/${planB}/purchase`, {})).data.reference as string;

    // Both settlements race unlockAssessmentForPurchase for the same orgId. Without the advisory
    // lock in case-unlock.ts, both could pass the "no existing case" check before either insert
    // committed, opening two cases for this one organisation.
    const [doneA, doneB] = await Promise.all([
      api(owner).post(`/payments/${refA}/mock-complete`, {}),
      api(owner).post(`/payments/${refB}/mock-complete`, {})
    ]);
    expect(doneA.status).toBe(200);
    expect(doneB.status).toBe(200);

    const cases = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(cases).toHaveLength(1);
  });
});

describe('product readiness: checkout is blocked for an assessment the system cannot deliver yet', () => {
  /** Whether a Published 'full' framework currently exists for this orgType -- queried live rather
   *  than assumed, because other test files (frameworks.test.ts's purpose-filter test, #133) publish
   *  a throwaway test framework for ESO as part of their own setup, in the one shared test database
   *  every file in a run uses. Asserting a fixed AgriFood360/ESO360 Draft state here would make this
   *  test's result depend on file execution order instead of on checkPlanReadiness's actual contract. */
  async function hasPublishedFullFramework(orgType: 'SME' | 'AGRIFOOD' | 'ESO') {
    const [row] = await db().select({ id: schema.frameworkVersions.id }).from(schema.frameworkVersions)
      .innerJoin(schema.frameworks, eq(schema.frameworks.id, schema.frameworkVersions.frameworkId))
      .where(and(eq(schema.frameworks.orgType, orgType), eq(schema.frameworks.purpose, 'full'), eq(schema.frameworkVersions.status, 'Published')))
      .limit(1);
    return !!row;
  }

  it('reflects live framework readiness at checkout for AgriFood360 and ESO360, whichever way it currently stands', async () => {
    const planId = await publishedPlan();
    for (const type of ['AGRIFOOD', 'ESO'] as const) {
      const { owner } = await ownerWithOrg(type);
      const r = await api(owner).post(`/plans/${planId}/purchase`, {});
      const ready = await hasPublishedFullFramework(type);
      expect(r.status).toBe(ready ? 200 : 422);
    }
  });

  it('refuses checkout when the plan is scoped to a platform other than the buying organisation\'s', async () => {
    const planId = await publishedPlan({ platforms: ['ESO'] });
    const { owner } = await ownerWithOrg('SME');
    const r = await api(owner).post(`/plans/${planId}/purchase`, {});
    expect(r.status).toBe(422);
  });

  it('allows checkout for a plan with no full_assessment entitlement regardless of platform readiness', async () => {
    const planId = await publishedPlan({ entitlements: [{ key: 'ai_assisted_report', enabled: true }] });
    const { owner } = await ownerWithOrg('ESO');
    const r = await api(owner).post(`/plans/${planId}/purchase`, {});
    expect(r.status).toBe(200);
  });
});

describe('reconciliation: fulfilment_reconciliation_scan heals a payment that settled but never unlocked', () => {
  /**
   * Builds the DB state settle() would have left behind had the process died (or the webhook never
   * arrived) after marking the invoice Paid but before reaching its own try/catch around
   * unlockAssessmentForPurchase (finance.ts) -- a Paid invoice, on a contract carrying a
   * full_assessment plan, with no case for the org. Constructed directly rather than through
   * payViaMock/settle(), which would unlock immediately and defeat the point of the test.
   */
  async function paidInvoiceWithNoCase(orgId: string, planId: string) {
    const [contract] = await db().insert(schema.contracts).values({ orgId, planId, status: 'Active', amountGhs: '500.00' }).returning({ id: schema.contracts.id });
    const [invoice] = await db().insert(schema.invoices).values({ contractId: contract.id, orgId, amountGhs: '500.00', status: 'Paid', dueDate: new Date().toISOString().slice(0, 10), paidAt: new Date() }).returning({ id: schema.invoices.id, code: schema.invoices.code });
    return invoice;
  }

  it('opens the case on the next scan, and never again once a human has reviewed the case', async () => {
    const planId = await publishedPlan();
    const { org, owner } = await ownerWithOrg('SME');
    const invoice = await paidInvoiceWithNoCase(org.id, planId);
    const before = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(before).toHaveLength(0);

    await db().insert(schema.jobs).values({ kind: 'fulfilment_reconciliation_scan' });
    await drain();

    const after = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe('PROFILED');
    const mine = await api(owner).get(`/cases/${after[0].id}`);
    expect(mine.status).toBe(200);

    // Idempotent: a second scan with the case already open must never open (or touch) a second one.
    await db().insert(schema.jobs).values({ kind: 'fulfilment_reconciliation_scan' });
    await drain();
    const stillOne = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(stillOne).toHaveLength(1);
    expect(stillOne[0].id).toBe(after[0].id);
    void invoice;
  });

  it('reflects live framework readiness for a platform other than SME360, without crashing the scan', async () => {
    // Live-checked rather than assumed, for the same reason as the checkout-readiness test above:
    // frameworks.test.ts's own purpose-filter test (#133) may have published a throwaway AGRIFOOD
    // framework in the one shared test database this run uses, depending on file execution order.
    const [row] = await db().select({ id: schema.frameworkVersions.id }).from(schema.frameworkVersions)
      .innerJoin(schema.frameworks, eq(schema.frameworks.id, schema.frameworkVersions.frameworkId))
      .where(and(eq(schema.frameworks.orgType, 'AGRIFOOD'), eq(schema.frameworks.purpose, 'full'), eq(schema.frameworkVersions.status, 'Published')))
      .limit(1);
    const ready = !!row;

    const planId = await publishedPlan();
    const { org } = await ownerWithOrg('AGRIFOOD');
    await paidInvoiceWithNoCase(org.id, planId);

    await db().insert(schema.jobs).values({ kind: 'fulfilment_reconciliation_scan' });
    await drain();

    const cases = await db().select().from(schema.cases).where(eq(schema.cases.orgId, org.id));
    expect(cases).toHaveLength(ready ? 1 : 0); // never silently substituted for SME360's bank either way
  });
});
