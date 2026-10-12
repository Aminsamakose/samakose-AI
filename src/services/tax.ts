/**
 * Tax / VAT / Withholding (Master Directive §46, rollout step 6). Replaces the single flat org-wide
 * rate the audit found in billing.ts with versioned, jurisdiction-aware rules: tax_rules supports
 * multiple concurrent rules by type and jurisdiction, each with a ruleVersion and an effective-date
 * range; tax_lines records what was actually charged against an invoice or payout, with the rule
 * version it used, so a later rate change never rewrites history.
 *
 * Scoping note (matching the design doc's own honesty about MVP scope): this is "configurable, not
 * hardcoded, with full traceability", not a multi-jurisdiction tax-residency engine. One rule is
 * resolved per (type, jurisdiction) as of a date; there is no apportionment across jurisdictions for
 * a single transaction.
 */
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, need, today } from './common';
import { fieldError, notFound, unprocessable } from '@/lib/errors';
import { postLedgerEntries } from './ledger';

const tr = schema.taxRules, tl = schema.taxLines, inv = schema.invoices, pyo = schema.professionalPayouts;
const dec = (n: number) => n.toFixed(2);

export const TAX_RULE_TYPES = ['VAT', 'WITHHOLDING', 'OTHER'] as const;
export type TaxRuleType = (typeof TAX_RULE_TYPES)[number];

export async function listTaxRules(ctx: Ctx) {
  allow(ctx, 'tax_rules', 'read');
  return ctx.db.select().from(tr).orderBy(tr.type, tr.jurisdiction, desc(tr.ruleVersion));
}

/** Opens a new versioned rule for this (type, jurisdiction). Does not close out the prior version -
 *  an effectiveTo on the old rule, if any, is the admin's own choice, made explicitly via updateTaxRule. */
export async function createTaxRule(ctx: Ctx, b: { type: TaxRuleType; rate: number; jurisdiction: string; inclusiveOfPrice?: boolean; effectiveFrom: string; effectiveTo?: string | null }) {
  allow(ctx, 'tax_rules', 'create');
  if (!TAX_RULE_TYPES.includes(b.type)) throw fieldError({ type: 'Must be VAT, WITHHOLDING or OTHER' });
  if (!(b.rate >= 0 && b.rate <= 100)) throw fieldError({ rate: 'Must be between 0 and 100' });
  if (!b.jurisdiction.trim()) throw fieldError({ jurisdiction: 'Required' });
  const [prior] = await ctx.db.select({ v: tr.ruleVersion }).from(tr).where(and(eq(tr.type, b.type), eq(tr.jurisdiction, b.jurisdiction))).orderBy(desc(tr.ruleVersion)).limit(1);
  const [row] = await ctx.db.insert(tr).values({
    type: b.type, rate: dec(b.rate), jurisdiction: b.jurisdiction.trim(), inclusiveOfPrice: !!b.inclusiveOfPrice,
    ruleVersion: (prior?.v ?? 0) + 1, effectiveFrom: b.effectiveFrom, effectiveTo: b.effectiveTo ?? null
  }).returning();
  await audit(ctx, 'tax_rule.created', 'tax_rules', row.id, undefined, row);
  return row;
}

/** Closes a rule's effective range (e.g. to retire it ahead of a new version). Never edits rate/type/jurisdiction -
 *  a rate change is always a new rule version, so every tax_line keeps pointing at the exact rule it used. */
export async function closeTaxRule(ctx: Ctx, id: string, effectiveTo: string) {
  allow(ctx, 'tax_rules', 'edit');
  const [row] = await ctx.db.select().from(tr).where(eq(tr.id, id)).limit(1);
  if (!row) throw notFound('Tax rule not found');
  const [updated] = await ctx.db.update(tr).set({ effectiveTo }).where(eq(tr.id, id)).returning();
  await audit(ctx, 'tax_rule.closed', 'tax_rules', id, row, updated);
  return updated;
}

/** The rule in force for (type, jurisdiction) on a given date: effectiveFrom <= date and (no effectiveTo, or
 *  effectiveTo >= date). When more than one such rule exists (shouldn't, but data can be messy), the highest
 *  ruleVersion wins. */
async function activeTaxRule(ctx: Ctx, type: TaxRuleType, jurisdiction: string, asOf: string) {
  const [row] = await ctx.db.select().from(tr)
    .where(and(eq(tr.type, type), eq(tr.jurisdiction, jurisdiction), lte(tr.effectiveFrom, asOf), or(isNull(tr.effectiveTo), gte(tr.effectiveTo, asOf))))
    .orderBy(desc(tr.ruleVersion)).limit(1);
  return row ?? null;
}

/** Pure computation, kept separate from the rule lookup so it's directly unit-testable. When inclusiveOfPrice,
 *  baseAmountGhs is treated as already including this tax and the tax is extracted from it; otherwise the tax
 *  is added on top of baseAmountGhs. */
export function computeTaxAmount(baseAmountGhs: number, ratePct: number, inclusiveOfPrice: boolean): number {
  const amount = inclusiveOfPrice ? baseAmountGhs * (ratePct / (100 + ratePct)) : baseAmountGhs * (ratePct / 100);
  return Math.round(amount * 100) / 100;
}

/**
 * Computes and records a tax_lines row for one invoice or payout against the (type, jurisdiction) rule
 * in force today, and posts the balanced ledger entry (debit Samakose Revenue, credit Tax Payable per
 * the design doc's ledger table). Returns null, posting nothing, when no rule is configured for this
 * (type, jurisdiction) - an unconfigured jurisdiction is "no tax applied", not an error, since not every
 * jurisdiction Samakose operates in necessarily has a rule yet.
 */
export async function applyTax(ctx: Ctx, args: { invoiceId?: string; payoutId?: string; type: TaxRuleType; jurisdiction: string; baseAmountGhs: number }) {
  if ((args.invoiceId ? 1 : 0) + (args.payoutId ? 1 : 0) !== 1) throw fieldError({ invoiceId: 'Specify exactly one of invoiceId or payoutId' });
  if (args.invoiceId) { const [i] = await ctx.db.select({ id: inv.id }).from(inv).where(eq(inv.id, args.invoiceId)).limit(1); if (!i) throw notFound('Invoice not found'); }
  if (args.payoutId) { const [p] = await ctx.db.select({ id: pyo.id }).from(pyo).where(eq(pyo.id, args.payoutId)).limit(1); if (!p) throw notFound('Payout not found'); }
  const rule = await activeTaxRule(ctx, args.type, args.jurisdiction, today());
  if (!rule) return null;
  const amountGhs = computeTaxAmount(args.baseAmountGhs, Number(rule.rate), rule.inclusiveOfPrice);
  const [line] = await ctx.db.insert(tl).values({
    invoiceId: args.invoiceId ?? null, payoutId: args.payoutId ?? null, taxRuleId: rule.id,
    baseAmountGhs: dec(args.baseAmountGhs), amountGhs: dec(amountGhs), ruleVersion: rule.ruleVersion
  }).returning();
  if (amountGhs > 0) {
    await postLedgerEntries(ctx, {
      referenceType: args.invoiceId ? 'INVOICE' : 'PAYOUT', referenceId: (args.invoiceId ?? args.payoutId) as string,
      description: `${rule.type} ${rule.rate}% (v${rule.ruleVersion}, ${rule.jurisdiction})`,
      lines: [{ accountCode: 'REVENUE', debitGhs: amountGhs }, { accountCode: 'TAX_PAYABLE', creditGhs: amountGhs }]
    });
  }
  await audit(ctx, 'tax_line.applied', 'tax_lines', line.id, undefined, line);
  return line;
}
