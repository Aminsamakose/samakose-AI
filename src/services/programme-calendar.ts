import { asc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, notFound, unprocessable } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { allow, need } from './common';
import { resolveVideoProvider } from './integrations';
import { createVideoMeeting, cancelVideoMeeting, type VideoProvider } from './meetings';

/** Maps the meetings.ts provider id to the calendar_events provider enum value it is stored under. */
const CALENDAR_PROVIDER_FOR_VIDEO: Record<VideoProvider, 'ZOOM' | 'GOOGLE'> = { zoom: 'ZOOM', google_meet: 'GOOGLE' };

/**
 * Creates a real, live meeting through whichever video provider the administrator has configured
 * (Settings -> Integrations -> Default video provider), unless the caller already supplied a
 * meeting URL by hand or asked to skip it. Failures here are reported, never silently swallowed
 * into a fake-looking success -- but they also never block the calendar event itself from being
 * created, since a session can still happen with a manually-shared link added afterwards.
 */
type LiveMeetingAttempt =
  | { ok: true; meeting: { joinUrl: string; externalId: string }; provider: VideoProvider }
  | { ok: false; error: string; provider: VideoProvider };

async function tryCreateLiveMeeting(ctx: Ctx, input: { title: string; description?: string | null; startsAt: Date; endsAt: Date; timezone?: string }): Promise<LiveMeetingAttempt | null> {
  const provider = await resolveVideoProvider(ctx);
  if (!provider) return null;
  try {
    const meeting = await createVideoMeeting(provider, { title: input.title, description: input.description ?? null, startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone });
    return { ok: true, meeting, provider };
  } catch (e) {
    // Honest failure: no meeting URL is fabricated. The calendar event is still created, with
    // sync_error-style context recorded via the audit log the caller already writes.
    return { ok: false, error: String((e as Error).message ?? e), provider };
  }
}

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

export async function createEvent(ctx: Ctx, cohortId: string, input: { title: string; description?: string | null; startsAt: string; endsAt: string; timezone?: string; location?: string | null; meetingUrl?: string | null; sessionId?: string | null; connectionId?: string | null; provider?: 'GOOGLE' | 'MICROSOFT' | 'ICS' | 'INTERNAL' | 'ZOOM'; skipLiveMeeting?: boolean; metadata?: unknown }) {
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
  let meetingUrl = input.meetingUrl ?? null;
  let provider = input.provider ?? 'INTERNAL';
  let syncError: string | null = null;
  let metadata = (input.metadata as Record<string, unknown> | undefined) ?? {};
  // Only reach for a real, administrator-configured video provider when the caller hasn't already
  // supplied a link and hasn't opted out (e.g. an in-person session recorded on the calendar).
  if (!meetingUrl && !input.skipLiveMeeting) {
    const live = await tryCreateLiveMeeting(ctx, { title: input.title.trim(), description: input.description, startsAt, endsAt, timezone: input.timezone });
    if (live?.ok) {
      meetingUrl = live.meeting.joinUrl;
      provider = CALENDAR_PROVIDER_FOR_VIDEO[live.provider];
      metadata = { ...metadata, videoProvider: live.provider, externalMeetingId: live.meeting.externalId };
    } else if (live && !live.ok) {
      syncError = live.error;
    }
  }
  const [row] = await ctx.db.insert(events).values({ cohortId, sessionId: input.sessionId ?? null, connectionId: input.connectionId ?? null, provider, title: input.title.trim(), description: input.description ?? null, startsAt, endsAt, timezone: input.timezone ?? 'UTC', location: input.location ?? null, meetingUrl, status: syncError ? 'SYNC_ERROR' : 'SCHEDULED', syncError, metadata, createdBy: need(ctx).user.id }).returning();
  await audit(ctx, 'calendar.event.created', 'calendar_event', row.id, undefined, { cohortId, sessionId: row.sessionId, provider: row.provider, liveMeetingCreated: !!meetingUrl && provider !== 'INTERNAL', syncError });
  return row;
}

export async function scheduleSession(ctx: Ctx, sessionId: string, input: { connectionId?: string | null; provider?: 'GOOGLE' | 'MICROSOFT' | 'ICS' | 'INTERNAL' | 'ZOOM'; timezone?: string; skipLiveMeeting?: boolean }) {
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
    // A manually-typed meetingUrl already on the session (set via delivery-operations.ts) is
    // honored as-is; otherwise createEvent reaches for a live-created meeting on its own.
    meetingUrl: session.meetingUrl,
    sessionId,
    connectionId: input.connectionId ?? null,
    provider: input.provider,
    skipLiveMeeting: input.skipLiveMeeting,
  });
  // The session's own meetingUrl column is the one delivery-coordination/provider views read, so
  // keep it in sync when a live meeting was just created for this calendar event.
  if (event.meetingUrl && event.meetingUrl !== session.meetingUrl) {
    await ctx.db.update(sessions).set({ meetingUrl: event.meetingUrl, updatedAt: new Date() }).where(eq(sessions.id, sessionId));
  }
  return event;
}

export async function cancelEvent(ctx: Ctx, id: string) {
  allow(ctx, 'programme_workspaces', 'edit');
  const [row] = await ctx.db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!row) throw notFound('Calendar event not found');
  await getCohort(ctx, row.cohortId);
  if (row.status === 'CANCELLED') return { ok: true };
  const meta = row.metadata as { videoProvider?: 'zoom' | 'google_meet'; externalMeetingId?: string } | null;
  if (meta?.videoProvider && meta?.externalMeetingId) {
    // Best-effort: cancelling the live meeting must never block cancelling the calendar record,
    // which is the source of truth participants and providers actually see.
    try { await cancelVideoMeeting(meta.videoProvider, meta.externalMeetingId); } catch { /* already gone, or provider unreachable -- the calendar event is cancelled regardless */ }
  }
  await ctx.db.update(events).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(events.id, id));
  await audit(ctx, 'calendar.event.cancelled', 'calendar_event', id, { status: row.status }, { status: 'CANCELLED' });
  return { ok: true };
}
