/**
 * Discounts & promo codes (Master Directive §43-45). Rollout step 3: price reductions, applied through a
 * redeemable code, to a Draft invoice only - before anything is posted to the ledger. A discount rule must
 * be approved by someone other than its creator (four-eyes) before any campaign built on it can be used;
 * nothing here enforces that at the database level the way migration 0051 does for approval_decisions, so
 * the check lives in approveDiscountRule() itself and must stay there.
 */
import { eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, need } from './common';
import { conflict, fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { randomToken } from '@/lib/crypto';
import { countOf } from '@/api/list';
import { today } from './common';

const dr = schema.discountRules, pcamp = schema.promoCampaigns, pcode = schema.promoCodes, pred = schema.promoRedemptions, inv = schema.invoices;
const dec = (n: number) => n.toFixed(2);
const DISCOUNT_KINDS = ['PERCENTAGE', 'FIXED', 'PROMOTIONAL_PRICE'] as const;

/* --------------------------- discount rules --------------------------- */
export async function listDiscountRules(ctx: Ctx) {
  allow(ctx, 'discounts', 'read');
  return ctx.db.select().from(dr).orderBy(dr.createdAt);
}
export async function createDiscountRule(ctx: Ctx, b: { kind: string; value: number; conditions?: Record<string, unknown> | null }) {
  allow(ctx, 'discounts', 'create');
  const u = need(ctx).user;
  if (!DISCOUNT_KINDS.includes(b.kind as any)) throw fieldError({ kind: 'Must be PERCENTAGE, FIXED or PROMOTIONAL_PRICE' });
  if (!(b.value > 0)) throw fieldError({ value: 'Must be a positive amount' });
  if (b.kind === 'PERCENTAGE' && b.value > 100) throw fieldError({ value: 'A percentage discount cannot exceed 100' });
  const [row] = await ctx.db.insert(dr).values({ kind: b.kind, value: dec(b.value), conditions: (b.conditions ?? null) as any, createdBy: u.id }).returning();
  await audit(ctx, 'discount_rule.created', 'discount_rule', row.id, undefined, b);
  return row;
}
/** Four-eyes: whoever created the rule may not be the one who approves it. Unapproved rules can never be redeemed. */
export async function approveDiscountRule(ctx: Ctx, id: string) {
  allow(ctx, 'discounts', 'approve');
  const u = need(ctx).user;
  const [before] = await ctx.db.select().from(dr).where(eq(dr.id, id)).limit(1);
  if (!before) throw notFound('Discount rule not found');
  if (before.approvedBy) throw conflict('This discount rule is already approved');
  if (before.createdBy === u.id) throw forbidden('The person who created a discount rule cannot approve it');
  await ctx.db.update(dr).set({ approvedBy: u.id, updatedAt: new Date() }).where(eq(dr.id, id));
  await audit(ctx, 'discount_rule.approved', 'discount_rule', id, { approvedBy: null }, { approvedBy: u.id });
  return { ok: true };
}

/* ----------------------------- campaigns ------------------------------- */
export async function createPromoCampaign(ctx: Ctx, b: { name: string; discountRuleId: string; startDate?: string | null; endDate?: string | null }) {
  allow(ctx, 'discounts', 'create');
  const [rule] = await ctx.db.select().from(dr).where(eq(dr.id, b.discountRuleId)).limit(1);
  if (!rule) throw fieldError({ discountRuleId: 'Discount rule not found' });
  if (b.startDate && b.endDate && b.endDate < b.startDate) throw fieldError({ endDate: 'End date must be after the start date' });
  const [row] = await ctx.db.insert(pcamp).values({ name: b.name.trim(), discountRuleId: b.discountRuleId, startDate: b.startDate ?? null, endDate: b.endDate ?? null }).returning();
  await audit(ctx, 'promo_campaign.created', 'promo_campaign', row.id, undefined, b);
  return row;
}

/* ------------------------------- codes --------------------------------- */
/** The code itself is always generated here, never taken from the caller - it must stay unguessable. */
export async function createPromoCode(ctx: Ctx, b: { campaignId: string; prefix?: string; maxRedemptions?: number | null; perCustomerLimit?: number | null; minPurchaseGhs?: number | null; maxDiscountGhs?: number | null; expiresAt?: string | null }) {
  allow(ctx, 'discounts', 'create');
  const [camp] = await ctx.db.select().from(pcamp).where(eq(pcamp.id, b.campaignId)).limit(1);
  if (!camp) throw fieldError({ campaignId: 'Campaign not found' });
  const prefix = (b.prefix ?? 'PROMO').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'PROMO';
  const code = `${prefix}-${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
  const [row] = await ctx.db.insert(pcode).values({
    campaignId: b.campaignId, code,
    maxRedemptions: b.maxRedemptions ?? null, perCustomerLimit: b.perCustomerLimit ?? 1,
    minPurchaseGhs: b.minPurchaseGhs != null ? dec(b.minPurchaseGhs) : null, maxDiscountGhs: b.maxDiscountGhs != null ? dec(b.maxDiscountGhs) : null,
    expiresAt: b.expiresAt ? new Date(b.expiresAt) : null
  }).returning();
  await audit(ctx, 'promo_code.created', 'promo_code', row.id, undefined, { campaignId: b.campaignId, code });
  return row;
}

/**
 * Redeems a promo code against a Draft invoice, lowering its amount before it is ever Sent (and so before
 * anything is posted to the ledger). customerId must be the OWNER of the invoice's organisation - the
 * redemption is recorded against them, and the (promoCodeId, customerId) unique index (migration 0051) is
 * what actually stops a double redemption under concurrent requests.
 */
export async function applyPromoCode(ctx: Ctx, invoiceId: string, b: { code: string; customerId: string }) {
  allow(ctx, 'invoices', 'edit');
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, invoiceId)).for('update').limit(1);
  if (!i) throw notFound('Invoice not found');
  if (i.status !== 'Draft') throw unprocessable('A promo code can only be applied while the invoice is a draft');
  const [cust] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, b.customerId)).limit(1);
  if (!cust || cust.orgId !== i.orgId || cust.role !== 'OWNER') throw fieldError({ customerId: "Must be the owner of the invoice's organisation" });

  const [pc] = await ctx.db.select().from(pcode).where(eq(pcode.code, b.code.trim().toUpperCase())).limit(1);
  if (!pc || !pc.active) throw fieldError({ code: 'This promo code is invalid or inactive' });
  if (pc.expiresAt && pc.expiresAt.getTime() < Date.now()) throw fieldError({ code: 'This promo code has expired' });
  const [camp] = await ctx.db.select().from(pcamp).where(eq(pcamp.id, pc.campaignId)).limit(1);
  if (!camp || !camp.active) throw fieldError({ code: 'This campaign is not active' });
  const d = today();
  if (camp.startDate && d < camp.startDate) throw fieldError({ code: 'This campaign has not started yet' });
  if (camp.endDate && d > camp.endDate) throw fieldError({ code: 'This campaign has ended' });
  const [rule] = await ctx.db.select().from(dr).where(eq(dr.id, camp.discountRuleId)).limit(1);
  if (!rule || !rule.active || !rule.approvedBy) throw fieldError({ code: 'This discount has not been approved and cannot be used yet' });

  if (pc.maxRedemptions != null) {
    const [{ n }] = await ctx.db.select({ n: countOf }).from(pred).where(eq(pred.promoCodeId, pc.id));
    if (Number(n) >= pc.maxRedemptions) throw conflict('This promo code has reached its redemption limit');
  }
  const amount = Number(i.amountGhs);
  if (pc.minPurchaseGhs != null && amount < Number(pc.minPurchaseGhs)) throw fieldError({ code: `This code requires a minimum purchase of GHS ${pc.minPurchaseGhs}` });

  let discount = rule.kind === 'PERCENTAGE' ? (amount * Number(rule.value)) / 100
    : rule.kind === 'FIXED' ? Number(rule.value)
    : Math.max(0, amount - Number(rule.value)); // PROMOTIONAL_PRICE: value is the new total
  if (pc.maxDiscountGhs != null) discount = Math.min(discount, Number(pc.maxDiscountGhs));
  discount = Math.min(discount, amount);
  if (discount <= 0) throw unprocessable('This code does not reduce the amount on this invoice');
  const newAmount = amount - discount;

  try {
    await ctx.db.insert(pred).values({ promoCodeId: pc.id, invoiceId: i.id, customerId: b.customerId, discountAppliedGhs: dec(discount) });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('This customer has already used this promo code');
    throw e;
  }
  await ctx.db.update(inv).set({ amountGhs: dec(newAmount), updatedAt: new Date() }).where(eq(inv.id, i.id));
  await audit(ctx, 'invoice.promo_applied', 'invoice', i.id, { amountGhs: i.amountGhs }, { code: pc.code, discountGhs: dec(discount), amountGhs: dec(newAmount) });
  return { ok: true, discountGhs: dec(discount), amountGhs: dec(newAmount) };
}
