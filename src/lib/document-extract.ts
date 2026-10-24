/**
 * A cheap, dependency-free, no-network first pass over an uploaded document: a guess at what kind of
 * document it is, and any dates/amounts/percentages a plain text scan can find in it.
 *
 * This is explicitly NOT an OCR or document-parsing engine. It can only read the text that is already
 * stored as text in the file -- that is true for .txt and .csv today. For anything whose text has to be
 * decoded out of a binary container (PDF, DOCX, XLSX) or read off an image (PNG/JPEG, or a scanned PDF),
 * real extraction needs a parsing/OCR library or service, which is a deliberate build-or-buy decision for
 * Samakose to make (cost, accuracy, and whether business documents should leave the server at all), not
 * something to fake here. For those files this returns `extractedText: null` and an honest note, and the
 * document still goes to the Pending-review queue (classified by filename alone) so a human can read it
 * and add evidence by hand -- extraction never gates anything a human has to do anyway.
 *
 * Nothing extracted here is evidence. It is a suggestion sitting in `document_extractions.status =
 * 'Pending'` until a human accepts or rejects it (services/document-intelligence.ts); only acceptance
 * creates an `evidence` row.
 */

export type ExtractedFact = { label: string; value: string };
export type ExtractionResult = { kind: DocumentKind; extractedText: string | null; facts: ExtractedFact[]; note?: string };

export const DOCUMENT_KINDS = ['invoice', 'certificate', 'financial_statement', 'id_document', 'contract', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

const KIND_KEYWORDS: { kind: DocumentKind; patterns: RegExp[] }[] = [
  { kind: 'invoice', patterns: [/invoice/i, /receipt/i, /\bbill(ed|ing)?\b/i] },
  { kind: 'certificate', patterns: [/certificate/i, /certif(y|ied|ication)/i, /\blicen[cs]e\b/i, /registration certificate/i] },
  { kind: 'financial_statement', patterns: [/balance sheet/i, /income statement/i, /profit and loss/i, /\bp[\s&]*l\b/i, /financial statement/i, /cash\s*flow/i] },
  { kind: 'id_document', patterns: [/passport/i, /national id/i, /voter'?s? id/i, /ghana card/i, /driver'?s? licen[cs]e/i] },
  { kind: 'contract', patterns: [/\bcontract\b/i, /agreement/i, /\bmemorandum of understanding\b/i, /\bmou\b/i] }
];

/** Guesses the kind of document from its filename and, when available, its text. Filename alone is enough
 *  to route a scanned image or PDF into the right review queue even with no text layer to read. */
export function classifyDocument(filename: string, text: string | null): DocumentKind {
  const hay = `${filename} ${text ?? ''}`;
  for (const { kind, patterns } of KIND_KEYWORDS) if (patterns.some((p) => p.test(hay))) return kind;
  return 'other';
}

const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/g, // 2026-03-15
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // 15/03/2026
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi // March 15, 2026
];
const AMOUNT_PATTERN = /\b(?:GHS|GH₵|₵|USD|\$)\s?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?\b/g;
const PERCENT_PATTERN = /\b\d{1,3}(?:\.\d+)?\s?%/g;

function extractTextFacts(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();
  const add = (label: string, value: string) => { const k = `${label}:${value}`; if (!seen.has(k)) { seen.add(k); facts.push({ label, value }); } };
  for (const re of DATE_PATTERNS) for (const m of text.matchAll(re)) add('date', m[0].trim());
  for (const m of text.matchAll(AMOUNT_PATTERN)) add('amount', m[0].trim());
  for (const m of text.matchAll(PERCENT_PATTERN)) add('percentage', m[0].trim());
  return facts.slice(0, 50); // a document pathologically full of numbers should not produce an unreviewable wall of facts
}

/** Runs the extraction pass for one stored file. `ext` is the already-validated lowercase extension
 *  (see ALLOWED_EXTENSIONS in services/evidence.ts); `buf` is the raw file bytes. */
export function extractDocument(filename: string, ext: string, buf: Buffer): ExtractionResult {
  if (ext !== 'txt' && ext !== 'csv') {
    return { kind: classifyDocument(filename, null), extractedText: null, facts: [], note: `Text extraction is not available yet for .${ext} files -- this needs document parsing or OCR, which is a separate build decision. Review the file directly.` };
  }
  const text = buf.toString('utf8');
  return { kind: classifyDocument(filename, text), extractedText: text.slice(0, 20_000), facts: extractTextFacts(text) };
}
