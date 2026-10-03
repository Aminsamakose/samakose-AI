import { and, desc, eq } from 'drizzle-orm';
import { storage } from '@/lib/storage';
import path from 'node:path';
import crypto from 'node:crypto';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, fieldError, forbidden, notFound } from '@/lib/errors';
import { can } from '@/lib/rbac';
import { assertCase, assertOrg, caseScope, isInternal, assertLeadCase } from '@/domain/scope';
import { emitEvent } from '@/domain/events';
import { env } from '@/lib/env';
import { sha256 } from '@/lib/crypto';
import { allow, need } from './common';
import { computeScore } from './diagnostics';
import { advanceCase, latestDiagnostic } from './common';
import type { EvidenceClass } from '@/db/schema';

const ev = schema.evidence;

export async function listEvidence(ctx: Ctx, caseId: string) {
  allow(ctx, 'evidence', 'read');
  await assertCase(ctx, caseId);
  return ctx.db.select({ id: ev.id, code: ev.code, class: ev.class, description: ev.description, link: ev.link, responseId: ev.responseId, documentId: ev.documentId, verifiedAt: ev.verifiedAt, createdAt: ev.createdAt }).from(ev).where(eq(ev.caseId, caseId)).orderBy(desc(ev.createdAt));
}

export async function addEvidence(ctx: Ctx, caseId: string, b: { description: string; class?: EvidenceClass; documentId?: string | null; link?: string | null }) {
  allow(ctx, 'evidence', 'create');
  const u = need(ctx).user;
  const cs = await assertLeadCase(ctx, caseId);
  let cls: EvidenceClass = b.class ?? 'Unverified';
  // Only staff can declare more than "offered, not yet checked". Owners cannot verify their own claims.
  if (u.role === 'OWNER' && cls !== 'Unverified' && cls !== 'Self-reported') cls = 'Unverified';
  if (b.documentId) {
    const [d] = await ctx.db.select().from(schema.documents).where(and(eq(schema.documents.id, b.documentId), eq(schema.documents.orgId, cs.orgId))).limit(1);
    if (!d) throw fieldError({ documentId: 'Document not found for this organisation' });
    if (u.role !== 'OWNER' && cls === 'Unverified') cls = 'Document-supported';
  }
  if (b.link && !/^https?:\/\//i.test(b.link)) throw fieldError({ link: 'Links must start with http:// or https://' });
  const [row] = await ctx.db.insert(ev).values({ caseId, description: b.description.trim(), class: cls, documentId: b.documentId ?? null, link: b.link ?? null }).returning({ id: ev.id, code: ev.code, class: ev.class });
  await audit(ctx, 'evidence.added', 'evidence', row.id, undefined, { class: row.class }, caseId);
  await emitEvent(ctx, 'EvidenceUpdated', { caseId, payload: { evidence: row.code } });
  return row;
}

export async function updateEvidence(ctx: Ctx, id: string, b: { class?: EvidenceClass; description?: string }) {
  allow(ctx, 'evidence', 'edit');
  const [before] = await ctx.db.select().from(ev).where(eq(ev.id, id)).limit(1);
  if (!before) throw notFound('Evidence not found');
  await assertLeadCase(ctx, before.caseId);
  if (b.class === 'Verified' && !can(need(ctx).user.role, 'evidence', 'verify')) throw forbidden('Only the lead expert on the case can verify evidence');
  const patch: Partial<typeof ev.$inferInsert> = { updatedAt: new Date() };
  if (b.description) patch.description = b.description.trim();
  if (b.class) { patch.class = b.class; if (b.class === 'Verified') { patch.verifiedBy = ctx.user!.id; patch.verifiedAt = new Date(); } }
  await ctx.db.update(ev).set(patch).where(eq(ev.id, id));
  await audit(ctx, 'evidence.updated', 'evidence', id, { class: before.class, description: before.description }, { class: b.class ?? before.class, description: b.description ?? before.description }, before.caseId);
  await emitEvent(ctx, 'EvidenceUpdated', { caseId: before.caseId, payload: { evidence: before.code, class: b.class } });
  // A changed evidence class changes the score. Score again from the current evidence.
  if (b.class && b.class !== before.class && before.responseId) {
    const d = await latestDiagnostic(ctx, before.caseId);
    if (d) { await computeScore(ctx, before.caseId, d.id); await advanceCase(ctx, before.caseId); }
  }
  return { ok: true };
}

/* ------------------------------ documents ------------------------------ */
const TYPES: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  pdf: { mime: 'application/pdf', magic: (b) => b.subarray(0, 4).toString() === '%PDF' },
  png: { mime: 'image/png', magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  jpg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])) },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])) },
  csv: { mime: 'text/csv', magic: (b) => !b.includes(0) },
  txt: { mime: 'text/plain', magic: (b) => !b.includes(0) }
};
export const ALLOWED_EXTENSIONS = Object.keys(TYPES);
const safeName = (n: string) => path.basename(n).replace(/[^\w.\- ()]/g, '_').replace(/\.{2,}/g, '.').slice(0, 120) || 'file';

export async function uploadDocument(ctx: Ctx, form: FormData) {
  allow(ctx, 'documents', 'create');
  const u = need(ctx).user;
  const caseId = (form.get('caseId') as string) || null;
  let orgId = (form.get('orgId') as string) || u.orgId;
  if (caseId) { const cs = await assertCase(ctx, caseId); orgId = cs.orgId; }
  else if (orgId) await assertOrg(ctx, orgId);
  if (!orgId) throw fieldError({ orgId: 'Choose the organisation this document belongs to' });
  return storeDocument(ctx, form, orgId, caseId);
}

/** Checks and stores one uploaded file for a business. Callers decide who may upload and for which business; the file rules are the same for everyone. */
export async function storeDocument(ctx: Ctx, form: FormData, orgId: string, caseId: string | null) {
  const u = need(ctx).user;
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw fieldError({ file: 'Choose a file to upload' });
  if (file.size > env.maxUploadBytes) throw fieldError({ file: `Files can be at most ${Math.round(env.maxUploadBytes / 1048576)} MB` });
  const name = safeName(file.name);
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const type = TYPES[ext];
  if (!type) throw fieldError({ file: `This file type is not accepted. Use ${ALLOWED_EXTENSIONS.join(', ')}` });
  const buf = Buffer.from(await file.arrayBuffer());
  if (!type.magic(buf)) throw fieldError({ file: 'The file content does not match its type' });
  const now = new Date();
  const key = [String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), crypto.randomUUID()].join('/');
  await storage().put(key, buf, type.mime);
  const [row] = await ctx.db.insert(schema.documents).values({ orgId, caseId, filename: name, mime: type.mime, size: buf.length, sha256: sha256(buf), storageKey: key, uploadedBy: u.id }).returning({ id: schema.documents.id, code: schema.documents.code, filename: schema.documents.filename, size: schema.documents.size });
  await audit(ctx, 'document.uploaded', 'document', row.id, undefined, { filename: name, size: buf.length, sha256: sha256(buf) }, caseId);
  if (caseId) await emitEvent(ctx, 'DocumentUploaded', { caseId, payload: { filename: name } });
  return row;
}

export async function listDocuments(ctx: Ctx, q: { caseId?: string; orgId?: string }) {
  allow(ctx, 'documents', 'read');
  const u = need(ctx).user;
  let orgId = q.orgId ?? u.orgId ?? undefined;
  if (q.caseId) orgId = (await assertCase(ctx, q.caseId)).orgId;
  else if (orgId) await assertOrg(ctx, orgId);
  else throw fieldError({ orgId: 'Choose an organisation or a case' });
  const d = schema.documents;
  return ctx.db.select({ id: d.id, code: d.code, filename: d.filename, mime: d.mime, size: d.size, caseId: d.caseId, createdAt: d.createdAt, sha256: d.sha256 }).from(d)
    .where(and(eq(d.orgId, orgId!), q.caseId ? eq(d.caseId, q.caseId) : undefined)).orderBy(desc(d.createdAt));
}

export async function downloadDocument(ctx: Ctx, id: string) {
  allow(ctx, 'documents', 'read');
  const [d] = await ctx.db.select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1);
  if (!d) throw notFound('Document not found');
  const u = need(ctx).user;
  if (d.caseId) await assertCase(ctx, d.caseId);
  else await assertOrg(ctx, d.orgId);
  if (u.role === 'OWNER' && u.orgId !== d.orgId) throw notFound('Document not found');
  return sendDocument(ctx, d);
}

/** Streams a stored document after checking its fingerprint. The caller has already decided the person may read it. */
export async function sendDocument(ctx: Ctx, d: typeof schema.documents.$inferSelect) {
  const data = await storage().get(d.storageKey);
  if (!data) throw new ApiError(410, 'file_missing', 'The stored file is no longer available');
  if (sha256(data) !== d.sha256) throw new ApiError(500, 'integrity_failed', 'The stored file failed its integrity check');
  await audit(ctx, 'document.downloaded', 'document', d.id, undefined, { filename: d.filename }, d.caseId);
  return new Response(new Uint8Array(data), { status: 200, headers: {
    'content-type': d.mime, 'content-length': String(data.length), 'content-disposition': `attachment; filename="${d.filename.replace(/"/g, '')}"`,
    'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store', 'content-security-policy': "default-src 'none'; sandbox"
  } });
}
export { caseScope, isInternal };
