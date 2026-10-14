/**
 * Business Doctor Resource Library: authors. A lightweight byline record (name, title, bio, photo),
 * distinct from practitioner_profiles because a Library author is not vetted, not assigned to cases,
 * and may not hold a platform login at all. Built as its own small table (per the approved Phase 0
 * assessment) so a second or third author can be added later without reshaping library_resources.
 */
import { desc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, notFound } from '@/lib/errors';
import { allow, need } from './common';

const t = schema.libraryAuthors;
type Row = typeof t.$inferSelect;
const shape = (r: Row) => ({ id: r.id, name: r.name, title: r.title, bio: r.bio, photoMediaId: r.photoMediaId, userId: r.userId, createdAt: r.createdAt, updatedAt: r.updatedAt });

export type AuthorInput = Partial<{ name: string; title: string | null; bio: string | null; photoMediaId: string | null; userId: string | null }>;

export async function listAuthors(ctx: Ctx) {
  allow(ctx, 'library_authors', 'read');
  const rows = await ctx.db.select().from(t).orderBy(desc(t.createdAt));
  return rows.map(shape);
}

export async function getAuthor(ctx: Ctx, id: string) {
  allow(ctx, 'library_authors', 'read');
  const [r] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!r) throw notFound('Author not found');
  return shape(r);
}

export async function createAuthor(ctx: Ctx, b: AuthorInput) {
  allow(ctx, 'library_authors', 'create');
  const name = (b.name ?? '').trim();
  if (!name) throw fieldError({ name: 'Enter the author’s name' });
  const [r] = await ctx.db.insert(t).values({ name, title: b.title?.trim() || null, bio: b.bio?.trim() || null, photoMediaId: b.photoMediaId ?? null, userId: b.userId ?? null }).returning();
  await audit(ctx, 'library_author.created', 'library_authors', r.id, undefined, { name });
  return shape(r);
}

export async function updateAuthor(ctx: Ctx, id: string, b: AuthorInput) {
  allow(ctx, 'library_authors', 'edit');
  const [before] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!before) throw notFound('Author not found');
  const name = b.name !== undefined ? b.name.trim() : before.name;
  if (!name) throw fieldError({ name: 'Enter the author’s name' });
  const [r] = await ctx.db.update(t).set({
    name, title: b.title === undefined ? before.title : (b.title?.trim() || null), bio: b.bio === undefined ? before.bio : (b.bio?.trim() || null),
    photoMediaId: b.photoMediaId === undefined ? before.photoMediaId : b.photoMediaId, userId: b.userId === undefined ? before.userId : b.userId,
    updatedAt: new Date()
  }).where(eq(t.id, id)).returning();
  await audit(ctx, 'library_author.updated', 'library_authors', id, before, r);
  return shape(r);
}

export async function deleteAuthor(ctx: Ctx, id: string) {
  allow(ctx, 'library_authors', 'delete');
  const u = need(ctx);
  const [used] = await ctx.db.select({ id: schema.libraryResources.id }).from(schema.libraryResources).where(eq(schema.libraryResources.authorId, id)).limit(1);
  if (used) throw conflict('This author has resources in the Library and cannot be deleted. Reassign or archive them first.');
  const [r] = await ctx.db.delete(t).where(eq(t.id, id)).returning({ id: t.id });
  if (!r) throw notFound('Author not found');
  await audit(ctx, 'library_author.deleted', 'library_authors', id, undefined, { by: u.user.id });
  return { ok: true };
}
