import { z } from 'zod';
import { badRequest } from '@/lib/errors';
import { defineRoute } from '../framework';
import { empty, text, uuid } from '../schemas';
import * as photos from '@/services/photos';
import * as prac from '@/services/practitioners';
import * as asg from '@/services/assignments';
import * as rat from '@/services/ratings';

const N = 'Practitioner network';
const list = z.array(z.string()).max(40);

/* ------------------------------- photos ------------------------------- */
/** Your own record: "me" is not an identifier, so these are separate paths. */
defineRoute({ method: 'POST', path: '/me/photo', tag: N, summary: 'Upload or replace your profile photo (multipart: file)', multipart: true, handler: async ({ ctx, req }) => {
  let form: FormData; try { form = await req.formData(); } catch { throw badRequest('Send the photo as multipart form data'); }
  return photos.uploadPhoto(ctx, ctx.user!.id, form);
} });
defineRoute({ method: 'DELETE', path: '/me/photo', tag: N, summary: 'Remove your profile photo', handler: ({ ctx }) => photos.removePhoto(ctx, ctx.user!.id) });
defineRoute({ method: 'GET', path: '/users/:id/photo', tag: N, summary: 'A person\'s profile photo, if you may see it', handler: ({ ctx, params }) => photos.readPhoto(ctx, params.id) });
defineRoute({ method: 'POST', path: '/users/:id/photo', tag: N, summary: 'Upload or replace a person\'s profile photo (multipart: file). Administrators only; people use /me/photo', multipart: true, handler: async ({ ctx, req, params }) => {
  let form: FormData; try { form = await req.formData(); } catch { throw badRequest('Send the photo as multipart form data'); }
  return photos.uploadPhoto(ctx, params.id, form);
} });
defineRoute({ method: 'DELETE', path: '/users/:id/photo', tag: N, summary: 'Remove a profile photo', handler: ({ ctx, params }) => photos.removePhoto(ctx, params.id) });

/* ------------------------------ profiles ------------------------------- */
const cred = z.object({ type: z.string().max(40), title: z.string().max(160), issuer: z.string().max(120).optional(), year: z.number().int().min(1950).max(2100).optional() });
const profileBody = z.object({
  functions: z.array(z.enum(['expert', 'coach'])).min(1).max(2), headline: z.string().max(140).nullish(), bio: z.string().max(2000).nullish(), specialisations: list, strengths: list, sectors: list, platforms: list,
  businessSizes: list, languages: list, regions: list, deliveryModes: list, yearsExperience: z.number().int().min(0).max(70).nullable(), credentials: z.array(cred).max(20),
  maxActive: z.number().int().min(1).max(50), availability: z.enum(['Available', 'Limited', 'Unavailable']), rateNote: z.string().max(500).nullish(), acceptConduct: z.boolean()
}).partial();
defineRoute({ method: 'GET', path: '/practitioners', tag: N, summary: 'List practitioners with vetting status, load and completeness', permission: ['practitioners', 'read'], query: z.object({ status: z.string().optional(), platform: z.string().optional(), availability: z.string().optional(), q: z.string().optional() }), handler: ({ ctx, query }) => prac.listPractitioners(ctx, query) });
defineRoute({ method: 'GET', path: '/practitioners/:id', tag: N, summary: 'One practitioner profile (use me for your own)', permission: ['practitioners', 'read'], handler: ({ ctx, params }) => prac.getProfile(ctx, params.id) });
defineRoute({ method: 'PATCH', path: '/practitioners/:id', tag: N, summary: 'Edit a practitioner profile. Yourself, or an administrator', permission: ['practitioners', 'edit'], body: profileBody, handler: ({ ctx, params, body }) => prac.updateProfile(ctx, params.id, body as prac.ProfileInput) });
defineRoute({ method: 'POST', path: '/practitioners/:id/submit', tag: N, summary: 'Submit your profile for vetting', permission: ['practitioners', 'edit'], body: empty, handler: ({ ctx, params }) => prac.submitProfile(ctx, params.id) });
defineRoute({ method: 'POST', path: '/practitioners/:id/decision', tag: N, summary: 'Approve, reject, suspend or return a profile. Administrator only', permission: ['practitioners', 'approve'], body: z.object({ decision: z.enum(['Approved', 'Rejected', 'Suspended', 'Draft']), note: z.string().max(1000).nullish() }), handler: ({ ctx, params, body }) => prac.decideVetting(ctx, params.id, body) });
defineRoute({ method: 'GET', path: '/practitioners/:id/conflicts', tag: N, summary: 'Businesses this practitioner must not serve', permission: ['practitioners', 'read'], handler: ({ ctx, params }) => prac.listConflicts(ctx, params.id) });
defineRoute({ method: 'POST', path: '/practitioners/:id/conflicts', tag: N, summary: 'Declare a conflict with a business', permission: ['practitioners', 'edit'], body: z.object({ orgId: uuid, reason: text(5, 500) }), handler: ({ ctx, params, body }) => prac.addConflict(ctx, params.id, body) });
defineRoute({ method: 'DELETE', path: '/practitioners/:id/conflicts/:conflictId', tag: N, summary: 'Remove a declared conflict. Administrator only', permission: ['practitioners', 'approve'], handler: ({ ctx, params }) => prac.removeConflict(ctx, params.id, params.conflictId) });
defineRoute({ method: 'GET', path: '/practitioners/:id/performance', tag: N, summary: 'Performance with sample size and confidence. The person and administrators', permission: ['practitioners', 'read'], handler: ({ ctx, params }) => rat.performanceFor(ctx, params.id) });

defineRoute({ method: 'GET', path: '/practitioners/:id/caseload', tag: N, summary: 'Active cases a practitioner is working on', permission: ['cases', 'assign'], handler: ({ ctx, params }) => asg.caseloadOf(ctx, params.id) });
defineRoute({ method: 'POST', path: '/practitioners/:id/transfer-caseload', tag: N, summary: 'Hand all of one expert\'s active cases to another. Cases that cannot move are reported', permission: ['cases', 'assign'], body: z.object({ toUserId: uuid, reason: text(5, 500) }), handler: ({ ctx, params, body }) => asg.transferCaseload(ctx, params.id, body) });
defineRoute({ method: 'GET', path: '/me/practitioner', tag: N, summary: 'Your own practitioner profile', permission: ['practitioners', 'read'], handler: ({ ctx }) => prac.getProfile(ctx, ctx.user!.id) });
defineRoute({ method: 'PATCH', path: '/me/practitioner', tag: N, summary: 'Edit your own practitioner profile', permission: ['practitioners', 'edit'], body: profileBody, handler: ({ ctx, body }) => prac.updateProfile(ctx, ctx.user!.id, body as prac.ProfileInput) });
defineRoute({ method: 'POST', path: '/me/practitioner/submit', tag: N, summary: 'Submit your profile for vetting', permission: ['practitioners', 'edit'], body: empty, handler: ({ ctx }) => prac.submitProfile(ctx, ctx.user!.id) });
defineRoute({ method: 'GET', path: '/me/practitioner/conflicts', tag: N, summary: 'Your declared conflicts', permission: ['practitioners', 'read'], handler: ({ ctx }) => prac.listConflicts(ctx, ctx.user!.id) });
defineRoute({ method: 'POST', path: '/me/practitioner/conflicts', tag: N, summary: 'Declare a conflict with a business', permission: ['practitioners', 'edit'], body: z.object({ orgId: uuid, reason: text(5, 500) }), handler: ({ ctx, body }) => prac.addConflict(ctx, ctx.user!.id, body) });
defineRoute({ method: 'GET', path: '/me/practitioner/performance', tag: N, summary: 'Your performance with sample size and confidence', permission: ['practitioners', 'read'], handler: ({ ctx }) => rat.performanceFor(ctx, ctx.user!.id) });

/* ----------------------------- assignments ----------------------------- */
defineRoute({ method: 'GET', path: '/cases/:id/team', tag: N, summary: 'The people on a case, with history for staff', permission: ['cases', 'read'], handler: ({ ctx, params }) => asg.caseTeam(ctx, params.id) });
defineRoute({ method: 'GET', path: '/cases/:id/matches', tag: N, summary: 'Recommended practitioners for a kind of work, explained', permission: ['cases', 'assign'], query: z.object({ fn: z.enum(['lead', 'specialist', 'coach']), specialisation: z.string().max(80).optional() }), handler: ({ ctx, params, query }) => asg.matches(ctx, params.id, query) });
defineRoute({ method: 'POST', path: '/cases/:id/specialists', tag: N, summary: 'Add a specialist expert to a case', permission: ['cases', 'assign'], body: z.object({ userId: uuid, specialisation: z.string().max(80).nullish(), reason: z.string().max(500).nullish() }), handler: ({ ctx, params, body }) => asg.addSpecialist(ctx, params.id, body) });
defineRoute({ method: 'DELETE', path: '/cases/:id/specialists/:userId', tag: N, summary: 'Remove a specialist from a case, with a reason', permission: ['cases', 'assign'], query: z.object({ reason: z.string().max(500).optional() }), handler: ({ ctx, params, query }) => asg.removeSpecialist(ctx, params.id, params.userId, query.reason) });
defineRoute({ method: 'POST', path: '/assignments/:id/respond', tag: N, summary: 'Accept an assignment, or decline it with a reason', permission: ['cases', 'read'], body: z.object({ decision: z.enum(['accept', 'decline']), reason: z.string().max(500).nullish() }), handler: ({ ctx, params, body }) => asg.respond(ctx, params.id, body) });

/* ------------------------------- ratings ------------------------------- */
defineRoute({ method: 'GET', path: '/ratings/pending', tag: N, summary: 'Engagements you can rate and have not yet rated', permission: ['ratings', 'create'], handler: ({ ctx }) => rat.pending(ctx) });
defineRoute({ method: 'GET', path: '/assignments/:id/rating', tag: N, summary: 'The rating form for an engagement, with your previous answer', permission: ['ratings', 'create'], handler: ({ ctx, params }) => rat.ratingForm(ctx, params.id) });
defineRoute({ method: 'POST', path: '/assignments/:id/rating', tag: N, summary: 'Rate an engagement. Ratings are never edited; a correction is a new rating', permission: ['ratings', 'create'], body: z.object({ scores: z.record(z.string(), z.number()), comment: z.string().max(1000).nullish() }), handler: ({ ctx, params, body }) => rat.rate(ctx, params.id, body) });
