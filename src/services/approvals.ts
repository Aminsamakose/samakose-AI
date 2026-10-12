/**
 * Approval Matrix + Four-Eyes + COI (Master Directive §9/§31-54), generalized. This is the shared
 * primitive the design doc describes: a single place that routes a high-risk commercial/financial
 * action to the right approver tier by amount/percentage, records the decision, and checks for a
 * conflict of interest — reusable by every feature instead of each one inventing its own inline
 * version.
 *
 * Rollout note: discounts.ts, revenue-share.ts and payouts already enforce their own four-eyes/COI
 * checks inline (creator/approver must differ, checked in-app, on top of the DB-level
 * approval_decisions_four_eyes trigger below which only fires once a request flows through THIS
 * table). This service does not retrofit those existing, already-shipped checks — that is a
 * deliberate fast-follow once their branches merge, to avoid destabilizing green PRs. What's new
 * here: (a) a shared approval_requests/approval_decisions/conflict_checks service so future
 * features (tax rules, refunds, chargebacks in rollout step 6) get this for free, and (b) the
 * admin-configurable amount/percentage thresholds in DEFAULT_RULES that decide which tier a
 * request is routed to.
 */
import { eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, loadRules, need } from './common';
import { badRequest, conflict, forbidden, notFound } from '@/lib/errors';
import type { Role } from '@/db/schema';

const ar = schema.approvalRequests, ad = schema.approvalDecisions, cc = schema.conflictChecks;

export const APPROVAL_ACTION_TYPES = schema.APPROVAL_ACTION_TYPES;
export const CONFLICT_CONTEXT_TYPES = schema.CONFLICT_CONTEXT_TYPES;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];
export type ConflictContextType = (typeof CONFLICT_CONTEXT_TYPES)[number];

/** Which rule-key pair (senior/executive) governs the metric for this action type, if any. */
const THRESHOLD_RULE_KEYS: Partial<Record<ApprovalActionType, { senior: string; executive: string; unit: 'pct' | 'ghs' }>> = {
  DISCOUNT_EXCEPTION: { senior: 'approval.discount.senior_pct', executive: 'approval.discount.executive_pct', unit: 'pct' },
  REVENUE_SHARE_OVERRIDE: { senior: 'approval.revenue_share.senior_pct', executive: 'approval.revenue_share.executive_pct', unit: 'pct' },
  PAYOUT: { senior: 'approval.payout.senior_ghs', executive: 'approval.payout.executive_ghs', unit: 'ghs' },
  REFUND: { senior: 'approval.refund.senior_pct', executive: 'approval.refund.executive_pct', unit: 'pct' }
};

/**
 * Computes the approver role required by the Approval Matrix for one action, given its metric
 * (a percentage 0-100 for discount/revenue-share/refund actions, or a GHS amount for payouts).
 * Actions with no configured threshold (LEDGER_ADJUSTMENT, CONTRACT) always route to Standard,
 * i.e. any role already permitted to approve the underlying resource.
 */
export async function requiredApproverRole(ctx: Ctx, actionType: ApprovalActionType, metric: number | null | undefined): Promise<Role | 'Standard'> {
  const keys = THRESHOLD_RULE_KEYS[actionType];
  if (!keys || metric === null || metric === undefined) return 'Standard';
  const rules = await loadRules(ctx.db);
  const senior = Number(rules[keys.senior]);
  const executive = Number(rules[keys.executive]);
  if (metric >= executive) return 'EXECUTIVE';
  if (metric >= senior) return 'FINANCE';
  return 'Standard';
}

/**
 * Opens an approval request for a high-risk action, computing and recording the required
 * approver tier from the Approval Matrix thresholds. `metric` is the percentage (discount,
 * revenue-share) or GHS amount (payout) the thresholds are evaluated against; pass undefined
 * for action types with no configured threshold.
 */
export async function createApprovalRequest(ctx: Ctx, args: { actionType: ApprovalActionType; referenceId: string; amountGhs?: number; metric?: number }) {
  const u = need(ctx);
  if (!APPROVAL_ACTION_TYPES.includes(args.actionType)) throw badRequest('Unknown action type');
  const requiredRole = await requiredApproverRole(ctx, args.actionType, args.metric ?? args.amountGhs);
  const [row] = await ctx.db.insert(ar).values({
    actionType: args.actionType,
    referenceId: args.referenceId,
    requestedBy: u.user.id,
    amountGhs: args.amountGhs !== undefined ? args.amountGhs.toFixed(2) : null,
    requiredApproverRole: requiredRole === 'Standard' ? null : requiredRole,
    status: 'Pending'
  }).returning();
  await audit(ctx, 'approval.requested', 'approval_requests', row.id, undefined, row);
  return row;
}

export async function listApprovalRequests(ctx: Ctx, filters: { status?: string; actionType?: string } = {}) {
  allow(ctx, 'approvals', 'read');
  const rows = await ctx.db.select().from(ar);
  return rows.filter((r) => (!filters.status || r.status === filters.status) && (!filters.actionType || r.actionType === filters.actionType));
}

async function getRequest(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(ar).where(eq(ar.id, id)).limit(1);
  if (!row) throw notFound('Approval request not found');
  return row;
}

/**
 * Records an approve/reject decision. Four-eyes is enforced twice: here in-app (a friendlier
 * 403 before any write), and again at the database layer by the approval_decisions_four_eyes
 * trigger (reject_self_approval(), migration 0051) which refuses the insert outright if
 * decided_by equals the request's requested_by — so this guarantee holds even for a caller that
 * bypasses this function and writes to approval_decisions directly.
 */
export async function decideApproval(ctx: Ctx, requestId: string, decision: 'Approved' | 'Rejected', reason?: string) {
  const u = need(ctx);
  const req = await getRequest(ctx, requestId);
  if (req.status !== 'Pending') throw conflict('This approval request has already been decided');
  if (req.requestedBy === u.user.id) throw forbidden();
  if (req.requiredApproverRole && u.user.role !== req.requiredApproverRole && u.user.role !== 'ADMIN') throw forbidden();
  const [decisionRow] = await ctx.db.insert(ad).values({ requestId, decision, decidedBy: u.user.id, reason: reason ?? null }).returning();
  const [updated] = await ctx.db.update(ar).set({ status: decision }).where(eq(ar.id, requestId)).returning();
  await audit(ctx, decision === 'Approved' ? 'approval.approved' : 'approval.rejected', 'approval_requests', requestId, req, updated);
  return { request: updated, decision: decisionRow };
}

/**
 * Records a conflict-of-interest check for one user against one context (e.g. is this reviewer
 * also the professional whose revenue-share agreement they're about to approve). This is a
 * record of the check, not an enforcement point by itself — callers that must block on BLOCKED
 * should throw forbidden() themselves when `result` comes back BLOCKED; this function only
 * persists the finding so it is auditable.
 */
export async function recordConflictCheck(ctx: Ctx, args: { userId: string; contextType: ConflictContextType; referenceId: string; result: 'CLEAR' | 'BLOCKED'; reason?: string }) {
  if (!CONFLICT_CONTEXT_TYPES.includes(args.contextType)) throw badRequest('Unknown conflict context type');
  const [row] = await ctx.db.insert(cc).values({ userId: args.userId, contextType: args.contextType, referenceId: args.referenceId, result: args.result, reason: args.reason ?? null }).returning();
  await audit(ctx, 'conflict.checked', 'conflict_checks', row.id, undefined, row);
  return row;
}
