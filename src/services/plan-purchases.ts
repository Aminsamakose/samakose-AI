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
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { forbidden, notFound, unprocessable } from '@/lib/errors';
import { need, today } from './common';
import { postLedgerEntries } from './ledger';
import { startPayment } from './finance';

const pl = schema.plans, con = schema.contracts, inv = schema.invoices;
const dec = (n: number) => n.toFixed(2);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

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
