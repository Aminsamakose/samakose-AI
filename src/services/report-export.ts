import { Document, Packer, Paragraph, TextRun, HeadingLevel, Footer, PageNumber, AlignmentType } from 'docx';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { notFound } from '@/lib/errors';
import { fileResponse } from '@/api/framework';
import { getReport } from './reports';

export type ExportFormat = 'docx' | 'pdf';
const BRAND = 'Business Doctor by Samakose';

/** Standard PDF fonts only cover Latin-1, so map common symbols and drop the rest. */
export function pdfSafe(s: string): string {
  return s
    .replace(/GH₵|₵/g, 'GHS ').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[•●]/g, '-')
    .replace(/\r/g, '').replace(/\t/g, '    ').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '?');
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';
const fmtDate = (d: unknown) => d ? new Date(d as string).toISOString().slice(0, 10) : '-';

export async function exportReport(ctx: Ctx, id: string, format: ExportFormat) {
  const r = await getReport(ctx, id);
  if (r.status !== 'Released') throw notFound('Only a released report can be exported');
  const meta = [`Business: ${r.org.name}`, `Case: ${r.caseCode}`, `Report: ${r.code}`, `Released: ${fmtDate(r.releasedAt)}`];
  const content = r.content as { heading: string; body: string }[];
  const bytes = format === 'docx' ? await buildDocx(r.title, meta, content, r.basis) : await buildPdf(r.title, meta, content, r.basis);
  await audit(ctx, 'report.exported', 'report', id, undefined, { format }, r.caseId);
  const name = `${slug(r.title)}-${r.code}.${format}`;
  return fileResponse(name, format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf', bytes);
}

const basisLine = (b: { verified: number; unverified: number } | null) => b ? `Evidence basis: ${b.verified} verified and ${b.unverified} unverified or self-reported item${b.unverified === 1 ? '' : 's'}.` : null;

async function buildDocx(title: string, meta: string[], content: { heading: string; body: string }[], basis: { verified: number; unverified: number } | null) {
  const paras = (t: string) => t.split(/\n/).map((line) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun(line)] }));
  const doc = new Document({
    creator: BRAND, title,
    sections: [{
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${BRAND}  |  Page `, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 })] })] }) },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }),
        ...meta.map((m) => new Paragraph({ children: [new TextRun({ text: m, color: '555555' })] })),
        ...(basisLine(basis) ? [new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: basisLine(basis)!, italics: true, color: '555555' })] })] : []),
        ...content.flatMap((s) => [new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 100 }, children: [new TextRun(s.heading)] }), ...paras(s.body)]),
      ],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const w of para.split(/\s+/)) {
      let word = w;
      while (font.widthOfTextAtSize(word, size) > max) {
        let k = word.length - 1;
        while (k > 1 && font.widthOfTextAtSize(word.slice(0, k), size) > max) k--;
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, k)); word = word.slice(k);
      }
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) > max && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
  }
  return out;
}

async function buildPdf(title: string, meta: string[], content: { heading: string; body: string }[], basis: { verified: number; unverified: number } | null) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(title)); pdf.setAuthor(BRAND); pdf.setCreator(BRAND);
  const reg = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 56, max = W - M * 2;
  let page = pdf.addPage([W, H]); let y = H - M;
  const ensure = (h: number) => { if (y - h < M + 20) { page = pdf.addPage([W, H]); y = H - M; } };
  const draw = (text: string, font: PDFFont, size: number, color = rgb(0.1, 0.1, 0.1), gap = 4) => {
    for (const l of wrap(pdfSafe(text), font, size, max)) { ensure(size + gap); if (l) page.drawText(l, { x: M, y: y - size, size, font, color }); y -= size + gap; }
  };
  draw(title, bold, 20, rgb(0, 0, 0), 6); y -= 4;
  for (const m of meta) draw(m, reg, 10, rgb(0.33, 0.33, 0.33), 3);
  const b = basisLine(basis); if (b) { y -= 4; draw(b, reg, 10, rgb(0.33, 0.33, 0.33), 3); }
  for (const s of content) { y -= 14; ensure(40); draw(s.heading, bold, 13, rgb(0, 0, 0), 5); y -= 2; draw(s.body, reg, 11, rgb(0.1, 0.1, 0.1), 4); }
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(pdfSafe(`${BRAND}  |  Page ${i + 1} of ${pages.length}`), { x: M, y: 28, size: 8, font: reg, color: rgb(0.45, 0.45, 0.45) }));
  return await pdf.save();
}
