import { z } from 'zod';
import { defineRoute, status } from '../framework';
import * as delivery from '@/services/delivery-operations';

const W = 'Programme workspace';
const activityInput = z.object({
  name: z.string().trim().min(1).max(200),
  activityType: z.string().trim().max(100).optional(),
  description: z.string().trim().max(5000).nullish(),
  sequence: z.number().int().min(1).optional(),
  scheduledStart: z.string().datetime().nullish(),
  scheduledEnd: z.string().datetime().nullish(),
  ownerUserId: z.string().uuid().nullish(),
  cohortConfigurationVersion: z.number().int().min(1).nullish(),
  metadata: z.unknown().optional(),
});
const sessionInput = z.object({
  facilitatorUserId: z.string().uuid().nullish(),
  mode: z.enum(['IN_PERSON', 'REMOTE', 'HYBRID', 'SELF_PACED']).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  location: z.string().trim().max(500).nullish(),
  meetingUrl: z.string().url().nullish(),
  capacity: z.number().int().positive().nullish(),
  notes: z.string().trim().max(5000).nullish(),
  metadata: z.unknown().optional(),
});
const activityStatus = z.object({ status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) });
const sessionStatus = z.object({ status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) });
const attendanceInput = z.object({
  status: z.enum(['PRESENT', 'ABSENT', 'EXCUSED', 'LATE']),
  arrivedAt: z.string().datetime().nullish(),
  note: z.string().trim().max(2000).nullish(),
});

defineRoute({ method: 'GET', path: '/cohorts/:id/activities', tag: W, summary: 'List delivery activities for a cohort', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => delivery.listActivities(ctx, params.id) });
defineRoute({ method: 'POST', path: '/cohorts/:id/activities', tag: W, summary: 'Create a cohort delivery activity', permission: ['programme_workspaces', 'edit'], body: activityInput, handler: async ({ ctx, params, body }) => status(201, await delivery.createActivity(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/delivery-activities/:id/status', tag: W, summary: 'Update delivery activity status', permission: ['programme_workspaces', 'edit'], body: activityStatus, handler: ({ ctx, params, body }) => delivery.updateActivityStatus(ctx, params.id, body.status) });
defineRoute({ method: 'GET', path: '/cohorts/:id/delivery-sessions', tag: W, summary: 'List delivery sessions for a cohort', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => delivery.listSessions(ctx, params.id) });
defineRoute({ method: 'POST', path: '/delivery-activities/:id/sessions', tag: W, summary: 'Schedule a delivery session', permission: ['programme_workspaces', 'edit'], body: sessionInput, handler: async ({ ctx, params, body }) => status(201, await delivery.createSession(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/delivery-sessions/:id/status', tag: W, summary: 'Update delivery session status', permission: ['programme_workspaces', 'edit'], body: sessionStatus, handler: ({ ctx, params, body }) => delivery.updateSessionStatus(ctx, params.id, body.status) });
defineRoute({ method: 'GET', path: '/delivery-sessions/:id/attendance', tag: W, summary: 'List session attendance', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => delivery.listAttendance(ctx, params.id) });
defineRoute({ method: 'POST', path: '/delivery-sessions/:id/attendance/:participantId', tag: W, summary: 'Record participant attendance', permission: ['programme_workspaces', 'edit'], body: attendanceInput, handler: ({ ctx, params, body }) => delivery.recordAttendance(ctx, params.id, params.participantId, body) });
