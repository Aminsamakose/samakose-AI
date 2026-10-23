/**
 * Human review layer for the document-extraction pass (lib/document-extract.ts). A document uploaded
 * through storeDocument gets one `document_extractions` row, classified and (where the file format
 * allows) scanned for facts, sitting at status 'Pending'. Nothing here influences a score on its own --
 * only `reviewExtraction`'s 'Accept' path creates a real `evidence` row, exactly the way a human adding
 * evidence by hand would, with the same Document-supported class and document link. Reviewing is a
 * one-way decision: once Accepted or Rejected an extraction cannot be re-reviewed (correct it by adding
 * or reclassifying evidence directly, the same as for any other evidence).
 */
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, forbidden, notFound } from '@/lib/errors';
import { assertCase, assertLeadCase } from '@/domain/scope';
import { emitEvent } from '@/domain/events';
import { allow, need } from './common';
import type { DocumentKind } from '@/lib/document-extract';

const dex = schema.documentExtractions;

export async function listExtractions(ctx: Ctx, caseId: string, status?: 'Pending' | 'Accepted' | 'Rejected') {
  allow(ctx, 'evidence', 'read');
  await assertCase(ctx, caseId);
  return ctx.db.select({
    id: dex.id, code: dex.code, documentId: dex.documentId, kind: dex.kind, extractedText: dex.extractedText,
    facts: dex.facts, status: dex.status, evidenceId: dex.evidenceId, reviewedBy: dex.reviewedBy, reviewedAt: dex.reviewedAt, createdAt: dex.createdAt
  }).from(dex).where(and(eq(dex.caseId, caseId), status ? eq(dex.status, status) : undefined)).orderBy(desc(dex.createdAt));
}

export async function reviewExtraction(ctx: Ctx, id: string, b: { decision: 'Accept' | 'Reject'; description?: string; kind?: DocumentKind }) {
  allow(ctx, 'evidence', 'create');
  const u = need(ctx).user;
  // A machine-read guess only becomes evidence once staff reviews it -- the owner who uploaded the
  // document is exactly the person who should not get to wave their own paperwork through unchecked,
  // the same reasoning addEvidence already applies to a self-declared evidence class.
  if (u.role === 'OWNER') throw forbidden('A staff member must review extracted evidence before it counts');
  const [row] = await ctx.db.select().from(dex).where(eq(dex.id, id)).limit(1);
  if (!row) throw notFound('Extraction not found');
  if (row.status !== 'Pending') throw fieldError({ decision: `This extraction was already ${row.status.toLowerCase()}` });
  if (!row.caseId) throw fieldError({ decision: 'This document is not attached to a case, so there is nothing to add evidence to' });
  await assertLeadCase(ctx, row.caseId);

  if (b.decision === 'Reject') {
    await ctx.db.update(dex).set({ status: 'Rejected', reviewedBy: u.id, reviewedAt: new Date() }).where(eq(dex.id, id));
    await audit(ctx, 'extraction.rejected', 'document_extraction', id, { status: 'Pending' }, { status: 'Rejected' }, row.caseId);
    return { ok: true, status: 'Rejected' as const };
  }

  const facts = (row.facts as { label: string; value: string }[]) ?? [];
  const description = (b.description ?? '').trim()
    || (facts.length ? `${b.kind ?? row.kind}: ${facts.map((f) => `${f.label} ${f.value}`).join(', ')}` : `${b.kind ?? row.kind} (reviewed from an uploaded document)`);
  const [evRow] = await ctx.db.insert(schema.evidence).values({ caseId: row.caseId, description, class: 'Document-supported', documentId: row.documentId }).returning({ id: schema.evidence.id, code: schema.evidence.code });
  await ctx.db.update(dex).set({ status: 'Accepted', reviewedBy: u.id, reviewedAt: new Date(), evidenceId: evRow.id, kind: b.kind ?? row.kind }).where(eq(dex.id, id));
  await audit(ctx, 'extraction.accepted', 'document_extraction', id, { status: 'Pending' }, { status: 'Accepted', evidence: evRow.code }, row.caseId);
  await emitEvent(ctx, 'EvidenceUpdated', { caseId: row.caseId, payload: { evidence: evRow.code, fromExtraction: row.code } });
  return { ok: true, status: 'Accepted' as const, evidence: evRow };
}
