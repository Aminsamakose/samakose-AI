/**
 * Management Insights Assistant rules. Pure functions, no database.
 * Answers ADMIN/EXECUTIVE from a read-only aggregate snapshot only - never raw case, client or
 * personal records - and never writes anything. If the snapshot does not cover the question, it says so.
 */
export type Snapshot = {
  casesByStatus: Record<string, number>;
  overdueInvoices: { count: number; totalGhs: number };
  pendingApprovals: number;
  revenueThisMonthGhs: number;
  kpiReadingsLast30Days: number;
  asOf: string;
};
export type InsightReply = { answer: string; caveat: string | null };

export function validateInsight(o: any): string[] {
  const p: string[] = [];
  if (!o || typeof o.answer !== 'string' || !o.answer.trim()) return ['answer is required'];
  if (o.answer.length > 1200) p.push('The answer is too long');
  if (o.caveat !== null && typeof o.caveat !== 'undefined' && typeof o.caveat !== 'string') p.push('caveat must be a string or null');
  if (/https?:\/\//i.test(o.answer)) p.push('The answer contains a web address');
  return p;
}

/** The built-in model for tests and for when no live key is set: states the figures the snapshot actually has. */
export function mockInsight(question: string, s: Snapshot): InsightReply {
  const q = question.toLowerCase();
  if (q.includes('invoice') || q.includes('overdue') || q.includes('receivable'))
    return { answer: `There are ${s.overdueInvoices.count} overdue invoice(s) totalling GHS ${s.overdueInvoices.totalGhs.toFixed(2)} as of ${s.asOf}.`, caveat: null };
  if (q.includes('approval') || q.includes('pending'))
    return { answer: `${s.pendingApprovals} approval request(s) are pending as of ${s.asOf}.`, caveat: null };
  if (q.includes('revenue') || q.includes('income') || q.includes('sales'))
    return { answer: `Revenue recorded this month is GHS ${s.revenueThisMonthGhs.toFixed(2)} as of ${s.asOf}.`, caveat: null };
  if (q.includes('case') || q.includes('pipeline'))
    return { answer: `Case counts by status: ${Object.entries(s.casesByStatus).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} (as of ${s.asOf}).`, caveat: null };
  return { answer: `Snapshot as of ${s.asOf}: cases ${Object.values(s.casesByStatus).reduce((a, b) => a + b, 0)}, overdue invoices ${s.overdueInvoices.count} (GHS ${s.overdueInvoices.totalGhs.toFixed(2)}), pending approvals ${s.pendingApprovals}, revenue this month GHS ${s.revenueThisMonthGhs.toFixed(2)}.`, caveat: 'Ask about cases, invoices, approvals or revenue for a more specific answer.' };
}
