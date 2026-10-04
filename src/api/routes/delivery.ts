import { z } from 'zod';
import { defineRoute, status } from '../framework';
import { empty } from '../schemas';
import * as messages from '@/services/messages';
import * as sla from '@/services/sla';

const M = 'Messages';
defineRoute({ method: 'GET', path: '/cases/:id/messages', tag: M, summary: 'The message thread on a case. Oversight reads by a manager are audited', permission: ['messages', 'read'], handler: ({ ctx, params }) => messages.listMessages(ctx, params.id) });
defineRoute({ method: 'POST', path: '/cases/:id/messages', tag: M, summary: 'Send a message to the people on the case', permission: ['messages', 'create'], body: z.object({ body: z.string().max(4000) }), handler: async ({ ctx, params, body }) => status(201, await messages.sendMessage(ctx, params.id, body.body)) });
defineRoute({ method: 'POST', path: '/cases/:id/messages/read', tag: M, summary: 'Mark the thread as read', permission: ['messages', 'read'], body: empty, handler: ({ ctx, params }) => messages.markRead(ctx, params.id) });
defineRoute({ method: 'GET', path: '/messages/unread', tag: M, summary: 'Unread messages across your cases', permission: ['messages', 'read'], handler: ({ ctx }) => messages.unreadCount(ctx) });
defineRoute({ method: 'GET', path: '/escalations', tag: 'Delivery', summary: 'Open escalations: stalled cases and sessions with no recorded outcome', permission: ['escalations', 'read'], handler: ({ ctx }) => sla.listEscalations(ctx) });
