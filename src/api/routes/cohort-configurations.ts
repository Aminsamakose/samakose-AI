import { z } from 'zod';
import { defineRoute, status } from '../framework';
import * as config from '@/services/cohort-configuration';

const W = 'Programme workspace';
const deliveryMode = z.enum(['IN_PERSON', 'REMOTE', 'HYBRID', 'SELF_PACED']);
const json = z.unknown();
const input = z.object({
  deliveryMode: deliveryMode.optional(),
  schedule: json.optional(),
  milestones: json.optional(),
  serviceLevels: json.optional(),
  providerPlan: json.optional(),
  sessionPlan: json.optional(),
  changeReason: z.string().trim().max(1000).nullish(),
});

defineRoute({ method: 'GET', path: '/cohorts/:id/configurations', tag: W, summary: 'List versioned cohort delivery configurations', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => config.listCohortConfigurations(ctx, params.id) });
defineRoute({ method: 'GET', path: '/cohorts/:id/configuration', tag: W, summary: 'Get the current approved cohort delivery configuration', permission: ['programme_workspaces', 'read'], handler: ({ ctx, params }) => config.getCurrentCohortConfiguration(ctx, params.id) });
defineRoute({ method: 'POST', path: '/cohorts/:id/configurations', tag: W, summary: 'Create a cohort delivery configuration draft', permission: ['programme_workspaces', 'edit'], body: input, handler: async ({ ctx, params, body }) => status(201, await config.createCohortConfigurationDraft(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/cohorts/:id/configurations/:version/submit', tag: W, summary: 'Submit a cohort delivery configuration', permission: ['programme_workspaces', 'edit'], handler: ({ ctx, params }) => config.submitCohortConfiguration(ctx, params.id, Number(params.version)) });
defineRoute({ method: 'POST', path: '/cohorts/:id/configurations/:version/approve', tag: W, summary: 'Approve a submitted cohort delivery configuration', permission: ['programme_workspaces', 'edit'], handler: ({ ctx, params }) => config.approveCohortConfiguration(ctx, params.id, Number(params.version)) });
defineRoute({ method: 'POST', path: '/cohorts/:id/configurations/:version/reject', tag: W, summary: 'Reject a submitted cohort delivery configuration', permission: ['programme_workspaces', 'edit'], body: z.object({ reason: z.string().trim().min(3).max(1000) }), handler: ({ ctx, params, body }) => config.rejectCohortConfiguration(ctx, params.id, Number(params.version), body.reason) });
defineRoute({ method: 'POST', path: '/cohorts/:id/configurations/:version/revise', tag: W, summary: 'Create a new draft from a rejected cohort configuration', permission: ['programme_workspaces', 'edit'], body: z.object({ changeReason: z.string().trim().max(1000).optional() }), handler: ({ ctx, params, body }) => config.reviseRejectedCohortConfiguration(ctx, params.id, Number(params.version), body.changeReason) });
