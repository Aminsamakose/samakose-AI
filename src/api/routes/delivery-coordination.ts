import { z } from 'zod';
import { defineRoute, status } from '../framework';
import * as coordination from '@/services/delivery-coordination';

const W = 'Programme workspace';
const taskInput = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().trim().max(5000).nullish(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(), assignedTo: z.string().uuid().nullish(),
  activityId: z.string().uuid().nullish(), sessionId: z.string().uuid().nullish(),
  dueAt: z.string().datetime().nullish(), metadata: z.unknown().optional(),
});
const taskStatus = z.object({ status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']) });
const milestoneInput = z.object({ name: z.string().trim().min(1).max(200), description: z.string().trim().max(5000).nullish(), dueAt: z.string().datetime(), ownerUserId: z.string().uuid().nullish(), metadata: z.unknown().optional() });
const milestoneStatus = z.object({ status: z.enum(['PLANNED', 'AT_RISK', 'ACHIEVED', 'MISSED', 'CANCELLED']) });
const exceptionInput = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().trim().max(5000).nullish(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(), ownerUserId: z.string().uuid().nullish(),
  activityId: z.string().uuid().nullish(), sessionId: z.string().uuid().nullish(), taskId: z.string().uuid().nullish(), metadata: z.unknown().optional(),
});
const exceptionStatus = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']), resolution: z.string().trim().max(5000).nullish() });

defineRoute({ method: 'GET', path: '/cohorts/:id/coordination', tag: W, summary: 'Get delivery coordination summary', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => coordination.coordinationSummary(ctx, params.id) });
defineRoute({ method: 'GET', path: '/cohorts/:id/delivery-tasks', tag: W, summary: 'List delivery tasks', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => coordination.listTasks(ctx, params.id) });
defineRoute({ method: 'POST', path: '/cohorts/:id/delivery-tasks', tag: W, summary: 'Create delivery task', permission: ['programme_workspaces', 'edit'], body: taskInput, handler: async ({ ctx, params, body }) => status(201, await coordination.createTask(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/delivery-tasks/:id/status', tag: W, summary: 'Update delivery task status', permission: ['programme_workspaces', 'edit'], body: taskStatus, handler: ({ ctx, params, body }) => coordination.updateTaskStatus(ctx, params.id, body.status) });
defineRoute({ method: 'GET', path: '/cohorts/:id/delivery-milestones', tag: W, summary: 'List delivery milestones', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => coordination.listMilestones(ctx, params.id) });
defineRoute({ method: 'POST', path: '/cohorts/:id/delivery-milestones', tag: W, summary: 'Create delivery milestone', permission: ['programme_workspaces', 'edit'], body: milestoneInput, handler: async ({ ctx, params, body }) => status(201, await coordination.createMilestone(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/delivery-milestones/:id/status', tag: W, summary: 'Update delivery milestone status', permission: ['programme_workspaces', 'edit'], body: milestoneStatus, handler: ({ ctx, params, body }) => coordination.updateMilestoneStatus(ctx, params.id, body.status) });
defineRoute({ method: 'GET', path: '/cohorts/:id/delivery-exceptions', tag: W, summary: 'List delivery exceptions', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => coordination.listExceptions(ctx, params.id) });
defineRoute({ method: 'POST', path: '/cohorts/:id/delivery-exceptions', tag: W, summary: 'Create delivery exception', permission: ['programme_workspaces', 'edit'], body: exceptionInput, handler: async ({ ctx, params, body }) => status(201, await coordination.createException(ctx, params.id, body) ) });
defineRoute({ method: 'POST', path: '/delivery-exceptions/:id/status', tag: W, summary: 'Update delivery exception status', permission: ['programme_workspaces', 'edit'], body: exceptionStatus, handler: ({ ctx, params, body }) => coordination.updateExceptionStatus(ctx, params.id, body.status, body.resolution) });
