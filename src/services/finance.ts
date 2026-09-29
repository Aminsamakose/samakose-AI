import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, conflict, fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertOrg } from '@/domain/scope';
import { emitEvent } from '@/domain/events';
import { notifyUsers } from '@/domain/notify';
import { INVOICE_TRANSITIONS } from '@/domain/logic';
import { env } from '@/lib/env';
import { hmacHex, randomToken, safeEqual } from '@/lib/crypto';
import { orderBy, search, countOf, type ListQuery } from '@/api/list';
import { allow, need, respondList, today } from './common';

const con = schema.contracts, inv = schema.invoices, pay = schema.payments, pl = schema.plans, o = schema.organisations;
const CONTRACT_MOVES: Record<string, string[]> = { Draft: ['Active', 'Cancelled'], Active: ['Expired', 'Cancelled'], Expired: [], Cancelled: [] };
const dec = (n: number) => n.toFixed(2);

/* -------------------------------- plans -------------------------------- */
export async function listPlans(ctx: Ctx) {
  allow(ctx, 'plans', 'read');
  return ctx.db.select().from(pl).orderBy(desc(pl.active), pl.name);
}
export async function createPlan(ctx: Ctx, b: { name: string; description?: string | null; priceGhs: number; intervalMonths: number }) {
  allow(ctx, 'plans', 'create');
  const [row] = await ctx.db.insert(pl).values({ name: b.name.trim(), description: b.description ?? null, priceGhs: dec(b.priceGhs), intervalMonths: b.intervalMonths }).returning({ id: pl.id, code: pl.code });
  await audit(ctx, 'plan.created', 'plan', row.id, undefined, b);
  return row;
}
export async function updatePlan(ctx: Ctx, id: string, b: { name?: string; description?: string | null; priceGhs?: number; intervalMonths?: number; active?: boolean }) {
  allow(ctx, 'plans', 'edit');
  const [before] = await ctx.db.select().from(pl).where(eq(pl.id, id)).limit(1);
  if (!before) throw notFound('Plan not found');
  const { priceGhs, ...rest } = b;
  await ctx.db.update(pl).set({ ...rest, ...(priceGhs !== undefined ? { priceGhs: dec(priceGhs) } : {}), updatedAt: new Date() }).where(eq(pl.id, id));
  await audit(ctx, 'plan.updated', 'plan', id, before, b);
  return { ok: true };
}

/* ------------------------------ contracts ------------------------------ */
const conCols = { id: con.id, code: con.code, orgId: con.orgId, org: o.name, planId: con.planId, programmeId: con.programmeId, status: con.status, startDate: con.startDate, endDate: con.endDate, amountGhs: con.amountGhs, createdAt: con.createdAt };
export async function listContracts(ctx: Ctx, q: ListQuery & { status?: string; orgId?: string }) {
  allow(ctx, 'contracts', 'read');
  const where = and(search(q.q, [con.code, o.name]), q.status ? eq(con.status, q.status) : undefined, q.orgId ? eq(con.orgId, q.orgId) : undefined);
  const from = (b: any) => b.from(con).innerJoin(o, eq(o.id, con.orgId));
  return respondList(ctx, 'contracts', q,
    (limit, off) => from(ctx.db.select(conCols)).where(where).orderBy(orderBy(q, { code: con.code, org: o.name, end: con.endDate, amount: con.amountGhs, status: con.status }, con.createdAt)).limit(limit).offset(off),
    async () => Number((await from(ctx.db.select({ n: countOf })).where(where))[0].n),
    { filename: 'contracts.csv', columns: [['code', 'Contract'], ['org', 'Organisation'], ['status', 'Status'], ['startDate', 'Start'], ['endDate', 'End'], ['amountGhs', 'Amount GHS']].map(([key, label]) => ({ key, label })) });
}
export async function createContract(ctx: Ctx, b: { orgId: string; planId?: string | null; programmeId?: string | null; startDate?: string | null; endDate?: string | null; amountGhs?: number }) {
  allow(ctx, 'contracts', 'create');
  await assertOrg(ctx, b.orgId);
  let amount = b.amountGhs;
  if (b.planId) { const [p] = await ctx.db.select().from(pl).where(eq(pl.id, b.planId)).limit(1); if (!p) throw fieldError({ planId: 'Plan not found' }); amount ??= Number(p.priceGhs); }
  if (amount === undefined) throw fieldError({ amountGhs: 'Enter the contract amount or choose a plan' });
  if (b.startDate && b.endDate && b.endDate < b.startDate) throw fieldError({ endDate: 'End date must be after the start date' });
  const [row] = await ctx.db.insert(con).values({ orgId: b.orgId, planId: b.planId ?? null, programmeId: b.programmeId ?? null, startDate: b.startDate ?? null, endDate: b.endDate ?? null, amountGhs: dec(amount) }).returning({ id: con.id, code: con.code });
  await audit(ctx, 'contract.created', 'contract', row.id, undefined, b);
  return row;
}
export async function updateContract(ctx: Ctx, id: string, b: { status?: string; startDate?: string | null; endDate?: string | null; amountGhs?: number }) {
  allow(ctx, 'contracts', 'edit');
  const [before] = await ctx.db.select().from(con).where(eq(con.id, id)).for('update').limit(1);
  if (!before) throw notFound('Contract not found');
  const start = b.startDate === undefined ? before.startDate : b.startDate, end = b.endDate === undefined ? before.endDate : b.endDate;
  if (start && end && end < start) throw fieldError({ endDate: 'End date must be after the start date' });
  if ((b.amountGhs !== undefined || b.startDate !== undefined || b.endDate !== undefined) && before.status !== 'Draft') throw unprocessable('Terms can be changed while the contract is a draft');
  if (b.status && b.status !== before.status) {
    if (!CONTRACT_MOVES[before.status]?.includes(b.status)) throw unprocessable(`A ${before.status} contract cannot become ${b.status}`);
    if (b.status === 'Active' && (!start || !end)) throw unprocessable('Set start and end dates before activating');
  }
  await ctx.db.update(con).set({ ...(b.status ? { status: b.status } : {}), startDate: start, endDate: end, ...(b.amountGhs !== undefined ? { amountGhs: dec(b.amountGhs) } : {}), updatedAt: new Date() }).where(eq(con.id, id));
  await audit(ctx, 'contract.updated', 'contract', id, before, b);
  return { ok: true };
}

/* ------------------------------- invoices ------------------------------ */
const invCols = { id: inv.id, code: inv.code, orgId: inv.orgId, org: o.name, contractId: inv.contractId, amountGhs: inv.amountGhs, status: inv.status, dueDate: inv.dueDate, issuedAt: inv.issuedAt, paidAt: inv.paidAt, createdAt: inv.createdAt, daysOverdue: sql<number>`greatest(0, (current_date - ${inv.dueDate}))::int` };
export async function listInvoices(ctx: Ctx, q: ListQuery & { status?: string; orgId?: string }) {
  allow(ctx, 'invoices', 'read');
  const u = need(ctx).user;
  const where = and(u.role === 'OWNER' ? eq(inv.orgId, u.orgId ?? '00000000-0000-0000-0000-000000000000') : undefined,
    u.role === 'OWNER' ? sql`${inv.status} <> 'Draft'` : undefined,
    search(q.q, [inv.code, o.name]), q.status ? eq(inv.status, q.status) : undefined, q.orgId ? eq(inv.orgId, q.orgId) : undefined);
  const from = (b: any) => b.from(inv).innerJoin(o, eq(o.id, inv.orgId));
  return respondList(ctx, 'invoices', q,
    (limit, off) => from(ctx.db.select(invCols)).where(where).orderBy(orderBy(q, { code: inv.code, org: o.name, due: inv.dueDate, amount: inv.amountGhs, status: inv.status }, inv.createdAt)).limit(limit).offset(off),
    async () => Number((await from(ctx.db.select({ n: countOf })).where(where))[0].n),
    { filename: 'invoices.csv', columns: [['code', 'Invoice'], ['org', 'Organisation'], ['amountGhs', 'Amount GHS'], ['status', 'Status'], ['dueDate', 'Due'], ['issuedAt', 'Issued'], ['paidAt', 'Paid'], ['daysOverdue', 'Days overdue']].map(([key, label]) => ({ key, label })) });
}
async function loadInvoice(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select(invCols).from(inv).innerJoin(o, eq(o.id, inv.orgId)).where(eq(inv.id, id)).limit(1);
  const u = need(ctx).user;
  if (!row || (u.role === 'OWNER' && (row.orgId !== u.orgId || row.status === 'Draft'))) throw notFound('Invoice not found');
  return row;
}
export async function getInvoice(ctx: Ctx, id: string) {
  allow(ctx, 'invoices', 'read');
  const row = await loadInvoice(ctx, id);
  const payments = await ctx.db.select({ id: pay.id, code: pay.code, provider: pay.provider, reference: pay.reference, amountGhs: pay.amountGhs, status: pay.status, createdAt: pay.createdAt }).from(pay).where(eq(pay.invoiceId, id)).orderBy(desc(pay.createdAt));
  return { ...row, payments };
}
export async function createInvoice(ctx: Ctx, b: { orgId: string; contractId?: string | null; amountGhs: number; dueDate: string }) {
  allow(ctx, 'invoices', 'create');
  await assertOrg(ctx, b.orgId);
  if (b.contractId) { const [c] = await ctx.db.select().from(con).where(eq(con.id, b.contractId)).limit(1); if (!c || c.orgId !== b.orgId) throw fieldError({ contractId: 'Contract not found for this organisation' }); }
  const [row] = await ctx.db.insert(inv).values({ orgId: b.orgId, contractId: b.contractId ?? null, amountGhs: dec(b.amountGhs), dueDate: b.dueDate }).returning({ id: inv.id, code: inv.code });
  await audit(ctx, 'invoice.created', 'invoice', row.id, undefined, b);
  return row;
}
export async function updateInvoice(ctx: Ctx, id: string, b: { status?: 'Sent' | 'Void'; amountGhs?: number; dueDate?: string }) {
  allow(ctx, 'invoices', 'edit');
  const [before] = await ctx.db.select().from(inv).where(eq(inv.id, id)).for('update').limit(1);
  if (!before) throw notFound('Invoice not found');
  if ((b.amountGhs !== undefined) && before.status !== 'Draft') throw unprocessable('The amount can be changed while the invoice is a draft');
  if (b.dueDate !== undefined && ['Paid', 'Void'].includes(before.status)) throw unprocessable('This invoice is closed');
  const patch: Partial<typeof inv.$inferInsert> = { updatedAt: new Date() };
  if (b.amountGhs !== undefined) patch.amountGhs = dec(b.amountGhs);
  if (b.dueDate !== undefined) patch.dueDate = b.dueDate;
  if (b.status && b.status !== before.status) {
    if (!INVOICE_TRANSITIONS[before.status]?.includes(b.status)) throw unprocessable(`A ${before.status} invoice cannot become ${b.status}`);
    if (b.status === 'Void') {
      const paid = await ctx.db.select({ id: pay.id }).from(pay).where(and(eq(pay.invoiceId, id), eq(pay.status, 'Succeeded'))).limit(1);
      if (paid.length) throw conflict('A payment was received for this invoice');
    }
    patch.status = b.status;
    if (b.status === 'Sent') patch.issuedAt = new Date();
  }
  await ctx.db.update(inv).set(patch).where(eq(inv.id, id));
  await audit(ctx, patch.status === 'Sent' ? 'invoice.sent' : patch.status === 'Void' ? 'invoice.voided' : 'invoice.updated', 'invoice', id, { status: before.status, amount: before.amountGhs, due: before.dueDate }, b);
  if (patch.status === 'Sent') {
    const owners = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.orgId, before.orgId), eq(schema.users.role, 'OWNER'), eq(schema.users.active, true)));
    await notifyUsers(ctx, owners.map((x) => x.id), { kind: 'InvoiceSent', title: `Invoice ${before.code} for GHS ${before.amountGhs}`, body: `Due ${patch.dueDate ?? before.dueDate}`, link: '/finance/invoices', email: true });
  }
  return { ok: true };
}

/* ------------------------------- payments ------------------------------ */
export async function listPayments(ctx: Ctx, q: ListQuery & { status?: string; invoiceId?: string }) {
  allow(ctx, 'payments', 'read');
  const where = and(search(q.q, [pay.code, pay.reference, inv.code, o.name]), q.status ? eq(pay.status, q.status) : undefined, q.invoiceId ? eq(pay.invoiceId, q.invoiceId) : undefined);
  const cols = { id: pay.id, code: pay.code, invoice: inv.code, invoiceId: pay.invoiceId, org: o.name, provider: pay.provider, reference: pay.reference, amountGhs: pay.amountGhs, status: pay.status, createdAt: pay.createdAt };
  const from = (b: any) => b.from(pay).innerJoin(inv, eq(inv.id, pay.invoiceId)).innerJoin(o, eq(o.id, inv.orgId));
  return respondList(ctx, 'payments', q,
    (limit, off) => from(ctx.db.select(cols)).where(where).orderBy(orderBy(q, { code: pay.code, amount: pay.amountGhs, status: pay.status, created: pay.createdAt }, pay.createdAt)).limit(limit).offset(off),
    async () => Number((await from(ctx.db.select({ n: countOf })).where(where))[0].n),
    { filename: 'payments.csv', columns: [['code', 'Payment'], ['invoice', 'Invoice'], ['org', 'Organisation'], ['provider', 'Provider'], ['reference', 'Reference'], ['amountGhs', 'Amount GHS'], ['status', 'Status'], ['createdAt', 'Date']].map(([key, label]) => ({ key, label })) });
}

/** Mark a payment received. Serialised on the invoice row so two payments can never both settle it. */
export async function settle(ctx: Ctx, paymentId: string, payload: unknown) {
  const [p] = await ctx.db.select().from(pay).where(eq(pay.id, paymentId)).for('update').limit(1);
  if (!p) throw notFound('Payment not found');
  if (p.status === 'Succeeded') return { status: 'Succeeded' as const, already: true };
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, p.invoiceId)).for('update').limit(1);
  if (i.status === 'Paid' || i.status === 'Void') {
    await ctx.db.update(pay).set({ status: 'Failed', providerPayload: { ...(payload as object), note: `Invoice already ${i.status.toLowerCase()}: refund or reconcile` }, updatedAt: new Date() }).where(eq(pay.id, p.id));
    await audit(ctx, 'payment.duplicate', 'payment', p.id, undefined, { invoice: i.code, invoiceStatus: i.status });
    await emitEvent(ctx, 'SystemError', { orgId: i.orgId, payload: { message: `Payment ${p.reference} arrived for ${i.code}, which is already ${i.status.toLowerCase()}. Reconcile or refund.` } });
    return { status: 'Failed' as const, already: false };
  }
  await ctx.db.update(pay).set({ status: 'Succeeded', providerPayload: (payload ?? null) as any, updatedAt: new Date() }).where(eq(pay.id, p.id));
  await ctx.db.update(inv).set({ status: 'Paid', paidAt: new Date(), updatedAt: new Date() }).where(eq(inv.id, i.id));
  await audit(ctx, 'payment.succeeded', 'payment', p.id, { invoice: i.status }, { invoice: 'Paid', reference: p.reference, amount: p.amountGhs });
  await emitEvent(ctx, 'PaymentReceived', { orgId: i.orgId, payload: { invoice: i.code, amount: p.amountGhs } });
  const owners = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.orgId, i.orgId), eq(schema.users.role, 'OWNER')));
  await notifyUsers(ctx, owners.map((x) => x.id), { kind: 'PaymentReceipt', title: `Payment received for ${i.code}`, body: `GHS ${p.amountGhs}. Thank you.`, link: '/finance/invoices', email: true });
  return { status: 'Succeeded' as const, already: false };
}

export async function recordManualPayment(ctx: Ctx, invoiceId: string, b: { reference: string; amountGhs: number; note?: string }) {
  allow(ctx, 'payments', 'create');
  const u = need(ctx).user;
  if (u.role === 'OWNER') throw forbidden();
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, invoiceId)).for('update').limit(1);
  if (!i) throw notFound('Invoice not found');
  if (!['Sent', 'Overdue'].includes(i.status)) throw unprocessable(`A ${i.status.toLowerCase()} invoice cannot receive a payment`);
  if (Math.abs(Number(i.amountGhs) - b.amountGhs) > 0.001) throw fieldError({ amountGhs: `The payment must equal the invoice amount of GHS ${i.amountGhs}. Part payments are not supported.` });
  const [p] = await ctx.db.insert(pay).values({ invoiceId, provider: 'manual', reference: `MAN-${b.reference.trim()}`, amountGhs: dec(b.amountGhs), status: 'Pending', providerPayload: { note: b.note ?? null }, recordedBy: u.id }).returning();
  const r = await settle(ctx, p.id, { manual: true, note: b.note ?? null, recordedBy: u.email });
  return { id: p.id, code: p.code, ...r };
}

type PsFetch = (path: string, init?: { method?: string; body?: unknown }) => Promise<any>;
let psOverride: PsFetch | null = null;
export const setPaystackTransport = (f: PsFetch | null) => { psOverride = f; };
export const paystackIsMock = () => !psOverride && !env.paystackSecret;
const psFetch: PsFetch = async (path, init) => {
  if (psOverride) return psOverride(path, init);
  const res = await fetch('https://api.paystack.co' + path, { method: init?.method ?? 'GET', headers: { authorization: `Bearer ${env.paystackSecret}`, 'content-type': 'application/json' }, body: init?.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(20_000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(502, 'provider_error', 'The payment provider could not be reached. Try again.');
  return j;
};

export async function startPayment(ctx: Ctx, invoiceId: string) {
  allow(ctx, 'payments', 'create');
  const u = need(ctx).user;
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, invoiceId)).limit(1);
  if (!i || (u.role === 'OWNER' && i.orgId !== u.orgId)) throw notFound('Invoice not found');
  if (!['Sent', 'Overdue'].includes(i.status)) throw unprocessable(`A ${i.status.toLowerCase()} invoice cannot be paid`);
  const reference = `SK-${i.code}-${randomToken(5)}`.replace(/[^\w-]/g, '');
  const amount = Number(i.amountGhs);
  let url: string;
  let payload: unknown = null;
  if (paystackIsMock()) url = `${env.appUrl}/pay/mock/${reference}`;
  else {
    const r = await psFetch('/transaction/initialize', { method: 'POST', body: { email: u.email, amount: Math.round(amount * 100), currency: 'GHS', reference, callback_url: `${env.appUrl}/pay/return`, metadata: { invoice: i.code } } });
    if (!r?.data?.authorization_url) throw new ApiError(502, 'provider_error', 'The payment provider did not return a payment page');
    url = r.data.authorization_url; payload = { initialised: true };
  }
  const [p] = await ctx.db.insert(pay).values({ invoiceId, provider: 'paystack', reference, amountGhs: dec(amount), status: 'Pending', providerPayload: payload as any, recordedBy: u.id }).returning({ id: pay.id, code: pay.code });
  await audit(ctx, 'payment.started', 'payment', p.id, undefined, { invoice: i.code, reference, mock: paystackIsMock() });
  return { paymentId: p.id, reference, authorizationUrl: url, mock: paystackIsMock() };
}

async function ownPayment(ctx: Ctx, reference: string) {
  const [p] = await ctx.db.select().from(pay).where(eq(pay.reference, reference)).limit(1);
  const u = need(ctx).user;
  if (!p) throw notFound('Payment not found');
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, p.invoiceId)).limit(1);
  if (u.role === 'OWNER' && i.orgId !== u.orgId) throw notFound('Payment not found');
  return { p, i };
}

/** Ask the provider what happened, for the owner returning from the payment page. */
export async function verifyPayment(ctx: Ctx, reference: string) {
  allow(ctx, 'payments', 'create');
  const { p, i } = await ownPayment(ctx, reference);
  if (p.status !== 'Pending' || paystackIsMock()) return { status: p.status, invoice: i.code };
  const r = await psFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
  const d = r?.data;
  if (d?.status === 'success') {
    if (d.currency !== 'GHS' || Number(d.amount) !== Math.round(Number(p.amountGhs) * 100)) {
      await ctx.db.update(pay).set({ status: 'Failed', providerPayload: { mismatch: true, amount: d.amount, currency: d.currency }, updatedAt: new Date() }).where(eq(pay.id, p.id));
      await audit(ctx, 'payment.mismatch', 'payment', p.id, undefined, { expected: p.amountGhs, got: d.amount });
      return { status: 'Failed', invoice: i.code };
    }
    const s = await settle(ctx, p.id, { verified: true, id: d.id, channel: d.channel });
    return { status: s.status, invoice: i.code };
  }
  if (d?.status === 'failed' || d?.status === 'abandoned') {
    await ctx.db.update(pay).set({ status: 'Failed', providerPayload: { status: d.status }, updatedAt: new Date() }).where(eq(pay.id, p.id));
    await audit(ctx, 'payment.failed', 'payment', p.id, undefined, { status: d.status });
    return { status: 'Failed', invoice: i.code };
  }
  return { status: 'Pending', invoice: i.code };
}

/** Development and demo only: complete a pending payment when no Paystack key is configured. */
export async function mockComplete(ctx: Ctx, reference: string) {
  if (!paystackIsMock()) throw forbidden('Mock payments are only available when no payment key is configured');
  allow(ctx, 'payments', 'create');
  const { p } = await ownPayment(ctx, reference);
  if (p.status !== 'Pending') throw unprocessable(`This payment is already ${p.status.toLowerCase()}`);
  return settle(ctx, p.id, { mock: true });
}

export async function paystackWebhook(ctx: Ctx, rawBody: string, signature: string | null) {
  if (!env.paystackSecret) throw new ApiError(503, 'not_configured', 'Payments are not configured');
  if (!signature || !safeEqual(hmacHex('sha512', env.paystackSecret, rawBody), signature)) throw new ApiError(401, 'bad_signature', 'Signature check failed');
  let evt: any;
  try { evt = JSON.parse(rawBody); } catch { throw new ApiError(400, 'bad_json', 'Not JSON'); }
  const eventId = `${evt.event}:${evt.data?.id ?? evt.data?.reference}`;
  const seen = await ctx.db.insert(schema.webhookEvents).values({ provider: 'paystack', eventId, type: evt.event, payload: evt }).onConflictDoNothing().returning({ id: schema.webhookEvents.id });
  if (!seen.length) return { ok: true, duplicate: true };
  const ref = evt.data?.reference as string | undefined;
  const [p] = ref ? await ctx.db.select().from(pay).where(eq(pay.reference, ref)).limit(1) : [];
  if (!p) return { ok: true, ignored: true };
  if (evt.event === 'charge.success') {
    if (evt.data.currency !== 'GHS' || Number(evt.data.amount) !== Math.round(Number(p.amountGhs) * 100)) {
      await ctx.db.update(pay).set({ status: 'Failed', providerPayload: { mismatch: true }, updatedAt: new Date() }).where(eq(pay.id, p.id));
      await audit(ctx, 'payment.mismatch', 'payment', p.id, undefined, { expected: p.amountGhs, got: evt.data.amount });
      return { ok: true, mismatch: true };
    }
    await settle(ctx, p.id, { webhook: true, id: evt.data.id, channel: evt.data.channel });
  } else if (evt.event === 'charge.failed' && p.status === 'Pending') {
    await ctx.db.update(pay).set({ status: 'Failed', providerPayload: { webhook: true }, updatedAt: new Date() }).where(eq(pay.id, p.id));
    await audit(ctx, 'payment.failed', 'payment', p.id);
    await emitEvent(ctx, 'PaymentFailed', { payload: { invoice: ref } });
  }
  return { ok: true };
}
export { today };
