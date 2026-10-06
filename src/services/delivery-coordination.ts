import { asc, desc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, notFound, unprocessable } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { allow, need } from './common';

const tasks = schema.deliveryTasks;
const milestones = schema.deliveryMilestones;
const exceptions = schema.deliveryExceptions;
const cohorts = schema.cohorts;

async function getCohort(ctx: Ctx, cohortId: string) {
  const [cohort] = await ctx.db.select().from(cohorts).where(eq(cohorts.id, cohortId)).limit(1);
  if (!cohort) throw notFound('Cohort not found');
  await assertProgramme(ctx, cohort.programmeId);
  return cohort;
}

async function getTask(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!row) throw notFound('Delivery task not found');
  await getCohort(ctx, row.cohortId);
  return row;
}

async function getMilestone(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(milestones).where(eq(milestones.id, id)).limit(1);
  if (!row) throw notFound('Delivery milestone not found');
  await getCohort(ctx, row.cohortId);
  return row;
}

async function getException(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(exceptions).where(eq(exceptions.id, id)).limit(1);
  if (!row) throw notFound('Delivery exception not found');
  await getCohort(ctx, row.cohortId);
  return row;
}

export async function coordinationSummary(ctx: Ctx, cohortId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getCohort(ctx, cohortId);
  const [taskRows, milestoneRows, exceptionRows] = await Promise.all([
    ctx.db.select().from(tasks).where(eq(tasks.cohortId, cohortId)).orderBy(asc(tasks.dueAt)),
    ctx.db.select().from(milestones).where(eq(milestones.cohortId, cohortId)).orderBy(asc(milestones.dueAt)),
    ctx.db.select().from(exceptions).where(eq(exceptions.cohortId, cohortId)).orderBy(desc(exceptions.createdAt)),
  ]);
  return {
    tasks: taskRows,
    milestones: milestoneRows,
    exceptions: exceptionRows,
    counts: {
      openTasks: taskRows.filter((r) => !['DONE', 'CANCELLED'].includes(r.status)).length,
      overdueTasks: taskRows.filter((r) => r.dueAt && r.dueAt.getTime() < Date.now() && !['DONE', 'CANCELLED'].includes(r.status)).length,
      openExceptions: exceptionRows.filter((r) => !['RESOLVED', 'CLOSED'].includes(r.status)).length,
      atRiskMilestones: milestoneRows.filter((r) => r.status === 'AT_RISK').length,
    },
  };
}

export async function listTasks(ctx: Ctx, cohortId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getCohort(ctx, cohortId);
  return ctx.db.select().from(tasks).where(eq(tasks.cohortId, cohortId)).orderBy(asc(tasks.dueAt), asc(tasks.createdAt));
}

export async function createTask(ctx: Ctx, cohortId: string, input: { title: string; description?: string | null; priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; assignedTo?: string | null; activityId?: string | null; sessionId?: string | null; dueAt?: string | null; metadata?: unknown }) {
  allow(ctx, 'programme_workspaces', 'edit');
  const cohort = await getCohort(ctx, cohortId);
  if (cohort.status === 'Closed') throw unprocessable('A closed cohort cannot receive new delivery tasks');
  if (!input.title.trim()) throw unprocessable('Task title is required');
  const [row] = await ctx.db.insert(tasks).values({
    cohortId, title: input.title.trim(), description: input.description ?? null, priority: input.priority ?? 'NORMAL',
    assignedTo: input.assignedTo ?? null, activityId: input.activityId ?? null, sessionId: input.sessionId ?? null,
    dueAt: input.dueAt ? new Date(input.dueAt) : null, metadata: input.metadata ?? {}, createdBy: need(ctx).user.id,
  }).returning();
  await audit(ctx, 'delivery.task.created', 'delivery_task', row.id, undefined, { cohortId, title: row.title });
  return row;
}

export async function updateTaskStatus(ctx: Ctx, id: string, status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED') {
  allow(ctx, 'programme_workspaces', 'edit');
  const row = await getTask(ctx, id);
  if (row.status === 'DONE' && status !== 'DONE') throw conflict('A completed task cannot be silently reopened');
  const completedAt = status === 'DONE' ? new Date() : row.completedAt;
  await ctx.db.update(tasks).set({ status, completedAt, updatedAt: new Date() }).where(eq(tasks.id, id));
  await audit(ctx, 'delivery.task.status', 'delivery_task', id, { status: row.status }, { status });
  return { ok: true };
}

export async function listMilestones(ctx: Ctx, cohortId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getCohort(ctx, cohortId);
  return ctx.db.select().from(milestones).where(eq(milestones.cohortId, cohortId)).orderBy(asc(milestones.dueAt));
}

export async function createMilestone(ctx: Ctx, cohortId: string, input: { name: string; description?: string | null; dueAt: string; ownerUserId?: string | null; metadata?: unknown }) {
  allow(ctx, 'programme_workspaces', 'edit');
  const cohort = await getCohort(ctx, cohortId);
  if (cohort.status === 'Closed') throw unprocessable('A closed cohort cannot receive new milestones');
  const [row] = await ctx.db.insert(milestones).values({ cohortId, name: input.name.trim(), description: input.description ?? null, dueAt: new Date(input.dueAt), ownerUserId: input.ownerUserId ?? null, metadata: input.metadata ?? {}, createdBy: need(ctx).user.id }).returning();
  await audit(ctx, 'delivery.milestone.created', 'delivery_milestone', row.id, undefined, { cohortId, name: row.name });
  return row;
}

export async function updateMilestoneStatus(ctx: Ctx, id: string, status: 'PLANNED' | 'AT_RISK' | 'ACHIEVED' | 'MISSED' | 'CANCELLED') {
  allow(ctx, 'programme_workspaces', 'edit');
  const row = await getMilestone(ctx, id);
  if (row.status === 'ACHIEVED' && status !== 'ACHIEVED') throw conflict('An achieved milestone cannot be silently reopened');
  await ctx.db.update(milestones).set({ status, achievedAt: status === 'ACHIEVED' ? new Date() : row.achievedAt, updatedAt: new Date() }).where(eq(milestones.id, id));
  await audit(ctx, 'delivery.milestone.status', 'delivery_milestone', id, { status: row.status }, { status });
  return { ok: true };
}

export async function listExceptions(ctx: Ctx, cohortId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getCohort(ctx, cohortId);
  return ctx.db.select().from(exceptions).where(eq(exceptions.cohortId, cohortId)).orderBy(desc(exceptions.createdAt));
}

export async function createException(ctx: Ctx, cohortId: string, input: { title: string; description?: string | null; severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; ownerUserId?: string | null; activityId?: string | null; sessionId?: string | null; taskId?: string | null; metadata?: unknown }) {
  allow(ctx, 'programme_workspaces', 'edit');
  await getCohort(ctx, cohortId);
  if (!input.title.trim()) throw unprocessable('Exception title is required');
  if (input.taskId) {
    const task = await getTask(ctx, input.taskId);
    if (task.cohortId !== cohortId) throw unprocessable('Task does not belong to this cohort');
  }
  const [row] = await ctx.db.insert(exceptions).values({ cohortId, title: input.title.trim(), description: input.description ?? null, severity: input.severity ?? 'MEDIUM', ownerUserId: input.ownerUserId ?? null, activityId: input.activityId ?? null, sessionId: input.sessionId ?? null, taskId: input.taskId ?? null, metadata: input.metadata ?? {}, createdBy: need(ctx).user.id }).returning();
  await audit(ctx, 'delivery.exception.created', 'delivery_exception', row.id, undefined, { cohortId, severity: row.severity });
  return row;
}

export async function updateExceptionStatus(ctx: Ctx, id: string, status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED', resolution?: string | null) {
  allow(ctx, 'programme_workspaces', 'edit');
  const row = await getException(ctx, id);
  if (row.status === 'CLOSED' && status !== 'CLOSED') throw conflict('A closed exception cannot be silently reopened');
  await ctx.db.update(exceptions).set({ status, resolution: resolution ?? row.resolution, resolvedAt: ['RESOLVED', 'CLOSED'].includes(status) ? new Date() : row.resolvedAt, updatedAt: new Date() }).where(eq(exceptions.id, id));
  await audit(ctx, 'delivery.exception.status', 'delivery_exception', id, { status: row.status }, { status, resolution: resolution ?? null });
  return { ok: true };
}
