import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { revalidateTag } from 'next/cache';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, conflict, fieldError, notFound, unprocessable } from '@/lib/errors';
import { randomToken } from '@/lib/crypto';
import { KIND_BY_ID, KINDS, validateData, slugify, type Kind } from '@/domain/content-kinds';
import { can as allowed } from '@/lib/rbac';
import { allow, need } from './common';

const t = schema.contentDocs;
type Row = typeof t.$inferSelect;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Visitors see changes straight away: drop the cached copy the public pages read. Safe to fail outside a web request. */
export function bust() { try { revalidateTag('site-content', { expire: 0 }); } catch { /* not in a request */ } }

function kindOf(id: string): Kind {
  const k = KIND_BY_ID[id];
  if (!k) throw notFound('Unknown content type');
  return k;
}
const shape = (r: Row, k: Kind) => ({
  id: r.id, kind: r.kind, key: r.key, title: r.title || (k.singleton ? k.label : 'Untitled'), status: r.status, version: r.version,
  data: r.draft as Record<string, unknown>, live: r.live as Record<string, unknown> | null,
  changed: r.live ? !same(r.draft, r.live) : false,
  customised: r.version > 0, publishAt: r.publishAt, publishedAt: r.publishedAt, updatedAt: r.updatedAt, sortOrder: r.sortOrder
});
const titleOf = (k: Kind, data: Record<string, unknown>) => (k.titleField ? String(data[k.titleField] ?? '') : k.label).slice(0, 160);

async function load(ctx: Ctx, id: string) {
  const [r] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!r) throw notFound('Content not found');
  const k = kindOf(r.kind);
  return { r, k };
}

/** The overview: every kind with how many items and how many are live. */
export async function overview(ctx: Ctx) {
  const c = need(ctx);
  const rows = await ctx.db.select({ kind: t.kind, status: t.status, n: sql<number>`count(*)::int` }).from(t).groupBy(t.kind, t.status);
  const mayContent = allowed(c.user.role, 'content', 'read');
  const maySettings = allowed(c.user.role, 'site_settings', 'read');
  return KINDS.filter((k) => (k.group === 'content' ? mayContent : maySettings)).map((k) => {
    const mine = rows.filter((x) => x.kind === k.id);
    const n = (s: string) => Number(mine.find((x) => x.status === s)?.n ?? 0);
    return { id: k.id, label: k.plural, blurb: k.blurb, group: k.group, singleton: k.singleton, total: mine.reduce((a, x) => a + Number(x.n), 0), published: n('Published'), draft: n('Draft'), inReview: n('In review'), scheduled: n('Scheduled'), archived: n('Archived') };
  });
}
export async function listDocs(ctx: Ctx, kindId: string) {
  const k = kindOf(kindId);
  allow(ctx, k.group, 'read');
  if (k.singleton) {
    let [r] = await ctx.db.select().from(t).where(and(eq(t.kind, k.id), eq(t.key, k.id))).limit(1);
    if (!r) r = await createSingleton(ctx, k);
    return { kind: k, items: [shape(r, k)] };
  }
  const rows = await ctx.db.select().from(t).where(eq(t.kind, k.id)).orderBy(asc(t.sortOrder), desc(t.updatedAt));
  return { kind: k, items: rows.map((r) => shape(r, k)) };
}

/** Settings start from the built-in text. Nothing is live from the database until someone publishes. */
async function createSingleton(ctx: Ctx, k: Kind) {
  const [r] = await ctx.db.insert(t).values({ kind: k.id, key: k.id, title: k.label, status: 'Draft', draft: k.defaults }).onConflictDoNothing().returning();
  if (r) return r;
  const [again] = await ctx.db.select().from(t).where(and(eq(t.kind, k.id), eq(t.key, k.id))).limit(1);
  return again;
}

export async function getDoc(ctx: Ctx, id: string) {
  const { r, k } = await load(ctx, id);
  allow(ctx, k.group, 'read');
  return { kind: k, item: shape(r, k) };
}

async function slugTaken(ctx: Ctx, slug: string, exceptId?: string) {
  const rows = await ctx.db.select({ id: t.id }).from(t).where(and(eq(t.kind, 'article'), sql`${t.draft}->>'slug' = ${slug}`));
  return rows.some((x) => x.id !== exceptId);
}

export async function createDoc(ctx: Ctx, kindId: string, body: { data: unknown; sortOrder?: number }) {
  const k = kindOf(kindId);
  if (k.singleton) throw unprocessable('This setting already exists. Edit it instead.');
  allow(ctx, k.group, 'create');
  const v = validateData(k, body.data);
  if (!v.ok) throw fieldError(v.fields);
  if (k.id === 'article') {
    if (!v.data.slug && v.data.title) v.data.slug = slugify(String(v.data.title));
    if (v.data.slug && (await slugTaken(ctx, String(v.data.slug)))) throw fieldError({ slug: 'Another article already uses this address' });
  }
  const [r] = await ctx.db.insert(t).values({ kind: k.id, key: randomToken(6), title: titleOf(k, v.data), status: 'Draft', draft: v.data, sortOrder: body.sortOrder ?? 0, createdBy: need(ctx).user.id, updatedBy: need(ctx).user.id }).returning();
  await audit(ctx, 'content.create', `content:${k.id}`, r.id, undefined, { title: r.title, status: r.status });
  return shape(r, k);
}

export async function saveDraft(ctx: Ctx, id: string, body: { data: unknown; sortOrder?: number }) {
  const { r, k } = await load(ctx, id);
  allow(ctx, k.group, 'edit');
  if (r.status === 'Archived') throw unprocessable('Restore this item from the archive before editing it.');
  const v = validateData(k, body.data);
  if (!v.ok) throw fieldError(v.fields);
  if (k.id === 'article' && v.data.slug && (await slugTaken(ctx, String(v.data.slug), r.id))) throw fieldError({ slug: 'Another article already uses this address' });
  // Editing something that is in review sends it back to draft so the reviewer sees the latest text.
  const status = r.status === 'In review' ? 'Draft' : r.status === 'Scheduled' ? 'Scheduled' : r.status;
  const [u] = await ctx.db.update(t).set({ draft: v.data, title: titleOf(k, v.data), status, sortOrder: body.sortOrder ?? r.sortOrder, updatedBy: need(ctx).user.id, updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'content.edit', `content:${k.id}`, id, r.draft, v.data);
  return shape(u, k);
}

export async function submitForReview(ctx: Ctx, id: string) {
  const { r, k } = await load(ctx, id);
  allow(ctx, k.group, 'edit');
  if (r.status !== 'Draft') throw unprocessable('Only drafts can be sent for review.');
  const v = validateData(k, r.draft, { forPublish: true });
  if (!v.ok) throw fieldError(v.fields);
  const [u] = await ctx.db.update(t).set({ status: 'In review', updatedBy: need(ctx).user.id, updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'content.submit', `content:${k.id}`, id, { status: r.status }, { status: 'In review' });
  return shape(u, k);
}

async function nextVersion(ctx: Ctx, r: Row, k: Kind, note: string | null, actor: string | null) {
  const v = validateData(k, r.draft, { forPublish: true });
  if (!v.ok) throw fieldError(v.fields);
  if (k.id === 'article' && v.data.slug && (await slugTaken(ctx, String(v.data.slug), r.id))) throw fieldError({ slug: 'Another article already uses this address' });
  const version = r.version + 1;
  await ctx.db.insert(schema.contentVersions).values({ docId: r.id, version, data: v.data, note, authorId: actor });
  return { version, data: v.data };
}

export async function publish(ctx: Ctx, id: string, body: { note?: string | null }) {
  const { r, k } = await load(ctx, id);
  allow(ctx, k.group, 'approve');
  if (r.status === 'Archived') throw unprocessable('Restore this item from the archive first.');
  const { version, data } = await nextVersion(ctx, r, k, body.note ?? null, need(ctx).user.id);
  const [u] = await ctx.db.update(t).set({ live: data, draft: data, title: titleOf(k, data), version, status: 'Published', publishAt: null, publishedAt: new Date(), publishedBy: need(ctx).user.id, updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'content.publish', `content:${k.id}`, id, r.live, data);
  bust();
  return shape(u, k);
}

export async function schedule(ctx: Ctx, id: string, body: { at: string }) {
  const { r, k } = await load(ctx, id);
  allow(ctx, k.group, 'approve');
  const at = new Date(body.at);
  if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 60_000) throw fieldError({ at: 'Choose a time in the future' });
  if (r.status === 'Archived') throw unprocessable('Restore this item from the archive first.');
  const v = validateData(k, r.draft, { forPublish: true });
  if (!v.ok) throw fieldError(v.fields);
  const [u] = await ctx.db.update(t).set({ status: 'Scheduled', publishAt: at, updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'content.schedule', `content:${k.id}`, id, { status: r.status }, { status: 'Scheduled', publishAt: at.toISOString() });
  bust();
  return shape(u, k);
}

export async function unschedule(ctx: Ctx, id: string) {
  const { r, k } = await load(ctx, id);
  allow(ctx, k.group, 'approve');
  if (r.status !== 'Scheduled') throw unprocessable('This item is not scheduled.');
  const [u] = await ctx.db.update(t).set({ status: r.live ? 'Published' : 'Draft', publishAt: null, updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'content.unschedule', `content:${k.id}`, id, { status: 'Scheduled' }, { status: u.status });
  bust();
  return shape(u, k);
}

/** Take something off the public site without losing it. */
export async function archive(ctx: Ctx, id: string) {
  const { r, k } = await load(ctx, id);
  if (k.singleton) throw unprocessable('Settings cannot be archived. Switch them off or restore an earlier version.');
  allow(ctx, k.group, 'approve');
  const [u] = await ctx.db.update(t).set({ status: 'Archived', publishAt: null, updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'content.archive', `content:${k.id}`, id, { status: r.status }, { status: 'Archived' });
  bust();
  return shape(u, k);
}

export async function unarchive(ctx: Ctx, id: string) {
  const { r, k } = await load(ctx, id);
  allow(ctx, k.group, 'approve');
  if (r.status !== 'Archived') throw unprocessable('This item is not archived.');
  const [u] = await ctx.db.update(t).set({ status: 'Draft', updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'content.unarchive', `content:${k.id}`, id, { status: 'Archived' }, { status: 'Draft' });
  bust();
  return shape(u, k);
}

/** Permanent removal is limited to archived items, so nothing live disappears by accident. */
export async function remove(ctx: Ctx, id: string) {
  const { r, k } = await load(ctx, id);
  allow(ctx, k.group, 'delete');
  if (r.status !== 'Archived') throw unprocessable('Archive an item before deleting it.');
  await ctx.db.delete(t).where(eq(t.id, id));
  await audit(ctx, 'content.delete', `content:${k.id}`, id, { title: r.title, draft: r.draft }, undefined);
  bust();
  return { deleted: true };
}

export async function versions(ctx: Ctx, id: string) {
  const { k } = await load(ctx, id);
  allow(ctx, k.group, 'read');
  const rows = await ctx.db.select({ id: schema.contentVersions.id, version: schema.contentVersions.version, data: schema.contentVersions.data, note: schema.contentVersions.note, createdAt: schema.contentVersions.createdAt, author: schema.users.name })
    .from(schema.contentVersions).leftJoin(schema.users, eq(schema.users.id, schema.contentVersions.authorId)).where(eq(schema.contentVersions.docId, id)).orderBy(desc(schema.contentVersions.version));
  return rows;
}

/** Put an earlier published version back into the working copy. It does not go live until it is published again. */
export async function restore(ctx: Ctx, id: string, body: { version: number }) {
  const { r, k } = await load(ctx, id);
  allow(ctx, k.group, 'edit');
  if (r.status === 'Archived') throw unprocessable('Restore this item from the archive first.');
  const [vr] = await ctx.db.select().from(schema.contentVersions).where(and(eq(schema.contentVersions.docId, id), eq(schema.contentVersions.version, body.version))).limit(1);
  if (!vr) throw notFound('Version not found');
  const v = validateData(k, vr.data);
  if (!v.ok) throw conflict('That version no longer fits the current fields.');
  const [u] = await ctx.db.update(t).set({ draft: v.data, title: titleOf(k, v.data), status: r.live ? 'Published' : 'Draft', updatedBy: need(ctx).user.id, updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'content.restore', `content:${k.id}`, id, r.draft, v.data);
  return shape(u, k);
}

/** Scheduled items whose time has come go live. Called from the daily job; the public loader also honours the time on its own. */
export async function promoteDue(ctx: Ctx) {
  const due = await ctx.db.select().from(t).where(and(eq(t.status, 'Scheduled'), sql`${t.publishAt} <= now()`));
  let n = 0;
  for (const r of due) {
    const k = KIND_BY_ID[r.kind]; if (!k) continue;
    try {
      const { version, data } = await nextVersion(ctx, r, k, 'Scheduled publication', r.updatedBy);
      await ctx.db.update(t).set({ live: data, draft: data, version, status: 'Published', publishAt: null, publishedAt: new Date(), publishedBy: r.updatedBy, updatedAt: new Date() }).where(eq(t.id, r.id));
      await audit(ctx, 'content.publish', `content:${k.id}`, r.id, r.live, data);
      n++;
    } catch (e) { if (!(e instanceof ApiError)) throw e; }
  }
  if (n) bust();
  return n;
}
