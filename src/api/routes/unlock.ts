import { z } from 'zod';
import { defineRoute, status } from '../framework';
import { empty, isoDate, optText, text, uuid } from '../schemas';
import { CONSENT_SCOPES } from '@/domain/unlock';
import { OPPORTUNITY_TYPES } from '@/db/schema';
import * as unlock from '@/services/unlock';
import * as scout from '@/services/scout';
import { REGIONS } from '@/domain/scout';

const U = 'UNLOCK';
const kind = z.enum(OPPORTUNITY_TYPES);
const amount = z.number().min(0).max(1_000_000_000).nullish();
const oppFields = {
  title: text(3, 160), type: kind, provider: text(2, 160), summary: text(10, 2000),
  url: z.string().trim().max(500).nullish(), valueMin: amount, valueMax: amount, currency: z.string().trim().length(3).toUpperCase().optional(),
  deadline: isoDate.nullish(), criteria: unlock.criteriaSchema.optional()
};
const consentBody = z.object({ scope: z.array(z.enum(CONSENT_SCOPES)).min(1).max(5) });

/* ------------------------------ catalogue ------------------------------- */
defineRoute({ method: 'GET', path: '/opportunities', tag: U, summary: 'Opportunities. Staff see drafts and closed ones; everyone else sees open ones', permission: ['opportunities', 'read'], query: z.object({ status: z.enum(['Draft', 'Open', 'Closed', 'Archived']).optional() }), handler: ({ ctx, query }) => unlock.listOpportunities(ctx, query as any) });
defineRoute({ method: 'POST', path: '/opportunities', tag: U, summary: 'Add an opportunity as a draft', permission: ['opportunities', 'create'], body: z.object(oppFields), handler: async ({ ctx, body }) => status(201, await unlock.createOpportunity(ctx, body as any)) });
defineRoute({ method: 'PATCH', path: '/opportunities/:id', tag: U, summary: 'Change an opportunity', permission: ['opportunities', 'edit'], body: z.object(oppFields).partial(), handler: ({ ctx, params, body }) => unlock.updateOpportunity(ctx, params.id, body as any) });
defineRoute({ method: 'POST', path: '/opportunities/:id/publish', tag: U, summary: 'Publish a draft or reopen a closed opportunity', permission: ['opportunities', 'approve'], body: empty, handler: ({ ctx, params }) => unlock.setOpportunityStatus(ctx, params.id, 'Open') });
defineRoute({ method: 'POST', path: '/opportunities/:id/close', tag: U, summary: 'Stop taking new referrals', permission: ['opportunities', 'edit'], body: empty, handler: ({ ctx, params }) => unlock.setOpportunityStatus(ctx, params.id, 'Closed') });
defineRoute({ method: 'POST', path: '/opportunities/:id/archive', tag: U, summary: 'Remove an opportunity from view', permission: ['opportunities', 'edit'], body: empty, handler: ({ ctx, params }) => unlock.setOpportunityStatus(ctx, params.id, 'Archived') });
defineRoute({ method: 'POST', path: '/opportunities/read', tag: U, summary: 'Opportunity Reader: draft an opportunity from pasted call text. Saves nothing', permission: ['opportunities', 'create'], rateLimit: { key: 'oppread:{ip}', windowSec: 3600, limit: 60 }, body: z.object({ text: z.string().min(1).max(20000) }), handler: ({ ctx, body }) => unlock.readOpportunityText(ctx, body) });
defineRoute({ method: 'POST', path: '/opportunities/import', tag: U, summary: 'Import opportunities found elsewhere (for example SOPIS) as drafts. Safe to repeat', permission: ['opportunities', 'create'],
  body: z.object({ source: z.enum(['sopis', 'import']), items: z.array(z.object({ sourceRef: text(1, 120), title: text(3, 160), type: kind, provider: text(2, 160), summary: text(10, 2000), url: z.string().trim().max(500).nullish(), valueMin: amount, valueMax: amount, currency: z.string().trim().length(3).toUpperCase().optional(), deadline: isoDate.nullish() })).min(1).max(200) }),
  handler: ({ ctx, body }) => unlock.importOpportunities(ctx, body.source, body.items as any) });

/* ------------------------------ pathway --------------------------------- */
defineRoute({ method: 'GET', path: '/organisations/:id/pathway', tag: U, summary: 'What an enterprise can reach now, what it is close to, and its referrals', permission: ['opportunities', 'read'], handler: ({ ctx, params }) => unlock.pathway(ctx, params.id) });
defineRoute({ method: 'POST', path: '/organisations/:id/opportunities/:opportunityId/explain', tag: U, summary: 'Opportunity Matcher: explain in plain words why this business does or does not fit this opportunity', permission: ['opportunities', 'read'], rateLimit: { key: 'oppexplain:{ip}', windowSec: 3600, limit: 120 }, handler: ({ ctx, params }) => unlock.explainMatch(ctx, params.id, params.opportunityId) });
defineRoute({ method: 'POST', path: '/organisations/:id/opportunities/:opportunityId/suggest', tag: U, summary: 'Staff propose an opportunity to an enterprise. The owner must consent', permission: ['referrals', 'create'], body: empty, handler: async ({ ctx, params }) => status(201, await unlock.suggest(ctx, params.id, params.opportunityId)) });
defineRoute({ method: 'POST', path: '/organisations/:id/opportunities/:opportunityId/request', tag: U, summary: 'The owner asks to be referred and consents to named data being shared', permission: ['referrals', 'create'], body: consentBody, handler: async ({ ctx, params, body }) => status(201, await unlock.requestReferral(ctx, params.id, params.opportunityId, body.scope)) });

/* ------------------------------ referrals ------------------------------- */
defineRoute({ method: 'GET', path: '/referrals', tag: U, summary: 'Referral queue for staff', permission: ['referrals', 'read'], query: z.object({ status: z.string().max(20).optional() }), handler: ({ ctx, query }) => unlock.queue(ctx, query as any) });
defineRoute({ method: 'GET', path: '/unlock/summary', tag: U, summary: 'Opportunities open, referrals by stage, awards and funding mobilised', permission: ['referrals', 'read'], handler: ({ ctx }) => unlock.summary(ctx) });
defineRoute({ method: 'GET', path: '/referrals/:id/history', tag: U, summary: 'Every status change on a referral', permission: ['referrals', 'read'], handler: ({ ctx, params }) => unlock.referralHistory(ctx, params.id) });
defineRoute({ method: 'POST', path: '/referrals/:id/consent', tag: U, summary: 'The owner agrees to a suggested referral and chooses what may be shared', permission: ['referrals', 'create'], body: consentBody, handler: ({ ctx, params, body }) => unlock.consent(ctx, params.id, body.scope) });
defineRoute({ method: 'POST', path: '/referrals/:id/approve', tag: U, summary: 'A person confirms the match. The match is checked again now', permission: ['referrals', 'approve'], body: z.object({ note: optText(400) }), handler: ({ ctx, params, body }) => unlock.approve(ctx, params.id, body.note) });
defineRoute({ method: 'POST', path: '/referrals/:id/status', tag: U, summary: 'Move a referral to Referred, Applied, Shortlisted, Awarded or Declined', permission: ['referrals', 'edit'], body: z.object({ to: z.enum(['Referred', 'Applied', 'Shortlisted', 'Awarded', 'Declined']), note: optText(600), amountGhs: z.number().min(0).max(1_000_000_000).nullish() }), handler: ({ ctx, params, body }) => unlock.advance(ctx, params.id, body.to, body.note, body.amountGhs) });
defineRoute({ method: 'POST', path: '/referrals/:id/withdraw', tag: U, summary: 'Step back from a referral. Nothing more is shared', permission: ['referrals', 'delete'], body: z.object({ note: optText(400) }), handler: ({ ctx, params, body }) => unlock.withdraw(ctx, params.id, body.note) });

/* ----------------------------- opportunity scout ------------------------ */
const srcBody = z.object({ name: text(2, 120), kind: z.enum(['feed', 'page', 'query', 'site']), url: z.string().trim().max(500).nullish(), query: z.string().trim().max(200).nullish(), region: z.enum(REGIONS).optional(), active: z.boolean().optional() });
defineRoute({ method: 'GET', path: '/opportunity-sources', tag: U, summary: 'Where the Opportunity Scout looks, the free search allowance, and recent runs', permission: ['opportunities', 'create'], handler: ({ ctx }) => scout.listSources(ctx) });
defineRoute({ method: 'POST', path: '/opportunity-sources', tag: U, summary: 'Add a feed, page or search query for the Scout', permission: ['opportunities', 'create'], body: srcBody, handler: async ({ ctx, body }) => status(201, await scout.addSource(ctx, body as any)) });
defineRoute({ method: 'POST', path: '/opportunity-sources/starter', tag: U, summary: 'Add the starter search queries. Safe to repeat', permission: ['opportunities', 'create'], body: empty, handler: ({ ctx }) => scout.addStarter(ctx) });
defineRoute({ method: 'POST', path: '/opportunity-sources/sites', tag: U, summary: 'Add the worldwide list of funder, ministry, procurement and accelerator websites. Safe to repeat', permission: ['opportunities', 'create'], body: empty, handler: ({ ctx }) => scout.addSites(ctx) });
defineRoute({ method: 'POST', path: '/opportunity-sources/run', tag: U, summary: 'Run the Scout now on the sources that are due. Saves drafts only', permission: ['opportunities', 'create'], rateLimit: { key: 'scoutrun:{ip}', windowSec: 3600, limit: 6 }, body: empty, handler: ({ ctx }) => scout.runNow(ctx) });
defineRoute({ method: 'PATCH', path: '/opportunity-sources/:id', tag: U, summary: 'Change or pause a source', permission: ['opportunities', 'edit'], body: srcBody.partial(), handler: ({ ctx, params, body }) => scout.updateSource(ctx, params.id, body as any) });
defineRoute({ method: 'DELETE', path: '/opportunity-sources/:id', tag: U, summary: 'Remove a source', permission: ['opportunities', 'edit'], handler: ({ ctx, params }) => scout.removeSource(ctx, params.id) });
defineRoute({ method: 'POST', path: '/opportunity-sources/:id/test', tag: U, summary: 'See what the Scout would find at a feed or page. Saves nothing', permission: ['opportunities', 'create'], rateLimit: { key: 'scouttest:{ip}', windowSec: 3600, limit: 60 }, body: empty, handler: ({ ctx, params }) => scout.testSource(ctx, params.id) });
defineRoute({ method: 'POST', path: '/opportunity-sources/:id/run', tag: U, summary: 'Run the Scout now on one source. Saves drafts only', permission: ['opportunities', 'create'], rateLimit: { key: 'scoutrun1:{ip}', windowSec: 3600, limit: 20 }, body: empty, handler: ({ ctx, params }) => scout.runNow(ctx, params.id) });
