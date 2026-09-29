import { z } from 'zod';
import { defineRoute, status, routes } from '../framework';
import { listQuery } from '../list';
import { email, isoDate, money, name, optText, text, uuid, empty } from '../schemas';
import * as fin from '@/services/finance';
import * as kobo from '@/services/kobo';
import * as dash from '@/services/dashboards';
import * as adm from '@/services/admin';
import { getJob } from '@/domain/jobs';
import { need } from '@/services/common';
import { forbidden, notFound } from '@/lib/errors';

/* ----------------------------- commercial ------------------------------ */
const F = 'Finance';
defineRoute({ method: 'GET', path: '/plans', tag: F, summary: 'Service plans', permission: ['plans', 'read'], handler: ({ ctx }) => fin.listPlans(ctx) });
defineRoute({ method: 'POST', path: '/plans', tag: F, summary: 'Create a plan', permission: ['plans', 'create'], body: z.object({ name, description: optText(500), priceGhs: money, intervalMonths: z.number().int().min(1).max(60).default(12) }), handler: async ({ ctx, body }) => status(201, await fin.createPlan(ctx, body as any)) });
defineRoute({ method: 'PATCH', path: '/plans/:id', tag: F, summary: 'Update or retire a plan', permission: ['plans', 'edit'], body: z.object({ name: name.optional(), description: optText(500), priceGhs: money.optional(), intervalMonths: z.number().int().min(1).max(60).optional(), active: z.boolean().optional() }), handler: ({ ctx, params, body }) => fin.updatePlan(ctx, params.id, body as any) });
defineRoute({ method: 'GET', path: '/contracts', tag: F, summary: 'Contracts', permission: ['contracts', 'read'], query: listQuery.extend({ status: z.string().optional(), orgId: z.string().optional() }), handler: ({ ctx, query }) => fin.listContracts(ctx, query) });
defineRoute({ method: 'POST', path: '/contracts', tag: F, summary: 'Create a contract', permission: ['contracts', 'create'], body: z.object({ orgId: uuid, planId: uuid.nullish(), programmeId: uuid.nullish(), startDate: isoDate.nullish(), endDate: isoDate.nullish(), amountGhs: z.number().min(0).max(1e9).optional() }), handler: async ({ ctx, body }) => status(201, await fin.createContract(ctx, body)) });
defineRoute({ method: 'PATCH', path: '/contracts/:id', tag: F, summary: 'Update terms or move status', permission: ['contracts', 'edit'], body: z.object({ status: z.enum(['Active', 'Expired', 'Cancelled']).optional(), startDate: isoDate.nullish(), endDate: isoDate.nullish(), amountGhs: z.number().min(0).max(1e9).optional() }), handler: ({ ctx, params, body }) => fin.updateContract(ctx, params.id, body) });
defineRoute({ method: 'GET', path: '/invoices', tag: F, summary: 'Invoices', permission: ['invoices', 'read'], query: listQuery.extend({ status: z.string().optional(), orgId: z.string().optional() }), handler: ({ ctx, query }) => fin.listInvoices(ctx, query) });
defineRoute({ method: 'POST', path: '/invoices', tag: F, summary: 'Create a draft invoice', permission: ['invoices', 'create'], body: z.object({ orgId: uuid, contractId: uuid.nullish(), amountGhs: money, dueDate: isoDate }), handler: async ({ ctx, body }) => status(201, await fin.createInvoice(ctx, body)) });
defineRoute({ method: 'GET', path: '/invoices/:id', tag: F, summary: 'One invoice with its payments', permission: ['invoices', 'read'], handler: ({ ctx, params }) => fin.getInvoice(ctx, params.id) });
defineRoute({ method: 'PATCH', path: '/invoices/:id', tag: F, summary: 'Send, void or edit a draft invoice', permission: ['invoices', 'edit'], body: z.object({ status: z.enum(['Sent', 'Void']).optional(), amountGhs: money.optional(), dueDate: isoDate.optional() }), handler: ({ ctx, params, body }) => fin.updateInvoice(ctx, params.id, body) });
defineRoute({ method: 'POST', path: '/invoices/:id/pay', tag: F, summary: 'Start an online payment for an invoice', permission: ['payments', 'create'], body: empty, rateLimit: { key: 'pay:ip:{ip}', limit: 30, windowSec: 600 }, handler: async ({ ctx, params }) => status(201, await fin.startPayment(ctx, params.id)) });
defineRoute({ method: 'POST', path: '/invoices/:id/manual-payment', tag: F, summary: 'Record a bank or cash payment', permission: ['payments', 'create'], body: z.object({ reference: text(3, 80), amountGhs: money, note: optText(300) }), handler: async ({ ctx, params, body }) => status(201, await fin.recordManualPayment(ctx, params.id, body as any)) });
defineRoute({ method: 'GET', path: '/payments', tag: F, summary: 'Payments', permission: ['payments', 'read'], query: listQuery.extend({ status: z.string().optional(), invoiceId: z.string().optional() }), handler: ({ ctx, query }) => fin.listPayments(ctx, query) });
defineRoute({ method: 'POST', path: '/payments/:reference/verify', tag: F, summary: 'Check a payment with the provider after the owner returns', permission: ['payments', 'create'], body: empty, handler: ({ ctx, params }) => fin.verifyPayment(ctx, params.reference) });
defineRoute({ method: 'POST', path: '/payments/:reference/mock-complete', tag: F, summary: 'Complete a test payment (only when no payment key is set)', permission: ['payments', 'create'], body: empty, handler: ({ ctx, params }) => fin.mockComplete(ctx, params.reference) });
defineRoute({ method: 'POST', path: '/webhooks/paystack', tag: 'Integrations', summary: 'Paystack event receiver (HMAC-SHA512 signature)', auth: 'webhook', handler: ({ ctx, req, rawBody }) => fin.paystackWebhook(ctx, rawBody, req.headers.get('x-paystack-signature')) });
defineRoute({ method: 'POST', path: '/integrations/kobo/webhook', tag: 'Integrations', summary: 'KoboToolbox REST service receiver (shared secret header)', auth: 'webhook', rateLimit: { key: 'kobo:ip:{ip}', limit: 600, windowSec: 60 },
  handler: async ({ ctx, req, rawBody }) => { let b: unknown; try { b = JSON.parse(rawBody); } catch { b = null; } return kobo.koboWebhook(ctx, req.headers.get('x-kobo-secret'), b); } });

/* ---------------------- dashboards, search, notifications --------------- */
const M = 'Insight';
defineRoute({ method: 'GET', path: '/dashboard', tag: M, summary: 'Dashboard data for the signed-in role', permission: ['dashboard', 'read'], handler: ({ ctx }) => dash.dashboard(ctx) });
defineRoute({ method: 'GET', path: '/programmes/:id/dashboard', tag: M, summary: 'Programme results (funders see suppressed aggregates)', permission: ['dashboard', 'read'], handler: ({ ctx, params }) => dash.programmeDashboard(ctx, params.id) });
defineRoute({ method: 'GET', path: '/programmes/:id/export', tag: M, summary: 'Programme summary as CSV', permission: ['dashboard', 'export'], handler: ({ ctx, params }) => dash.exportProgramme(ctx, params.id) });
defineRoute({ method: 'GET', path: '/search', tag: M, summary: 'Search across what you may see', query: z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(80) }), handler: ({ ctx, query }) => adm.globalSearch(ctx, query.q) });
defineRoute({ method: 'GET', path: '/notifications', tag: M, summary: 'Your notifications', query: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), unread: z.string().optional() }), handler: ({ ctx, query }) => adm.listNotifications(ctx, query) });
defineRoute({ method: 'POST', path: '/notifications/read-all', tag: M, summary: 'Mark all notifications read', body: empty, handler: ({ ctx }) => adm.markAllRead(ctx) });
defineRoute({ method: 'POST', path: '/notifications/:id/read', tag: M, summary: 'Mark one notification read', body: empty, handler: ({ ctx, params }) => adm.markRead(ctx, params.id) });
defineRoute({ method: 'GET', path: '/jobs/:id', tag: M, summary: 'Status of a background job you started', handler: async ({ ctx, params }) => {
  const j = await getJob(params.id); const u = need(ctx).user;
  if (!j || (j.requestedBy !== u.id && u.role !== 'ADMIN')) throw notFound('Job not found');
  return { id: j.id, kind: j.kind, status: j.status, result: j.status === 'done' ? j.result : null, error: j.status === 'failed' ? 'It could not be completed. Check the case for details or try again.' : null, attempts: j.attempts };
} });

/* -------------------------------- admin --------------------------------- */
const AD = 'Administration';
defineRoute({ method: 'GET', path: '/audit', tag: AD, summary: 'Audit log', permission: ['audit', 'read'], query: listQuery.extend({ actor: z.string().optional(), action: z.string().optional(), entity: z.string().optional(), from: isoDate.optional(), to: isoDate.optional(), caseId: z.string().optional() }), handler: ({ ctx, query }) => adm.listAudit(ctx, query) });
defineRoute({ method: 'GET', path: '/events', tag: AD, summary: 'Event stream', permission: ['audit', 'read'], query: listQuery.extend({ type: z.string().optional() }), handler: ({ ctx, query }) => adm.listEvents(ctx, query) });
defineRoute({ method: 'GET', path: '/settings/rules', tag: AD, summary: 'Scoring and workflow rules', permission: ['settings', 'read'], handler: ({ ctx }) => adm.getRules(ctx) });
defineRoute({ method: 'PUT', path: '/settings/rules', tag: AD, summary: 'Change rule values (validated, audited)', permission: ['settings', 'edit'], body: z.object({ values: z.record(z.string(), z.number()) }), handler: ({ ctx, body }) => adm.updateRules(ctx, body.values) });
defineRoute({ method: 'GET', path: '/settings/questions', tag: AD, summary: 'Diagnostic questions', permission: ['settings', 'read'], handler: ({ ctx }) => adm.listQuestions(ctx) });
defineRoute({ method: 'POST', path: '/settings/questions', tag: AD, summary: 'Add a question', permission: ['settings', 'create'], body: z.object({ code: z.string().trim().regex(/^Q\d{2,3}$/, 'Use a code like Q19'), dimension: text(3, 60), text: text(5, 300), weight: z.number().int().min(1).max(5), sort: z.number().int().optional() }), handler: async ({ ctx, body }) => status(201, await adm.createQuestion(ctx, body)) });
defineRoute({ method: 'PATCH', path: '/settings/questions/:id', tag: AD, summary: 'Edit or retire a question', permission: ['settings', 'edit'], body: z.object({ text: text(5, 300).optional(), weight: z.number().int().min(1).max(5).optional(), sort: z.number().int().optional(), active: z.boolean().optional(), dimension: text(3, 60).optional() }), handler: ({ ctx, params, body }) => adm.updateQuestion(ctx, params.id, body) });
defineRoute({ method: 'GET', path: '/settings/library', tag: AD, summary: 'Approved intervention library', permission: ['settings', 'read'], handler: ({ ctx }) => adm.listLibrary(ctx) });
defineRoute({ method: 'POST', path: '/settings/library', tag: AD, summary: 'Add an intervention', permission: ['settings', 'create'], body: z.object({ code: z.string().trim().regex(/^IVL-\d{3}$/, 'Use a code like IVL-011'), title: text(3, 120), dimension: text(3, 60), description: text(10, 500), typicalDays: z.number().int().min(1).max(365), kpiHint: optText(120) }), handler: async ({ ctx, body }) => status(201, await adm.createLibraryItem(ctx, body as any)) });
defineRoute({ method: 'PATCH', path: '/settings/library/:id', tag: AD, summary: 'Edit or retire an intervention', permission: ['settings', 'edit'], body: z.object({ title: text(3, 120).optional(), description: text(10, 500).optional(), typicalDays: z.number().int().min(1).max(365).optional(), kpiHint: optText(120), active: z.boolean().optional(), dimension: text(3, 60).optional() }), handler: ({ ctx, params, body }) => adm.updateLibraryItem(ctx, params.id, body as any) });
defineRoute({ method: 'GET', path: '/admin/system', tag: AD, summary: 'System and integration status', permission: ['integrations', 'read'], handler: ({ ctx }) => adm.systemStatus(ctx) });
defineRoute({ method: 'POST', path: '/admin/jobs/:id/retry', tag: AD, summary: 'Retry a failed job', permission: ['integrations', 'edit'], body: empty, handler: ({ ctx, params }) => adm.retryJob(ctx, params.id) });
defineRoute({ method: 'GET', path: '/health', tag: 'Platform', summary: 'Liveness and database check', auth: 'public', transactional: false, handler: () => adm.health() });
defineRoute({ method: 'GET', path: '/openapi.json', tag: 'Platform', summary: 'This API described in OpenAPI 3.1', auth: 'public', transactional: false, handler: async () => (await import('../openapi')).buildOpenApi(routes) });
export { email, forbidden };
