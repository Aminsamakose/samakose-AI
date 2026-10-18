import { and, asc, desc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, notFound, unprocessable } from '@/lib/errors';
import { assertProgramme, assertCase } from '@/domain/scope';
import { allow, need } from './common';

const D = schema.outcomeDefinitions, R = schema.outcomeRecords;
const isUnique = (e: any) => (e?.code ?? e?.cause?.code) === '23505';

type DefInput = { name: string; unit: string; reportingPeriod?: string | null; source?: string | null; verificationRequired?: boolean };

export async function listDefinitions(ctx: Ctx, programmeId: string) {
  allow(ctx, 'programmes', 'read');
  await assertProgramme(ctx, programmeId);
  return ctx.db.select().from(D).where(eq(D.programmeId, programmeId)).orderBy(asc(D.createdAt));
}

export async function createDefinition(ctx: Ctx, programmeId: string, b: DefInput) {
  allow(ctx, 'programmes', 'edit');
  await assertProgramme(ctx, programmeId);
  try {
    const [row] = await ctx.db.insert(D).values({
      programmeId, name: b.name.trim(), unit: b.unit.trim(), reportingPeriod: b.reportingPeriod?.trim() || null,
      source: b.source?.trim() || null, verificationRequired: b.verificationRequired ?? true, createdBy: need(ctx).user.id,
    }).returning({ id: D.id });
    await audit(ctx, 'outcome_definition.created', 'programme', programmeId, undefined, { name: b.name, unit: b.unit });
    return { id: row.id };
  } catch (e) { if (isUnique(e)) throw conflict('This programme already has an outcome definition with that name'); throw e; }
}

async function loadDefinition(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(D).where(eq(D.id, id)).limit(1);
  if (!row) throw notFound('Outcome definition not found');
  await assertProgramme(ctx, row.programmeId);
  return row;
}

export async function updateDefinition(ctx: Ctx, id: string, b: Partial<DefInput>) {
  allow(ctx, 'programmes', 'edit');
  const row = await loadDefinition(ctx, id);
  try {
    await ctx.db.update(D).set({
      ...(b.name ? { name: b.name.trim() } : {}), ...(b.unit ? { unit: b.unit.trim() } : {}),
      ...(b.reportingPeriod !== undefined ? { reportingPeriod: b.reportingPeriod?.trim() || null } : {}),
      ...(b.source !== undefined ? { source: b.source?.trim() || null } : {}),
      ...(b.verificationRequired !== undefined ? { verificationRequired: b.verificationRequired } : {}),
      updatedAt: new Date(),
    }).where(eq(D.id, id));
  } catch (e) { if (isUnique(e)) throw conflict('This programme already has an outcome definition with that name'); throw e; }
  await audit(ctx, 'outcome_definition.updated', 'programme', row.programmeId, { name: row.name, unit: row.unit }, b);
  return { ok: true };
}

/** A definition with recorded results against it is evidence of what funders were told; removing it
 *  would erase that trail, so it can only go while nothing has been recorded yet. */
export async function deleteDefinition(ctx: Ctx, id: string) {
  allow(ctx, 'programmes', 'edit');
  const row = await loadDefinition(ctx, id);
  const [{ n }] = await ctx.db.select({ n: schema.outcomeRecords.id }).from(R).where(eq(R.definitionId, id)).limit(1).then((r) => [{ n: r.length }]);
  if (n > 0) throw conflict('This definition already has recorded results and cannot be removed');
  await ctx.db.delete(D).where(eq(D.id, id));
  await audit(ctx, 'outcome_definition.deleted', 'programme', row.programmeId, { name: row.name }, undefined);
  return { ok: true };
}

export async function listRecords(ctx: Ctx, definitionId: string) {
  allow(ctx, 'programmes', 'read');
  await loadDefinition(ctx, definitionId);
  return ctx.db.select().from(R).where(eq(R.definitionId, definitionId)).orderBy(desc(R.createdAt));
}

type RecordInput = {
  caseId: string;
  baselineValue?: number | null; baselineDate?: string | null;
  followupValue?: number | null; followupDate?: string | null;
  evidenceClass?: typeof schema.EVIDENCE_CLASSES[number];
  documentId?: string | null;
  attributionNote?: string | null;
};

/** Records one enterprise's baseline and/or followup result against a definition. A case must
 *  belong to the same programme as the definition -- an outcome is reported against the enterprise
 *  the programme actually worked with, never a case borrowed from another programme. */
export async function recordOutcome(ctx: Ctx, definitionId: string, b: RecordInput) {
  allow(ctx, 'programmes', 'edit');
  const def = await loadDefinition(ctx, definitionId);
  const c = await assertCase(ctx, b.caseId);
  if (c.programmeId !== def.programmeId) throw fieldError({ caseId: 'This enterprise is not part of the definition’s programme' });
  if (b.baselineValue == null && b.followupValue == null) throw fieldError({ baselineValue: 'Give a baseline value, a followup value, or both' });
  const [row] = await ctx.db.insert(R).values({
    definitionId, caseId: b.caseId,
    baselineValue: b.baselineValue != null ? String(b.baselineValue) : null, baselineDate: b.baselineDate ?? null,
    followupValue: b.followupValue != null ? String(b.followupValue) : null, followupDate: b.followupDate ?? null,
    evidenceClass: b.evidenceClass ?? 'Self-reported', documentId: b.documentId ?? null,
    attributionNote: b.attributionNote?.trim() || null, status: 'PENDING', createdBy: need(ctx).user.id,
  }).returning({ id: R.id });
  await audit(ctx, 'outcome_record.created', 'programme', def.programmeId, undefined, { definitionId, caseId: b.caseId });
  return { id: row.id };
}

async function loadRecord(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(R).where(eq(R.id, id)).limit(1);
  if (!row) throw notFound('Outcome record not found');
  const def = await loadDefinition(ctx, row.definitionId);
  return { row, def };
}

/**
 * Requirement 5/7: records a verifier, date, decision and reason, and once decided a record is
 * immutable -- a rejected or unverified result is never silently overwritten, it stands on its own.
 * Re-verifying an already-decided record is refused; use correctOutcome instead, which keeps this
 * one untouched and opens a new one.
 */
export async function verifyOutcome(ctx: Ctx, id: string, b: { decision: 'VERIFIED' | 'REJECTED'; reason: string }) {
  allow(ctx, 'programmes', 'edit');
  const { row, def } = await loadRecord(ctx, id);
  if (row.status !== 'PENDING') throw unprocessable(`This record was already decided (${row.status}); correct it instead of re-verifying`);
  await ctx.db.update(R).set({ status: b.decision, decision: b.decision, reason: b.reason.trim(), verifiedBy: need(ctx).user.id, verifiedAt: new Date(), updatedAt: new Date() }).where(eq(R.id, id));
  await audit(ctx, 'outcome_record.verified', 'programme', def.programmeId, { status: row.status }, { decision: b.decision, reason: b.reason });
  return { ok: true };
}

/**
 * Requirement 8: a correction never edits the decided record in place. It supersedes it with a new
 * PENDING row carrying the corrected values, and flips the original to SUPERSEDED -- its evidence,
 * verifier, decision and reason stay exactly as they were, reachable via supersedesId.
 */
export async function correctOutcome(ctx: Ctx, id: string, b: Partial<RecordInput> & { reason: string }) {
  allow(ctx, 'programmes', 'edit');
  const { row, def } = await loadRecord(ctx, id);
  if (row.status === 'SUPERSEDED') throw conflict('This record has already been superseded by a correction');
  const c = await assertCase(ctx, b.caseId ?? row.caseId);
  if (c.programmeId !== def.programmeId) throw fieldError({ caseId: 'This enterprise is not part of the definition’s programme' });
  if ((b.baselineValue ?? Number(row.baselineValue)) == null && (b.followupValue ?? Number(row.followupValue)) == null) throw fieldError({ baselineValue: 'Give a baseline value, a followup value, or both' });
  const [created] = await ctx.db.insert(R).values({
    definitionId: row.definitionId, caseId: b.caseId ?? row.caseId,
    baselineValue: b.baselineValue !== undefined ? (b.baselineValue != null ? String(b.baselineValue) : null) : row.baselineValue,
    baselineDate: b.baselineDate !== undefined ? b.baselineDate : row.baselineDate,
    followupValue: b.followupValue !== undefined ? (b.followupValue != null ? String(b.followupValue) : null) : row.followupValue,
    followupDate: b.followupDate !== undefined ? b.followupDate : row.followupDate,
    evidenceClass: b.evidenceClass ?? row.evidenceClass, documentId: b.documentId !== undefined ? b.documentId : row.documentId,
    attributionNote: b.attributionNote !== undefined ? (b.attributionNote?.trim() || null) : row.attributionNote,
    status: 'PENDING', supersedesId: row.id, createdBy: need(ctx).user.id,
  }).returning({ id: R.id });
  await ctx.db.update(R).set({ status: 'SUPERSEDED', updatedAt: new Date() }).where(eq(R.id, row.id));
  await audit(ctx, 'outcome_record.corrected', 'programme', def.programmeId, { recordId: row.id, status: row.status }, { correctedBy: created.id, reason: b.reason });
  return { id: created.id };
}
