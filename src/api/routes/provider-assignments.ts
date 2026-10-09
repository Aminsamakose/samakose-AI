import { z } from 'zod';
import { defineRoute, status } from '../framework';
import * as provider from '@/services/provider-assignment';

const W = 'Programme workspace';
const role = z.enum(['EXPERT', 'COACH']);
const availability = z.enum(['AVAILABLE', 'LIMITED', 'UNAVAILABLE']);
const assignmentStatus = z.enum(['PROPOSED', 'ACTIVE', 'PAUSED', 'ENDED', 'DECLINED']);

const capacityInput = z.object({
  providerUserId: z.string().uuid(), providerRole: role,
  maxActiveAssignments: z.number().int().min(1).max(100),
  maxSessionsPerWeek: z.number().int().min(1).max(500).nullish(),
  weeklyHours: z.number().int().min(1).max(168).nullish(),
  availability: availability.optional(),
  effectiveFrom: z.string().datetime().optional(), effectiveTo: z.string().datetime().nullish(), metadata: z.unknown().optional(),
});
const assignmentInput = z.object({
  providerUserId: z.string().uuid(), providerRole: role, cohortId: z.string().uuid().nullish(),
  allocationPercent: z.number().int().min(1).max(100).optional(), maxParticipants: z.number().int().positive().nullish(),
  startsAt: z.string().datetime().nullish(), endsAt: z.string().datetime().nullish(), reason: z.string().trim().max(2000).nullish(), metadata: z.unknown().optional(),
});
const statusInput = z.object({ status: assignmentStatus, reason: z.string().trim().max(2000).nullish(), scheduleKickoffMeeting: z.boolean().optional() });

defineRoute({ method: 'GET', path: '/programme-workspaces/:id/providers', tag: W, summary: 'List eligible programme providers', permission: ['programme_workspaces', 'read'], query: z.object({ providerRole: role }), handler: ({ ctx, params, query }) => provider.listEligibleProviders(ctx, params.id, query.providerRole) });
defineRoute({ method: 'GET', path: '/programme-workspaces/:id/provider-assignments', tag: W, summary: 'List programme provider assignments', permission: ['programme_workspaces', 'read'], query: z.object({ providerRole: role.optional(), status: assignmentStatus.optional() }), handler: ({ ctx, params, query }) => provider.listAssignments(ctx, params.id, query) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/provider-assignments', tag: W, summary: 'Create a programme provider assignment', permission: ['programme_workspaces', 'assign'], body: assignmentInput, handler: async ({ ctx, params, body }) => status(201, await provider.createAssignment(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/provider-assignments/:id/status', tag: W, summary: 'Update provider assignment status', permission: ['programme_workspaces', 'edit'], body: statusInput, handler: ({ ctx, params, body }) => provider.updateAssignmentStatus(ctx, params.id, body.status, body.reason, { scheduleKickoffMeeting: body.scheduleKickoffMeeting }) });
defineRoute({ method: 'GET', path: '/programme-workspaces/:id/provider-capacity', tag: W, summary: 'List provider capacity and utilisation', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => provider.capacitySummary(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/provider-capacity', tag: W, summary: 'Set programme provider capacity', permission: ['programme_workspaces', 'edit'], body: capacityInput, handler: ({ ctx, params, body }) => provider.setCapacity(ctx, params.id, body) });
