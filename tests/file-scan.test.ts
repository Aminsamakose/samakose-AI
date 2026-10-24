import { describe, expect, it } from 'vitest';
import { scanFile } from '@/lib/file-scan';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

/** Builds a minimal, valid, uncompressed (store-method) zip with the given entry names, good enough for the scanner's local-file-header walk -- not a real Office document otherwise. */
function fakeZip(entryNames: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const name of entryNames) {
    const nameBuf = Buffer.from(name, 'utf8');
    const content = Buffer.from('x');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // method: stored
    header.writeUInt16LE(0, 10); // time
    header.writeUInt16LE(0, 12); // date
    header.writeUInt32LE(crc32(content), 14);
    header.writeUInt32LE(content.length, 18); // compressed size
    header.writeUInt32LE(content.length, 22); // uncompressed size
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28); // extra field length
    parts.push(header, nameBuf, content);
  }
  return Buffer.concat(parts);
}

describe('#92 upload scan: active content a magic-byte check alone would let through', () => {
  it('passes a clean docx/xlsx zip with no VBA project', () => {
    const buf = fakeZip(['[Content_Types].xml', 'word/document.xml']);
    expect(scanFile('docx', buf)).toEqual({ clean: true });
    expect(scanFile('xlsx', buf)).toEqual({ clean: true });
  });

  it('rejects a docx/xlsx carrying a VBA macro project', () => {
    const buf = fakeZip(['[Content_Types].xml', 'word/vbaProject.bin']);
    const r = scanFile('docx', buf);
    expect(r.clean).toBe(false);
    if (!r.clean) expect(r.reason).toMatch(/macro/i);
  });

  it('passes a clean PDF with no active content', () => {
    expect(scanFile('pdf', Buffer.from('%PDF-1.4\nhello world'))).toEqual({ clean: true });
  });

  it('rejects a PDF carrying embedded JavaScript, an auto-launch action, or an embedded file', () => {
    for (const token of ['/JavaScript', '/JS', '/OpenAction', '/AA', '/Launch', '/EmbeddedFile']) {
      const r = scanFile('pdf', Buffer.from(`%PDF-1.4\n1 0 obj << ${token} 2 0 R >> endobj`));
      expect(r.clean).toBe(false);
    }
  });

  it('does not scan file types with no active-content format it covers', () => {
    expect(scanFile('png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toEqual({ clean: true });
    expect(scanFile('txt', Buffer.from('/JavaScript looks scary in plain text but is not executable'))).toEqual({ clean: true });
  });
});
