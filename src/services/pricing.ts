/**
 * Pricing management: the draft -> submit -> Finance approve -> publish workflow behind the
 * admin "Pricing & packages" console and the customer-facing One business / Programme cohort
 * flow. Exactly one pricing_configs row may ever be `isPublished` (enforced by a DB partial
 * unique index) - that row, and only that row, is what quoteOneBusiness/quoteProgramme and the
 * customer UI ever read. Everything else here is staff-only.
 *
 * Self-approval: the same person who submitted a draft may not approve it, even if their role
 * grants both `pricing:edit` and `pricing:approve` (ADMIN does). This is enforced here in code,
 * not left to the role matrix, because ADMIN legitimately needs both permissions for days when
 * no second admin is available to review someone else's draft - but never their own.
 */
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, need } from './common';
import { forbidden, notFound, unprocessable, fieldError } from '@/lib/errors';
import { ORG_TYPES, PROGRAMME_TOOL_SETUPS, type PricingConfigData } from '@/db/schema';

const pc = schema.pricingConfigs;

/** A brand-new configuration has no packages/rules/tax yet - editors build it up from here, or
 *  (more commonly) `cloneFromPublished` seeds a new draft from the live configuration. */
export function emptyPricingData(): PricingConfigData {
  return {
    platforms: { SME: { enabled: true }, AGRIFOOD: { enabled: true }, ESO: { enabled: true } },
    packages: [],
    programmeRules: PROGRAMME_TOOL_SETUPS.map((setup) => ({
      setup, discountPct: setup === 'samakose_only' ? 75 : setup === 'partner_only' ? 50 : 65,
      oneSamakosePlatformOnly: setup !== 'partner_only', partnerToolsNameRequired: setup !== 'samakose_only', customerFacingNote: null
    })),
    individualAssessments: [],
    tax: { mode: 'estimate', components: [], confirmedBy: null, confirmedAt: null }
  };
}

/** Validates one proposed configuration. Returns a field->message map (empty = valid). This is
 *  run both before a draft may be submitted and again, server-side, before it may be published -
 *  never trust that what was valid at submission time is still valid at approval time, since a
 *  rejected-then-reused draft can be edited in between. */
export function validatePricingData(data: PricingConfigData): Record<string, string> {
  const errs: Record<string, string> = {};
  const enabledPlatforms = ORG_TYPES.filter((p) => data.platforms[p]?.enabled);
  if (!data.packages.length) errs['packages'] = 'At least one package is required.';
  data.packages.forEach((pkg, i) => {
    if (!pkg.name?.trim()) errs[`packages.${i}.name`] = 'Package name is required.';
    for (const platform of enabledPlatforms) {
      const price = pkg.pricesGhs[platform];
      if (price === undefined || price === null) errs[`packages.${i}.price.${platform}`] = `${pkg.name || 'This package'} has no price for ${platform}.`;
      else if (!(price > 0)) errs[`packages.${i}.price.${platform}`] = `${pkg.name || 'This package'}'s ${platform} price must be a positive amount.`;
    }
  });
  data.programmeRules.forEach((r, i) => {
    if (!(r.discountPct >= 0 && r.discountPct <= 100)) errs[`programmeRules.${i}.discountPct`] = 'Discount must be between 0% and 100%.';
  });
  data.individualAssessments.forEach((a, i) => {
    if (a.enabled && !(Number(a.priceGhs) > 0)) errs[`individualAssessments.${i}.priceGhs`] = `${a.name || 'This assessment'} is enabled but has no valid price.`;
  });
  data.tax.components.forEach((c, i) => {
    if (!(c.pct >= 0 && c.pct <= 100)) errs[`tax.components.${i}.pct`] = `${c.name || 'This tax component'}'s rate must be between 0% and 100%.`;
  });
  if (data.tax.mode === 'confirmed' && !data.tax.confirmedBy) errs['tax.mode'] = 'Tax cannot be set to Confirmed without a recorded Finance confirmation.';
  return errs;
}

async function loadOr404(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(pc).where(eq(pc.id, id)).limit(1);
  if (!row) throw notFound('Pricing configuration not found');
  return row;
}

/** The single currently-live configuration, or null if nothing has ever been published (a fresh
 *  install). Used by both the customer flow and the admin "current published configuration" view. */
export async function getPublished(ctx: Ctx) {
  const [row] = await ctx.db.select().from(pc).where(eq(pc.isPublished, true)).limit(1);
  return row ?? null;
}

/** The editor's current working draft: the most recent row still in draft/rejected status. If
 *  none exists, seeds a new draft from the published configuration (or an empty one, if nothing
 *  has ever been published) so an editor always starts from "what's live today", not a blank page. */
export async function getOrCreateDraft(ctx: Ctx) {
  const u = need(ctx).user; allow(ctx, 'pricing', 'read');
  const [existing] = await ctx.db.select().from(pc).where(and(eq(pc.status, 'draft'))).orderBy(desc(pc.createdAt)).limit(1);
  if (existing) return existing;
  const published = await getPublished(ctx);
  const data = published ? (published.data as PricingConfigData) : emptyPricingData();
  allow(ctx, 'pricing', 'create');
  const [row] = await ctx.db.insert(pc).values({ data, createdBy: u.id, supersedes: published?.id ?? null }).returning();
  await audit(ctx, 'pricing.draft.created', 'pricing_config', row.id, undefined, { from: published ? 'published' : 'empty' });
  return row;
}

export async function updateDraft(ctx: Ctx, id: string, data: PricingConfigData) {
  allow(ctx, 'pricing', 'edit');
  const row = await loadOr404(ctx, id);
  if (row.status !== 'draft' && row.status !== 'rejected') throw unprocessable('Only a draft or rejected configuration can be edited.');
  const [updated] = await ctx.db.update(pc).set({ data, status: 'draft', rejectionReason: null, updatedAt: new Date() }).where(eq(pc.id, id)).returning();
  await audit(ctx, 'pricing.draft.updated', 'pricing_config', id, row.data, data);
  return updated;
}

export async function submitDraft(ctx: Ctx, id: string) {
  const u = need(ctx).user; allow(ctx, 'pricing', 'edit');
  const row = await loadOr404(ctx, id);
  if (row.status !== 'draft' && row.status !== 'rejected') throw unprocessable('Only a draft or rejected configuration can be submitted.');
  const errs = validatePricingData(row.data as PricingConfigData);
  if (Object.keys(errs).length) throw fieldError(errs);
  const [updated] = await ctx.db.update(pc).set({ status: 'pending_approval', submittedBy: u.id, submittedAt: new Date(), updatedAt: new Date() }).where(eq(pc.id, id)).returning();
  await audit(ctx, 'pricing.draft.submitted', 'pricing_config', id, { status: row.status }, { status: 'pending_approval' });
  return updated;
}

export async function decideDraft(ctx: Ctx, id: string, decision: 'approved' | 'rejected', reason?: string) {
  const u = need(ctx).user; allow(ctx, 'pricing', 'approve');
  const row = await loadOr404(ctx, id);
  if (row.status !== 'pending_approval') throw unprocessable('Only a submission pending approval can be decided.');
  if (row.submittedBy && row.submittedBy === u.id) throw forbidden('You cannot approve or reject your own pricing submission. Ask another authorised approver to review it.');
  if (decision === 'rejected' && !reason?.trim()) throw fieldError({ reason: 'A reason is required when rejecting a pricing submission.' });
  const [updated] = await ctx.db.update(pc).set({ status: decision, decidedBy: u.id, decidedAt: new Date(), rejectionReason: decision === 'rejected' ? reason!.trim() : null, updatedAt: new Date() }).where(eq(pc.id, id)).returning();
  await audit(ctx, decision === 'approved' ? 'pricing.draft.approved' : 'pricing.draft.rejected', 'pricing_config', id, { status: 'pending_approval' }, { status: decision, reason });
  return updated;
}

/** Makes an approved configuration the one live, customer-facing configuration. Re-validates
 *  (the same rule publish() relies on for every other state-changing call here: never trust that
 *  "valid when approved" still holds) and atomically supersedes whatever was published before. */
export async function publishConfig(ctx: Ctx, id: string) {
  const u = need(ctx).user; allow(ctx, 'pricing', 'approve');
  const row = await loadOr404(ctx, id);
  if (row.status !== 'approved') throw unprocessable('Only an approved configuration can be published.');
  const errs = validatePricingData(row.data as PricingConfigData);
  if (Object.keys(errs).length) throw fieldError(errs);
  return ctx.db.transaction(async (tx) => {
    const txCtx = { ...ctx, db: tx } as Ctx;
    const [previous] = await tx.select().from(pc).where(eq(pc.isPublished, true)).limit(1);
    if (previous) {
      await tx.update(pc).set({ isPublished: false, status: 'superseded', updatedAt: new Date() }).where(eq(pc.id, previous.id));
      await audit(txCtx, 'pricing.config.superseded', 'pricing_config', previous.id, { isPublished: true }, { isPublished: false });
    }
    const [updated] = await tx.update(pc).set({ isPublished: true, status: 'published', publishedAt: new Date(), updatedAt: new Date() }).where(eq(pc.id, id)).returning();
    await audit(txCtx, 'pricing.config.published', 'pricing_config', id, { isPublished: false }, { isPublished: true, publishedBy: u.id });
    return updated;
  });
}

export async function listConfigs(ctx: Ctx) {
  allow(ctx, 'pricing', 'read');
  return ctx.db.select().from(pc).orderBy(desc(pc.createdAt));
}

/* ------------------------------ server-side quoting ------------------------------ */
/** Server-side authoritative price for a one-business purchase. Never computed client-side for
 *  anything that will reach a payment request - the client preview mirrors this logic for instant
 *  feedback, but the actual amount charged must always come from here. */
export function quoteOneBusiness(data: PricingConfigData, platform: (typeof ORG_TYPES)[number], packageKey: string) {
  if (!data.platforms[platform]?.enabled) throw unprocessable(`${platform} is not currently available for purchase.`);
  const pkg = data.packages.find((p) => p.key === packageKey);
  if (!pkg) throw notFound('Package not found');
  const priceGhs = pkg.pricesGhs[platform];
  if (priceGhs === undefined || priceGhs === null) throw unprocessable(`${pkg.name} is not priced for ${platform} yet.`);
  const tax = applyTax(data, priceGhs);
  return { package: pkg.name, durationLabel: pkg.durationLabel, platform, subtotalGhs: priceGhs, ...tax };
}

/** Server-side authoritative price for a programme cohort, implementing:
 *    cohort subtotal = participant count x package price x (1 - discount rate)
 *  Duration is never multiplied in - it's already fully reflected in the package's own price. */
export function quoteProgramme(data: PricingConfigData, opts: { toolSetup: (typeof PROGRAMME_TOOL_SETUPS)[number]; platform?: (typeof ORG_TYPES)[number]; packageKey: string; participantCount: number }) {
  const rule = data.programmeRules.find((r) => r.setup === opts.toolSetup);
  if (!rule) throw notFound('Programme tool setup not found');
  if (rule.oneSamakosePlatformOnly) {
    if (!opts.platform) throw fieldError({ platform: 'Select one Samakose platform for this programme.' });
    if (!data.platforms[opts.platform]?.enabled) throw unprocessable(`${opts.platform} is not currently available.`);
  }
  if (!Number.isInteger(opts.participantCount) || opts.participantCount < 1) throw fieldError({ participantCount: 'Enter a whole number of participating businesses (at least 1).' });
  const pkg = data.packages.find((p) => p.key === opts.packageKey);
  if (!pkg) throw notFound('Package not found');
  const refPlatform = opts.platform ?? ORG_TYPES.find((p) => pkg.pricesGhs[p] !== undefined);
  const listPrice = refPlatform ? pkg.pricesGhs[refPlatform] : undefined;
  if (listPrice === undefined || listPrice === null) throw unprocessable(`${pkg.name} has no list price to discount from.`);
  const listSubtotal = opts.participantCount * listPrice;
  const discountAmount = listSubtotal * (rule.discountPct / 100);
  const discountedSubtotal = listSubtotal - discountAmount;
  const tax = applyTax(data, discountedSubtotal);
  return {
    toolSetup: opts.toolSetup, platform: opts.platform ?? null, package: pkg.name, durationLabel: pkg.durationLabel,
    participantCount: opts.participantCount, listPriceGhs: listPrice, listSubtotalGhs: round2(listSubtotal),
    discountPct: rule.discountPct, discountAmountGhs: round2(discountAmount), subtotalGhs: round2(discountedSubtotal), ...tax
  };
}

function applyTax(data: PricingConfigData, subtotalGhs: number) {
  if (data.tax.mode === 'hidden') return { taxMode: 'hidden' as const, taxLines: [], taxGhs: 0, totalGhs: round2(subtotalGhs), estimate: true };
  const taxLines = data.tax.components.map((c) => ({ name: c.name, pct: c.pct, amountGhs: round2(subtotalGhs * (c.pct / 100)) }));
  const taxGhs = round2(taxLines.reduce((s, l) => s + l.amountGhs, 0));
  return { taxMode: data.tax.mode, taxLines, taxGhs, totalGhs: round2(subtotalGhs + taxGhs), estimate: data.tax.mode !== 'confirmed' };
}
function round2(n: number) { return Math.round(n * 100) / 100; }
