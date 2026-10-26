/**
 * Business Doctor Resource Library: Phase 4, payment wiring. Reuses finance.ts's Paystack
 * transport, signature verification and mock gate - the same payment rail as every other invoice,
 * just a standalone row (resource_payments) because a Library buyer may have no organisation.
 * On a confirmed payment, grants the entitlement through entitlements.ts; nothing here decides
 * who may read what - that stays entitlements.ts's job.
 */
import { eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, conflict, notFound, unprocessable } from '@/lib/errors';
import { env } from '@/lib/env';
import { hmacHex, randomToken, safeEqual } from '@/lib/crypto';
import { mockForbidden, paystackIsMock, psFetch } from './finance';
import { need, systemCtx } from './common';
import { grantEntitlement } from './entitlements';

const rp = schema.resourcePayments, r = schema.libraryResources;
const dec = (n: number) => n.toFixed(2);

export async function startPurchase(ctx: Ctx, resourceId: string) {
  const u = need(ctx).user;
  const [resource] = await ctx.db.select().from(r).where(eq(r.id, resourceId)).limit(1);
  if (!resource || resource.status !== 'Published') throw notFound('Resource not found');
  if (resource.priceGhs === null) throw unprocessable('This resource is free; no purchase is needed');
  if (mockForbidden()) throw new ApiError(503, 'not_configured', 'Online payments are not configured for the Library yet.');
  const amount = Number(resource.priceGhs);
  const reference = `LIB-${resource.slug.slice(0, 20)}-${randomToken(5)}`.replace(/[^\w-]/g, '');
  let url: string;
  let payload: unknown = null;
  if (paystackIsMock()) url = `${env.appUrl}/pay/library-mock/${reference}`;
  else {
    const res = await psFetch('/transaction/initialize', { method: 'POST', body: { email: u.email, amount: Math.round(amount * 100), currency: 'GHS', reference, callback_url: `${env.appUrl}/pay/return`, metadata: { resource: resource.slug } } });
    if (!res?.data?.authorization_url) throw new ApiError(502, 'provider_error', 'The payment provider did not return a payment page');
    url = res.data.authorization_url; payload = { initialised: true };
  }
  const [row] = await ctx.db.insert(rp).values({ userId: u.id, resourceId, reference, amountGhs: dec(amount), status: 'Pending', providerPayload: payload as any }).returning({ id: rp.id });
  await audit(ctx, 'resource_payment.started', 'library_entitlements', row.id, undefined, { resource: resource.slug, reference, mock: paystackIsMock() });
  return { reference, authorizationUrl: url, mock: paystackIsMock() };
}

async function ownPurchase(ctx: Ctx, reference: string) {
  const [p] = await ctx.db.select().from(rp).where(eq(rp.reference, reference)).limit(1);
  const u = need(ctx).user;
  if (!p || p.userId !== u.id) throw notFound('Purchase not found');
  return p;
}

async function settle(db: Ctx['db'], paymentId: string, payload: unknown) {
  // Advisory lock on this payment: without it, a webhook delivery and a concurrent mock-complete call
  // (or two concurrent calls of either) could both pass the "not already Succeeded" check below and
  // both grant the entitlement and run the succeeded side effects twice.
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('resource-payment:settle:' || ${paymentId}))`);
  const [p] = await db.select().from(rp).where(eq(rp.id, paymentId)).limit(1);
  if (!p) throw notFound('Purchase not found');
  if (p.status === 'Succeeded') return { status: 'Succeeded' as const, already: true };
  await db.update(rp).set({ status: 'Succeeded', providerPayload: (payload ?? null) as any, updatedAt: new Date() }).where(eq(rp.id, p.id));
  const sctx = systemCtx(db, 'library-payment');
  await grantEntitlement(sctx, { userId: p.userId, resourceId: p.resourceId, grantedVia: 'purchase', invoiceId: null, grantedBy: null });
  await audit(sctx, 'resource_payment.succeeded', 'library_entitlements', p.id, undefined, { reference: p.reference, amount: p.amountGhs });
  return { status: 'Succeeded' as const, already: false };
}

export async function purchaseStatus(ctx: Ctx, reference: string) {
  const p = await ownPurchase(ctx, reference);
  return { status: p.status, resourceId: p.resourceId };
}

/** Development/demo only: complete a pending resource purchase when no Paystack key is configured. */
export async function mockComplete(ctx: Ctx, reference: string) {
  if (!paystackIsMock() || mockForbidden()) throw new ApiError(403, 'forbidden', 'Mock payments are not available here');
  const p = await ownPurchase(ctx, reference);
  if (p.status !== 'Pending') throw conflict(`This purchase is already ${p.status.toLowerCase()}`);
  return settle(ctx.db, p.id, { mock: true });
}

export async function webhook(ctx: Ctx, rawBody: string, signature: string | null) {
  if (!env.paystackSecret) throw new ApiError(503, 'not_configured', 'Payments are not configured');
  if (!signature || !safeEqual(hmacHex('sha512', env.paystackSecret, rawBody), signature)) throw new ApiError(401, 'bad_signature', 'Signature check failed');
  let evt: any;
  try { evt = JSON.parse(rawBody); } catch { throw new ApiError(400, 'bad_json', 'Not JSON'); }
  const d = ctx.db;
  const eventId = `${evt.event}:${evt.data?.id ?? evt.data?.reference}:library`;
  const seen = await d.insert(schema.webhookEvents).values({ provider: 'paystack', eventId, type: evt.event, payload: evt }).onConflictDoNothing().returning({ id: schema.webhookEvents.id });
  if (!seen.length) return { ok: true, duplicate: true };
  const ref = evt.data?.reference as string | undefined;
  const [p] = ref ? await d.select().from(rp).where(eq(rp.reference, ref)).limit(1) : [];
  if (!p) return { ok: true, ignored: true };
  if (evt.event === 'charge.success') {
    if (evt.data.currency !== 'GHS' || Number(evt.data.amount) !== Math.round(Number(p.amountGhs) * 100)) {
      await d.update(rp).set({ status: 'Failed', providerPayload: { mismatch: true }, updatedAt: new Date() }).where(eq(rp.id, p.id));
      return { ok: true, mismatch: true };
    }
    await settle(d, p.id, { verified: true, id: evt.data.id, channel: evt.data.channel });
    return { ok: true };
  }
  if (evt.event === 'charge.failed' && p.status === 'Pending') {
    await d.update(rp).set({ status: 'Failed', providerPayload: { status: 'failed' }, updatedAt: new Date() }).where(eq(rp.id, p.id));
  }
  return { ok: true };
}
