/**
 * Phase 1 and 2 of the assessment-config upload/combine gap (scoping memo, 2026-10-18): turns an
 * uploaded CSV into the same { questions, dimensions, meta } shape services/frameworks.ts's
 * createDraft/updateDraft already accept by hand.
 *
 * Phase 1 (upload) produces a brand-new draft, exactly as if the same content had been pasted in as
 * JSON. Phase 2 (combine) merges a CSV into an *existing* draft via one of two explicit actions the
 * memo recommends over auto-detecting intent: 'add' (codes already in the draft are left untouched)
 * or 'replace' (codes already in the draft are overwritten by the incoming row; everything else in
 * the draft is untouched either way). There is no silent default and no collision-review queue (Phase
 * 3) -- that stays deferred pending real usage data on whether these two actions are enough.
 *
 * Deliberately out of scope for this pass, same discipline as the memo: readiness-index *definitions*
 * and consistency checks are not importable from the sheet (both are cross-question relational concepts
 * that do not fit one question-per-row); a question's readiness_codes column is still read and passed
 * through, but validateContent will reject it unless those readiness codes are added to the draft
 * afterwards through the existing JSON-editing API. XLSX is also deferred to a follow-up pass once a
 * parsing dependency is reviewed -- CSV needs none and covers the same column schema.
 */
import type { FrameworkMeta, FrameworkQuestion } from '@/db/schema';

export const FRAMEWORK_IMPORT_COLUMNS = [
  'dimension', 'sub_dimension_code', 'sub_dimension_name', 'question_code', 'question_text', 'weight',
  'criticality', 'response_type', 'anchor_0', 'anchor_1', 'anchor_2', 'anchor_3', 'anchor_4',
  'readiness_codes', 'applies_when', 'risk_tag',
] as const;

export interface ParsedFrameworkImport {
  questions: FrameworkQuestion[];
  dimensions: string[];
  meta: FrameworkMeta | null;
  /** Row-level problems found before any database write was attempted -- 1-based, header excluded. */
  errors: { row: number; message: string }[];
}

/** RFC4180-ish: quoted fields, "" as an escaped quote, commas and newlines inside quotes. No external dependency needed for this. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') pushRow();
    else field += c;
  }
  if (field.length || row.length) pushRow();
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

const CRITICALITIES = new Set(['Gate', 'Core', 'Standard']);
const RESPONSE_TYPES = new Set(['ANCHORED', 'BANDED', 'YNP', 'FREQ']);

export function parseFrameworkCsv(text: string): ParsedFrameworkImport {
  const rows = parseCsv(text);
  const errors: ParsedFrameworkImport['errors'] = [];
  if (!rows.length) return { questions: [], dimensions: [], meta: null, errors: [{ row: 0, message: 'The file is empty' }] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const required = ['dimension', 'question_code', 'question_text', 'weight'];
  const missing = required.filter((c) => col(c) < 0);
  if (missing.length) return { questions: [], dimensions: [], meta: null, errors: [{ row: 0, message: `Missing required column(s): ${missing.join(', ')}` }] };

  const dimensions: string[] = [];
  const questions: FrameworkQuestion[] = [];
  const subDimensions: NonNullable<FrameworkMeta['subDimensions']> = [];
  const seenSubDims = new Set<string>();
  const seenCodes = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length === 1 && !cells[0].trim()) continue; // blank line
    const get = (name: string) => (col(name) >= 0 ? (cells[col(name)] ?? '').trim() : '');
    const rowNum = r + 1; // 1-based with header counted, matching what a spreadsheet shows

    const dimension = get('dimension');
    const code = get('question_code');
    const text_ = get('question_text');
    const weightRaw = get('weight');
    if (!dimension) { errors.push({ row: rowNum, message: 'dimension is required' }); continue; }
    if (!code) { errors.push({ row: rowNum, message: 'question_code is required' }); continue; }
    if (seenCodes.has(code)) { errors.push({ row: rowNum, message: `question_code ${code} is used twice` }); continue; }
    if (!text_) { errors.push({ row: rowNum, message: `question ${code}: question_text is required` }); continue; }
    const weight = Number(weightRaw || '1');
    if (!Number.isInteger(weight) || weight < 1 || weight > 5) { errors.push({ row: rowNum, message: `question ${code}: weight must be a whole number from 1 to 5` }); continue; }

    seenCodes.add(code);
    if (!dimensions.includes(dimension)) dimensions.push(dimension);

    const subCode = get('sub_dimension_code') || undefined;
    const subName = get('sub_dimension_name');
    if (subCode && subName && !seenSubDims.has(subCode)) { seenSubDims.add(subCode); subDimensions.push({ code: subCode, name: subName, dimension }); }

    const criticalityRaw = get('criticality');
    const criticality = criticalityRaw ? (CRITICALITIES.has(criticalityRaw) ? (criticalityRaw as FrameworkQuestion['criticality']) : undefined) : undefined;
    if (criticalityRaw && !criticality) { errors.push({ row: rowNum, message: `question ${code}: criticality "${criticalityRaw}" must be Gate, Core or Standard` }); continue; }

    const responseTypeRaw = get('response_type');
    const responseType = responseTypeRaw ? (RESPONSE_TYPES.has(responseTypeRaw) ? (responseTypeRaw as FrameworkQuestion['responseType']) : undefined) : undefined;
    if (responseTypeRaw && !responseType) { errors.push({ row: rowNum, message: `question ${code}: response_type "${responseTypeRaw}" must be ANCHORED, BANDED, YNP or FREQ` }); continue; }

    const anchorCells = ['anchor_0', 'anchor_1', 'anchor_2', 'anchor_3', 'anchor_4'].map((n) => get(n));
    const anchors = anchorCells.some((a) => a) ? anchorCells.map((a) => (a ? a : null)) : undefined;

    const readinessCodes = get('readiness_codes').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const appliesWhen = get('applies_when') || undefined;
    const riskTag = get('risk_tag') || undefined;

    const q: FrameworkQuestion = { code, dimension, text: text_, weight };
    if (subCode) q.subDimension = subCode;
    if (responseType) q.responseType = responseType;
    if (anchors) q.anchors = anchors;
    if (criticality) q.criticality = criticality;
    if (readinessCodes.length) q.readiness = readinessCodes;
    if (appliesWhen) q.applies = appliesWhen;
    if (riskTag) q.riskTag = riskTag;
    questions.push(q);
  }

  const meta: FrameworkMeta | null = subDimensions.length ? { subDimensions } : null;
  return { questions, dimensions, meta, errors };
}

export const FRAMEWORK_IMPORT_MODES = ['add', 'replace'] as const;
export type FrameworkImportMode = (typeof FRAMEWORK_IMPORT_MODES)[number];

export interface FrameworkImportMergeResult {
  questions: FrameworkQuestion[];
  dimensions: string[];
  meta: FrameworkMeta | null;
  added: string[];
  replaced: string[];
  /** 'add' mode only: an incoming code that already existed in the draft, left untouched. */
  skipped: string[];
}

/**
 * Merges a parsed CSV into an existing draft's content by question code -- the only two actions the
 * memo recommends, never auto-detected. 'add' never touches a question already in the draft (the
 * incoming row for that code is reported in `skipped`, not applied). 'replace' overwrites a matching
 * code in place (keeping its position in the array) and reports it in `replaced`; a code the draft
 * does not have yet is always added, in both modes, and reported in `added`.
 *
 * Dimensions are unioned (existing order first, then any new names). Sub-dimensions are unioned by
 * code, existing definition winning on a collision -- redefining an existing sub-dimension's name or
 * parent dimension through this path is not supported; discard the draft's sub-dimension, or edit it
 * through the existing JSON-editing API, to do that. readiness/consistencyChecks on the existing draft's
 * meta are preserved untouched (this pass never writes to either).
 */
export function mergeFrameworkImport(
  existing: { questions: FrameworkQuestion[]; dimensions: string[]; meta?: FrameworkMeta | null },
  incoming: ParsedFrameworkImport,
  mode: FrameworkImportMode,
): FrameworkImportMergeResult {
  const questions = [...existing.questions];
  const added: string[] = [], replaced: string[] = [], skipped: string[] = [];
  for (const q of incoming.questions) {
    const idx = questions.findIndex((e) => e.code === q.code);
    if (idx >= 0) {
      if (mode === 'replace') { questions[idx] = q; replaced.push(q.code); }
      else skipped.push(q.code);
    } else { questions.push(q); added.push(q.code); }
  }

  const dimensions = [...existing.dimensions];
  for (const d of incoming.dimensions) if (!dimensions.includes(d)) dimensions.push(d);

  const existingSubs = existing.meta?.subDimensions ?? [];
  const incomingSubs = incoming.meta?.subDimensions ?? [];
  const existingSubCodes = new Set(existingSubs.map((s) => s.code));
  const mergedSubs = [...existingSubs, ...incomingSubs.filter((s) => !existingSubCodes.has(s.code))];
  const meta: FrameworkMeta | null = existing.meta || mergedSubs.length
    ? { ...existing.meta, ...(mergedSubs.length ? { subDimensions: mergedSubs } : {}) }
    : null;

  return { questions, dimensions, meta, added, replaced, skipped };
}
