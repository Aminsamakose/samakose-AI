/**
 * Financial ledger (Master Directive §40-42). Append-only, double-entry postings against the fixed chart
 * of accounts seeded in seedReference(). postLedgerEntries() is the ONLY place application code should
 * write to financial_ledger_entries — the database role has no UPDATE/DELETE on that table (migration 0051),
 * and this function additionally enforces balance and resolves the open financial period itself.
 *
 * Rollout step: wired only to the existing invoice (Sent/Void) and payment (settle) flows. No revenue share,
 * payouts, discounts or tax yet — those build on this once it has proven itself against real volume.
 */
import { and, eq, lte, gte } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { ApiError } from '@/lib/errors';
import { today } from './common';

const fa = schema.financialAccounts, fp = schema.financialPeriods, fle = schema.financialLedgerEntries;

/** The fixed chart of accounts (Directive §40). Seeded once, idempotently, by seedReference(). */
export const CHART_OF_ACCOUNTS: { code: string; name: string; type: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE' | 'EQUITY' }[] = [
  { code: 'RECEIVABLE', name: 'Accounts Receivable', type: 'ASSET' },
  { code: 'CASH', name: 'Cash and Bank', type: 'ASSET' },
  { code: 'PAYSTACK_CLEARING', name: 'Paystack Clearing', type: 'ASSET' },
  { code: 'REVENUE', name: 'Service Revenue', type: 'REVENUE' },
  { code: 'PAYABLE', name: 'Accounts Payable', type: 'LIABILITY' },
  { code: 'TAX_PAYABLE', name: 'Tax Payable', type: 'LIABILITY' },
  { code: 'DISCOUNT_CONTRA', name: 'Discounts Given', type: 'REVENUE' }
];

/** Returns the id of the account with this chart-of-accounts code, or throws if seedReference() hasn't run. */
async function accountId(ctx: Ctx, code: string): Promise<string> {
  const [row] = await ctx.db.select({ id: fa.id }).from(fa).where(eq(fa.code, code)).limit(1);
  if (!row) throw new ApiError(500, 'not_configured', `Financial account ${code} is not seeded`);
  return row.id;
}

/** The Open financial period covering today, creating a calendar-month period if none exists yet. */
export async function ensureCurrentPeriod(ctx: Ctx): Promise<{ id: string; status: string }> {
  const d = today();
  const [existing] = await ctx.db.select({ id: fp.id, status: fp.status }).from(fp).where(and(lte(fp.startDate, d), gte(fp.endDate, d))).limit(1);
  if (existing) return existing;
  const start = `${d.slice(0, 7)}-01`;
  const [y, m] = start.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1));
  const end = new Date(nextMonth.getTime() - 86_400_000).toISOString().slice(0, 10);
  const label = d.slice(0, 7);
  const [row] = await ctx.db.insert(fp).values({ label, startDate: start, endDate: end, status: 'Open' })
    .onConflictDoNothing({ target: fp.label }).returning({ id: fp.id, status: fp.status });
  if (row) return row;
  const [got] = await ctx.db.select({ id: fp.id, status: fp.status }).from(fp).where(eq(fp.label, label)).limit(1);
  if (!got) throw new ApiError(500, 'internal', 'Could not resolve the current financial period');
  return got;
}

export type LedgerLine = { accountCode: string; debitGhs?: number; creditGhs?: number };

/**
 * Posts a balanced set of debit/credit lines to the ledger, dated into the current open period.
 * Throws if the lines don't balance (debits must equal credits) or if the period is Closed/Locked
 * (the database trigger also enforces this, so this is a friendlier pre-check, not the only guard).
 */
export async function postLedgerEntries(ctx: Ctx, args: { referenceType: string; referenceId: string; description?: string; lines: LedgerLine[] }) {
  const totalDebit = args.lines.reduce((s, l) => s + (l.debitGhs ?? 0), 0);
  const totalCredit = args.lines.reduce((s, l) => s + (l.creditGhs ?? 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.005) throw new ApiError(500, 'internal', `Ledger entry does not balance: debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}`);
  if (!args.lines.length) return;
  const period = await ensureCurrentPeriod(ctx);
  if (period.status === 'Closed' || period.status === 'Locked') throw new ApiError(409, 'period_closed', 'The current financial period is closed');
  const createdBy = ctx.user?.id ?? null;
  const rows = await Promise.all(args.lines.map(async (l) => ({
    accountId: await accountId(ctx, l.accountCode),
    debitGhs: (l.debitGhs ?? 0).toFixed(2),
    creditGhs: (l.creditGhs ?? 0).toFixed(2),
    currency: 'GHS',
    referenceType: args.referenceType,
    referenceId: args.referenceId,
    description: args.description ?? null,
    periodId: period.id,
    createdBy
  })));
  await ctx.db.insert(fle).values(rows);
}
