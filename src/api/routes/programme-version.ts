import { z } from 'zod';
import { defineRoute, status } from '../framework';
import * as ver from '@/services/programme-version';

const V = 'Programme version';
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31');

const versionInput = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  funder: z.string().trim().max(200).nullish(),
  startDate: isoDate.nullish(),
  endDate: isoDate.nullish(),
  budgetGhs: z.number().positive().max(1_000_000_000).nullish(),
  changeReason: z.string().trim().max(1000).nullish(),
});

defineRoute({ method: 'GET', path: '/programmes/:id/versions', tag: V, summary: 'List versioned definitions of a programme', permission: ['programmes', 'read'], handler: ({ ctx, params }) => ver.listVersions(ctx, params.id) });
defineRoute({ method: 'GET', path: '/programmes/:id/version', tag: V, summary: 'Get the current approved version of a programme', permission: ['programmes', 'read'], handler: ({ ctx, params }) => ver.getCurrentVersion(ctx, params.id) });
defineRoute({ method: 'POST', path: '/programmes/:id/versions', tag: V, summary: 'Create a new programme version draft', permission: ['programmes', 'edit'], body: versionInput, handler: async ({ ctx, params, body }) => status(201, await ver.createVersionDraft(ctx, params.id, body)) });
defineRoute({ method: 'POST', path: '/programmes/:id/versions/:version/submit', tag: V, summary: 'Submit a programme version for approval', permission: ['programmes', 'edit'], handler: ({ ctx, params }) => ver.submitVersion(ctx, params.id, Number(params.version)) });
// Gated on 'read' at the route level (the common ground between ADMIN and EXECUTIVE, who alone
// may approve) -- the real admin/executive-only check lives in assertApprover (services/programme-version.ts).
defineRoute({ method: 'POST', path: '/programmes/:id/versions/:version/approve', tag: V, summary: 'Approve a submitted programme version (admin/executive only)', permission: ['programmes', 'read'], handler: ({ ctx, params }) => ver.approveVersion(ctx, params.id, Number(params.version)) });
defineRoute({ method: 'POST', path: '/programmes/:id/versions/:version/reject', tag: V, summary: 'Reject a submitted programme version (admin/executive only)', permission: ['programmes', 'read'], body: z.object({ reason: z.string().trim().min(3).max(1000) }), handler: ({ ctx, params, body }) => ver.rejectVersion(ctx, params.id, Number(params.version), body.reason) });
defineRoute({ method: 'POST', path: '/programmes/:id/versions/:version/revise', tag: V, summary: 'Create a new draft from a rejected version', permission: ['programmes', 'edit'], body: z.object({ changeReason: z.string().trim().max(1000).optional() }), handler: ({ ctx, params, body }) => ver.reviseRejectedVersion(ctx, params.id, Number(params.version), body.changeReason) });
