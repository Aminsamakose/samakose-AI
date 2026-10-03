import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { forbidden, notFound, tooMany, unprocessable } from '@/lib/errors';
import { need, allow } from './common';
import { myPlace, openRound } from './rounds';
import { sendDocument, storeDocument } from './evidence';

/** Proof for answers in a team round. A colleague sees and attaches only what they uploaded themselves; the owner sees every upload for the round. */
export const DAILY_UPLOAD_LIMIT = 20;
const d = schema.documents;
const cols = { id: d.id, code: d.code, filename: d.filename, mime: d.mime, size: d.size, status: d.status, uploadedBy: d.uploadedBy, createdAt: d.createdAt };

async function placeAndRound(ctx: Ctx, roundId: string) {
  const place = await myPlace(ctx);
  if (!place) throw forbidden();
  const r = await openRound(ctx, place.orgId);
  if (!r || r.id !== roundId) throw notFound('Round not found');
  return { place, r };
}

export async function uploadRoundDocument(ctx: Ctx, roundId: string, form: FormData) {
  const { place, r } = await placeAndRound(ctx, roundId);
  const u = need(ctx).user;
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [n] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(d).where(and(eq(d.uploadedBy, u.id), gte(d.createdAt, since)));
  if ((n?.n ?? 0) >= DAILY_UPLOAD_LIMIT) throw tooMany(`You can upload up to ${DAILY_UPLOAD_LIMIT} files a day. Try again tomorrow.`);
  const row = await storeDocument(ctx, form, place.orgId, r.caseId);
  await audit(ctx, 'round.document_added', 'assessment_round', r.id, undefined, { document: row.code, by: u.id }, r.caseId);
  return { id: row.id, code: row.code, filename: row.filename, size: row.size };
}

export async function listRoundDocuments(ctx: Ctx, roundId: string) {
  const { place, r } = await placeAndRound(ctx, roundId);
  const u = need(ctx).user;
  const where = place.isOwner ? and(eq(d.orgId, place.orgId), eq(d.caseId, r.caseId)) : and(eq(d.orgId, place.orgId), eq(d.caseId, r.caseId), eq(d.uploadedBy, u.id));
  return ctx.db.select(cols).from(d).where(where).orderBy(desc(d.createdAt));
}

export async function downloadRoundDocument(ctx: Ctx, roundId: string, docId: string) {
  const { place, r } = await placeAndRound(ctx, roundId);
  const u = need(ctx).user;
  const [doc] = await ctx.db.select().from(d).where(and(eq(d.id, docId), eq(d.orgId, place.orgId), eq(d.caseId, r.caseId))).limit(1);
  if (!doc || (!place.isOwner && doc.uploadedBy !== u.id)) throw notFound('Document not found');
  return sendDocument(ctx, doc);
}

/** The owner takes a document off an answer before submitting. The answer falls back to Self-reported and the file stays in the record. */
export async function detachEvidence(ctx: Ctx, roundId: string, code: string) {
  allow(ctx, 'team', 'edit');
  const { place, r } = await placeAndRound(ctx, roundId);
  if (!place.isOwner) throw forbidden();
  const [draft] = await ctx.db.select().from(schema.responseDrafts).where(and(eq(schema.responseDrafts.roundId, r.id), eq(schema.responseDrafts.questionCode, code))).limit(1);
  if (!draft) throw notFound('Answer not found');
  if (draft.evidenceClass !== 'Document-supported') throw unprocessable('This answer has no attached document');
  await ctx.db.update(schema.responseDrafts).set({ evidenceClass: 'Self-reported', evidenceRef: null, updatedAt: new Date() }).where(eq(schema.responseDrafts.id, draft.id));
  await audit(ctx, 'round.evidence_detached', 'assessment_round', r.id, { question: code, document: draft.evidenceRef, answeredBy: draft.answeredBy }, undefined, r.caseId);
  return { ok: true };
}
