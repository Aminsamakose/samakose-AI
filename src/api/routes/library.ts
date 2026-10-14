/**
 * Business Doctor Resource Library: public catalogue, the staff editorial workflow, entitlements,
 * and the entitlement-gated file download. Payments are wired in purchases.ts (Phase 4), which this
 * file imports only to start a purchase; nothing here touches Paystack directly.
 */
import { z } from 'zod';
import { badRequest, forbidden, notFound } from '@/lib/errors';
import { defineRoute, fileResponse } from '../framework';
import { uuid, text, optText } from '../schemas';
import * as authors from '@/services/library-authors';
import * as lib from '@/services/library';
import * as ent from '@/services/entitlements';
import * as purchases from '@/services/library-purchases';
import { storage } from '@/lib/storage';
import { need } from '@/services/common';

const L = 'Resource Library';
const PDF_MAGIC = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-';

/* ------------------------------ public ------------------------------- */
defineRoute({ method: 'GET', path: '/library/public/resources', tag: L, summary: 'Published catalogue (free and premium, premium items locked)', auth: 'public',
  query: z.object({ q: z.string().max(120).optional(), dimension: z.string().max(80).optional() }),
  handler: ({ ctx, query }) => lib.publicList(ctx, query) });
defineRoute({ method: 'GET', path: '/library/public/resources/:slug', tag: L, summary: 'One published resource by slug (premium body/file hidden unless entitled and signed in)', auth: 'public',
  handler: async ({ ctx, params }) => {
    const r = await lib.publicGet(ctx, params.slug);
    if (r.locked && ctx.user && await ent.hasEntitlement(ctx, ctx.user.id, r.id)) {
      const full = await lib.getResource({ ...ctx, user: ctx.user }, r.id);
      return { ...r, body: full.body, locked: false };
    }
    return r;
  } });
defineRoute({ method: 'GET', path: '/library/public/authors/:id', tag: L, summary: 'An author’s public byline', auth: 'public', handler: ({ ctx, params }) => authors.getAuthor(ctx, params.id) });

/* -------------------------------- authors ------------------------------ */
const authorBody = z.object({ name: z.string().trim().min(1).max(160), title: optText(120), bio: optText(2000), photoMediaId: uuid.nullish(), userId: uuid.nullish() }).partial();
defineRoute({ method: 'GET', path: '/library/authors', tag: L, summary: 'List Library authors', permission: ['library_authors', 'read'], handler: ({ ctx }) => authors.listAuthors(ctx) });
defineRoute({ method: 'GET', path: '/library/authors/:id', tag: L, summary: 'One Library author', permission: ['library_authors', 'read'], handler: ({ ctx, params }) => authors.getAuthor(ctx, params.id) });
defineRoute({ method: 'POST', path: '/library/authors', tag: L, summary: 'Add a Library author', permission: ['library_authors', 'create'], body: authorBody, handler: ({ ctx, body }) => authors.createAuthor(ctx, body as authors.AuthorInput) });
defineRoute({ method: 'PATCH', path: '/library/authors/:id', tag: L, summary: 'Edit a Library author', permission: ['library_authors', 'edit'], body: authorBody, handler: ({ ctx, params, body }) => authors.updateAuthor(ctx, params.id, body as authors.AuthorInput) });
defineRoute({ method: 'DELETE', path: '/library/authors/:id', tag: L, summary: 'Remove a Library author with no resources', permission: ['library_authors', 'delete'], handler: ({ ctx, params }) => authors.deleteAuthor(ctx, params.id) });

/* ------------------------------ resources ------------------------------ */
const resourceBody = z.object({
  title: z.string().trim().min(1).max(200), authorId: uuid, topic: optText(80), dimension: optText(80),
  summary: z.string().trim().max(400), body: z.string().max(100_000), coverMediaId: uuid.nullish(),
  priceGhs: z.number().min(0).max(100_000).nullable(), slug: optText(80)
}).partial();
defineRoute({ method: 'GET', path: '/library/resources', tag: L, summary: 'List Library resources (staff view)', permission: ['library_resources', 'read'],
  query: z.object({ status: z.string().max(20).optional(), authorId: z.string().uuid().optional(), q: z.string().max(120).optional() }),
  handler: ({ ctx, query }) => lib.listResources(ctx, query) });
defineRoute({ method: 'GET', path: '/library/resources/:id', tag: L, summary: 'One Library resource (staff view)', permission: ['library_resources', 'read'], handler: ({ ctx, params }) => lib.getResource(ctx, params.id) });
defineRoute({ method: 'POST', path: '/library/resources', tag: L, summary: 'Draft a new Library resource', permission: ['library_resources', 'create'], body: resourceBody, handler: ({ ctx, body }) => lib.createResource(ctx, body as lib.ResourceInput) });
defineRoute({ method: 'PATCH', path: '/library/resources/:id', tag: L, summary: 'Edit a draft Library resource', permission: ['library_resources', 'edit'], body: resourceBody, handler: ({ ctx, params, body }) => lib.updateResource(ctx, params.id, body as lib.ResourceInput) });
defineRoute({ method: 'DELETE', path: '/library/resources/:id', tag: L, summary: 'Delete a draft Library resource', permission: ['library_resources', 'delete'], handler: ({ ctx, params }) => lib.deleteResource(ctx, params.id) });
defineRoute({ method: 'POST', path: '/library/resources/:id/submit', tag: L, summary: 'Submit a draft for review', permission: ['library_resources', 'edit'], body: z.object({}).passthrough(), handler: ({ ctx, params }) => lib.submitResource(ctx, params.id) });
defineRoute({ method: 'POST', path: '/library/resources/:id/decision', tag: L, summary: 'Publish or return a resource in review (four-eyes: the drafter may not approve it)', permission: ['library_resources', 'approve'],
  body: z.object({ decision: z.enum(['Published', 'Draft']), note: optText(500) }), handler: ({ ctx, params, body }) => lib.decideResource(ctx, params.id, body as any) });
defineRoute({ method: 'POST', path: '/library/resources/:id/archive', tag: L, summary: 'Archive a published resource', permission: ['library_resources', 'approve'], body: z.object({}).passthrough(), handler: ({ ctx, params }) => lib.archiveResource(ctx, params.id) });

defineRoute({ method: 'POST', path: '/library/resources/:id/file', tag: L, summary: 'Attach the resource’s PDF (multipart: file)', permission: ['library_resources', 'edit'], multipart: true, handler: async ({ ctx, params, req }) => {
  let form: FormData; try { form = await req.formData(); } catch { throw badRequest('Send the file as multipart form data'); }
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw badRequest('Choose a PDF file');
  if (file.size > 20 * 1048576) throw badRequest('The file can be at most 20 MB');
  const buf = Buffer.from(await file.arrayBuffer());
  if (!PDF_MAGIC(buf)) throw badRequest('Only a PDF file may be attached to a resource');
  const key = `library/${params.id}/${crypto.randomUUID()}.pdf`;
  await storage().put(key, buf, 'application/pdf');
  return lib.attachFile(ctx, params.id, { storageKey: key, mime: 'application/pdf', size: buf.length });
} });
defineRoute({ method: 'GET', path: '/library/resources/:id/file', tag: L, summary: 'Download a resource’s PDF. Free resources: anyone signed in. Premium: entitled users and staff only', permission: ['library_catalog', 'read'],
  handler: async ({ ctx, params }) => {
    const u = need(ctx);
    const r = await lib.loadResourceForFile(ctx, params.id);
    const staffCanRead = (await import('@/lib/rbac')).can(u.user.role, 'library_resources', 'approve');
    if (!staffCanRead && !(await ent.hasEntitlement(ctx, u.user.id, params.id))) throw forbidden('You do not have access to this resource’s file');
    if (!r.fileStorageKey) throw notFound('This resource has no file attached');
    const bytes = await storage().get(r.fileStorageKey);
    if (!bytes) throw notFound('This resource has no file attached');
    return fileResponse(`${r.slug}.pdf`, 'application/pdf', new Uint8Array(bytes));
  } });

defineRoute({ method: 'POST', path: '/library/draft', tag: L, summary: 'Draft a resource from a topic brief (AI-assisted; nothing is saved)', permission: ['library_resources', 'create'],
  body: z.object({ topic: text(2, 160), dimension: optText(80), audience: optText(120), notes: optText(1000) }),
  handler: ({ ctx, body }) => lib.draftResource(ctx, body) });

/* ------------------------------ entitlements ---------------------------- */
defineRoute({ method: 'GET', path: '/library/entitlements/mine', tag: L, summary: 'Resources you have unlocked', permission: ['library_catalog', 'read'], handler: ({ ctx }) => ent.myEntitlements(ctx) });
defineRoute({ method: 'GET', path: '/library/resources/:id/entitlements', tag: L, summary: 'Who holds an entitlement to this resource', permission: ['library_entitlements', 'read'], handler: ({ ctx, params }) => ent.entitlementsFor(ctx, params.id) });
defineRoute({ method: 'POST', path: '/library/entitlements/grant', tag: L, summary: 'Grant a user standing access to a premium resource (administrator override)', permission: ['library_entitlements', 'create'],
  body: z.object({ userId: uuid, resourceId: uuid }), handler: ({ ctx, body }) => ent.grantEntitlement(ctx, { ...body, grantedVia: 'admin_grant', grantedBy: need(ctx).user.id }) });
defineRoute({ method: 'POST', path: '/library/entitlements/:id/revoke', tag: L, summary: 'Revoke an entitlement', permission: ['library_entitlements', 'approve'], body: z.object({}).passthrough(), handler: ({ ctx, params }) => ent.revokeEntitlement(ctx, params.id) });

/* -------------------------------- purchase ------------------------------ */
defineRoute({ method: 'POST', path: '/library/resources/:id/purchase', tag: L, summary: 'Buy a premium resource (starts a Paystack transaction, or the mock-payment path outside production)', permission: ['library_catalog', 'read'],
  body: z.object({}).passthrough(), handler: ({ ctx, params }) => purchases.startPurchase(ctx, params.id) });
defineRoute({ method: 'GET', path: '/library/purchases/:reference/status', tag: L, summary: 'Check a purchase’s payment status and whether the entitlement was granted', permission: ['library_catalog', 'read'],
  handler: ({ ctx, params }) => purchases.purchaseStatus(ctx, params.reference) });
defineRoute({ method: 'POST', path: '/library/purchases/:reference/mock-complete', tag: L, summary: 'Development/demo only: complete a pending resource purchase when no Paystack key is configured', permission: ['library_catalog', 'read'],
  body: z.object({}).passthrough(), handler: ({ ctx, params }) => purchases.mockComplete(ctx, params.reference) });
defineRoute({ method: 'POST', path: '/library/purchases/webhook', tag: L, summary: 'Paystack webhook for resource purchases', auth: 'webhook',
  handler: async ({ ctx, req, rawBody }) => purchases.webhook(ctx, rawBody, req.headers.get('x-paystack-signature')) });
