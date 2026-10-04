/**
 * Profile photos. One capability for every person on the platform: the photo belongs to the user identity, not to a role.
 * Photos are private. They are served only after an access check, are resized and stripped of location data on upload,
 * and are removed from storage when taken down.
 */
import crypto from 'node:crypto';
import sharp from 'sharp';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { sha256 } from '@/lib/crypto';
import { fieldError, forbidden, notFound } from '@/lib/errors';
import { storage } from '@/lib/storage';
import { isStaff } from '@/lib/rbac';
import { caseScope } from '@/domain/scope';
import { need } from './common';

const u = schema.users;
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const SIZE = 320;
const startsWith = (b: Buffer, ...sig: number[]) => sig.every((x, i) => b[i] === x);
/** PNG, JPEG and WebP only, checked by content and not by file name. SVG is left out because it can carry scripts. */
const isImage = (b: Buffer) => startsWith(b, 0x89, 0x50, 0x4e, 0x47) || startsWith(b, 0xff, 0xd8, 0xff) || (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP');

/** Who may see a person's photo: themselves, administrators and executives, other staff for staff photos,
 *  staff on a case for the business's people, and a business for the practitioners assigned to it. */
export async function canSeePhoto(ctx: Ctx, targetId: string): Promise<boolean> {
  const v = need(ctx).user;
  if (v.id === targetId || v.role === 'ADMIN' || v.role === 'EXECUTIVE') return true;
  const [t] = await ctx.db.select({ role: u.role, orgId: u.orgId }).from(u).where(eq(u.id, targetId)).limit(1);
  if (!t) return false;
  if (isStaff(v.role)) {
    if (isStaff(t.role)) return true;
    if (!t.orgId) return false;
    if (v.role === 'FINANCE') return true;
    const r = await ctx.db.execute(sql`select 1 from cases where org_id = ${t.orgId} and ${caseScope(v)} limit 1`);
    return r.rows.length > 0;
  }
  if (v.orgId && t.orgId === v.orgId) return true;
  if (v.orgId && isStaff(t.role)) {
    const r = await ctx.db.execute(sql`select 1 from cases c where c.org_id = ${v.orgId} and (c.consultant_id = ${targetId} or c.coach_id = ${targetId} or c.reviewer_id = ${targetId}
      or exists (select 1 from case_assignments a where a.case_id = c.id and a.user_id = ${targetId} and a.status = 'Active')) limit 1`);
    return r.rows.length > 0;
  }
  return false;
}

export async function uploadPhoto(ctx: Ctx, userId: string, form: FormData) {
  const c = need(ctx);
  if (c.user.id !== userId && c.user.role !== 'ADMIN') throw forbidden('You can change only your own photo');
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw fieldError({ file: 'Choose a photo to upload' });
  if (file.size > PHOTO_MAX_BYTES) throw fieldError({ file: 'The photo can be at most 4 MB' });
  const buf = Buffer.from(await file.arrayBuffer());
  if (!isImage(buf)) throw fieldError({ file: 'Use a PNG, JPG or WebP photo' });
  let out: Buffer;
  try {
    // Rotate by the camera orientation, crop to a square, shrink, and drop all metadata (including location).
    out = await sharp(buf, { limitInputPixels: 50_000_000 }).rotate().resize(SIZE, SIZE, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toBuffer();
  } catch { throw fieldError({ file: 'This photo could not be read. Try another one.' }); }
  const [row] = await ctx.db.select({ photoKey: u.photoKey }).from(u).where(eq(u.id, userId)).limit(1);
  if (!row) throw notFound('Person not found');
  const key = `photos/${userId}/${crypto.randomUUID()}.webp`;
  await storage().put(key, out, 'image/webp');
  const now = new Date();
  await ctx.db.update(u).set({ photoKey: key, photoMime: 'image/webp', photoSha256: sha256(out), photoUpdatedAt: now, updatedAt: now }).where(eq(u.id, userId));
  if (row.photoKey) await storage().remove(row.photoKey);
  await audit(ctx, 'user.photo_updated', 'user', userId, { had: !!row.photoKey }, { size: out.length });
  return { ok: true, photoUrl: `/api/v1/users/${userId}/photo?v=${now.getTime()}` };
}

export async function removePhoto(ctx: Ctx, userId: string) {
  const c = need(ctx);
  if (c.user.id !== userId && c.user.role !== 'ADMIN') throw forbidden('You can remove only your own photo');
  const [row] = await ctx.db.select({ photoKey: u.photoKey }).from(u).where(eq(u.id, userId)).limit(1);
  if (!row) throw notFound('Person not found');
  if (!row.photoKey) return { ok: true };
  await ctx.db.update(u).set({ photoKey: null, photoMime: null, photoSha256: null, photoUpdatedAt: null, updatedAt: new Date() }).where(eq(u.id, userId));
  await storage().remove(row.photoKey);
  await audit(ctx, 'user.photo_removed', 'user', userId, { had: true }, undefined);
  return { ok: true };
}

/** A missing photo and a photo the viewer may not see look the same: not found. */
export async function readPhoto(ctx: Ctx, userId: string) {
  need(ctx);
  const [row] = await ctx.db.select({ photoKey: u.photoKey, photoSha256: u.photoSha256 }).from(u).where(and(eq(u.id, userId))).limit(1);
  if (!row?.photoKey || !(await canSeePhoto(ctx, userId))) throw notFound('Photo not found');
  const data = await storage().get(row.photoKey);
  if (!data) throw notFound('Photo not found');
  return new Response(new Uint8Array(data), { status: 200, headers: {
    'content-type': 'image/webp', 'content-length': String(data.length), 'x-content-type-options': 'nosniff', etag: `"${row.photoSha256}"`,
    // Private: the browser may keep it, a shared cache may not. The address carries a version, so a new photo is fetched at once.
    'cache-control': 'private, max-age=86400', 'content-security-policy': "default-src 'none'; sandbox"
  } });
}
