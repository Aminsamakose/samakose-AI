/**
 * Self-serve plan purchase: lets a signed-in business owner buy a published, fixed-price,
 * price-confirmed plan for their own organisation, without needing Finance/Admin to create the
 * contract and invoice by hand first. Contract and invoice creation are normally gated to staff
 * (see finance.ts's `allow(ctx, 'contracts'|'invoices', 'create')`) because they are usually built
 * up manually from negotiated terms. A self-serve purchase is the one case where the "negotiation"
 * is just "the published price, right now", so this inserts the contract/invoice rows directly
 * (mirroring what finance.ts's createContract/createInvoice/updateInvoice(status: 'Sent') do,
 * ledger postings included) rather than trying to grant the owner broader staff permissions.
 * Once a Sent invoice exists, payment itself goes through the real, already-audited Paystack
 * pipeline in finance.ts (startPayment) exactly as any staff-invoiced payment would - owners
 * already hold `payments: [create]`, so nothing new is needed there.
 *
 * Product readiness (master-prompt Phase 3): a customer must not be charged for an assessment the
 * system cannot deliver. Before this file's checkPlanReadiness existed, nothing here checked that
 * (a) the plan is actually sold to this organisation's platform, or (b) when the plan grants
 * full_assessment, that platform's paid framework has a Published version to score the diagnostic
 * against. AgriFood360 and ESO360's paid frameworks can sit as Draft for a long time pending Amin's
 * own review (see frameworks.ts's resolveVersion, which now refuses to silently substitute SME360's
 * bank for them); without this gate, an AgriFood or ESO owner could pay in full for an assessment
 * that would then be undeliverable, or impossible to score correctly, the moment they tried to take it.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { forbidden, notFound, unprocessable } from '@/lib/errors';
import { need, today } from './common';
import { postLedgerEntries } from './ledger';
import { startPayment } from './finance';
import { resolveVersion } from './frameworks';

const pl = schema.plans, con = schema.contracts, inv = schema.invoices, o = schema.organisations;
const dec = (n: number) => n.toFixed(2);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/**
 * Blocks checkout (rather than charging for something undeliverable) when the plan is not sold to
 * this organisation's platform, or when it grants full_assessment but that platform has no Published
 * framework to score it against yet. Read-only: raises unprocessable() rather than returning a
 * boolean, since every caller's correct response to a readiness failure is the same -- stop and
 * explain, never silently proceed.
 */
async function checkPlanReadiness(ctx: Ctx, plan: typeof schema.plans.$inferSelect, orgType: string) {
  const platforms = (plan.platforms ?? []) as string[];
  if (platforms.length && !platforms.includes(orgType)) throw unprocessable('This plan is not offered for your kind of organisation.');
  const entitlements = (plan.entitlements ?? []) as { key: string; enabled: boolean }[];
  if (entitlements.some((e) => e.key === 'full_assessment' && e.enabled)) {
    try { await resolveVersion(ctx.db, orgType); }
    catch { throw unprocessable('This plan\'s full assessment is not available for your kind of organisation yet. Please check back soon or send an enquiry.'); }
  }
}

/** Finds (or creates) the Draft contract this purchase belongs to, and the Sent invoice for its
 *  full amount, then hands off to the ordinary payment pipeline. Idempotent: calling it twice for
 *  the same org+plan reuses the existing unpaid contract/invoice rather than creating duplicates,
 *  so retrying a failed or abandoned checkout doesn't pile up billing records. */
export async function startPlanPurchase(ctx: Ctx, planId: string) {
  const u = need(ctx).user;
  if (u.role !== 'OWNER' || !u.orgId) throw forbidden('Only a business owner purchasing for their own organisation can buy a plan online');

  const [p] = await ctx.db.select().from(pl).where(eq(pl.id, planId)).limit(1);
  if (!p || p.publicationStatus !== 'published') throw notFound('Plan not found');
  if (p.pricingModel !== 'fixed' || !p.priceConfirmed) throw unprocessable('This plan is not yet available for online purchase. Send an enquiry instead.');

  const [org] = await ctx.db.select({ type: o.type }).from(o).where(eq(o.id, u.orgId)).limit(1);
  if (!org) throw notFound('Organisation not found');
  await checkPlanReadiness(ctx, p, org.type);

  // Advisory lock on (orgId, planId) so two concurrent checkouts (a double-click, or a client retry
  // after a slow response) cannot both pass the "no existing Draft contract" check below before
  // either has inserted its row. Without this, each would create its own contract + Sent invoice and
  // post its own ledger entries - double revenue booking for a single purchase. See discounts.ts's
  // applyPromoCode() for the same pattern against the same class of race.
  await ctx.db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${u.orgId} || ':' || ${planId}, 0))`);

  let [c] = await ctx.db.select().from(con).where(and(eq(con.orgId, u.orgId), eq(con.planId, planId), eq(con.status, 'Draft'))).limit(1);
  if (!c) {
    const start = today();
    const end = p.durationDays ? addDays(start, p.durationDays) : null;
    [c] = await ctx.db.insert(con).values({ orgId: u.orgId, planId, startDate: start, endDate: end, amountGhs: p.priceGhs }).returning();
    await audit(ctx, 'contract.created', 'contract', c.id, undefined, { planId, self_serve: true });
  }

  let [i] = await ctx.db.select().from(inv).where(and(eq(inv.contractId, c.id), inArray(inv.status, ['Draft', 'Sent', 'Overdue']))).limit(1);
  if (!i) {
    const [row] = await ctx.db.insert(inv).values({ orgId: u.orgId, contractId: c.id, amountGhs: c.amountGhs, dueDate: addDays(today(), 7) }).returning();
    await ctx.db.update(inv).set({ status: 'Sent', issuedAt: new Date(), updatedAt: new Date() }).where(eq(inv.id, row.id));
    i = { ...row, status: 'Sent' };
    await audit(ctx, 'invoice.created', 'invoice', i.id, undefined, { contractId: c.id, amountGhs: c.amountGhs, self_serve: true });
    await audit(ctx, 'invoice.sent', 'invoice', i.id, { status: 'Draft' }, { status: 'Sent' });
    await postLedgerEntries(ctx, { referenceType: 'INVOICE', referenceId: i.id, description: `Invoice ${i.code} issued (self-serve: ${p.name})`,
      lines: [{ accountCode: 'RECEIVABLE', debitGhs: Number(i.amountGhs) }, { accountCode: 'REVENUE', creditGhs: Number(i.amountGhs) }] });
  }

  return startPayment(ctx, i.id);
}
