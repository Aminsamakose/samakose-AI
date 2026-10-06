import { asc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, notFound, unprocessable } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { allow, need } from './common';

const connections = schema.calendarConnections;
const events = schema.calendarEvents;
const sessions = schema.deliverySessions;
const activities = schema.deliveryActivities;
const cohorts = schema.cohorts;

async function getCohort(ctx: Ctx, cohortId: string) {
  const [cohort] = await ctx.db.select().from(cohorts).where(eq(cohorts.id, cohortId)).limit(1);
  if (!cohort) throw notFound('Cohort not found');
  await assertProgramme(ctx, cohort.programmeId);
  return cohort;
}

async function getSession(ctx: Ctx, sessionId: string) {
  const [session] = await ctx.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) throw notFound('Delivery session not found');
  const [activity] = await ctx.db.select().from(activities).where(eq(activities.id, session.activityId)).limit(1);
  if (!activity) throw notFound('Delivery activity not found');
  await getCohort(ctx, activity.cohortId);
  return { session, activity };
}

export async function listConnections(ctx: Ctx) {
  allow(ctx, 'programme_workspaces', 'read');
  const user = need(ctx).user;
  return ctx.db.select().from(connections).where(eq(connections.userId, user.id)).orderBy(asc(connections.provider));
}

export async function upsertConnection(ctx: Ctx, input: { provider: 'GOOGLE' | 'MICROSOFT' | 'ICS' | 'INTERNAL'; externalCalendarId?: string | null; accountLabel?: string | null; metadata?: unknown }) {
  allow(ctx, 'programme_workspaces', 'edit');
  const user = need(ctx).user;
  const [existing] = await ctx.db.select().from(connections).where(eq(connections.userId, user.id)).limit(1);
  if (existing && existing.provider === input.provider) {
    const [row] = await ctx.db.update(connections).set({ externalCalendarId: input.externalCalendarId ?? existing.externalCalendarId, accountLabel: input.accountLabel ?? existing.accountLabel, metadata: input.metadata ?? existing.metadata, status: 'CONNECTED', disconnectedAt: null, updatedAt: new Date() }).where(eq(connections.id, existing.id)).returning();
    await audit(ctx, 'calendar.connection.updated', 'calendar_connection', row.id, undefined, { provider: row.provider });
    return row;
  }
  const [row] = await ctx.db.insert(connections).values({ userId: user.id, provider: input.provider, externalCalendarId: input.externalCalendarId ?? null, accountLabel: input.accountLabel ?? null, metadata: input.metadata ?? {} }).returning();
  await audit(ctx, 'calendar.connection.created', 'calendar_connection', row.id, undefined, { provider: row.provider });
  return row;
}

export async function disconnectConnection(ctx: Ctx, id: string) {
  allow(ctx, 'programme_workspaces', 'edit');
  const user = need(ctx).user;
  const [row] = await ctx.db.select().from(connections).where(eq(connections.id, id)).limit(1);
  if (!row || row.userId !== user.id) throw notFound('Calendar connection not found');
  await ctx.db.update(connections).set({ status: 'DISCONNECTED', disconnectedAt: new Date(), updatedAt: new Date() }).where(eq(connections.id, id));
  await audit(ctx, 'calendar.connection.disconnected', 'calendar_connection', id, { status: row.status }, { status: 'DISCONNECTED' });
  return { ok: true };
}

export async function listEvents(ctx: Ctx, cohortId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getCohort(ctx, cohortId);
  return ctx.db.select().from(events).where(eq(events.cohortId, cohortId)).orderBy(asc(events.startsAt));
}

export async function createEvent(ctx: Ctx, cohortId: string, input: { title: string; description?: string | null; startsAt: string; endsAt: string; timezone?: string; location?: string | null; meetingUrl?: string | null; sessionId?: string | null; connectionId?: string | null; provider?: 'GOOGLE' | 'MICROSOFT' | 'ICS' | 'INTERNAL'; metadata?: unknown }) {
  allow(ctx, 'programme_workspaces', 'edit');
  await getCohort(ctx, cohortId);
  if (!input.title.trim()) throw unprocessable('Calendar event title is required');
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (!(endsAt > startsAt)) throw unprocessable('Calendar event must end after it starts');
  if (input.sessionId) {
    const { activity } = await getSession(ctx, input.sessionId);
    if (activity.cohortId !== cohortId) throw unprocessable('Session does not belong to this cohort');
  }
  if (input.connectionId) {
    const [connection] = await ctx.db.select().from(connections).where(eq(connections.id, input.connectionId)).limit(1);
    if (!connection || connection.userId !== need(ctx).user.id) throw unprocessable('Calendar connection is not available to the current user');
    if (connection.status !== 'CONNECTED') throw conflict('Calendar connection is not connected');
  }
  const [row] = await ctx.db.insert(events).values({ cohortId, sessionId: input.sessionId ?? null, connectionId: input.connectionId ?? null, provider: input.provider ?? 'INTERNAL', title: input.title.trim(), description: input.description ?? null, startsAt, endsAt, timezone: input.timezone ?? 'UTC', location: input.location ?? null, meetingUrl: input.meetingUrl ?? null, metadata: input.metadata ?? {}, createdBy: need(ctx).user.id }).returning();
  await audit(ctx, 'calendar.event.created', 'calendar_event', row.id, undefined, { cohortId, sessionId: row.sessionId, provider: row.provider });
  return row;
}

export async function scheduleSession(ctx: Ctx, sessionId: string, input: { connectionId?: string | null; provider?: 'GOOGLE' | 'MICROSOFT' | 'ICS' | 'INTERNAL'; timezone?: string }) {
  allow(ctx, 'programme_workspaces', 'edit');
  const { session, activity } = await getSession(ctx, sessionId);
  const existing = await ctx.db.select().from(events).where(eq(events.sessionId, sessionId)).limit(1);
  if (existing[0] && existing[0].status !== 'CANCELLED') throw conflict('This delivery session already has a calendar event');
  const event = await createEvent(ctx, activity.cohortId, {
    title: activity.name,
    description: activity.description,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    timezone: input.timezone ?? 'UTC',
    location: session.location,
    meetingUrl: session.meetingUrl,
    sessionId,
    connectionId: input.connectionId ?? null,
    provider: input.provider ?? 'INTERNAL',
  });
  return event;
}

export async function cancelEvent(ctx: Ctx, id: string) {
  allow(ctx, 'programme_workspaces', 'edit');
  const [row] = await ctx.db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!row) throw notFound('Calendar event not found');
  await getCohort(ctx, row.cohortId);
  if (row.status === 'CANCELLED') return { ok: true };
  await ctx.db.update(events).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(events.id, id));
  await audit(ctx, 'calendar.event.cancelled', 'calendar_event', id, { status: row.status }, { status: 'CANCELLED' });
  return { ok: true };
}
