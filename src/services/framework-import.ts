/**
 * Phase 1 (upload) and Phase 2 (combine) of the assessment-config upload/combine gap (scoping memo,
 * 2026-10-18). Both reuse createDraft/updateDraft's own authorization and validateContent gate
 * unchanged -- this module only translates a file (and, for combine, a merge action) into the same
 * input a hand-written API call would already send.
 */
import crypto from 'node:crypto';
import { storage } from '@/lib/storage';
import { sha256 } from '@/lib/crypto';
import { env } from '@/lib/env';
import { fieldError, notFound, unprocessable } from '@/lib/errors';
import { audit } from '@/lib/audit';
import type { Ctx } from '@/lib/context';
import { allow, need } from './common';
import { FRAMEWORK_IMPORT_MODES, mergeFrameworkImport, parseFrameworkCsv, type FrameworkImportMode } from '@/domain/framework-import';
import { createDraft, updateDraft, versionById } from './frameworks';

const MAX_IMPORT_ROWS = 2000;

function readCsvFile(form: FormData) {
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw fieldError({ file: 'Choose a CSV file to upload' });
  if (file.size > env.maxUploadBytes) throw fieldError({ file: `Files can be at most ${Math.round(env.maxUploadBytes / 1048576)} MB` });
  const name = file.name || 'import.csv';
  if (!/\.csv$/i.test(name)) throw fieldError({ file: 'Only .csv files are accepted in this pass. Build the draft by hand through the API for other formats' });
  return { file, name };
}

async function storeImport(ctx: Ctx, entity: 'framework' | 'framework_version', entityId: string, name: string, buf: Buffer, parsed: { questions: unknown[]; dimensions: unknown[] }) {
  const now = new Date();
  const key = ['framework-imports', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), crypto.randomUUID()].join('/');
  await storage().put(key, buf, 'text/csv');
  await audit(ctx, 'framework.import_uploaded', entity, entityId, undefined, { filename: name, size: buf.length, sha256: sha256(buf), storageKey: key, questions: parsed.questions.length, dimensions: parsed.dimensions.length });
  return key;
}

export async function importFrameworkCsv(ctx: Ctx, code: string, form: FormData) {
  // createDraft itself re-checks 'frameworks'/'create', but the parse-and-store work below should
  // never run for someone who could not create a draft anyway -- fail before touching storage.
  allow(ctx, 'frameworks', 'create');
  const u = need(ctx).user;
  const { file, name } = readCsvFile(form);
  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseFrameworkCsv(buf.toString('utf-8'));
  if (parsed.errors.length) throw unprocessable(`${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} could not be read`, { rows: parsed.errors });
  if (parsed.questions.length > MAX_IMPORT_ROWS) throw fieldError({ file: `A single import is capped at ${MAX_IMPORT_ROWS} questions` });

  // Store the raw upload for audit, independent of whether createDraft below succeeds -- a validateContent
  // rejection (e.g. a dimension with no questions) should still leave a record of what was submitted.
  const key = await storeImport(ctx, 'framework', code, name, buf, parsed);

  // validateContent (inside createDraft) is the single source of truth for what a valid draft looks
  // like -- this module does not duplicate that gate, only produces its input.
  const draft = await createDraft(ctx, code, { questions: parsed.questions, dimensions: parsed.dimensions, meta: parsed.meta, note: `Imported from ${name} by ${u.email}` });
  return { ...draft, importedFrom: { filename: name, storageKey: key, questions: parsed.questions.length, dimensions: parsed.dimensions.length } };
}

/**
 * Phase 2: merges an uploaded CSV into an existing draft by one of two explicit actions -- never
 * auto-detected (see mergeFrameworkImport's doc comment for exactly what each one does). Still goes
 * through updateDraft's own 'frameworks'/'edit' check and validateContent gate unchanged.
 */
export async function combineFrameworkImport(ctx: Ctx, versionId: string, form: FormData) {
  allow(ctx, 'frameworks', 'edit');
  const modeRaw = String(form.get('mode') ?? '');
  if (!FRAMEWORK_IMPORT_MODES.includes(modeRaw as FrameworkImportMode)) throw fieldError({ mode: `mode must be one of: ${FRAMEWORK_IMPORT_MODES.join(', ')}` });
  const mode = modeRaw as FrameworkImportMode;
  const v = await versionById(ctx.db, versionId);
  if (!v) throw notFound('Framework version not found');
  if (v.status !== 'Draft') throw unprocessable('Only a draft can be combined with an import. Published versions are permanent; create a new version instead');

  const { file, name } = readCsvFile(form);
  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseFrameworkCsv(buf.toString('utf-8'));
  if (parsed.errors.length) throw unprocessable(`${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} could not be read`, { rows: parsed.errors });
  if (parsed.questions.length > MAX_IMPORT_ROWS) throw fieldError({ file: `A single import is capped at ${MAX_IMPORT_ROWS} questions` });

  const key = await storeImport(ctx, 'framework_version', versionId, name, buf, parsed);

  const merged = mergeFrameworkImport({ questions: v.questions, dimensions: v.dimensions, meta: v.meta }, parsed, mode);
  // validateContent (inside updateDraft) is the single source of truth for what a valid draft looks
  // like -- this module does not duplicate that gate, only produces its input.
  await updateDraft(ctx, versionId, { questions: merged.questions, dimensions: merged.dimensions, meta: merged.meta, note: v.note });
  return {
    id: versionId, mode,
    added: merged.added, replaced: merged.replaced, skipped: merged.skipped,
    importedFrom: { filename: name, storageKey: key, questions: parsed.questions.length },
  };
}
