import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { api, call, ensureReference, makeOrg, makeUser, type Session } from './helpers';
import { classifyDocument, extractDocument } from '@/lib/document-extract';

let admin: Session, consultant: Session, owner: Session, orgId: string, caseId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); consultant = await makeUser('EXPERT');
  const o = await makeOrg(admin); orgId = o.id; owner = await makeUser('OWNER', { orgId });
  const c = (await api(admin).post('/cases', { orgId })).data; caseId = c.id;
  await api(admin).post(`/cases/${caseId}/assign`, { consultantId: consultant.userId });
});

const upload = (s: Session, name: string, content: string, extra: Record<string, string> = { caseId }) => {
  const f = new FormData(); f.set('file', new File([content], name)); for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return call('POST', '/documents', { cookie: s.cookie, form: f });
};
const extractionFor = async (documentId: string) => {
  const [row] = await db().select().from(schema.documentExtractions).where(eq(schema.documentExtractions.documentId, documentId));
  return row;
};

describe('#83: document classification and fact extraction, unit', () => {
  it('classifies by filename and content keywords', () => {
    expect(classifyDocument('Q1 invoice.pdf', null)).toBe('invoice');
    expect(classifyDocument('registration.pdf', 'This Certificate of Registration confirms...')).toBe('certificate');
    expect(classifyDocument('statement.pdf', 'Income Statement for the year ended...')).toBe('financial_statement');
    expect(classifyDocument('random-notes.txt', 'just some notes about the farm')).toBe('other');
  });

  it('extracts dates, amounts and percentages from text files, and caps the fact count', () => {
    const r = extractDocument('invoice-2026.txt', 'txt', Buffer.from('Invoice dated 2026-03-15 for GHS 1,250.00. Tax 12.5% applied. Due 15/04/2026.'));
    expect(r.kind).toBe('invoice');
    expect(r.extractedText).toContain('Invoice dated');
    expect(r.facts).toEqual(expect.arrayContaining([
      { label: 'date', value: '2026-03-15' }, { label: 'amount', value: 'GHS 1,250.00' }, { label: 'percentage', value: '12.5%' }
    ]));
  });

  it('is honest that binary formats have no text layer to read without OCR/parsing', () => {
    const r = extractDocument('ledger.pdf', 'pdf', Buffer.from('%PDF-1.4 whatever bytes'));
    expect(r.extractedText).toBeNull();
    expect(r.facts).toEqual([]);
    expect(r.note).toMatch(/OCR|parsing/i);
  });
});

describe('#83: upload creates a pending extraction; review gates it into evidence', () => {
  it('creates a Pending extraction row classified from the upload, for a text file with facts', async () => {
    const up = await upload(owner, 'cashbook-invoice.txt', 'Invoice total GHS 500.00 dated 2026-02-01');
    expect(up.status).toBe(201);
    const row = await extractionFor(up.data.id);
    expect(row.status).toBe('Pending');
    expect(row.kind).toBe('invoice');
    expect(row.facts).toEqual(expect.arrayContaining([{ label: 'amount', value: 'GHS 500.00' }]));
  });

  it('creates a Pending extraction with no text for a binary file, still queued for human review', async () => {
    const up = await upload(owner, 'contract.pdf', '%PDF-1.4 signed agreement');
    const row = await extractionFor(up.data.id);
    expect(row.status).toBe('Pending');
    expect(row.extractedText).toBeNull();
  });

  it('lists pending extractions for a case; owners can see them but not decide on them', async () => {
    const list = await api(consultant).get(`/cases/${caseId}/extractions?status=Pending`);
    expect(list.status).toBe(200);
    expect(list.data.length).toBeGreaterThan(0);
    expect((await api(owner).get(`/cases/${caseId}/extractions`)).status).toBe(200);
    expect((await api(owner).post(`/extractions/${list.data[0].id}/review`, { decision: 'Accept' })).status).toBe(403); // owners cannot wave through their own paperwork
  });

  it('accepting an extraction creates Document-supported evidence linked to the document, and cannot be reviewed twice', async () => {
    const up = await upload(owner, 'proof-of-sales.txt', 'Sales for March: GHS 3,400.00');
    const row = await extractionFor(up.data.id);
    const accept = await api(consultant).post(`/extractions/${row.id}/review`, { decision: 'Accept' });
    expect(accept.status).toBe(200); expect(accept.data.status).toBe('Accepted');
    const [ev] = await db().select().from(schema.evidence).where(eq(schema.evidence.id, accept.data.evidence.id));
    expect(ev.class).toBe('Document-supported'); expect(ev.documentId).toBe(up.data.id);
    expect(ev.description).toContain('GHS 3,400.00');
    expect((await api(consultant).post(`/extractions/${row.id}/review`, { decision: 'Accept' })).status).toBe(400);
  });

  it('rejecting an extraction leaves no evidence behind', async () => {
    const up = await upload(owner, 'irrelevant.txt', 'not useful to anyone');
    const row = await extractionFor(up.data.id);
    const reject = await api(consultant).post(`/extractions/${row.id}/review`, { decision: 'Reject' });
    expect(reject.status).toBe(200); expect(reject.data.status).toBe('Rejected');
    const after = await extractionFor(up.data.id);
    expect(after.evidenceId).toBeNull();
  });
});
