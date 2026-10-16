import { Document, Packer, Paragraph, TextRun, HeadingLevel, Footer, PageNumber, AlignmentType } from 'docx';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { notFound } from '@/lib/errors';
import { fileResponse } from '@/api/framework';
import { getReport } from './reports';

export type ExportFormat = 'docx' | 'pdf';
const BRAND = 'Business Doctor by Samakose';
const BRAND_WEBSITE = 'www.samakose.com';
const BRAND_CONTACT = 'info@samakose.com  |  +233 (0) 55-858-9254';

/** Brand palette, carried over exactly from the app's own CSS tokens (src/app/globals.css) -- not invented for the PDF. */
const BRAND_COLOR = {
  forest: rgb(0x0f / 255, 0x4a / 255, 0x3f / 255),
  leaf: rgb(0x1e / 255, 0x7a / 255, 0x5a / 255),
  lime: rgb(0xc6 / 255, 0xf2 / 255, 0x6b / 255),
  gold: rgb(0xe2 / 255, 0xa9 / 255, 0x3b / 255),
  clay: rgb(0xad / 255, 0x43 / 255, 0x28 / 255),
  ink: rgb(0x0c / 255, 0x26 / 255, 0x22 / 255)
};

/** Draws the in-app Logo mark (src/components/site/Logo.tsx: a circle with a traced pulse line) directly with pdf-lib
 *  primitives, so every PDF carries the real Business Doctor mark without needing a separate image asset.
 *  onDark mirrors the app component's own onDark variant: on the forest-green header band, a forest-colored
 *  circle would vanish into the band, so the mark flips to a lime circle with a dark ink line, exactly as
 *  Logo.tsx does when it is placed on a dark background. */
function drawLogoMark(page: PDFPage, cx: number, cy: number, r: number, onDark = false) {
  page.drawCircle({ x: cx, y: cy, size: r, color: onDark ? BRAND_COLOR.lime : BRAND_COLOR.forest });
  // Pulse-line points traced from the app logo's SVG path ("M6 21h7l3-8 5 16 4-11 2 3h7", viewBox 0 0 40 40, y-down),
  // scaled to 80% of the circle's diameter and flipped into pdf-lib's y-up coordinate space.
  const raw: [number, number][] = [[6, 21], [13, 21], [16, 13], [21, 29], [25, 18], [27, 21], [34, 21]];
  const scale = (r * 2 * 0.8) / 40;
  const ox = cx - (40 * scale) / 2, oy = cy + (40 * scale) / 2;
  const pts = raw.map(([x, y]) => ({ x: ox + x * scale, y: oy - y * scale }));
  for (let i = 0; i < pts.length - 1; i++) page.drawLine({ start: pts[i], end: pts[i + 1], thickness: Math.max(1.3, r * 0.09), color: onDark ? BRAND_COLOR.ink : BRAND_COLOR.lime });
}

/** Draws the corporate header band (logo + brand name on the left, document title on the right) at the top of a page. */
function drawHeaderBand(page: PDFPage, W: number, H: number, bandH: number, title: string, subtitle: string, bold: PDFFont, reg: PDFFont, M: number) {
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: BRAND_COLOR.forest });
  drawLogoMark(page, M - 22, H - bandH / 2, 15, true);
  page.drawText(pdfSafe('Business Doctor'), { x: M, y: H - bandH / 2 + 1, size: 15, font: bold, color: rgb(1, 1, 1) });
  page.drawText(pdfSafe('by Samakose'), { x: M, y: H - bandH / 2 - 12, size: 8, font: reg, color: rgb(0.85, 0.93, 0.9) });
  const tw = bold.widthOfTextAtSize(pdfSafe(title), 11);
  page.drawText(pdfSafe(title), { x: W - M - tw, y: H - bandH / 2 + 1, size: 11, font: bold, color: rgb(1, 1, 1) });
  if (subtitle) {
    const sw = reg.widthOfTextAtSize(pdfSafe(subtitle), 8);
    page.drawText(pdfSafe(subtitle), { x: W - M - sw, y: H - bandH / 2 - 12, size: 8, font: reg, color: rgb(0.85, 0.93, 0.9) });
  }
}

/** Draws the corporate footer (brand, support contact, website) at the bottom of a page. */
function drawFooter(page: PDFPage, W: number, M: number, left: string, reg: PDFFont) {
  page.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.6, color: rgb(0.82, 0.82, 0.82) });
  page.drawText(pdfSafe(left), { x: M, y: 26, size: 7.5, font: reg, color: rgb(0.45, 0.45, 0.45) });
  const w = reg.widthOfTextAtSize(pdfSafe(BRAND_WEBSITE), 7.5);
  page.drawText(pdfSafe(BRAND_WEBSITE), { x: W - M - w, y: 26, size: 7.5, font: reg, color: rgb(0.45, 0.45, 0.45) });
}

/** Standard PDF fonts only cover Latin-1, so map common symbols and drop the rest. */
export function pdfSafe(s: string): string {
  return s
    .replace(/GH₵|₵/g, 'GHS ').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[•●]/g, '-')
    .replace(/\r/g, '').replace(/\t/g, '    ').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '?');
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';
const fmtDate = (d: unknown) => d ? new Date(d as string).toISOString().slice(0, 10) : '-';

const PLATFORM_LABEL: Record<string, string> = { SME: 'SME360', AGRIFOOD: 'AgriFood360', ESO: 'ESO360' };

export async function exportReport(ctx: Ctx, id: string, format: ExportFormat) {
  const r = await getReport(ctx, id);
  if (r.status !== 'Released') throw notFound('Only a released report can be exported');
  const platform = PLATFORM_LABEL[r.org.type] ?? r.org.type;
  const meta = [
    `Business: ${r.org.name}`, `Platform: ${platform}`, `Case: ${r.caseCode}`, `Report: ${r.code}`,
    ...(r.org.contactName ? [`Prepared for: ${r.org.contactName}${r.org.contactEmail ? ` (${r.org.contactEmail})` : ''}`] : []),
    `Released: ${fmtDate(r.releasedAt)}`
  ];
  const content = r.content as { heading: string; body: string }[];
  const bytes = format === 'docx' ? await buildDocx(r.title, meta, content, r.basis) : await buildPdf(r.title, platform, meta, content, r.basis);
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

/** Picks the dimensions worth naming as a strength or a priority area: 1 of each for a short dimension
 *  list, 2 of each once there are enough dimensions that naming more than one is still meaningful. */
function topAndBottom(dims: { dimension: string; score: number }[]) {
  const n = dims.length >= 5 ? 2 : 1;
  const sorted = [...dims].sort((a, b) => b.score - a.score);
  return { strengths: sorted.slice(0, n), priorities: sorted.slice(-n).reverse() };
}

/** The free preliminary assessment's downloadable result (#123: a real PDF, not a client-side text Blob).
 *  Deliberately fixed-length and laid out with margin to spare so it always renders as exactly one A4 page. */
export async function buildFreeAssessmentPdf(input: {
  id: string; platform: string; fullName: string; email: string; businessName: string | null; overallScore: number; classification: string;
  dimensionScores: { dimension: string; score: number }[]; completedAt: string | Date | null;
}) {
  const title = `${input.platform} Free Business Health Result`;
  const ref = `REF-${input.id.slice(0, 8).toUpperCase()}`;
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(title)); pdf.setAuthor(BRAND); pdf.setCreator(BRAND);
  const reg = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 56, max = W - M * 2, BAND = 56;
  const page = pdf.addPage([W, H]);
  drawHeaderBand(page, W, H, BAND, 'Free Business Health Check', input.platform, bold, reg, M);
  let y = H - BAND - 24;
  const draw = (text: string, font: PDFFont, size: number, color = rgb(0.1, 0.1, 0.1), gap = 4) => {
    for (const l of wrap(pdfSafe(text), font, size, max)) { if (l) page.drawText(l, { x: M, y: y - size, size, font, color }); y -= size + gap; }
  };

  draw(`${input.platform} Preliminary Result`, bold, 19, rgb(0, 0, 0), 8);
  const detailBits = [input.fullName, input.businessName, ref, input.completedAt ? new Date(input.completedAt).toISOString().slice(0, 10) : null].filter(Boolean);
  draw(detailBits.join('   |   '), reg, 9.5, rgb(0.35, 0.35, 0.35), 18);

  const classColor = input.classification === 'Critical Attention' ? BRAND_COLOR.clay : input.classification === 'Strong Foundation' ? BRAND_COLOR.leaf : BRAND_COLOR.gold;
  page.drawText(pdfSafe(`${input.overallScore}`), { x: M, y: y - 30, size: 32, font: bold, color: rgb(0, 0, 0) });
  const w1 = bold.widthOfTextAtSize(pdfSafe(`${input.overallScore}`), 32);
  page.drawText(pdfSafe('/100'), { x: M + w1 + 2, y: y - 24, size: 14, font: reg, color: rgb(0.45, 0.45, 0.45) });
  page.drawText(pdfSafe(input.classification), { x: M, y: y - 46, size: 12, font: bold, color: classColor });
  y -= 62;

  draw('Dimension scores', bold, 12.5, rgb(0, 0, 0), 7);
  const barX = M + 210, barW = max - 210 - 46;
  for (const d of input.dimensionScores) {
    page.drawText(pdfSafe(`${d.dimension}`), { x: M, y: y - 10, size: 10, font: reg, color: rgb(0.15, 0.15, 0.15) });
    page.drawRectangle({ x: barX, y: y - 10, width: barW, height: 7, color: rgb(0.9, 0.9, 0.9) });
    page.drawRectangle({ x: barX, y: y - 10, width: barW * Math.max(0, Math.min(100, d.score)) / 100, height: 7, color: BRAND_COLOR.leaf });
    page.drawText(pdfSafe(`${d.score}/100`), { x: barX + barW + 8, y: y - 10, size: 9, font: reg, color: rgb(0.35, 0.35, 0.35) });
    y -= 20;
  }
  y -= 10;

  const { strengths, priorities } = topAndBottom(input.dimensionScores);
  draw('Key findings', bold, 12.5, rgb(0, 0, 0), 6);
  if (strengths.length) draw(`Strength${strengths.length > 1 ? 's' : ''}: ${strengths.map((d) => d.dimension).join(', ')}.`, reg, 10, rgb(0.15, 0.15, 0.15), 4);
  if (priorities.length) draw(`Priority area${priorities.length > 1 ? 's' : ''}: ${priorities.map((d) => d.dimension).join(', ')}.`, reg, 10, rgb(0.15, 0.15, 0.15), 10);

  draw('Recommended next step', bold, 12.5, rgb(0, 0, 0), 5);
  draw(`Address your priority area${priorities.length > 1 ? 's' : ''} first, then explore the full ${input.platform} Business Health Assessment for a complete diagnosis, evidence review and written action plan.`, reg, 10, rgb(0.15, 0.15, 0.15), 10);

  draw('This is a preliminary assessment based on your own answers, not a certified diagnosis, investment-readiness determination or guarantee of business success. The score bands are provisional, set by expert judgment and not yet statistically validated against business outcomes.', reg, 8.5, rgb(0.45, 0.45, 0.45), 3);

  drawFooter(page, W, M, `${BRAND}  |  Free preliminary assessment  |  ${input.email}`, reg);
  return pdf.save();
}

async function buildPdf(title: string, platform: string, meta: string[], content: { heading: string; body: string }[], basis: { verified: number; unverified: number } | null) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(title)); pdf.setAuthor(BRAND); pdf.setCreator(BRAND);
  const reg = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 56, max = W - M * 2, BAND = 56;
  const newPage = () => { const p = pdf.addPage([W, H]); drawHeaderBand(p, W, H, BAND, 'Deep Business Health Assessment', platform, bold, reg, M); return p; };
  let page = newPage(); let y = H - BAND - 24;
  const ensure = (h: number) => { if (y - h < M + 20) { page = newPage(); y = H - BAND - 24; } };
  const draw = (text: string, font: PDFFont, size: number, color = rgb(0.1, 0.1, 0.1), gap = 4) => {
    for (const l of wrap(pdfSafe(text), font, size, max)) { ensure(size + gap); if (l) page.drawText(l, { x: M, y: y - size, size, font, color }); y -= size + gap; }
  };
  draw(title, bold, 20, rgb(0, 0, 0), 6); y -= 4;
  for (const m of meta) draw(m, reg, 10, rgb(0.33, 0.33, 0.33), 3);
  const b = basisLine(basis); if (b) { y -= 4; draw(b, reg, 10, rgb(0.33, 0.33, 0.33), 3); }
  for (const s of content) { y -= 14; ensure(40); draw(s.heading, bold, 13, rgb(0, 0, 0), 5); y -= 2; draw(s.body, reg, 11, rgb(0.1, 0.1, 0.1), 4); }
  const pages = pdf.getPages();
  pages.forEach((p, i) => drawFooter(p, W, M, `${BRAND}  |  ${BRAND_CONTACT}  |  Page ${i + 1} of ${pages.length}`, reg));
  return await pdf.save();
}
