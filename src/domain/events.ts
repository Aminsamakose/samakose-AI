/**
 * The event bus. One catalogue of 27 events (design: event bus).
 * An event is written in the caller's transaction, then its handler creates notifications.
 * State changes are audited instead of being events, so the catalogue stays at 27.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { notifyUsers } from './notify';

export const EVENT_TYPES = [
  'DiagnosticCompleted', 'EvidenceUpdated', 'HealthScoreChanged', 'GoalCreated', 'GoalAtRisk', 'RiskDetected',
  'PrescriptionGenerated', 'PrescriptionApproved', 'InterventionAssigned', 'ActionCreated', 'ActionCompleted', 'ActionOverdue',
  'KPIUpdated', 'CoachingCompleted', 'CoachingMissed', 'OpportunityMatched', 'PaymentReceived', 'PaymentFailed', 'SystemError',
  'DocumentUploaded', 'ProgrammeMilestoneReached', 'ProgrammeDeadlineApproaching', 'ContractExpiring', 'ClientInactive',
  'HealthDeclined', 'HealthImproved', 'ProgrammeCompleted'
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export async function caseParties(ctx: Ctx, caseId: string) {
  const [c] = await ctx.db.select().from(schema.cases).where(eq(schema.cases.id, caseId)).limit(1);
  if (!c) return null;
  const owners = await ctx.db.select({ id: schema.users.id }).from(schema.users)
    .where(and(eq(schema.users.orgId, c.orgId), eq(schema.users.role, 'OWNER'), eq(schema.users.active, true)));
  const admins = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, 'ADMIN'), eq(schema.users.active, true)));
  return { c, consultantId: c.consultantId, coachId: c.coachId, reviewerId: c.reviewerId, ownerIds: owners.map((o) => o.id), adminIds: admins.map((a) => a.id) };
}
const some = (...xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];

export async function emitEvent(ctx: Ctx, type: EventType, o: { caseId?: string | null; orgId?: string | null; payload?: Record<string, unknown> } = {}) {
  await ctx.db.insert(schema.events).values({ type, caseId: o.caseId ?? null, orgId: o.orgId ?? null, actorId: ctx.user?.id ?? null, payload: o.payload ?? null });
  if (!o.caseId) return handleNoCase(ctx, type, o.payload ?? {});
  const p = await caseParties(ctx, o.caseId);
  if (!p) return;
  const link = `/cases/${o.caseId}`;
  const pl = o.payload ?? {};
  switch (type) {
    case 'DiagnosticCompleted':
      return notifyUsers(ctx, some(p.consultantId), { kind: type, title: 'Diagnostic received and validated', body: 'Scoring is running. Review the score when it appears.', link });
    case 'HealthScoreChanged':
      return notifyUsers(ctx, some(p.consultantId), { kind: type, title: `Health score ${pl.overall} (${pl.maturity})`, body: `Confidence ${pl.confidence_class}. Ready for diagnosis.`, link });
    case 'RiskDetected':
      return notifyUsers(ctx, some(p.consultantId), { kind: type, title: 'Risks flagged in the diagnosis', body: `${pl.count ?? 0} risk(s) need a decision.`, link });
    case 'PrescriptionGenerated':
      return notifyUsers(ctx, some(p.reviewerId), { kind: type, title: 'Prescription waiting for your review', body: 'Approve it, or return it with a reason.', link, email: true });
    case 'PrescriptionApproved':
      return notifyUsers(ctx, some(p.consultantId, p.coachId, ...p.ownerIds), { kind: type, title: 'Prescription approved', body: 'Actions are now in the plan.', link, email: true });
    case 'ActionCompleted':
      return notifyUsers(ctx, some(p.coachId, p.consultantId), { kind: type, title: 'An action was completed', body: String(pl.text ?? ''), link });
    case 'ActionOverdue':
      return notifyUsers(ctx, some(...p.ownerIds, p.coachId, p.consultantId), { kind: type, title: 'An action is overdue', body: String(pl.text ?? ''), link, email: true });
    case 'HealthDeclined':
      return notifyUsers(ctx, some(p.consultantId, p.coachId), { kind: type, title: 'Health score declined', body: `From ${pl.from} to ${pl.to}. Review the cause.`, link });
    case 'HealthImproved':
      return notifyUsers(ctx, some(p.consultantId, p.coachId), { kind: type, title: 'Health score improved', body: `From ${pl.from} to ${pl.to}.`, link });
    case 'DocumentUploaded':
      return notifyUsers(ctx, some(p.consultantId), { kind: type, title: 'New document uploaded', body: String(pl.filename ?? ''), link });
    case 'CoachingMissed':
      return notifyUsers(ctx, some(p.consultantId, p.coachId), { kind: type, title: 'Coaching session missed', body: 'Reschedule with the owner.', link });
    case 'SystemError':
      return notifyUsers(ctx, some(p.consultantId, ...p.adminIds), { kind: type, title: pl.kind === 'data_quality' ? 'Diagnostic rejected by the data quality gate' : 'System issue on a case', body: Array.isArray(pl.problems) ? (pl.problems as string[]).join('; ') : String(pl.message ?? ''), link });
    default:
      return;
  }
}

async function handleNoCase(ctx: Ctx, type: EventType, pl: Record<string, unknown>) {
  const staff = async (roles: ('ADMIN' | 'FINANCE')[]) =>
    (await ctx.db.select({ id: schema.users.id }).from(schema.users).where(and(inArray(schema.users.role, roles), eq(schema.users.active, true)))).map((u) => u.id);
  if (type === 'PaymentReceived') return notifyUsers(ctx, await staff(['ADMIN', 'FINANCE']), { kind: type, title: 'Payment received', body: `${pl.invoice} paid, GHS ${pl.amount}`, link: '/finance/payments' });
  if (type === 'PaymentFailed') return notifyUsers(ctx, await staff(['ADMIN', 'FINANCE']), { kind: type, title: 'Payment failed', body: String(pl.invoice ?? ''), link: '/finance/payments' });
  if (type === 'ContractExpiring') return notifyUsers(ctx, await staff(['FINANCE']), { kind: type, title: 'Contract expiring soon', body: String(pl.contract ?? ''), link: '/finance/contracts' });
  if (type === 'SystemError') return notifyUsers(ctx, await staff(['ADMIN']), { kind: type, title: 'System issue', body: String(pl.message ?? ''), link: '/admin/system' });
}
