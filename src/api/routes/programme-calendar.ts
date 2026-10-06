import { z } from 'zod';
import { defineRoute, status } from '../framework';
import * as calendar from '@/services/programme-calendar';

const W = 'Programme workspace';
const provider = z.enum(['GOOGLE', 'MICROSOFT', 'ICS', 'INTERNAL']);

const connectionInput = z.object({
  provider,
  externalCalendarId: z.string().trim().max(500).nullish(),
  accountLabel: z.string().trim().max(200).nullish(),
  metadata: z.unknown().optional(),
});

const eventInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().trim().min(1).max(100).optional(),
  location: z.string().trim().max(1000).nullish(),
  meetingUrl: z.string().url().nullish(),
  sessionId: z.string().uuid().nullish(),
  connectionId: z.string().uuid().nullish(),
  provider,
  metadata: z.unknown().optional(),
});

const scheduleInput = z.object({
  connectionId: z.string().uuid().nullish(),
  provider,
  timezone: z.string().trim().min(1).max(100).optional(),
});

defineRoute({ method: 'GET', path: '/calendar/connections', tag: W, summary: 'List current user calendar connections', permission: ['programme_workspaces', 'read'], handler: ({ ctx }) => calendar.listConnections(ctx) });
defineRoute({ method: 'POST', path: '/calendar/connections', tag: W, summary: 'Connect a calendar provider', permission: ['programme_workspaces', 'edit'], body: connectionInput, handler: async ({ ctx, body }) => status(201, await calendar.upsertConnection(ctx, body)) });
defineRoute({ method: 'POST', path: '/calendar/connections/:id/disconnect', tag: W, summary: 'Disconnect a calendar provider', permission: ['programme_workspaces', 'edit'], handler: ({ ctx, params }) => calendar.disconnectConnection(ctx, params.id) });
defineRoute({ method: 'GET', path: '/cohorts/:id/calendar-events', tag: W, summary: 'List calendar events for a cohort', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => calendar.listEvents(ctx, params.id) });
defineRoute({ method: 'POST', path: '/cohorts/:id/calendar-events', tag: W, summary: 'Create a calendar event', permission: ['programme_workspaces', 'edit'], body: eventInput, handler: async ({ ctx, params, body }) => status(201, await calendar.createEvent(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/delivery-sessions/:id/calendar', tag: W, summary: 'Schedule a delivery session on the calendar', permission: ['programme_workspaces', 'edit'], body: scheduleInput, handler: async ({ ctx, params, body }) => status(201, await calendar.scheduleSession(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/calendar-events/:id/cancel', tag: W, summary: 'Cancel a calendar event', permission: ['programme_workspaces', 'edit'], handler: ({ ctx, params }) => calendar.cancelEvent(ctx, params.id) });
