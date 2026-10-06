import { z } from 'zod';
import { defineRoute, status } from '../framework';
import * as communications from '@/services/programme-communications';

const W = 'Programme workspace';
const channels = z.enum(['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP']);
const notificationInput = z.object({
  recipientUserId: z.string().uuid(), programmeId: z.string().uuid().nullish(), cohortId: z.string().uuid().nullish(),
  channel: channels.optional(), eventId: z.string().uuid().nullish(), templateKey: z.string().max(150).nullish(),
  subject: z.string().trim().max(300).nullish(), body: z.string().trim().min(1).max(10000), metadata: z.unknown().optional(),
});
const eventInput = z.object({ programmeId: z.string().uuid().nullish(), cohortId: z.string().uuid().nullish(), eventType: z.string().trim().min(1).max(150), entityType: z.string().trim().min(1).max(100), entityId: z.string().uuid().nullish(), payload: z.unknown().optional() });
const preferenceInput = z.object({ userId: z.string().uuid(), programmeId: z.string().uuid().nullish(), channel: channels, enabled: z.boolean() });

defineRoute({ method: 'GET', path: '/notifications', tag: W, summary: 'List my notifications', permission: ['notifications', 'read'], handler: ({ ctx, query }) => communications.listNotifications(ctx, query.status) });
defineRoute({ method: 'POST', path: '/notifications/:id/read', tag: W, summary: 'Mark notification read', permission: ['notifications', 'read'], handler: ({ ctx, params }) => communications.markNotificationRead(ctx, params.id) });
defineRoute({ method: 'GET', path: '/programmes/:id/notifications', tag: W, summary: 'List programme notifications', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => communications.listProgrammeNotifications(ctx, params.id) });
defineRoute({ method: 'POST', path: '/notifications/events', tag: W, summary: 'Create notification event', permission: ['programme_workspaces', 'edit'], body: eventInput, handler: async ({ ctx, body }) => status(201, await communications.createEvent(ctx, body)) });
defineRoute({ method: 'POST', path: '/notifications/send', tag: W, summary: 'Queue or send notification', permission: ['programme_workspaces', 'edit'], body: notificationInput, handler: async ({ ctx, body }) => status(201, await communications.sendNotification(ctx, body)) });
defineRoute({ method: 'POST', path: '/notifications/preferences', tag: W, summary: 'Set notification preference', permission: ['notifications', 'edit'], body: preferenceInput, handler: async ({ ctx, body }) => status(201, await communications.upsertPreference(ctx, body)) });
defineRoute({ method: 'GET', path: '/notification-templates', tag: W, summary: 'List notification templates', permission: ['programme_workspaces', 'read'], handler: ({ ctx, query }) => communications.listTemplates(ctx, query.programmeId) });
