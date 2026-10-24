/**
 * Professional tax identity (Payouts & Compliance design, Component 2). Separate from tax.ts (the
 * rates applied to a transaction) and from practitioner_profiles (vetting/skills): this module owns
 * *whose* identifier a payout and any GRA return must carry, and whether that identifier has been
 * verified by someone other than the professional themselves.
 *
 * The one thing the rest of the payout lifecycle actually needs from here is isPayoutEligible() -
 * revenue-share.ts's markPayable() calls it so that a payout cannot reach Payable for a professional
 * whose tax identity is missing or unverified, closing the gap the design review flagged: nothing
 * previously blocked a payout for missing tax information at all.
 */
import { eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, need } from './common';
import { fieldError, forbidden, notFound } from '@/lib/errors';

const tp = schema.taxProfiles;

export const TAX_PROFILE_PARTY_TYPES = ['INDIVIDUAL', 'SOLE_PROPRIETOR', 'ORGANISATION'] as const;
export type TaxPartyType = (typeof TAX_PROFILE_PARTY_TYPES)[number];

type SubmitInput = { partyType: TaxPartyType; legalName: string; taxIdentifier: string; taxResidency?: string | null };

/** A professional submits (or corrects) their own tax identity. Re-submitting always resets status to
 *  Submitted and clears any prior verification -- a previously Verified identity never stays verified
 *  against new, unverified information, even when only one field changed. */
export async function submitMyTaxProfile(ctx: Ctx, b: SubmitInput) {
  allow(ctx, 'tax_profiles', 'create');
  const u = need(ctx).user;
  if (!TAX_PROFILE_PARTY_TYPES.includes(b.partyType)) throw fieldError({ partyType: 'Must be INDIVIDUAL, SOLE_PROPRIETOR or ORGANISATION' });
  if (!b.legalName.trim()) throw fieldError({ legalName: 'Required' });
  if (!b.taxIdentifier.trim()) throw fieldError({ taxIdentifier: 'Required' });
  const [existing] = await ctx.db.select({ userId: tp.userId }).from(tp).where(eq(tp.userId, u.id)).limit(1);
  const now = new Date();
  const values = {
    userId: u.id, partyType: b.partyType, legalName: b.legalName.trim(), taxIdentifier: b.taxIdentifier.trim(),
    taxResidency: b.taxResidency?.trim() || 'GH', status: 'Submitted' as const, submittedAt: now,
    verifiedBy: null, verifiedAt: null, verificationNote: null, updatedAt: now
  };
  const before = existing ? { status: 'resubmitted' } : undefined;
  const [row] = existing
    ? await ctx.db.update(tp).set(values).where(eq(tp.userId, u.id)).returning()
    : await ctx.db.insert(tp).values(values).returning();
  await audit(ctx, existing ? 'tax_profile.resubmitted' : 'tax_profile.submitted', 'tax_profiles', u.id, before, { partyType: b.partyType, taxResidency: values.taxResidency });
  return row;
}

export async function getMyTaxProfile(ctx: Ctx) {
  allow(ctx, 'tax_profiles', 'read');
  const u = need(ctx).user;
  const [row] = await ctx.db.select().from(tp).where(eq(tp.userId, u.id)).limit(1);
  return row ?? null;
}

/** Finance/admin queue, optionally filtered by status (e.g. the Submitted ones awaiting verification). */
export async function listTaxProfiles(ctx: Ctx, status?: string) {
  allow(ctx, 'tax_profiles', 'read');
  return ctx.db.select().from(tp).where(status ? eq(tp.status, status) : undefined).orderBy(tp.submittedAt);
}

async function loadProfile(ctx: Ctx, userId: string) {
  const [row] = await ctx.db.select().from(tp).where(eq(tp.userId, userId)).limit(1);
  if (!row) throw notFound('Tax profile not found');
  return row;
}

/** A person never verifies their own tax identity -- mirrors the review/approve separation already
 *  enforced on payouts and revenue-share agreements elsewhere in this file's sibling services. */
export async function verifyTaxProfile(ctx: Ctx, userId: string, b: { decision: 'Verified' | 'Rejected'; note?: string | null }) {
  allow(ctx, 'tax_profiles', 'verify');
  const u = need(ctx).user;
  if (userId === u.id) throw forbidden('You cannot verify your own tax profile');
  const row = await loadProfile(ctx, userId);
  const [updated] = await ctx.db.update(tp).set({
    status: b.decision, verifiedBy: u.id, verifiedAt: new Date(), verificationNote: b.note?.trim() || null, updatedAt: new Date()
  }).where(eq(tp.userId, userId)).returning();
  await audit(ctx, b.decision === 'Verified' ? 'tax_profile.verified' : 'tax_profile.rejected', 'tax_profiles', userId, { status: row.status }, { status: b.decision, verifiedBy: u.id });
  return updated;
}

/** The one check the rest of the payout lifecycle needs: can this professional actually be paid?
 *  No profile at all, or one that is Submitted/Rejected rather than Verified, is not eligible. */
export async function isPayoutEligible(ctx: Ctx, professionalId: string): Promise<boolean> {
  const [row] = await ctx.db.select({ status: tp.status }).from(tp).where(eq(tp.userId, professionalId)).limit(1);
  return row?.status === 'Verified';
}
