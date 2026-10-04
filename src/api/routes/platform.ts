import { z } from 'zod';
import { defineRoute, status, routes } from '../framework';
import { listQuery } from '../list';
import { email, isoDate, money, name, optText, text, uuid, empty } from '../schemas';
import * as fin from '@/services/finance';
import * as contracts from '@/services/contracts';
import * as kobo from '@/services/kobo';
import * as dash from '@/services/dashboards';
import * as adm from '@/services/admin';
import * as fw from '@/services/frameworks';
import * as asst from '@/services/assistant';
import * as ag from '@/services/agents';
import { AGENT_STATUSES } from '@/domain/agents';
import * as sw from '@/services/switches';
import * as aiset from '@/services/ai-settings';
import * as sys from '@/services/system';
import * as bill from '@/services/billing';
import * as inq from '@/services/inquiries';
import * as rc from '@/services/registration-config';
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
defineRoute({ method: 'GET', path: '/contracts/:id', tag: F, summary: 'One contract with acceptance, amendments and invoicing', permission: ['contracts', 'read'], handler: ({ ctx, params }) => contracts.getContract(ctx, params.id) });
defineRoute({ method: 'POST', path: '/contracts/:id/accept', tag: F, summary: 'The business accepts the contract, or staff record a signed copy', permission: ['contracts', 'read'], body: z.object({ signatoryName: z.string().trim().min(3).max(120), signatoryTitle: z.string().trim().max(120).nullish(), note: z.string().trim().max(500).nullish() }), handler: ({ ctx, params, body }) => contracts.acceptContract(ctx, params.id, body) });
defineRoute({ method: 'POST', path: '/contracts/:id/amend', tag: F, summary: 'Extend an active contract or change its amount, with a reason', permission: ['contracts', 'edit'], body: z.object({ endDate: isoDate.nullish(), amountGhs: z.number().min(0).max(1_000_000_000).optional(), reason: z.string().trim().min(5).max(1000) }), handler: ({ ctx, params, body }) => contracts.amendContract(ctx, params.id, { ...body, endDate: body.endDate ?? undefined }) });
defineRoute({ method: 'POST', path: '/contracts/:id/renew', tag: F, summary: 'Start a renewal as a new draft contract', permission: ['contracts', 'create'], body: z.object({ startDate: isoDate.nullish(), endDate: isoDate.nullish(), amountGhs: z.number().min(0).max(1_000_000_000).optional() }), handler: async ({ ctx, params, body }) => status(201, await contracts.renewContract(ctx, params.id, { ...body, startDate: body.startDate ?? undefined, endDate: body.endDate ?? undefined })) });
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
defineRoute({ method: 'GET', path: '/dashboard', tag: M, summary: 'Dashboard data for the signed-in role. An administrator can add as=<user id> to see that person\'s dashboard, read-only and audited', permission: ['dashboard', 'read'], query: z.object({ as: z.string().uuid().optional() }), handler: ({ ctx, query }) => query.as ? dash.dashboardAs(ctx, query.as) : dash.dashboard(ctx) });
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
defineRoute({ method: 'GET', path: '/settings/switches', tag: AD, summary: 'Workflow and registration switches', permission: ['settings', 'read'], handler: ({ ctx }) => sw.listSwitches(ctx) });
defineRoute({ method: 'PUT', path: '/settings/switches/:key', tag: AD, summary: 'Turn a switch on or off. Turning a protected one off needs a reason', permission: ['settings', 'edit'], body: z.object({ on: z.boolean(), reason: z.string().trim().max(300).optional() }), handler: ({ ctx, params, body }) => sw.setSwitch(ctx, params.key, body.on, body.reason) });
defineRoute({ method: 'GET', path: '/settings/email-templates', tag: AD, summary: 'System email wording', permission: ['settings', 'read'], handler: ({ ctx }) => sw.listTemplates(ctx) });
defineRoute({ method: 'PUT', path: '/settings/email-templates/:key', tag: AD, summary: 'Save the wording of a system email', permission: ['settings', 'edit'], body: z.object({ subject: z.string().max(300), body: z.string().max(8000) }), handler: ({ ctx, params, body }) => sw.saveTemplate(ctx, params.key, body) });
defineRoute({ method: 'POST', path: '/settings/email-templates/:key/reset', tag: AD, summary: 'Restore the built-in wording', permission: ['settings', 'edit'], body: z.object({}).optional(), handler: ({ ctx, params }) => sw.resetTemplate(ctx, params.key) });
defineRoute({ method: 'GET', path: '/settings/report-text', tag: AD, summary: 'Report wording', permission: ['settings', 'read'], handler: ({ ctx }) => sw.listReportText(ctx) });
defineRoute({ method: 'PUT', path: '/settings/report-text', tag: AD, summary: 'Save report wording', permission: ['settings', 'edit'], body: z.object({ values: z.record(z.string(), z.string().max(2000)) }), handler: ({ ctx, body }) => sw.saveReportText(ctx, body.values) });
defineRoute({ method: 'PUT', path: '/settings/rules', tag: AD, summary: 'Change rule values (validated, audited)', permission: ['settings', 'edit'], body: z.object({ values: z.record(z.string(), z.number()) }), handler: ({ ctx, body }) => adm.updateRules(ctx, body.values) });
defineRoute({ method: 'GET', path: '/settings/questions', tag: AD, summary: 'Diagnostic questions', permission: ['settings', 'read'], handler: ({ ctx }) => adm.listQuestions(ctx) });
const fwQuestion = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_-]{2,12}$/, 'Use a short code like Q19 or AG01'), dimension: text(3, 60), text: text(5, 300), weight: z.number().int().min(1).max(5),
  subDimension: z.string().trim().max(8).optional(), responseType: z.enum(['ANCHORED', 'BANDED', 'YNP', 'FREQ']).optional(),
  anchors: z.array(z.string().max(240).nullable()).length(5).optional(),
  evidence: z.object({ requirement: text(3, 400), method: text(3, 40), examples: z.array(text(1, 160)).max(5).optional() }).optional(),
  criticality: z.enum(['Gate', 'Core', 'Standard']).optional(), readiness: z.array(z.string().max(16)).max(4).optional(),
  applies: z.string().trim().max(120).optional(), riskTag: z.string().trim().max(80).optional(), consistencyGroup: z.string().trim().max(20).optional(), basis: z.string().max(40).optional()
});
const fwMeta = z.object({
  architecture: z.string().max(200).optional(),
  subDimensions: z.array(z.object({ code: z.string().max(8), domain: z.string().max(8).optional(), name: z.string().max(100), dimension: z.string().max(60), mapping: z.unknown().optional() })).max(60).optional(),
  readiness: z.array(z.object({ code: z.string().max(16), name: z.string().max(100), purpose: z.string().max(400).optional(), unlocks: z.string().max(600).optional() })).max(12).optional(),
  consistencyChecks: z.array(z.object({ id: z.string().max(12), itemA: z.string().max(16), itemB: z.string().max(16), rule: z.string().max(300), condition: z.string().max(40) })).max(20).optional()
});
const fwSource = z.object({ component: text(3, 120), source: text(3, 400), rationale: text(3, 600), adaptation: text(2, 600), approval: z.enum(['Proposed', 'Approved', 'Rejected']).default('Proposed') });
const fwDraft = z.object({ questions: z.array(fwQuestion).min(1).max(120), dimensions: z.array(text(3, 60)).min(1).max(12), rules: z.record(z.string(), z.union([z.string(), z.number()])).nullable().optional(), sources: z.array(fwSource).max(80).optional(), meta: fwMeta.nullable().optional(), note: optText(600).nullish() });
defineRoute({ method: 'GET', path: '/settings/frameworks', tag: AD, summary: 'Frameworks and their versions', permission: ['frameworks', 'read'], handler: ({ ctx }) => fw.listFrameworks(ctx) });
defineRoute({ method: 'GET', path: '/settings/frameworks/versions/:id', tag: AD, summary: 'One framework version with its evidence trail', permission: ['frameworks', 'read'], handler: ({ ctx, params }) => fw.getVersion(ctx, params.id) });
defineRoute({ method: 'POST', path: '/settings/frameworks/:code/versions', tag: AD, summary: 'Start a draft version', permission: ['frameworks', 'create'], body: fwDraft.partial().extend({ fromBank: z.boolean().optional() }), handler: async ({ ctx, params, body }) => status(201, await fw.createDraft(ctx, params.code, body as never)) });
defineRoute({ method: 'PATCH', path: '/settings/frameworks/versions/:id', tag: AD, summary: 'Edit a draft version or its evidence trail', permission: ['frameworks', 'edit'], body: fwDraft.partial(), handler: ({ ctx, params, body }) => fw.updateDraft(ctx, params.id, body as never) });
defineRoute({ method: 'DELETE', path: '/settings/frameworks/versions/:id', tag: AD, summary: 'Discard a draft version', permission: ['frameworks', 'edit'], handler: ({ ctx, params }) => fw.discardDraft(ctx, params.id) });
defineRoute({ method: 'POST', path: '/settings/frameworks/versions/:id/publish', tag: AD, summary: 'Approve and publish a draft version', permission: ['frameworks', 'approve'], body: z.object({ note: text(5, 600) }), handler: ({ ctx, params, body }) => fw.publishVersion(ctx, params.id, body.note) });

// AI workforce: registry, versions, lifecycle, limits. Administrators only; executives may read.
const agentLimits = z.object({ requestsPerDay: z.number().int().min(0).optional(), requestsPerMonth: z.number().int().min(0).optional(), tokensPerDay: z.number().int().min(0).optional(), tokensPerMonth: z.number().int().min(0).optional(), alertPct: z.number().int().min(1).max(99).optional(), onLimit: z.enum(['throttle', 'pause']).optional() });
defineRoute({ method: 'GET', path: '/admin/agents', tag: AD, summary: 'AI agents with status, owner, usage and limits', permission: ['agents', 'read'], handler: ({ ctx }) => ag.listAgents(ctx) });
defineRoute({ method: 'GET', path: '/admin/agents/:id', tag: AD, summary: 'One agent with versions, recent requests and audit trail', permission: ['agents', 'read'], handler: ({ ctx, params }) => ag.getAgent(ctx, params.id) });
defineRoute({ method: 'PATCH', path: '/admin/agents/:id', tag: AD, summary: 'Change an agent owner, description or usage limits', permission: ['agents', 'edit'], body: z.object({ ownerId: z.string().uuid().nullable().optional(), name: text(2, 80).optional(), description: text(0, 400).nullable().optional(), purpose: text(0, 400).nullable().optional(), limits: agentLimits.optional() }), handler: ({ ctx, params, body }) => ag.updateAgent(ctx, params.id, body as never) });
defineRoute({ method: 'POST', path: '/admin/agents/:id/versions', tag: AD, summary: 'Create a new agent version (prompt, model or configuration)', permission: ['agents', 'edit'], body: z.object({ prompt: z.string().max(20000).optional(), model: z.string().max(80).nullable().optional(), config: z.record(z.string(), z.any()).optional(), note: text(5, 400) }), handler: async ({ ctx, params, body }) => status(201, await ag.createVersion(ctx, params.id, body as never)) });
defineRoute({ method: 'POST', path: '/admin/agents/:id/current-version', tag: AD, summary: 'Make a version the one the agent runs', permission: ['agents', 'edit'], body: z.object({ versionId: z.string().uuid(), reason: text(5, 400) }), handler: ({ ctx, params, body }) => ag.setCurrentVersion(ctx, params.id, body.versionId, body.reason) });
defineRoute({ method: 'POST', path: '/admin/agents/:id/evaluate', tag: AD, summary: 'Run the evaluation cases against the live model for the current version and record the result', permission: ['agents', 'approve'], handler: ({ ctx, params }) => ag.evaluateAgent(ctx, params.id) });
defineRoute({ method: 'POST', path: '/admin/agents/:id/status', tag: AD, summary: 'Move an agent through its lifecycle, pause, resume or disable it', permission: ['agents', 'edit'], body: z.object({ to: z.enum([...AGENT_STATUSES, 'Resume']), reason: text(5, 400) }), handler: ({ ctx, params, body }) => ag.changeStatus(ctx, params.id, body as never) });
defineRoute({ method: 'POST', path: '/settings/questions', tag: AD, summary: 'Add a question', permission: ['settings', 'create'], body: z.object({ code: z.string().trim().regex(/^Q\d{2,3}$/, 'Use a code like Q19'), dimension: text(3, 60), text: text(5, 300), weight: z.number().int().min(1).max(5), sort: z.number().int().optional() }), handler: async ({ ctx, body }) => status(201, await adm.createQuestion(ctx, body)) });
defineRoute({ method: 'PATCH', path: '/settings/questions/:id', tag: AD, summary: 'Edit or retire a question', permission: ['settings', 'edit'], body: z.object({ text: text(5, 300).optional(), weight: z.number().int().min(1).max(5).optional(), sort: z.number().int().optional(), active: z.boolean().optional(), dimension: text(3, 60).optional() }), handler: ({ ctx, params, body }) => adm.updateQuestion(ctx, params.id, body) });
defineRoute({ method: 'GET', path: '/settings/library', tag: AD, summary: 'Approved intervention library', permission: ['settings', 'read'], handler: ({ ctx }) => adm.listLibrary(ctx) });
defineRoute({ method: 'POST', path: '/settings/library', tag: AD, summary: 'Add an intervention', permission: ['settings', 'create'], body: z.object({ code: z.string().trim().regex(/^IVL-\d{3}$/, 'Use a code like IVL-011'), title: text(3, 120), dimension: text(3, 60), description: text(10, 500), typicalDays: z.number().int().min(1).max(365), kpiHint: optText(120) }), handler: async ({ ctx, body }) => status(201, await adm.createLibraryItem(ctx, body as any)) });
defineRoute({ method: 'PATCH', path: '/settings/library/:id', tag: AD, summary: 'Edit or retire an intervention', permission: ['settings', 'edit'], body: z.object({ title: text(3, 120).optional(), description: text(10, 500).optional(), typicalDays: z.number().int().min(1).max(365).optional(), kpiHint: optText(120), active: z.boolean().optional(), dimension: text(3, 60).optional() }), handler: ({ ctx, params, body }) => adm.updateLibraryItem(ctx, params.id, body as any) });
defineRoute({ method: 'GET', path: '/admin/system', tag: AD, summary: 'System and integration status', permission: ['integrations', 'read'], handler: ({ ctx }) => adm.systemStatus(ctx) });
defineRoute({ method: 'POST', path: '/admin/system/test/:what', tag: AD, summary: 'Test email, storage or database', permission: ['integrations', 'edit'], body: z.object({}).optional(), handler: ({ ctx, params }) => sys.testIntegration(ctx, params.what) });
defineRoute({ method: 'GET', path: '/admin/system/emails', tag: AD, summary: 'Recent outgoing email and its delivery status', permission: ['integrations', 'read'], query: z.object({ status: z.string().optional() }), handler: ({ ctx, query }) => sys.emailLog(ctx, query.status) });
defineRoute({ method: 'POST', path: '/admin/system/emails/:id/retry', tag: AD, summary: 'Send a failed email again', permission: ['integrations', 'edit'], body: z.object({}).optional(), handler: ({ ctx, params }) => sys.retryEmail(ctx, params.id) });
defineRoute({ method: 'GET', path: '/settings/billing', tag: AD, summary: 'Billing configuration (currency, tax, invoice terms). Separate from public pricing', permission: ['settings', 'read'], handler: ({ ctx }) => bill.readBilling(ctx) });
defineRoute({ method: 'PUT', path: '/settings/billing', tag: AD, summary: 'Change billing configuration. Tax cannot be switched on without a rate, a registration number and a Finance confirmation reference', permission: ['settings', 'edit'],
  body: z.object({ currency: z.enum(['GHS', 'USD']), usdReferenceEnabled: z.boolean(), taxEnabled: z.boolean(), taxLabel: z.string().max(40), taxRatePercent: z.number(), taxInclusive: z.boolean(), taxRegistrationNumber: z.string().max(60), taxConfirmationRef: z.string().max(160), invoicePrefix: z.string().max(10), paymentTermsDays: z.number(), paymentInstructions: z.string().max(1200), invoiceFooter: z.string().max(600) }).partial(),
  handler: ({ ctx, body }) => bill.saveBilling(ctx, body as any) });
defineRoute({ method: 'GET', path: '/admin/system/payments', tag: AD, summary: 'Is Paystack ready for real money', permission: ['integrations', 'read'], handler: ({ ctx }) => bill.readPaymentReadiness(ctx) });
defineRoute({ method: 'GET', path: '/settings/security', tag: AD, summary: 'Security overview', permission: ['settings', 'read'], handler: ({ ctx }) => sys.securityOverview(ctx) });
defineRoute({ method: 'GET', path: '/settings/ai', tag: AD, summary: 'Which AI provider is in use, which keys are set, and the saved choices', permission: ['settings', 'read'], handler: ({ ctx }) => aiset.readAiSettings(ctx) });
defineRoute({ method: 'PUT', path: '/settings/ai', tag: AD, summary: 'Choose the AI provider and models. Changing provider needs confirmation and a reason', permission: ['settings', 'edit'], body: z.object({ provider: z.enum(['anthropic', 'openai', 'openai-compatible']), claudeModel: z.string().trim().max(80).optional(), openaiModel: z.string().trim().max(80).optional(), openaiBaseUrl: z.string().trim().max(200).optional(), tiers: z.record(z.string(), z.object({ claude: z.string().trim().max(80).optional(), openai: z.string().trim().max(80).optional() })).optional(), confirm: z.boolean().optional(), reason: z.string().trim().max(500).optional() }), handler: ({ ctx, body }) => aiset.saveAiSettings(ctx, body as any) });
defineRoute({ method: 'POST', path: '/settings/ai/test', tag: AD, summary: 'Send one harmless test request to the chosen AI provider', permission: ['integrations', 'edit'], handler: ({ ctx }) => aiset.testAiProvider(ctx) });
defineRoute({ method: 'GET', path: '/settings/maintenance', tag: AD, summary: 'Maintenance mode', permission: ['settings', 'read'], handler: ({ ctx }) => sys.readMaintenance(ctx) });
defineRoute({ method: 'PUT', path: '/settings/maintenance', tag: AD, summary: 'Turn maintenance mode on or off', permission: ['settings', 'edit'], body: z.object({ on: z.boolean(), blockSignin: z.boolean(), message: z.string().max(600) }), handler: ({ ctx, body }) => sys.setMaintenance(ctx, body) });
defineRoute({ method: 'GET', path: '/settings/config/export', tag: AD, summary: 'Download the website and workflow configuration as a file', permission: ['settings', 'edit'], handler: async ({ ctx }) => new Response(JSON.stringify(await sys.exportConfig(ctx), null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="samakose-config.json"', 'cache-control': 'no-store' } }) });
defineRoute({ method: 'POST', path: '/settings/config/import', tag: AD, summary: 'Check or apply a configuration file. Content arrives as drafts', permission: ['settings', 'edit'], body: z.object({ bundle: z.unknown(), dryRun: z.boolean() }), handler: ({ ctx, body }) => sys.importConfig(ctx, body.bundle, body.dryRun) });
defineRoute({ method: 'POST', path: '/admin/jobs/:id/retry', tag: AD, summary: 'Retry a failed job', permission: ['integrations', 'edit'], body: empty, handler: ({ ctx, params }) => adm.retryJob(ctx, params.id) });
defineRoute({ method: 'GET', path: '/health', tag: 'Platform', summary: 'Liveness and database check', auth: 'public', transactional: false, handler: () => adm.health() });
defineRoute({ method: 'GET', path: '/openapi.json', tag: 'Platform', summary: 'This API described in OpenAPI 3.1', auth: 'public', transactional: false, handler: async () => (await import('../openapi')).buildOpenApi(routes) });
export { email, forbidden };

/* ------------------------- public website enquiries ------------------------- */
const W = 'Website';
defineRoute({ method: 'POST', path: '/public/inquiries', tag: W, summary: 'Send a contact, demo or newsletter enquiry from the public site', auth: 'public',
  rateLimit: { key: 'inquiry:ip:{ip}', limit: 6, windowSec: 900 },
  body: z.object({
    kind: z.enum(['contact', 'demo', 'newsletter']), name: optText(160), email, organisation: optText(160), phone: optText(40), interest: optText(80),
    message: optText(3000), consent: z.literal(true, { error: 'Please confirm you agree to be contacted' }), source: optText(80), website: optText(200)
  }).superRefine((v, c) => {
    if (v.kind !== 'newsletter' && !v.website) {
      if (!v.name || v.name.length < 2) c.addIssue({ code: 'custom', path: ['name'], message: 'Enter your name' });
      if ((v.kind === 'contact' || v.kind === 'demo') && (!v.message || v.message.length < 10)) c.addIssue({ code: 'custom', path: ['message'], message: 'Tell us a little more (at least 10 characters)' });
    }
  }),
  handler: ({ ctx, body }) => inq.submitInquiry(ctx, body as any) });
defineRoute({ method: 'GET', path: '/public/certificates/:id', tag: W, summary: 'Confirm a certificate the owner has agreed to share', auth: 'public', rateLimit: { key: 'verify:ip:{ip}', limit: 30, windowSec: 900 },
  handler: async ({ params }) => { const v = await (await import('@/services/certificates')).publicVerification(params.id); if (!v) throw notFound('No shared certificate with this reference'); return v; } });
defineRoute({ method: 'GET', path: '/public/assistant', tag: W, summary: 'Whether the website assistant is switched on', auth: 'public', handler: async () => ({ on: await asst.assistantOn() }) });
defineRoute({ method: 'POST', path: '/public/assistant', tag: W, summary: 'Ask the website assistant a question. Answers come from published content only', auth: 'public',
  rateLimit: { key: 'assistant:ip:{ip}', limit: 20, windowSec: 900 },
  body: z.object({ message: z.string().trim().min(3, 'Type your question').max(500), history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(900) })).max(6).optional() }),
  handler: async ({ body }) => {
    if (!(await asst.assistantOn())) throw notFound('The assistant is not switched on');
    return asst.ask(body.message, body.history ?? []);
  } });
defineRoute({ method: 'GET', path: '/inquiries', tag: AD, summary: 'Website enquiries', permission: ['inquiries', 'read'], query: listQuery.extend({ status: z.string().optional(), kind: z.string().optional() }), handler: ({ ctx, query }) => inq.listInquiries(ctx, query) });
defineRoute({ method: 'PATCH', path: '/inquiries/:id', tag: AD, summary: 'Mark an enquiry handled, spam or new', permission: ['inquiries', 'edit'], body: z.object({ status: z.enum(['New', 'Handled', 'Spam']) }), handler: ({ ctx, params, body }) => inq.setInquiryStatus(ctx, params.id, (body as any).status) });

/* ------------------------- website content (configuration centre) ------------------------- */
import * as cms from '@/services/content';
const CM = 'Website content';
const contentBody = z.object({ data: z.record(z.string(), z.unknown()), sortOrder: z.number().int().min(0).max(10000).optional() });
defineRoute({ method: 'GET', path: '/admin/content', tag: CM, summary: 'Everything that can be edited on the website, with counts', permission: ['content', 'read'], handler: ({ ctx }) => cms.overview(ctx) });
defineRoute({ method: 'GET', path: '/admin/content/kind/:kind', tag: CM, summary: 'Items of one content type', permission: ['content', 'read'], handler: ({ ctx, params }) => cms.listDocs(ctx, params.kind) });
defineRoute({ method: 'POST', path: '/admin/content/kind/:kind', tag: CM, summary: 'Create a draft item', permission: ['content', 'create'], body: contentBody, handler: async ({ ctx, params, body }) => status(201, await cms.createDoc(ctx, params.kind, body)) });
defineRoute({ method: 'GET', path: '/admin/content/:id', tag: CM, summary: 'One item', permission: ['content', 'read'], handler: ({ ctx, params }) => cms.getDoc(ctx, params.id) });
defineRoute({ method: 'PUT', path: '/admin/content/:id', tag: CM, summary: 'Save the working copy', permission: ['content', 'edit'], body: contentBody, handler: ({ ctx, params, body }) => cms.saveDraft(ctx, params.id, body) });
defineRoute({ method: 'POST', path: '/admin/content/:id/submit', tag: CM, summary: 'Send a draft for review', permission: ['content', 'edit'], body: empty, handler: ({ ctx, params }) => cms.submitForReview(ctx, params.id) });
defineRoute({ method: 'POST', path: '/admin/content/:id/publish', tag: CM, summary: 'Publish the working copy', permission: ['content', 'approve'], body: z.object({ note: optText(200) }), handler: ({ ctx, params, body }) => cms.publish(ctx, params.id, body as any) });
defineRoute({ method: 'POST', path: '/admin/content/:id/schedule', tag: CM, summary: 'Publish at a set time', permission: ['content', 'approve'], body: z.object({ at: z.string().min(10).max(40) }), handler: ({ ctx, params, body }) => cms.schedule(ctx, params.id, body) });
defineRoute({ method: 'POST', path: '/admin/content/:id/unschedule', tag: CM, summary: 'Cancel a scheduled publication', permission: ['content', 'approve'], body: empty, handler: ({ ctx, params }) => cms.unschedule(ctx, params.id) });
defineRoute({ method: 'POST', path: '/admin/content/:id/archive', tag: CM, summary: 'Take an item off the website', permission: ['content', 'approve'], body: empty, handler: ({ ctx, params }) => cms.archive(ctx, params.id) });
defineRoute({ method: 'POST', path: '/admin/content/:id/unarchive', tag: CM, summary: 'Bring an archived item back as a draft', permission: ['content', 'approve'], body: empty, handler: ({ ctx, params }) => cms.unarchive(ctx, params.id) });
defineRoute({ method: 'DELETE', path: '/admin/content/:id', tag: CM, summary: 'Delete an archived item', permission: ['content', 'delete'], handler: ({ ctx, params }) => cms.remove(ctx, params.id) });
defineRoute({ method: 'GET', path: '/admin/content/:id/versions', tag: CM, summary: 'Published versions of an item', permission: ['content', 'read'], handler: ({ ctx, params }) => cms.versions(ctx, params.id) });
defineRoute({ method: 'POST', path: '/admin/content/:id/restore', tag: CM, summary: 'Put an earlier version back in the working copy', permission: ['content', 'edit'], body: z.object({ version: z.number().int().min(1) }), handler: ({ ctx, params, body }) => cms.restore(ctx, params.id, body) });

/* ------------------------------- media library ------------------------------- */
import * as media from '@/services/media';
import { badRequest } from '@/lib/errors';
defineRoute({ method: 'GET', path: '/admin/media', tag: CM, summary: 'Media library', permission: ['media', 'read'], query: z.object({ q: z.string().max(80).optional(), category: z.string().max(40).optional() }).passthrough(), handler: ({ ctx, query }) => media.listMedia(ctx, query) });
defineRoute({ method: 'POST', path: '/admin/media', tag: CM, summary: 'Upload an image or PDF (multipart: file, name, altText, category)', permission: ['media', 'create'], multipart: true, handler: async ({ ctx, req }) => { let form: FormData; try { form = await req.formData(); } catch { throw badRequest('Send the file as multipart form data'); } return status(201, await media.uploadMedia(ctx, form)); } });
defineRoute({ method: 'PATCH', path: '/admin/media/:id', tag: CM, summary: 'Rename or re-describe a file', permission: ['media', 'edit'], body: z.object({ name: z.string().trim().min(1).max(120).optional(), altText: z.string().trim().max(200).nullish(), category: z.string().max(40).optional() }), handler: ({ ctx, params, body }) => media.updateMedia(ctx, params.id, body as any) });
defineRoute({ method: 'DELETE', path: '/admin/media/:id', tag: CM, summary: 'Delete a file that no page uses', permission: ['media', 'delete'], handler: ({ ctx, params }) => media.deleteMedia(ctx, params.id) });
defineRoute({ method: 'GET', path: '/admin/command-centre', tag: AD, summary: 'Administrator Command Centre figures', permission: ['users', 'create'], handler: ({ ctx }) => adm.commandCentre(ctx) });

/* ------------------------ registration settings (administrator) ------------------------ */

const RG = 'Registration settings';
defineRoute({ method: 'GET', path: '/admin/consent-notices', tag: RG, summary: 'Consent wording by purpose and version, with how many people agreed to each', permission: ['consent', 'read'], query: z.object({ country: z.string().length(2).optional() }), handler: ({ ctx, query }) => rc.listNotices(ctx, query.country) });
defineRoute({ method: 'POST', path: '/admin/consent-notices', tag: RG, summary: 'Start a new draft version of a consent notice', permission: ['consent', 'create'], body: z.object({ purpose: z.string().max(40), countryCode: z.string().length(2).optional(), text: z.string().max(4000) }), handler: async ({ ctx, body }) => status(201, await rc.createNotice(ctx, body)) });
defineRoute({ method: 'PATCH', path: '/admin/consent-notices/:id', tag: RG, summary: 'Edit a draft notice', permission: ['consent', 'edit'], body: z.object({ text: z.string().max(4000) }), handler: ({ ctx, params, body }) => rc.updateNotice(ctx, params.id, body.text) });
defineRoute({ method: 'POST', path: '/admin/consent-notices/:id/publish', tag: RG, summary: 'Publish a draft notice and retire the live one', permission: ['consent', 'approve'], body: empty, handler: ({ ctx, params }) => rc.publishNotice(ctx, params.id) });
defineRoute({ method: 'GET', path: '/admin/role-mappings', tag: RG, summary: 'Role mapping versions by framework', permission: ['role_mapping', 'read'], handler: ({ ctx }) => rc.listMappings(ctx) });
defineRoute({ method: 'POST', path: '/admin/role-mappings', tag: RG, summary: 'Start a draft mapping, from the reviewed default or from the data sent', permission: ['role_mapping', 'create'], body: z.object({ frameworkCode: z.string().max(20), note: z.string().max(500).optional(), data: z.any().optional() }), handler: async ({ ctx, body }) => status(201, await rc.createMapping(ctx, body)) });
defineRoute({ method: 'GET', path: '/admin/role-mappings/:id', tag: RG, summary: 'One mapping with its full data', permission: ['role_mapping', 'read'], handler: ({ ctx, params }) => rc.getMapping(ctx, params.id) });
defineRoute({ method: 'PATCH', path: '/admin/role-mappings/:id', tag: RG, summary: 'Edit a draft mapping', permission: ['role_mapping', 'edit'], body: z.object({ data: z.any().optional(), note: z.string().max(500).optional() }), handler: ({ ctx, params, body }) => rc.updateMapping(ctx, params.id, body) });
defineRoute({ method: 'POST', path: '/admin/role-mappings/:id/publish', tag: RG, summary: 'Approve and publish a draft mapping', permission: ['role_mapping', 'approve'], body: empty, handler: ({ ctx, params }) => rc.publishMapping(ctx, params.id) });
