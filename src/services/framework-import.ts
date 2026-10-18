/**
 * Phase 1 of the assessment-config upload/combine gap (scoping memo, 2026-10-18): upload a CSV and get
 * a brand-new draft version back, without hand-writing the JSON createDraft already accepts. Reuses
 * createDraft's own authorization and validateContent gate unchanged -- this module only translates a
 * file into the same DraftInput shape a hand-written API call would send.
 */
import crypto from 'node:crypto';
import { storage } from '@/lib/storage';
import { sha256 } from '@/lib/crypto';
import { env } from '@/lib/env';
import { fieldError, unprocessable } from '@/lib/errors';
import { audit } from '@/lib/audit';
import type { Ctx } from '@/lib/context';
import { allow, need } from './common';
import { parseFrameworkCsv } from '@/domain/framework-import';
import { createDraft } from './frameworks';

const MAX_IMPORT_ROWS = 2000;

export async function importFrameworkCsv(ctx: Ctx, code: string, form: FormData) {
  // createDraft itself re-checks 'frameworks'/'create', but the parse-and-store work below should
  // never run for someone who could not create a draft anyway -- fail before touching storage.
  allow(ctx, 'frameworks', 'create');
  const u = need(ctx).user;
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw fieldError({ file: 'Choose a CSV file to upload' });
  if (file.size > env.maxUploadBytes) throw fieldError({ file: `Files can be at most ${Math.round(env.maxUploadBytes / 1048576)} MB` });
  const name = file.name || 'import.csv';
  if (!/\.csv$/i.test(name)) throw fieldError({ file: 'Only .csv files are accepted in this pass. Build the draft by hand through the API for other formats' });
  const buf = Buffer.from(await file.arrayBuffer());
  const text = buf.toString('utf-8');

  const parsed = parseFrameworkCsv(text);
  if (parsed.errors.length) throw unprocessable(`${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} could not be read`, { rows: parsed.errors });
  if (parsed.questions.length > MAX_IMPORT_ROWS) throw fieldError({ file: `A single import is capped at ${MAX_IMPORT_ROWS} questions` });

  // Store the raw upload for audit, independent of whether createDraft below succeeds -- a validateContent
  // rejection (e.g. a dimension with no questions) should still leave a record of what was submitted.
  const now = new Date();
  const key = ['framework-imports', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), crypto.randomUUID()].join('/');
  await storage().put(key, buf, 'text/csv');
  await audit(ctx, 'framework.import_uploaded', 'framework', code, undefined, { filename: name, size: buf.length, sha256: sha256(buf), storageKey: key, questions: parsed.questions.length, dimensions: parsed.dimensions.length });

  // validateContent (inside createDraft) is the single source of truth for what a valid draft looks
  // like -- this module does not duplicate that gate, only produces its input.
  const draft = await createDraft(ctx, code, { questions: parsed.questions, dimensions: parsed.dimensions, meta: parsed.meta, note: `Imported from ${name} by ${u.email}` });
  return { ...draft, importedFrom: { filename: name, storageKey: key, questions: parsed.questions.length, dimensions: parsed.dimensions.length } };
}
