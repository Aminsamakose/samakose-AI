import { and, asc, desc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, notFound, unprocessable } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { allow, need } from './common';

const activities = schema.deliveryActivities;
const sessions = schema.deliverySessions;
const attendance = schema.deliveryAttendance;
const cohorts = schema.cohorts;
const participants = schema.programmeParticipants;

async function getCohort(ctx: Ctx, cohortId: string) {
  const [cohort] = await ctx.db.select().from(cohorts).where(eq(cohorts.id, cohortId)).limit(1);
  if (!cohort) throw notFound('Cohort not found');
  await assertProgramme(ctx, cohort.programmeId);
  return cohort;
}

async function getActivity(ctx: Ctx, activityId: string) {
  const [row] = await ctx.db.select().from(activities).where(eq(activities.id, activityId)).limit(1);
  if (!row) throw notFound('Delivery activity not found');
  await getCohort(ctx, row.cohortId);
  return row;
}

async function getSession(ctx: Ctx, sessionId: string) {
  const [row] = await ctx.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!row) throw notFound('Delivery session not found');
  await getActivity(ctx, row.activityId);
  return row;
}

export async function listActivities(ctx: Ctx, cohortId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getCohort(ctx, cohortId);
  return ctx.db.select().from(activities).where(eq(activities.cohortId, cohortId)).orderBy(asc(activities.sequence), asc(activities.scheduledStart));
}

export async function createActivity(ctx: Ctx, cohortId: string, input: {
  name: string; activityType?: string; description?: string | null; sequence?: number;
  scheduledStart?: string | null; scheduledEnd?: string | null; ownerUserId?: string | null;
  cohortConfigurationVersion?: number | null; metadata?: unknown;
}) {
  allow(ctx, 'programme_workspaces', 'edit');
  const cohort = await getCohort(ctx, cohortId);
  if (cohort.status === 'Closed') throw unprocessable('A closed cohort cannot receive new delivery activities');
  if (!input.name.trim()) throw unprocessable('Activity name is required');
  const [row] = await ctx.db.insert(activities).values({
    cohortId, name: input.name.trim(), activityType: input.activityType?.trim() || 'GENERAL',
    description: input.description ?? null, sequence: input.sequence ?? 1,
    scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null,
    scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : null,
    ownerUserId: input.ownerUserId ?? null, cohortConfigurationVersion: input.cohortConfigurationVersion ?? null,
    metadata: input.metadata ?? {}, createdBy: need(ctx).user.id,
  }).returning();
  await audit(ctx, 'delivery.activity.created', 'delivery_activity', row.id, undefined, { cohortId, name: row.name });
  return row;
}

export async function updateActivityStatus(ctx: Ctx, activityId: string, status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') {
  allow(ctx, 'programme_workspaces', 'edit');
  const row = await getActivity(ctx, activityId);
  if (row.status === 'COMPLETED' && status !== 'COMPLETED') throw conflict('A completed activity cannot be reopened through delivery operations');
  await ctx.db.update(activities).set({ status, updatedAt: new Date() }).where(eq(activities.id, activityId));
  await audit(ctx, 'delivery.activity.status', 'delivery_activity', activityId, { status: row.status }, { status });
  return { ok: true };
}

export async function listSessions(ctx: Ctx, cohortId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getCohort(ctx, cohortId);
  return ctx.db.select({ session: sessions, activity: activities })
    .from(sessions).innerJoin(activities, eq(sessions.activityId, activities.id))
    .where(eq(activities.cohortId, cohortId)).orderBy(asc(sessions.startsAt));
}

export async function createSession(ctx: Ctx, activityId: string, input: {
  facilitatorUserId?: string | null; mode?: 'IN_PERSON' | 'REMOTE' | 'HYBRID' | 'SELF_PACED';
  startsAt: string; endsAt: string; location?: string | null; meetingUrl?: string | null;
  capacity?: number | null; notes?: string | null; metadata?: unknown;
}) {
  allow(ctx, 'programme_workspaces', 'edit');
  const activity = await getActivity(ctx, activityId);
  if (activity.status === 'CANCELLED') throw unprocessable('A cancelled activity cannot receive a session');
  const startsAt = new Date(input.startsAt); const endsAt = new Date(input.endsAt);
  if (!(endsAt > startsAt)) throw unprocessable('Session end time must be after start time');
  const [row] = await ctx.db.insert(sessions).values({
    activityId, facilitatorUserId: input.facilitatorUserId ?? null, mode: input.mode ?? 'HYBRID',
    startsAt, endsAt, location: input.location ?? null, meetingUrl: input.meetingUrl ?? null,
    capacity: input.capacity ?? null, notes: input.notes ?? null, metadata: input.metadata ?? {}, createdBy: need(ctx).user.id,
  }).returning();
  await audit(ctx, 'delivery.session.created', 'delivery_session', row.id, undefined, { activityId, startsAt: row.startsAt });
  return row;
}

export async function updateSessionStatus(ctx: Ctx, sessionId: string, status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW') {
  allow(ctx, 'programme_workspaces', 'edit');
  const row = await getSession(ctx, sessionId);
  if (row.status === 'COMPLETED' && status !== 'COMPLETED') throw conflict('A completed session cannot be reopened through delivery operations');
  await ctx.db.update(sessions).set({ status, updatedAt: new Date() }).where(eq(sessions.id, sessionId));
  await audit(ctx, 'delivery.session.status', 'delivery_session', sessionId, { status: row.status }, { status });
  return { ok: true };
}

export async function listAttendance(ctx: Ctx, sessionId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getSession(ctx, sessionId);
  return ctx.db.select({ attendance, participant: participants })
    .from(attendance).innerJoin(participants, eq(attendance.participantId, participants.id))
    .where(eq(attendance.sessionId, sessionId)).orderBy(desc(attendance.recordedAt));
}

export async function recordAttendance(ctx: Ctx, sessionId: string, participantId: string, input: { status: 'PRESENT' | 'ABSENT' | 'EXCUSED' | 'LATE'; arrivedAt?: string | null; note?: string | null }) {
  allow(ctx, 'programme_workspaces', 'edit');
  await getSession(ctx, sessionId);
  const [participant] = await ctx.db.select().from(participants).where(eq(participants.id, participantId)).limit(1);
  if (!participant) throw notFound('Programme participant not found');
  const [sessionActivity] = await ctx.db.select({ cohortId: activities.cohortId }).from(sessions).innerJoin(activities, eq(sessions.activityId, activities.id)).where(eq(sessions.id, sessionId)).limit(1);
  if (!sessionActivity || participant.cohortId !== sessionActivity.cohortId) throw unprocessable('Participant is not assigned to this cohort');
  const [row] = await ctx.db.insert(attendance).values({
    sessionId, participantId, status: input.status, arrivedAt: input.arrivedAt ? new Date(input.arrivedAt) : null,
    note: input.note ?? null, recordedBy: need(ctx).user.id,
  }).onConflictDoUpdate({ target: [attendance.sessionId, attendance.participantId], set: { status: input.status, arrivedAt: input.arrivedAt ? new Date(input.arrivedAt) : null, note: input.note ?? null, recordedBy: need(ctx).user.id, recordedAt: new Date() } }).returning();
  await audit(ctx, 'delivery.attendance.recorded', 'delivery_session', sessionId, undefined, { participantId, status: input.status });
  return row;
}
