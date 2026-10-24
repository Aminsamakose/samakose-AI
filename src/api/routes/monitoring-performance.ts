import { z } from 'zod';
import { defineRoute, status } from '../framework';
import * as monitoring from '@/services/monitoring-performance';

const W = 'Monitoring & performance';
const periodQuery = z.object({ periodStart: z.string().datetime(), periodEnd: z.string().datetime() });
const snapshotInput = z.object({ periodStart: z.string().datetime(), periodEnd: z.string().datetime(), cohortId: z.string().uuid().nullish() });
const reviewInput = z.object({
  providerAssignmentId: z.string().uuid(), periodStart: z.string().datetime(), periodEnd: z.string().datetime(),
  humanPerformanceScore: z.number().min(0).max(100).nullish(), serviceQualityScore: z.number().min(0).max(100).nullish(),
  clientExperienceScore: z.number().min(0).max(100).nullish(), businessOutcomeScore: z.number().min(0).max(100).nullish(),
  evidence: z.unknown().optional(), notes: z.string().trim().max(5000).nullish(),
});

defineRoute({ method: 'GET', path: '/programme-workspaces/:id/monitoring/summary', tag: W, summary: 'Get live programme monitoring summary', permission: ['monitoring', 'read'], query: periodQuery.partial(), handler: ({ ctx, params, query }) => monitoring.monitoringSummary(ctx, params.id, query.periodStart, query.periodEnd) });
defineRoute({ method: 'GET', path: '/programme-workspaces/:id/monitoring/snapshots', tag: W, summary: 'List programme monitoring snapshots', permission: ['monitoring', 'read'], handler: ({ ctx, params }) => monitoring.listSnapshots(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/monitoring/snapshots', tag: W, summary: 'Create a monitoring snapshot', permission: ['monitoring', 'create'], body: snapshotInput, handler: async ({ ctx, params, body }) => status(201, await monitoring.createSnapshot(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/monitoring-snapshots/:id/finalize', tag: W, summary: 'Finalize a monitoring snapshot', permission: ['monitoring', 'approve'], handler: ({ ctx, params }) => monitoring.finalizeSnapshot(ctx, params.id) });
defineRoute({ method: 'GET', path: '/programme-workspaces/:id/provider-performance', tag: W, summary: 'Get provider operational and performance monitoring', permission: ['monitoring', 'read'], query: periodQuery, handler: ({ ctx, params, query }) => monitoring.providerPerformance(ctx, params.id, query.periodStart, query.periodEnd) });
defineRoute({ method: 'POST', path: '/programme-workspaces/:id/provider-performance/reviews', tag: W, summary: 'Save an evidence-backed provider performance review', permission: ['monitoring', 'edit'], body: reviewInput, handler: ({ ctx, params, body }) => monitoring.upsertPerformanceReview(ctx, params.id, body) });
defineRoute({ method: 'POST', path: '/provider-performance-reviews/:id/finalize', tag: W, summary: 'Finalize a provider performance review', permission: ['monitoring', 'approve'], handler: ({ ctx, params }) => monitoring.finalizePerformanceReview(ctx, params.id) });
