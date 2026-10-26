/**
 * Business Doctor: the missing link between a verified paid-plan purchase and actual assessment
 * access. plan-purchases.ts creates a contract+invoice and hands off to finance.ts's ordinary
 * Paystack pipeline; finance.ts's settle() marks the invoice Paid. Until this file existed, nothing
 * then happened: the owner's organisation never got a case, and OWNER already holds
 * diagnostics:[R,C] plus cases:[R] (src/lib/rbac.ts) but a case is required before any diagnostic
 * can be started (diagnostics.ts's assertLeadCase/stateIndex checks), and cases:[create] is staff-only
 * (EXPERT/PROGRAMME_MANAGER/ADMIN) -- so a paying owner had no way to get one for themselves.
 *
 * This closes that gap with the smallest coherent change: when settle() marks an invoice Paid and
 * that invoice's contract carries a plan whose entitlements include an enabled 'full_assessment'
 * (PLAN_ENTITLEMENT_KEYS, src/db/schema.ts; set from the plan catalog, src/domain/plan-catalog.ts),
 * it opens (or reuses) a case for the paying organisation, exactly as if a programme manager had
 * opened one -- same CASE_STATES, same auto-coach/auto-reviewer assignment (assignments.ts), same
 * audit trail. No new entitlement table, no duplicate assessment engine: a case IS the unit that
 * already gates diagnostics.ts access, so "unlock the assessment" means "this org has an open case".
 *
 * Called from a Ctx with no user (settle() runs from webhooks, mock-complete and manual-payment
 * paths alike, some of which have no signed-in owner in scope), so this never calls allow() or
 * assertOrg() (both require ctx.user) -- it reads the organisation and plan directly, the same
 * convention assessment-validity.ts's matchPublicAssessmentsToOrganisations() and assignments.ts's
 * scanUnacknowledged() already follow for functions shared between a route and a background path.
 *
 * Deliberately fails soft: a bug or missing precondition here must never roll back or retry the
 * payment itself (money already moved), so every caller wraps this in try/catch and logs rather
 * than throws. A platform/consent problem just leaves the org unmatched for a human to open the
 * case by hand later, exactly as before this file existed.
 */
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { autoAssignCoach, autoAssignReviewer } from './assignments';
import { resolveVersion } from './frameworks';

const c = schema.cases, o = schema.organisations, pl = schema.plans;

export type UnlockReason =
  | 'no_plan' | 'plan_not_found' | 'plan_has_no_full_assessment' | 'plan_not_for_platform'
  | 'org_not_found' | 'org_consent_missing' | 'framework_not_ready';
export type UnlockResult =
  | { unlocked: true; caseId: string; caseCode: string; created: boolean }
  | { unlocked: false; reason: UnlockReason };

/**
 * Idempotent and safe to retry: a webhook retry, a reconciliation re-run, or settle() being called
 * twice for the same invoice (shouldn't happen -- settle() itself is idempotent on payment status --
 * but this stands on its own too) all land on the same case rather than creating duplicates, because
 * any existing non-GRADUATED case for the org is reused rather than a second one opened.
 */
export async function unlockAssessmentForPurchase(ctx: Ctx, b: { orgId: string; planId: string | null; invoiceId: string }): Promise<UnlockResult> {
  if (!b.planId) return { unlocked: false, reason: 'no_plan' };
  const [plan] = await ctx.db.select().from(pl).where(eq(pl.id, b.planId)).limit(1);
  if (!plan) return { unlocked: false, reason: 'plan_not_found' };
  const entitlements = (plan.entitlements ?? []) as { key: string; enabled: boolean }[];
  if (!entitlements.some((e) => e.key === 'full_assessment' && e.enabled)) return { unlocked: false, reason: 'plan_has_no_full_assessment' };

  const [org] = await ctx.db.select().from(o).where(eq(o.id, b.orgId)).limit(1);
  if (!org) return { unlocked: false, reason: 'org_not_found' };
  const platforms = (plan.platforms ?? []) as string[];
  if (platforms.length && !platforms.includes(org.type)) return { unlocked: false, reason: 'plan_not_for_platform' };

  // Defense in depth: plan-purchases.ts's checkPlanReadiness already refuses checkout for a platform
  // with no Published framework, but settlement can land well after checkout (Paystack redirect,
  // webhook delay, reconciliation retry) -- re-check now so a framework unpublished in between never
  // produces a false "your assessment is ready" notification or a case nobody can actually diagnose.
  try { await resolveVersion(ctx.db, org.type); }
  catch { return { unlocked: false, reason: 'framework_not_ready' }; }

  // Advisory lock on orgId: settle() locks per-payment, not per-org, so two settlements landing close
  // together for the same org (two separate invoices, or a webhook racing fulfilment_reconciliation_scan)
  // could otherwise both pass the "no existing case" check below and each open one - two cases for one
  // organisation. No money is duplicated either way (this never touches payments/invoices), but the
  // reuse-the-existing-case guarantee the docstring above promises only actually holds with this lock.
  await ctx.db.execute(sql`select pg_advisory_xact_lock(hashtext('case_unlock:' || ${b.orgId}))`);

  const [existing] = await ctx.db.select({ id: c.id, code: c.code }).from(c)
    .where(and(eq(c.orgId, b.orgId), sql`${c.status} <> 'GRADUATED'`)).limit(1);
  if (existing) {
    await audit(ctx, 'case.purchase_matched_existing', 'case', existing.id, undefined, { invoiceId: b.invoiceId, planId: b.planId }, existing.id);
    return { unlocked: true, caseId: existing.id, caseCode: existing.code, created: false };
  }

  // Mirrors createCase's own consent guard (cases.ts); a self-serve buyer without consent on file
  // is left for a human to follow up with rather than silently skipped.
  if (!org.consentAt) return { unlocked: false, reason: 'org_consent_missing' };

  const [row] = await ctx.db.insert(c).values({ orgId: b.orgId, status: 'PROFILED', createdBy: null }).returning({ id: c.id, code: c.code });
  await autoAssignCoach(ctx, row.id).catch(() => undefined);
  await autoAssignReviewer(ctx, row.id).catch(() => undefined);
  await audit(ctx, 'case.opened_from_purchase', 'case', row.id, undefined, { orgId: b.orgId, invoiceId: b.invoiceId, planId: b.planId }, row.id);
  return { unlocked: true, caseId: row.id, caseCode: row.code, created: true };
}
