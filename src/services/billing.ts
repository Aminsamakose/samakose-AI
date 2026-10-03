import { inArray } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError } from '@/lib/errors';
import { env } from '@/lib/env';
import { paystackIsMock } from './finance';
import { allow, need } from './common';

/**
 * Billing configuration for Finance. It is stored apart from the public pricing cards, which never read or write it,
 * and the finance tables (plans, contracts, invoices) never read the public cards. Tax is off until Finance confirms Samakose Accelerator Lab's position.
 */
export type Billing = {
  currency: 'GHS' | 'USD'; usdReferenceEnabled: boolean;
  taxEnabled: boolean; taxLabel: string; taxRatePercent: number; taxInclusive: boolean; taxRegistrationNumber: string; taxConfirmationRef: string;
  invoicePrefix: string; paymentTermsDays: number; paymentInstructions: string; invoiceFooter: string;
};
export const BILLING_DEFAULTS: Billing = {
  currency: 'GHS', usdReferenceEnabled: false, taxEnabled: false, taxLabel: 'VAT', taxRatePercent: 0, taxInclusive: false, taxRegistrationNumber: '', taxConfirmationRef: '',
  invoicePrefix: 'INV', paymentTermsDays: 14, paymentInstructions: '', invoiceFooter: ''
};
const K = (f: string) => `billing.${f}`;
const FIELDS = Object.keys(BILLING_DEFAULTS) as (keyof Billing)[];

/** Read by Finance code. Safe to call from anywhere: falls back to the defaults. */
export async function getBilling(db: Ctx['db']): Promise<Billing & { updatedAt: Date | null }> {
  const rows = await db.select().from(schema.rules).where(inArray(schema.rules.key, FIELDS.map(K)));
  const m = new Map(rows.map((r) => [r.key, r]));
  const out: any = { ...BILLING_DEFAULTS };
  let at: Date | null = null;
  for (const f of FIELDS) {
    const r = m.get(K(f)); if (!r) continue;
    const d = BILLING_DEFAULTS[f];
    out[f] = typeof d === 'boolean' ? r.value === '1' : typeof d === 'number' ? Number(r.value) : r.value;
    if (!at || r.updatedAt > at) at = r.updatedAt;
  }
  return { ...out, updatedAt: at };
}
export async function readBilling(ctx: Ctx) { allow(ctx, 'settings', 'read'); return getBilling(ctx.db); }

export function billingProblems(b: Billing): Record<string, string> {
  const e: Record<string, string> = {};
  if (!['GHS', 'USD'].includes(b.currency)) e.currency = 'Choose GHS or USD';
  if (!/^[A-Z]{2,6}$/.test(b.invoicePrefix)) e.invoicePrefix = 'Use 2 to 6 capital letters';
  if (!Number.isInteger(b.paymentTermsDays) || b.paymentTermsDays < 0 || b.paymentTermsDays > 180) e.paymentTermsDays = 'Use whole days from 0 to 180';
  if (b.paymentInstructions.length > 800) e.paymentInstructions = 'Keep this under 800 characters';
  if (b.invoiceFooter.length > 400) e.invoiceFooter = 'Keep this under 400 characters';
  if (!b.taxLabel.trim() || b.taxLabel.length > 20) e.taxLabel = 'Use a short label such as VAT';
  if (!(b.taxRatePercent >= 0 && b.taxRatePercent <= 100)) e.taxRatePercent = 'Use a rate from 0 to 100';
  if (b.taxEnabled) {
    if (!(b.taxRatePercent > 0)) e.taxRatePercent = 'Enter the rate Finance has confirmed before switching tax on';
    if (b.taxRegistrationNumber.trim().length < 4) e.taxRegistrationNumber = 'Enter the tax registration number before switching tax on';
    if (b.taxConfirmationRef.trim().length < 5) e.taxConfirmationRef = 'Record who in Finance confirmed this and when';
  }
  return e;
}

export async function saveBilling(ctx: Ctx, input: Partial<Billing>) {
  allow(ctx, 'settings', 'edit');
  const cur = await getBilling(ctx.db);
  const next: Billing = { ...BILLING_DEFAULTS, ...cur, ...input } as Billing;
  for (const f of FIELDS) if (typeof BILLING_DEFAULTS[f] === 'string') (next as any)[f] = String((next as any)[f] ?? '').trim();
  const errs = billingProblems(next);
  if (Object.keys(errs).length) throw fieldError(errs);
  const uid = need(ctx).user.id; const before: Record<string, unknown> = {}; const after: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if ((cur as any)[f] === (next as any)[f]) continue;
    before[f] = (cur as any)[f]; after[f] = (next as any)[f];
    const v = typeof next[f] === 'boolean' ? (next[f] ? '1' : '0') : String(next[f]);
    await ctx.db.insert(schema.rules).values({ key: K(f), value: v, updatedBy: uid }).onConflictDoUpdate({ target: schema.rules.key, set: { value: v, updatedBy: uid, updatedAt: new Date() } });
  }
  if (Object.keys(after).length) await audit(ctx, 'settings.billing_changed', 'billing', null, before, after);
  return getBilling(ctx.db);
}

/** Is online payment ready for real money? Shows what is missing, never the key itself. */
export function paymentReadiness() {
  const mock = paystackIsMock();
  const https = env.appUrl.startsWith('https://');
  const checks = [
    { label: 'Paystack secret key is set on the server', ok: !!env.paystackSecret, fix: 'Add PAYSTACK_SECRET_KEY to the hosting environment.' },
    { label: 'Live keys, not test keys', ok: !mock && env.paystackSecret.startsWith('sk_live_'), fix: 'A key starting sk_test_ moves no real money. Use the live key once Finance approves going live.' },
    { label: 'The site address uses https', ok: https, fix: 'Paystack callbacks and webhooks need a secure address.' },
    { label: 'Mock payments are blocked in production', ok: !(env.isProd && process.env.ALLOW_MOCK_PAYMENTS === '1'), fix: 'Remove ALLOW_MOCK_PAYMENTS from the hosting environment.' }
  ];
  return { mode: mock ? 'mock' : env.paystackSecret.startsWith('sk_live_') ? 'live' : 'test', ready: checks.every((c) => c.ok), checks,
    webhookUrl: `${env.appUrl}/api/v1/webhooks/paystack`, callbackUrl: `${env.appUrl}/pay/return`, note: 'Add the webhook address in the Paystack dashboard under Settings, API keys and webhooks. Currency on the Paystack account must include GHS.' };
}
export async function readPaymentReadiness(ctx: Ctx) { allow(ctx, 'integrations', 'read'); return paymentReadiness(); }
