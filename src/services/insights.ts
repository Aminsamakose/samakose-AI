/**
 * Management Insights Assistant: a read-only "ask a question" capability for ADMIN and EXECUTIVE.
 * It only ever reads aggregate counts and totals - never an individual case, client or personal record -
 * and runs through the AI gateway like every other agent, so it can be paused, limited and audited.
 */
import { gte, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { runAgent } from './ai';
import { need } from './common';
import { mockInsight, validateInsight, type InsightReply, type Snapshot } from '@/domain/insights';

export async function snapshot(): Promise<Snapshot> {
  const d = db();
  const byStatus = await d.select({ status: schema.cases.status, n: sql<number>`count(*)::int` }).from(schema.cases).groupBy(schema.cases.status);
  const overdue = await d.select({ n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${schema.invoices.amountGhs}), 0)` }).from(schema.invoices).where(sql`${schema.invoices.status} = 'Overdue'`);
  const pendingApprovals = await d.select({ n: sql<number>`count(*)::int` }).from(schema.approvalRequests).where(sql`${schema.approvalRequests.status} = 'Pending'`);
  const startOfMonth = new Date(); startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0, 0, 0, 0);
  const revenue = await d.select({ total: sql<string>`coalesce(sum(${schema.payments.amountGhs}), 0)` }).from(schema.payments).where(sql`${schema.payments.status} = 'Succeeded' and ${schema.payments.createdAt} >= ${startOfMonth}`);
  const since = new Date(Date.now() - 30 * 86400000);
  const readings = await d.select({ n: sql<number>`count(*)::int` }).from(schema.kpiReadings).where(gte(schema.kpiReadings.createdAt, since));
  return {
    casesByStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
    overdueInvoices: { count: Number(overdue[0]?.n ?? 0), totalGhs: Number(overdue[0]?.total ?? 0) },
    pendingApprovals: Number(pendingApprovals[0]?.n ?? 0),
    revenueThisMonthGhs: Number(revenue[0]?.total ?? 0),
    kpiReadingsLast30Days: Number(readings[0]?.n ?? 0),
    asOf: new Date().toISOString()
  };
}

export async function ask(ctx: Ctx, question: string): Promise<InsightReply & { blocked?: boolean }> {
  const s = await snapshot();
  try {
    const r = await runAgent<InsightReply>({
      agent: 'insights', caseId: null, requestedBy: need(ctx).user.id,
      context: { question, snapshot: s },
      validate: validateInsight, mock: () => mockInsight(question, s)
    });
    return r.output;
  } catch (e: any) {
    if (e?.name === 'AgentBlocked' || e?.constructor?.name === 'AgentBlocked') return { answer: 'The insights assistant is not available right now.', caveat: null, blocked: true };
    return { answer: 'Could not answer that question right now.', caveat: null, blocked: true };
  }
}
