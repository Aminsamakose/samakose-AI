/**
 * Business Doctor Resource Library: entitlements. A row here is what lets a signed-in user read a
 * premium (priced) resource's body and file. A free resource needs no row - everyone may read it.
 * Phase 1 (this file) provides the grant/check/list primitives and the administrator override path.
 * Phase 4 of the approved roadmap wires grantEntitlement() into finance.ts's Paystack webhook and
 * mock-payment completion, so a confirmed purchase grants access automatically; nothing here calls
 * into payments yet, and no payment code is touched by this file.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, notFound } from '@/lib/errors';
import { allow, need } from './common';

const e = schema.resourceEntitlements, r = schema.libraryResources;

/** Does this user currently hold a live (not revoked) entitlement to this resource? Free resources never need one. */
export async function hasEntitlement(ctx: Ctx, userId: string, resourceId: string) {
  const [resource] = await ctx.db.select({ priceGhs: r.priceGhs }).from(r).where(eq(r.id, resourceId)).limit(1);
  if (!resource) throw notFound('Resource not found');
  if (resource.priceGhs === null) return true;
  const [row] = await ctx.db.select({ id: e.id }).from(e).where(and(eq(e.userId, userId), eq(e.resourceId, resourceId), isNull(e.revokedAt))).limit(1);
  return !!row;
}

/** The signed-in user's own check: used to gate reading a priced resource's body and file. */
export async function canRead(ctx: Ctx, resourceId: string) {
  const u = need(ctx);
  return hasEntitlement(ctx, u.user.id, resourceId);
}

/**
 * Grant standing access. Called by the payment-completion path in Phase 4 (grantedVia: 'purchase', with
 * invoiceId) and by promo redemption in Phase 4 (grantedVia: 'promo'); an administrator override
 * (grantedVia: 'admin_grant') is available now and is the only path exercised before Phase 4 lands.
 * Idempotent: granting twice for the same user and resource is a no-op, never a duplicate row.
 */
export async function grantEntitlement(ctx: Ctx, b: { userId: string; resourceId: string; grantedVia: 'purchase' | 'promo' | 'admin_grant'; invoiceId?: string | null; grantedBy?: string | null }) {
  if (b.grantedVia === 'admin_grant') allow(ctx, 'library_entitlements', 'create');
  const existing = await ctx.db.select({ id: e.id, revokedAt: e.revokedAt }).from(e).where(and(eq(e.userId, b.userId), eq(e.resourceId, b.resourceId))).limit(1);
  if (existing.length && !existing[0].revokedAt) return { ok: true, id: existing[0].id, already: true };
  if (existing.length) {
    await ctx.db.update(e).set({ revokedAt: null, grantedVia: b.grantedVia, invoiceId: b.invoiceId ?? null, grantedBy: b.grantedBy ?? null, grantedAt: new Date() }).where(eq(e.id, existing[0].id));
    await audit(ctx, 'resource_entitlement.regranted', 'library_entitlements', existing[0].id, undefined, b);
    return { ok: true, id: existing[0].id, already: false };
  }
  const [row] = await ctx.db.insert(e).values({ userId: b.userId, resourceId: b.resourceId, grantedVia: b.grantedVia, invoiceId: b.invoiceId ?? null, grantedBy: b.grantedBy ?? null }).returning();
  await audit(ctx, 'resource_entitlement.granted', 'library_entitlements', row.id, undefined, b);
  return { ok: true, id: row.id, already: false };
}

export async function revokeEntitlement(ctx: Ctx, id: string) {
  allow(ctx, 'library_entitlements', 'approve');
  const [before] = await ctx.db.select().from(e).where(eq(e.id, id)).limit(1);
  if (!before) throw notFound('Entitlement not found');
  if (before.revokedAt) throw conflict('This entitlement is already revoked');
  await ctx.db.update(e).set({ revokedAt: new Date() }).where(eq(e.id, id));
  await audit(ctx, 'resource_entitlement.revoked', 'library_entitlements', id, { revokedAt: null }, { revokedAt: new Date() });
  return { ok: true };
}

/** The signed-in user's own unlocked resources. */
export async function myEntitlements(ctx: Ctx) {
  const u = need(ctx);
  const rows = await ctx.db.select({ id: e.id, resourceId: e.resourceId, grantedVia: e.grantedVia, grantedAt: e.grantedAt })
    .from(e).where(and(eq(e.userId, u.user.id), isNull(e.revokedAt)));
  return rows;
}

/** Administrator/Finance view: who holds an entitlement to one resource. */
export async function entitlementsFor(ctx: Ctx, resourceId: string) {
  allow(ctx, 'library_entitlements', 'read');
  return ctx.db.select().from(e).where(eq(e.resourceId, resourceId));
}
