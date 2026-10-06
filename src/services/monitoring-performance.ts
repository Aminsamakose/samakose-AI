import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, notFound, unprocessable } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { allow, need } from './common';

const workspaces = schema.programmeWorkspaces;
const cohorts = schema.cohorts;
const participants = schema.programmeParticipants;
const activities = schema.deliveryActivities;
const sessions = schema.deliverySessions;
const attendance = schema.deliveryAttendance;
const tasks = schema.deliveryTasks;
const exceptions = schema.deliveryExceptions;
const assignments = schema.providerAssignments;
const snapshots = schema.programmeMonitoringSnapshots;
const reviews = schema.providerPerformanceReviews;
const users = schema.users;

async function getWorkspace(ctx: Ctx, workspaceId: string) {
  const [workspace] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) throw notFound('Programme workspace not found');
  await assertProgramme(ctx, workspace.programmeId);
  return workspace;
}

async function getAssignment(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(assignments).where(eq(assignments.id, id)).limit(1);
  if (!row) throw notFound('Provider assignment not found');
  await getWorkspace(ctx, row.workspaceId);
  return row;
}

function pct(n: number, d: number) { return d ? Number(((n / d) * 100).toFixed(2)) : null; }

export async function monitoringSummary(ctx: Ctx, workspaceId: string, periodStart?: string, periodEnd?: string) {
  allow(ctx, 'monitoring', 'read');
  const workspace = await getWorkspace(ctx, workspaceId);
  const start = periodStart ? new Date(periodStart) : new Date(Date.now() - 30 * 24 * 3600_000);
  const end = periodEnd ? new Date(periodEnd) : new Date();
  if (end < start) throw fieldError({ periodEnd: 'Period end must be on or after period start' });

  const [participantRows, activityRows, sessionRows, taskRows, exceptionRows, assignmentRows] = await Promise.all([
    ctx.db.select({ status: participants.status, count: sql<number>`count(*)::int` }).from(participants).where(eq(participants.workspaceId, workspaceId)).groupBy(participants.status),
    ctx.db.select({ status: activities.status, count: sql<number>`count(*)::int` }).from(activities).innerJoin(cohorts, eq(cohorts.id, activities.cohortId)).where(and(eq(cohorts.programmeId, workspace.programmeId), sql`${activities.createdAt} <= ${end}`, sql`${activities.createdAt} >= ${start}`)).groupBy(activities.status),
    ctx.db.select({ status: sessions.status, count: sql<number>`count(*)::int` }).from(sessions).innerJoin(activities, eq(activities.id, sessions.activityId)).innerJoin(cohorts, eq(cohorts.id, activities.cohortId)).where(and(eq(cohorts.programmeId, workspace.programmeId), sql`${sessions.startsAt} >= ${start}`, sql`${sessions.startsAt} <= ${end}`)).groupBy(sessions.status),
    ctx.db.select({ status: tasks.status, count: sql<number>`count(*)::int` }).from(tasks).innerJoin(cohorts, eq(cohorts.id, tasks.cohortId)).where(and(eq(cohorts.programmeId, workspace.programmeId), sql`${tasks.createdAt} >= ${start}`, sql`${tasks.createdAt} <= ${end}`)).groupBy(tasks.status),
    ctx.db.select({ status: exceptions.status, severity: exceptions.severity, count: sql<number>`count(*)::int` }).from(exceptions).innerJoin(cohorts, eq(cohorts.id, exceptions.cohortId)).where(and(eq(cohorts.programmeId, workspace.programmeId), sql`${exceptions.createdAt} >= ${start}`, sql`${exceptions.createdAt} <= ${end}`)).groupBy(exceptions.status, exceptions.severity),
    ctx.db.select({ status: assignments.status, count: sql<number>`count(*)::int` }).from(assignments).where(eq(assignments.workspaceId, workspaceId)).groupBy(assignments.status),
  ]);

  const [attendanceTotals] = await ctx.db.select({ total: sql<number>`count(*)::int`, present: sql<number>`count(*) filter (where ${attendance.status} in ('PRESENT','LATE'))::int` }).from(attendance).innerJoin(sessions, eq(sessions.id, attendance.sessionId)).innerJoin(activities, eq(activities.id, sessions.activityId)).innerJoin(cohorts, eq(cohorts.id, activities.cohortId)).where(and(eq(cohorts.programmeId, workspace.programmeId), sql`${sessions.startsAt} >= ${start}`, sql`${sessions.startsAt} <= ${end}`));

  const toMap = (rows: Array<{ status: string; count: number }>) => Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  const participantsByStatus = toMap(participantRows);
  const activitiesByStatus = toMap(activityRows);
  const sessionsByStatus = toMap(sessionRows);
  const tasksByStatus = toMap(taskRows);
  const activeExceptions = exceptionRows.filter((r) => !['RESOLVED', 'CLOSED'].includes(r.status)).reduce((n, r) => n + Number(r.count), 0);
  const criticalExceptions = exceptionRows.filter((r) => r.severity === 'CRITICAL' && !['RESOLVED', 'CLOSED'].includes(r.status)).reduce((n, r) => n + Number(r.count), 0);
  const activeAssignments = Number(assignmentRows.find((r) => r.status === 'ACTIVE')?.count ?? 0);
  const completedSessions = Number(sessionsByStatus.COMPLETED ?? 0);
  const scheduledSessions = Object.values(sessionsByStatus).reduce((n, x) => n + x, 0);

  return {
    workspaceId, programmeId: workspace.programmeId, periodStart: start.toISOString(), periodEnd: end.toISOString(),
    participants: { total: Object.values(participantsByStatus).reduce((n, x) => n + x, 0), byStatus: participantsByStatus, active: Number(participantsByStatus.ACTIVE ?? 0) },
    delivery: { activities: activitiesByStatus, sessions: sessionsByStatus, sessionCompletionRate: pct(completedSessions, scheduledSessions), attendanceRate: pct(Number(attendanceTotals?.present ?? 0), Number(attendanceTotals?.total ?? 0)) },
    coordination: { tasks: tasksByStatus, openTasks: Object.entries(tasksByStatus).filter(([s]) => !['DONE', 'CANCELLED'].includes(s)).reduce((n, [, x]) => n + x, 0), openExceptions: activeExceptions, criticalExceptions },
    providers: { assignments: Object.fromEntries(assignmentRows.map((r) => [r.status, Number(r.count)])), activeAssignments },
  };
}

export async function createSnapshot(ctx: Ctx, workspaceId: string, input: { periodStart: string; periodEnd: string; cohortId?: string | null }) {
  allow(ctx, 'monitoring', 'create');
  const workspace = await getWorkspace(ctx, workspaceId);
  const summary = await monitoringSummary(ctx, workspaceId, input.periodStart, input.periodEnd);
  if (input.cohortId) {
    const [cohort] = await ctx.db.select().from(cohorts).where(eq(cohorts.id, input.cohortId)).limit(1);
    if (!cohort || cohort.programmeId !== workspace.programmeId) throw fieldError({ cohortId: 'Cohort does not belong to this programme' });
  }
  const [row] = await ctx.db.insert(snapshots).values({ workspaceId, cohortId: input.cohortId ?? null, periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd), status: 'DRAFT', metrics: summary, generatedBy: need(ctx).user.id }).returning();
  await audit(ctx, 'monitoring.snapshot.created', 'monitoring_snapshot', row.id, undefined, { workspaceId, periodStart: input.periodStart, periodEnd: input.periodEnd });
  return row;
}

export async function finalizeSnapshot(ctx: Ctx, id: string) {
  allow(ctx, 'monitoring', 'approve');
  const [row] = await ctx.db.select().from(snapshots).where(eq(snapshots.id, id)).limit(1);
  if (!row) throw notFound('Monitoring snapshot not found');
  await getWorkspace(ctx, row.workspaceId);
  if (row.status === 'FINAL') return row;
  await ctx.db.update(snapshots).set({ status: 'FINAL', updatedAt: new Date() }).where(eq(snapshots.id, id));
  await audit(ctx, 'monitoring.snapshot.finalized', 'monitoring_snapshot', id, { status: row.status }, { status: 'FINAL' }, row.workspaceId);
  return ctx.db.select().from(snapshots).where(eq(snapshots.id, id)).limit(1).then((r) => r[0]);
}

export async function listSnapshots(ctx: Ctx, workspaceId: string) {
  allow(ctx, 'monitoring', 'read');
  await getWorkspace(ctx, workspaceId);
  return ctx.db.select().from(snapshots).where(eq(snapshots.workspaceId, workspaceId)).orderBy(desc(snapshots.periodEnd));
}

async function providerOperationalMetrics(ctx: Ctx, assignment: typeof assignments.$inferSelect, periodStart: Date, periodEnd: Date) {
  const [sessionRows] = await Promise.all([
    ctx.db.select({ id: sessions.id, status: sessions.status }).from(sessions).innerJoin(activities, eq(activities.id, sessions.activityId)).innerJoin(cohorts, eq(cohorts.id, activities.cohortId)).where(and(eq(cohorts.programmeId, (await getWorkspace(ctx, assignment.workspaceId)).programmeId), eq(sessions.facilitatorUserId, assignment.providerUserId), sql`${sessions.startsAt} >= ${periodStart}`, sql`${sessions.startsAt} <= ${periodEnd}`)),
  ]);
  const ids = sessionRows.map((r) => r.id);
  const attendanceRows = ids.length ? await ctx.db.select({ status: attendance.status, count: sql<number>`count(*)::int` }).from(attendance).where(inArray(attendance.sessionId, ids)).groupBy(attendance.status) : [];
  const totalAttendance = attendanceRows.reduce((n, r) => n + Number(r.count), 0);
  const attended = attendanceRows.filter((r) => ['PRESENT', 'LATE'].includes(r.status)).reduce((n, r) => n + Number(r.count), 0);
  const totalSessions = sessionRows.length;
  const completedSessions = sessionRows.filter((r) => r.status === 'COMPLETED').length;
  return { totalSessions, completedSessions, cancelledSessions: sessionRows.filter((r) => r.status === 'CANCELLED').length, sessionCompletionRate: pct(completedSessions, totalSessions), attendanceRate: pct(attended, totalAttendance) };
}

export async function providerPerformance(ctx: Ctx, workspaceId: string, periodStart: string, periodEnd: string) {
  allow(ctx, 'monitoring', 'read');
  await getWorkspace(ctx, workspaceId);
  const start = new Date(periodStart), end = new Date(periodEnd);
  if (end < start) throw fieldError({ periodEnd: 'Period end must be on or after period start' });
  const rows = await ctx.db.select({ assignment: assignments, user: users }).from(assignments).innerJoin(users, eq(users.id, assignments.providerUserId)).where(and(eq(assignments.workspaceId, workspaceId), inArray(assignments.status, ['ACTIVE', 'PAUSED', 'ENDED']))).orderBy(asc(users.name));
  const items = [];
  for (const row of rows) {
    const operational = await providerOperationalMetrics(ctx, row.assignment, start, end);
    const [review] = await ctx.db.select().from(reviews).where(and(eq(reviews.providerAssignmentId, row.assignment.id), eq(reviews.periodStart, start), eq(reviews.periodEnd, end))).limit(1);
    items.push({ provider: { id: row.user.id, name: row.user.name }, assignment: row.assignment, operational, performanceReview: review ?? null });
  }
  return items;
}

function scoreValue(value: number | null | undefined, field: string) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) throw fieldError({ [field]: 'Score must be between 0 and 100' });
  return Number(value.toFixed(2));
}

export async function upsertPerformanceReview(ctx: Ctx, workspaceId: string, input: { providerAssignmentId: string; periodStart: string; periodEnd: string; humanPerformanceScore?: number | null; serviceQualityScore?: number | null; clientExperienceScore?: number | null; businessOutcomeScore?: number | null; evidence?: unknown; notes?: string | null }) {
  allow(ctx, 'monitoring', 'edit');
  const assignment = await getAssignment(ctx, input.providerAssignmentId);
  if (assignment.workspaceId !== workspaceId) throw fieldError({ providerAssignmentId: 'Provider assignment does not belong to this workspace' });
  const scores = {
    humanPerformanceScore: scoreValue(input.humanPerformanceScore, 'humanPerformanceScore'),
    serviceQualityScore: scoreValue(input.serviceQualityScore, 'serviceQualityScore'),
    clientExperienceScore: scoreValue(input.clientExperienceScore, 'clientExperienceScore'),
    businessOutcomeScore: scoreValue(input.businessOutcomeScore, 'businessOutcomeScore'),
  };
  const present = Object.values(scores).filter((v) => v != null) as number[];
  const compositeScore = present.length ? Number((present.reduce((a, b) => a + b, 0) / present.length).toFixed(2)) : null;
  const [existing] = await ctx.db.select().from(reviews).where(and(eq(reviews.providerAssignmentId, assignment.id), eq(reviews.periodStart, new Date(input.periodStart)), eq(reviews.periodEnd, new Date(input.periodEnd)))).limit(1);
  const values = { ...scores, compositeScore, evidence: input.evidence ?? {}, notes: input.notes?.trim() || null, updatedAt: new Date() };
  if (existing) {
    if (existing.status === 'FINAL') throw conflict('A final provider performance review cannot be silently edited');
    await ctx.db.update(reviews).set(values).where(eq(reviews.id, existing.id));
  } else {
    await ctx.db.insert(reviews).values({ workspaceId, providerAssignmentId: assignment.id, providerUserId: assignment.providerUserId, providerRole: assignment.providerRole, periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd), ...values, status: 'DRAFT', createdBy: need(ctx).user.id });
  }
  const [row] = await ctx.db.select().from(reviews).where(and(eq(reviews.providerAssignmentId, assignment.id), eq(reviews.periodStart, new Date(input.periodStart)), eq(reviews.periodEnd, new Date(input.periodEnd)))).limit(1);
  await audit(ctx, 'monitoring.provider_review.saved', 'provider_performance_review', row.id, existing ? { status: existing.status } : undefined, { status: row.status, scores }, workspaceId);
  return row;
}

export async function finalizePerformanceReview(ctx: Ctx, id: string) {
  allow(ctx, 'monitoring', 'approve');
  const [row] = await ctx.db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
  if (!row) throw notFound('Provider performance review not found');
  await getWorkspace(ctx, row.workspaceId);
  if (row.status === 'FINAL') return row;
  if (row.humanPerformanceScore == null && row.serviceQualityScore == null && row.clientExperienceScore == null && row.businessOutcomeScore == null) throw unprocessable('At least one evidence-backed performance dimension is required before finalization');
  await ctx.db.update(reviews).set({ status: 'FINAL', reviewedBy: need(ctx).user.id, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(reviews.id, id));
  await audit(ctx, 'monitoring.provider_review.finalized', 'provider_performance_review', id, { status: row.status }, { status: 'FINAL' }, row.workspaceId);
  return ctx.db.select().from(reviews).where(eq(reviews.id, id)).limit(1).then((r) => r[0]);
}
