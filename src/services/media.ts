import path from 'node:path';
import { desc, eq, ilike, and, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { sha256 } from '@/lib/crypto';
import { env } from '@/lib/env';
import { storage } from '@/lib/storage';
import { fieldError, notFound, unprocessable } from '@/lib/errors';
import { allow, need } from './common';

const m = schema.mediaAssets;
export const MEDIA_CATEGORIES = ['Logo', 'Image', 'Team photo', 'Partner logo', 'Background', 'Document'] as const;
const startsWith = (b: Buffer, ...sig: number[]) => sig.every((x, i) => b[i] === x);
/** Images and PDFs only. SVG is left out on purpose because it can carry scripts. */
const TYPES: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  png: { mime: 'image/png', magic: (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47) },
  jpg: { mime: 'image/jpeg', magic: (b) => startsWith(b, 0xff, 0xd8, 0xff) },
  jpeg: { mime: 'image/jpeg', magic: (b) => startsWith(b, 0xff, 0xd8, 0xff) },
  webp: { mime: 'image/webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  pdf: { mime: 'application/pdf', magic: (b) => b.subarray(0, 5).toString() === '%PDF-' }
};
const safeName = (n: string) => path.basename(n).replace(/[^\w.\- ()]/g, '_').replace(/\.{2,}/g, '.').slice(0, 120) || 'file';
const shape = (r: typeof m.$inferSelect) => ({ id: r.id, name: r.name, filename: r.filename, category: r.category, mime: r.mime, size: r.size, altText: r.altText, url: `/media/${r.id}`, isImage: r.mime.startsWith('image/'), createdAt: r.createdAt });

export async function listMedia(ctx: Ctx, q: { q?: string; category?: string }) {
  allow(ctx, 'media', 'read');
  const rows = await ctx.db.select().from(m).where(and(q.q ? ilike(m.name, `%${q.q.replace(/[%_]/g, '')}%`) : undefined, q.category ? eq(m.category, q.category) : undefined)).orderBy(desc(m.createdAt)).limit(200);
  return { items: rows.map(shape), categories: MEDIA_CATEGORIES };
}

export async function uploadMedia(ctx: Ctx, form: FormData) {
  allow(ctx, 'media', 'create');
  return storeUpload(ctx, form);
}
/** Saves an uploaded image or PDF after checking size, type and content. Callers check their own permission first. */
export async function storeUpload(ctx: Ctx, form: FormData) {
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw fieldError({ file: 'Choose a file to upload' });
  if (file.size > Math.min(env.maxUploadBytes, 8 * 1048576)) throw fieldError({ file: 'Files can be at most 8 MB' });
  const filename = safeName(file.name);
  const type = TYPES[filename.split('.').pop()?.toLowerCase() ?? ''];
  if (!type) throw fieldError({ file: 'Use a PNG, JPG, WebP or PDF file' });
  const buf = Buffer.from(await file.arrayBuffer());
  if (!type.magic(buf)) throw fieldError({ file: 'The file content does not match its type' });
  const category = String(form.get('category') || (type.mime === 'application/pdf' ? 'Document' : 'Image'));
  if (!(MEDIA_CATEGORIES as readonly string[]).includes(category)) throw fieldError({ category: 'Choose a listed category' });
  const alt = String(form.get('altText') || '').trim().slice(0, 200) || null;
  if (type.mime.startsWith('image/') && !alt) throw fieldError({ altText: 'Describe the image for people who cannot see it' });
  const name = (String(form.get('name') || '').trim() || filename.replace(/\.[^.]+$/, '')).slice(0, 120);
  const key = `media/${crypto.randomUUID()}`;
  await storage().put(key, buf, type.mime);
  const [r] = await ctx.db.insert(m).values({ name, filename, category, mime: type.mime, size: buf.length, sha256: sha256(buf), storageKey: key, altText: alt, uploadedBy: need(ctx).user.id }).returning();
  await audit(ctx, 'media.upload', 'media', r.id, undefined, { name, filename, size: buf.length, sha256: r.sha256 });
  return shape(r);
}

export async function updateMedia(ctx: Ctx, id: string, b: { name?: string; altText?: string | null; category?: string }) {
  allow(ctx, 'media', 'edit');
  const [r] = await ctx.db.select().from(m).where(eq(m.id, id)).limit(1);
  if (!r) throw notFound('File not found');
  if (b.category && !(MEDIA_CATEGORIES as readonly string[]).includes(b.category)) throw fieldError({ category: 'Choose a listed category' });
  if (b.altText !== undefined && r.mime.startsWith('image/') && !(b.altText ?? '').trim()) throw fieldError({ altText: 'Describe the image for people who cannot see it' });
  const [u] = await ctx.db.update(m).set({ name: b.name?.trim() || r.name, altText: b.altText === undefined ? r.altText : (b.altText?.trim() || null), category: b.category ?? r.category, updatedAt: new Date() }).where(eq(m.id, id)).returning();
  await audit(ctx, 'media.edit', 'media', id, { name: r.name, altText: r.altText, category: r.category }, { name: u.name, altText: u.altText, category: u.category });
  return shape(u);
}

/** A file still used by a page cannot be deleted, so nothing on the website turns into a broken image. */
export async function deleteMedia(ctx: Ctx, id: string) {
  allow(ctx, 'media', 'delete');
  const [r] = await ctx.db.select().from(m).where(eq(m.id, id)).limit(1);
  if (!r) throw notFound('File not found');
  const [prog] = await ctx.db.select({ name: schema.programmes.name }).from(schema.programmes).where(eq(schema.programmes.logoMediaId, id)).limit(1);
  if (prog) throw unprocessable(`This file is the logo of the programme ${prog.name}. Change the logo there first.`);
  const used = await ctx.db.execute(sql`select kind, title from content_docs where draft::text like ${'%/media/' + id + '%'} or live::text like ${'%/media/' + id + '%'} limit 3`);
  if (used.rows.length) throw unprocessable(`This file is still used by: ${used.rows.map((x: any) => x.title || x.kind).join(', ')}. Remove it there first.`);
  await ctx.db.delete(m).where(eq(m.id, id));
  await audit(ctx, 'media.delete', 'media', id, { name: r.name, filename: r.filename }, undefined);
  return { deleted: true };
}

/** For the public /media/<id> address. */
export async function readMedia(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db().select().from(m).where(eq(m.id, id)).limit(1);
  if (!r) return null;
  const data = await storage().get(r.storageKey);
  return data ? { data, mime: r.mime, filename: r.filename } : null;
}
