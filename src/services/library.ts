/**
 * Business Doctor Resource Library: the 100-topic catalogue itself. Same draft -> in review ->
 * published -> archived discipline as src/services/content.ts, on its own table because a 100-row
 * priced, entitlement-gated catalogue does not fit contentDocs' small-collection kind model.
 * A premium resource's price is an administrator's (or Site Manager's) call even when a Content
 * Editor owns the rest of the row, mirroring content.ts's priceGuard pattern exactly.
 */
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, conflict, fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { can as allowed } from '@/lib/rbac';
import { allow, need } from './common';
import { runAgent } from './ai';
import { mockDraft, validateDraft, type DraftBrief, type DraftReply } from '@/domain/library-draft';

const t = schema.libraryResources;
type Row = typeof t.$inferSelect;
export const STATUSES = schema.LIBRARY_RESOURCE_STATUSES;

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'resource';

const shape = (r: Row) => ({
  id: r.id, slug: r.slug, title: r.title, authorId: r.authorId, topic: r.topic, dimension: r.dimension,
  summary: r.summary, body: r.body, coverMediaId: r.coverMediaId, fileMime: r.fileMime, fileSize: r.fileSize,
  hasFile: !!r.fileStorageKey, priceGhs: r.priceGhs === null ? null : Number(r.priceGhs), isFree: r.priceGhs === null,
  status: r.status, publishAt: r.publishAt, publishedAt: r.publishedAt, createdBy: r.createdBy, approvedBy: r.approvedBy,
  createdAt: r.createdAt, updatedAt: r.updatedAt
});
/** What an anonymous or non-entitled visitor may see: never the body or file of a priced resource. */
const publicShape = (r: Row) => ({
  id: r.id, slug: r.slug, title: r.title, authorId: r.authorId, topic: r.topic, dimension: r.dimension,
  summary: r.summary, body: r.priceGhs === null ? r.body : null, coverMediaId: r.coverMediaId,
  priceGhs: r.priceGhs === null ? null : Number(r.priceGhs), isFree: r.priceGhs === null, locked: r.priceGhs !== null,
  publishedAt: r.publishedAt
});

function priceGuard(ctx: Ctx, before: string | null | undefined, after: string | null | undefined) {
  const touched = String(before ?? '') !== String(after ?? '');
  if (touched && !allowed(need(ctx).user.role, 'settings', 'edit')) throw new ApiError(403, 'forbidden', 'Only an administrator can set or change a resource’s price.');
}

async function uniqueSlug(ctx: Ctx, base: string, excludeId?: string) {
  let slug = base, n = 1;
  for (;;) {
    const rows = await ctx.db.select({ id: t.id }).from(t).where(eq(t.slug, slug)).limit(1);
    if (!rows.length || rows[0].id === excludeId) return slug;
    slug = `${base}-${++n}`;
  }
}

/* --------------------------- public catalogue --------------------------- */
/** Published resources only, for the public /library pages. No role check: this is what an anonymous visitor sees. */
export async function publicList(ctx: Ctx, q: { q?: string; dimension?: string } = {}) {
  const rows = await ctx.db.select().from(t).where(and(
    eq(t.status, 'Published'),
    q.q ? or(ilike(t.title, `%${q.q.replace(/[%_]/g, '')}%`), ilike(t.summary, `%${q.q.replace(/[%_]/g, '')}%`)) : undefined,
    q.dimension ? eq(t.dimension, q.dimension) : undefined
  )).orderBy(desc(t.publishedAt)).limit(200);
  return rows.map(publicShape);
}
export async function publicGet(ctx: Ctx, slug: string) {
  const [r] = await ctx.db.select().from(t).where(and(eq(t.slug, slug), eq(t.status, 'Published'))).limit(1);
  if (!r) throw notFound('Resource not found');
  return publicShape(r);
}

/* ------------------------------- staff CRUD ------------------------------ */
export async function listResources(ctx: Ctx, q: { status?: string; authorId?: string; q?: string } = {}) {
  allow(ctx, 'library_resources', 'read');
  const rows = await ctx.db.select().from(t).where(and(
    q.status ? eq(t.status, q.status) : undefined,
    q.authorId ? eq(t.authorId, q.authorId) : undefined,
    q.q ? ilike(t.title, `%${q.q.replace(/[%_]/g, '')}%`) : undefined
  )).orderBy(desc(t.updatedAt)).limit(500);
  return rows.map(shape);
}

export async function getResource(ctx: Ctx, id: string) {
  allow(ctx, 'library_resources', 'read');
  const [r] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!r) throw notFound('Resource not found');
  return shape(r);
}

export type ResourceInput = Partial<{
  title: string; authorId: string; topic: string | null; dimension: string | null; summary: string; body: string;
  coverMediaId: string | null; priceGhs: number | null; slug: string;
}>;

export async function createResource(ctx: Ctx, b: ResourceInput) {
  allow(ctx, 'library_resources', 'create');
  const u = need(ctx);
  const title = (b.title ?? '').trim();
  if (!title) throw fieldError({ title: 'Enter a title' });
  if (!b.authorId) throw fieldError({ authorId: 'Choose an author' });
  const [author] = await ctx.db.select({ id: schema.libraryAuthors.id }).from(schema.libraryAuthors).where(eq(schema.libraryAuthors.id, b.authorId)).limit(1);
  if (!author) throw fieldError({ authorId: 'Unknown author' });
  if (b.priceGhs !== undefined && b.priceGhs !== null && !(b.priceGhs >= 0)) throw fieldError({ priceGhs: 'Must be zero or a positive amount, or leave blank for a free resource' });
  priceGuard(ctx, null, b.priceGhs === null || b.priceGhs === undefined ? null : String(b.priceGhs));
  const slug = await uniqueSlug(ctx, slugify(b.slug || title));
  const [r] = await ctx.db.insert(t).values({
    slug, title, authorId: b.authorId, topic: b.topic ?? null, dimension: b.dimension ?? null,
    summary: (b.summary ?? '').trim(), body: b.body ?? '', coverMediaId: b.coverMediaId ?? null,
    priceGhs: b.priceGhs === null || b.priceGhs === undefined ? null : String(b.priceGhs),
    status: 'Draft', createdBy: u.user.id
  }).returning();
  await audit(ctx, 'library_resource.created', 'library_resources', r.id, undefined, { title, slug });
  return shape(r);
}

async function load(ctx: Ctx, id: string) {
  const [r] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!r) throw notFound('Resource not found');
  return r;
}

/** No RBAC gate: used by the file-download route, where the real check is the entitlement/staff check that follows.
 *  Returns the raw row (storage key included) rather than the public shape(), which omits it. */
export async function loadResourceForFile(ctx: Ctx, id: string) {
  return load(ctx, id);
}

export async function updateResource(ctx: Ctx, id: string, b: ResourceInput) {
  allow(ctx, 'library_resources', 'edit');
  const before = await load(ctx, id);
  if (before.status === 'Published' || before.status === 'Archived') throw unprocessable('Unpublish or archive, or edit a new draft version. A live resource is not edited in place.');
  if (b.priceGhs !== undefined && b.priceGhs !== null && !(b.priceGhs >= 0)) throw fieldError({ priceGhs: 'Must be zero or a positive amount, or leave blank for a free resource' });
  if (b.priceGhs !== undefined) priceGuard(ctx, before.priceGhs, b.priceGhs === null ? null : String(b.priceGhs));
  if (b.authorId) {
    const [author] = await ctx.db.select({ id: schema.libraryAuthors.id }).from(schema.libraryAuthors).where(eq(schema.libraryAuthors.id, b.authorId)).limit(1);
    if (!author) throw fieldError({ authorId: 'Unknown author' });
  }
  const title = b.title !== undefined ? b.title.trim() : before.title;
  if (!title) throw fieldError({ title: 'Enter a title' });
  const slug = b.slug !== undefined ? await uniqueSlug(ctx, slugify(b.slug || title), id) : before.slug;
  const [r] = await ctx.db.update(t).set({
    title, slug, authorId: b.authorId ?? before.authorId, topic: b.topic === undefined ? before.topic : b.topic,
    dimension: b.dimension === undefined ? before.dimension : b.dimension, summary: b.summary === undefined ? before.summary : b.summary.trim(),
    body: b.body === undefined ? before.body : b.body, coverMediaId: b.coverMediaId === undefined ? before.coverMediaId : b.coverMediaId,
    priceGhs: b.priceGhs === undefined ? before.priceGhs : (b.priceGhs === null ? null : String(b.priceGhs)),
    updatedAt: new Date()
  }).where(eq(t.id, id)).returning();
  await audit(ctx, 'library_resource.updated', 'library_resources', id, before, r);
  return shape(r);
}

/** A Content Editor's own draft moves to In review; nothing is published without a separate approve. */
export async function submitResource(ctx: Ctx, id: string) {
  allow(ctx, 'library_resources', 'edit');
  const before = await load(ctx, id);
  if (before.status !== 'Draft') throw conflict('Only a draft can be submitted for review');
  if (!before.body.trim()) throw unprocessable('Add the resource’s content before submitting it for review');
  const [r] = await ctx.db.update(t).set({ status: 'In review', updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'library_resource.submitted', 'library_resources', id, { status: before.status }, { status: 'In review' });
  return shape(r);
}

/** Publish or send back to Draft. Whoever submitted it may not approve it (four-eyes, same discipline as discount rules). */
export async function decideResource(ctx: Ctx, id: string, b: { decision: 'Published' | 'Draft'; note?: string | null }) {
  allow(ctx, 'library_resources', 'approve');
  const u = need(ctx);
  const before = await load(ctx, id);
  if (before.status !== 'In review') throw conflict('Only a resource in review can be approved or returned');
  if (b.decision === 'Published' && before.createdBy === u.user.id) throw forbidden('The person who drafted this resource cannot approve its publication');
  const [r] = await ctx.db.update(t).set({
    status: b.decision, approvedBy: b.decision === 'Published' ? u.user.id : null,
    publishedAt: b.decision === 'Published' ? new Date() : before.publishedAt, updatedAt: new Date()
  }).where(eq(t.id, id)).returning();
  await audit(ctx, 'library_resource.decided', 'library_resources', id, { status: before.status }, { status: b.decision, note: b.note ?? null });
  return shape(r);
}

export async function archiveResource(ctx: Ctx, id: string) {
  allow(ctx, 'library_resources', 'approve');
  const before = await load(ctx, id);
  if (before.status !== 'Published') throw conflict('Only a published resource can be archived');
  const [r] = await ctx.db.update(t).set({ status: 'Archived', updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'library_resource.archived', 'library_resources', id, { status: before.status }, { status: 'Archived' });
  return shape(r);
}

export async function deleteResource(ctx: Ctx, id: string) {
  allow(ctx, 'library_resources', 'delete');
  const before = await load(ctx, id);
  if (before.status !== 'Draft') throw conflict('Only a draft may be deleted. Archive a published resource instead.');
  const [ent] = await ctx.db.select({ id: schema.resourceEntitlements.id }).from(schema.resourceEntitlements).where(eq(schema.resourceEntitlements.resourceId, id)).limit(1);
  if (ent) throw conflict('This resource has entitlements on record and cannot be deleted');
  await ctx.db.delete(t).where(eq(t.id, id));
  await audit(ctx, 'library_resource.deleted', 'library_resources', id, before, undefined);
  return { ok: true };
}

/**
 * Draft a resource from a topic brief. Returns a proposal only - nothing is saved. A Library Editor
 * who likes it calls createResource() themselves with the returned fields (editing freely first);
 * this function never writes to library_resources.
 */
export async function draftResource(ctx: Ctx, brief: DraftBrief): Promise<DraftReply & { blocked?: boolean }> {
  allow(ctx, 'library_resources', 'create');
  const u = need(ctx);
  if (!brief.topic?.trim()) throw fieldError({ topic: 'Describe the topic to draft' });
  try {
    const r = await runAgent<DraftReply>({
      agent: 'library_draft', caseId: null, requestedBy: u.user.id,
      context: { brief },
      validate: validateDraft, mock: () => mockDraft(brief)
    });
    return r.output;
  } catch (e: any) {
    if (e?.name === 'AgentBlocked' || e?.constructor?.name === 'AgentBlocked') return { title: '', summary: '', body: '', suggestedDimension: null, blocked: true };
    throw e;
  }
}

/** File attachment metadata only; the bytes are written by the API route handling the upload (storage.ts), same split as media.ts. */
export async function attachFile(ctx: Ctx, id: string, f: { storageKey: string; mime: string; size: number }) {
  allow(ctx, 'library_resources', 'edit');
  const before = await load(ctx, id);
  if (before.status === 'Published' || before.status === 'Archived') throw unprocessable('A live resource’s file is not replaced in place');
  const [r] = await ctx.db.update(t).set({ fileStorageKey: f.storageKey, fileMime: f.mime, fileSize: f.size, updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'library_resource.file_attached', 'library_resources', id, undefined, { mime: f.mime, size: f.size });
  return shape(r);
}
