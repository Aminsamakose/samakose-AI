/**
 * #92: a content scan for uploaded documents, run after the magic-byte type check in evidence.ts's
 * storeDocument and before the file is written to storage. Previously nothing scanned uploaded files at
 * all beyond confirming the extension and magic bytes matched one of the allowed types -- a real gap,
 * since the allowed types (PDF, DOCX, XLSX, PNG, JPG, CSV, TXT) can still carry active content: a
 * macro-enabled Office document, or a PDF with embedded JavaScript or an auto-launch action.
 *
 * This is NOT a substitute for a real antivirus engine (ClamAV, a hosted scanning API, etc.) -- it has no
 * signature database and cannot catch a payload hidden in, say, a crafted image parser exploit. It catches
 * the specific, well-known classes of active content that the allowed file types can carry, with zero
 * external dependencies or network calls (document content can be sensitive business/financial material;
 * sending it to a third-party scanning API is a vendor and data-handling decision for Samakose to make
 * deliberately, not one to default into here). Wiring in a true AV engine, when that decision is made, is
 * a single new check added to `scanFile` below -- everything else in the upload path stays the same.
 */

export type ScanResult = { clean: true } | { clean: false; reason: string };

const PDF_ACTIVE_CONTENT = /\/(JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile)\b/;

/** True if any local-file-header entry name inside this zip-based Office document indicates VBA macros. */
function zipEntryNamesMatch(buf: Buffer, pattern: RegExp): boolean {
  const LOCAL_HEADER_SIG = 0x04034b50;
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== LOCAL_HEADER_SIG) break; // local headers are contiguous from the start; stop at the first non-match
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    if (pattern.test(name)) return true;
    const compressedSize = buf.readUInt32LE(offset + 18);
    offset += 30 + nameLen + extraLen + compressedSize;
  }
  return false;
}

function scanPdf(buf: Buffer): ScanResult {
  // latin1 keeps a 1:1 byte mapping so the regex matches literal PDF object-name bytes regardless of any
  // binary stream content elsewhere in the file.
  if (PDF_ACTIVE_CONTENT.test(buf.toString('latin1'))) {
    return { clean: false, reason: 'This PDF contains embedded JavaScript, an auto-launch action or an embedded file, which Samakose does not accept as evidence.' };
  }
  return { clean: true };
}

function scanOfficeZip(buf: Buffer): ScanResult {
  if (zipEntryNamesMatch(buf, /vbaProject\.bin$/i)) {
    return { clean: false, reason: 'This document contains macros (VBA), which Samakose does not accept as evidence. Save it without macros and upload again.' };
  }
  return { clean: true };
}

/** Runs the scan appropriate to the file's already-verified type. `ext` is the lower-cased extension storeDocument matched against TYPES. */
export function scanFile(ext: string, buf: Buffer): ScanResult {
  if (ext === 'pdf') return scanPdf(buf);
  if (ext === 'docx' || ext === 'xlsx') return scanOfficeZip(buf);
  return { clean: true }; // png/jpg/jpeg/csv/txt carry no active-content format this scan covers
}
