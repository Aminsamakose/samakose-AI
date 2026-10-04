import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { api, auditActions, ensureReference, makeOrg, makeUser, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { dispatch } from '@/api/framework';
import { pdfSafe } from '@/services/report-export';

const get = (s: Session, path: string) => dispatch(new Request('http://localhost/api/v1' + path, { headers: { cookie: s.cookie, 'x-forwarded-for': '10.9.9.9' } }));
let admin: Session, owner: Session, otherOwner: Session, funder: Session, reportId: string, draftId: string;

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); funder = await makeUser('FUNDER');
  const org = await makeOrg(admin); owner = await makeUser('OWNER', { orgId: org.id });
  otherOwner = await makeUser('OWNER', { orgId: (await makeOrg(admin)).id });
  const caseId = (await api(admin).post('/cases', { orgId: org.id })).data.id;
  const content = [{ heading: 'Summary', body: 'Revenue grew to GH₵ 12,000 – a “strong” result.\nSecond line.' }, { heading: 'Long', body: 'word '.repeat(900) }];
  reportId = (await db().insert(schema.reports).values({ caseId, status: 'Released', title: 'Progress report', content, basis: { verified: 3, unverified: 1 }, releasedAt: new Date() }).returning())[0].id;
  draftId = (await db().insert(schema.reports).values({ caseId, status: 'Draft', title: 'Draft one', content }).returning())[0].id;
});

describe('report export', () => {
  it('pdfSafe keeps text readable', () => {
    expect(pdfSafe('GH₵ 5 – “x” …')).toBe('GHS  5 - "x" ...');
    expect(pdfSafe('日本')).toBe('??');
  });
  it('produces a valid multi-page PDF', async () => {
    const res = await get(owner, `/reports/${reportId}/export?format=pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="progress-report-.*\.pdf"/);
    const pdf = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
  it('produces a Word file containing the sections', async () => {
    const res = await get(owner, `/reports/${reportId}/export?format=docx`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('wordprocessingml');
    const zip = await JSZip.loadAsync(new Uint8Array(await res.arrayBuffer()));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Summary'); expect(xml).toContain('GH₵ 12,000'); expect(xml).toContain('Evidence basis');
  });
  it('defaults to PDF and rejects other formats', async () => {
    expect((await get(owner, `/reports/${reportId}/export`)).headers.get('content-type')).toBe('application/pdf');
    expect((await get(owner, `/reports/${reportId}/export?format=exe`)).status).toBe(400);
  });
  it('drafts cannot be exported, and other businesses cannot see a released one', async () => {
    expect((await get(admin, `/reports/${draftId}/export?format=pdf`)).status).toBe(404);
    expect((await get(otherOwner, `/reports/${reportId}/export?format=pdf`)).status).toBeGreaterThanOrEqual(403);
  });
  it('is audited', async () => {
    await get(owner, `/reports/${reportId}/export?format=pdf`);
    expect(await auditActions(reportId)).toContain('report.exported');
  });
});
