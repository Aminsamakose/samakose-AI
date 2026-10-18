import { z } from 'zod';
import { defineRoute, status } from '../framework';
import { EVIDENCE_CLASSES } from '@/db/schema';
import * as ov from '@/services/outcome-verification';

const O = 'Outcome verification';
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31');
const evidenceClass = z.enum(EVIDENCE_CLASSES);

const defBody = z.object({
  name: z.string().trim().min(3).max(160),
  unit: z.string().trim().min(1).max(60),
  reportingPeriod: z.string().trim().max(120).nullish(),
  source: z.string().trim().max(200).nullish(),
  verificationRequired: z.boolean().optional(),
});

const recordBody = z.object({
  caseId: z.string().uuid(),
  baselineValue: z.number().nullish(),
  baselineDate: isoDate.nullish(),
  followupValue: z.number().nullish(),
  followupDate: isoDate.nullish(),
  evidenceClass: evidenceClass.optional(),
  documentId: z.string().uuid().nullish(),
  attributionNote: z.string().trim().max(1000).nullish(),
});

defineRoute({ method: 'GET', path: '/programmes/:id/outcome-definitions', tag: O, summary: 'List outcome definitions for a programme', permission: ['programmes', 'read'], handler: ({ ctx, params }) => ov.listDefinitions(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programmes/:id/outcome-definitions', tag: O, summary: 'Define a real-world outcome this programme is funded to produce', permission: ['programmes', 'edit'], body: defBody, handler: async ({ ctx, params, body }) => status(201, await ov.createDefinition(ctx, params.id, body as any)) });
defineRoute({ method: 'PATCH', path: '/outcome-definitions/:id', tag: O, summary: 'Change an outcome definition', permission: ['programmes', 'edit'], body: defBody.partial(), handler: ({ ctx, params, body }) => ov.updateDefinition(ctx, params.id, body as any) });
defineRoute({ method: 'DELETE', path: '/outcome-definitions/:id', tag: O, summary: 'Remove an outcome definition with no recorded results', permission: ['programmes', 'edit'], handler: ({ ctx, params }) => ov.deleteDefinition(ctx, params.id) });

defineRoute({ method: 'GET', path: '/outcome-definitions/:id/records', tag: O, summary: 'List recorded results against one outcome definition', permission: ['programmes', 'read'], handler: ({ ctx, params }) => ov.listRecords(ctx, params.id) });
defineRoute({ method: 'POST', path: '/outcome-definitions/:id/records', tag: O, summary: 'Record one enterprise’s baseline and/or followup result', permission: ['programmes', 'edit'], body: recordBody, handler: async ({ ctx, params, body }) => status(201, await ov.recordOutcome(ctx, params.id, body as any)) });
defineRoute({ method: 'POST', path: '/outcome-records/:id/verify', tag: O, summary: 'Verify or reject a recorded result, with a reason', permission: ['programmes', 'edit'], body: z.object({ decision: z.enum(['VERIFIED', 'REJECTED']), reason: z.string().trim().min(3).max(1000) }), handler: ({ ctx, params, body }) => ov.verifyOutcome(ctx, params.id, body as any) });
defineRoute({ method: 'POST', path: '/outcome-records/:id/correct', tag: O, summary: 'Correct a decided record by superseding it, preserving the original', permission: ['programmes', 'edit'], body: recordBody.partial({ caseId: true }).extend({ reason: z.string().trim().min(3).max(1000) }), handler: async ({ ctx, params, body }) => status(201, await ov.correctOutcome(ctx, params.id, body as any)) });
