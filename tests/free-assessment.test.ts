import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_RULES, freeAssessmentClassification, scoreFreeAssessment, type FreeAssessmentAnswer } from '@/domain/logic';
import { SME360_ANSWER_OPTIONS, AGRIFOOD360_ANSWER_OPTIONS, ESO360_ANSWER_OPTIONS } from '@/services/frameworks';
import { normaliseEmail } from '@/services/publicAssessments';
import { dispatch } from '@/api/framework';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { ensureReference, api, makeUser } from './helpers';

const post = (path: string, body: unknown = {}) => dispatch(new Request('http://localhost/api/v1' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.44.44.44' }, body: JSON.stringify(body) }));

// A result consistent with the real, published SME360 framework and with the classification bands --
// the server now rejects a payload that isn't (audit Section B), so test fixtures must be genuine.
const SME360_DIMENSIONS = ['Strategy and Leadership', 'Financial Health', 'Marketing and Sales', 'Operations and Productivity', 'Human Resources and Organisation', 'Risk, Resilience and Growth'];
const sme360Result = (score: number, completedAt = new Date().toISOString()) => ({
  overallScore: score, classification: freeAssessmentClassification(score, DEFAULT_RULES),
  dimensionScores: SME360_DIMENSIONS.map((dimension) => ({ dimension, score })), completedAt
});

// SME360_QUESTIONS isn't exported (kept module-private in frameworks.ts); re-derive the 25-question
// shape locally from the answer-options map, which IS exported, purely so these tests don't need DB access.
const questions = Object.keys(SME360_ANSWER_OPTIONS).map((code, i) => ({ code, dimension: `D${Math.floor(i / 4)}` }));

describe('free assessment scorer (plain, unweighted -- not scoreDiagnostic)', () => {
  it('matches the approved spec\'s own worked example: 4,3,2,3 over 4 questions = 75', () => {
    const qs = [{ code: 'Q1', dimension: 'Dim' }, { code: 'Q2', dimension: 'Dim' }, { code: 'Q3', dimension: 'Dim' }, { code: 'Q4', dimension: 'Dim' }];
    const answers: FreeAssessmentAnswer[] = [{ questionCode: 'Q1', value: 4 }, { questionCode: 'Q2', value: 3 }, { questionCode: 'Q3', value: 2 }, { questionCode: 'Q4', value: 3 }];
    const r = scoreFreeAssessment(answers, qs, DEFAULT_RULES);
    expect(r.dimensions[0].score).toBe(75);
    expect(r.overall).toBe(75);
  });
  it('scores 100 for all A answers, unlike the evidence-weighted engine which would cap at 80', () => {
    const qs = [{ code: 'Q1', dimension: 'D' }, { code: 'Q2', dimension: 'D' }];
    const answers: FreeAssessmentAnswer[] = [{ questionCode: 'Q1', value: 4 }, { questionCode: 'Q2', value: 4 }];
    expect(scoreFreeAssessment(answers, qs, DEFAULT_RULES).overall).toBe(100);
  });
  it('scores 25 for all D answers (D=1 of a possible 4, not zero)', () => {
    const qs = [{ code: 'Q1', dimension: 'D' }];
    expect(scoreFreeAssessment([{ questionCode: 'Q1', value: 1 }], qs, DEFAULT_RULES).overall).toBe(25);
  });
  it('throws rather than silently scoring a missing answer as the lowest value (spec, Phase 5 safeguard)', () => {
    const qs = [{ code: 'Q1', dimension: 'D' }, { code: 'Q2', dimension: 'D' }];
    expect(() => scoreFreeAssessment([{ questionCode: 'Q1', value: 4 }], qs, DEFAULT_RULES)).toThrow(/Q2/);
  });
  it('classifies against the provisional bands exactly as specified', () => {
    expect(freeAssessmentClassification(0, DEFAULT_RULES)).toBe('Critical Attention');
    expect(freeAssessmentClassification(39, DEFAULT_RULES)).toBe('Critical Attention');
    expect(freeAssessmentClassification(40, DEFAULT_RULES)).toBe('Needs Improvement');
    expect(freeAssessmentClassification(59, DEFAULT_RULES)).toBe('Needs Improvement');
    expect(freeAssessmentClassification(60, DEFAULT_RULES)).toBe('Developing');
    expect(freeAssessmentClassification(79, DEFAULT_RULES)).toBe('Developing');
    expect(freeAssessmentClassification(80, DEFAULT_RULES)).toBe('Strong Foundation');
    expect(freeAssessmentClassification(100, DEFAULT_RULES)).toBe('Strong Foundation');
  });
});

describe('SME360 question bank', () => {
  it('has exactly 25 questions with 4 answer options each', () => {
    expect(questions).toHaveLength(25);
    for (const code of Object.keys(SME360_ANSWER_OPTIONS)) {
      const opts = SME360_ANSWER_OPTIONS[code];
      expect(Object.keys(opts).sort()).toEqual(['A', 'B', 'C', 'D']);
    }
  });
});

describe('AgriFood360 question bank (#125): drafted content, seeded as Draft pending Amin’s review', () => {
  it('has exactly 25 questions across 6 dimensions, with 4 answer options each', () => {
    const codes = Object.keys(AGRIFOOD360_ANSWER_OPTIONS);
    expect(codes).toHaveLength(25);
    for (const code of codes) {
      const opts = AGRIFOOD360_ANSWER_OPTIONS[code];
      expect(Object.keys(opts).sort()).toEqual(['A', 'B', 'C', 'D']);
    }
  });

  it('is seeded as a Draft version, never auto-published, so the free assessment cannot be taken under it yet', async () => {
    await ensureReference();
    const [f] = await db().select().from(schema.frameworks).where(eq(schema.frameworks.code, 'AGRIFOOD360_FREE')).limit(1);
    expect(f).toBeTruthy();
    expect(f.purpose).toBe('free_preliminary');
    const versions = await db().select().from(schema.frameworkVersions).where(eq(schema.frameworkVersions.frameworkId, f.id));
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((v) => v.status === 'Draft')).toBe(true);

    // Unapproved content: a publish attempt is refused until the source is reviewed, same gate AGRIFOOD360 hits.
    const admin = await makeUser('ADMIN');
    const pub = await api(admin).post(`/settings/frameworks/versions/${versions[0].id}/publish`, { note: 'Attempt without review' });
    expect(pub.status).toBe(422);
  });
});

describe('ESO360 question bank (#126): drafted content, seeded as Draft pending Amin’s review', () => {
  it('has exactly 25 questions across 6 dimensions, with 4 answer options each', () => {
    const codes = Object.keys(ESO360_ANSWER_OPTIONS);
    expect(codes).toHaveLength(25);
    for (const code of codes) {
      const opts = ESO360_ANSWER_OPTIONS[code];
      expect(Object.keys(opts).sort()).toEqual(['A', 'B', 'C', 'D']);
    }
  });

  it('is seeded as a Draft version, never auto-published, so the free assessment cannot be taken under it yet', async () => {
    await ensureReference();
    const [f] = await db().select().from(schema.frameworks).where(eq(schema.frameworks.code, 'ESO360_FREE')).limit(1);
    expect(f).toBeTruthy();
    expect(f.purpose).toBe('free_preliminary');
    const versions = await db().select().from(schema.frameworkVersions).where(eq(schema.frameworkVersions.frameworkId, f.id));
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every((v) => v.status === 'Draft')).toBe(true);

    // Unapproved content: a publish attempt is refused until the source is reviewed, same gate AGRIFOOD360 hits.
    const admin = await makeUser('ADMIN');
    const pub = await api(admin).post(`/settings/frameworks/versions/${versions[0].id}/publish`, { note: 'Attempt without review' });
    expect(pub.status).toBe(422);
  });
});

describe('email normalisation (spec, Phase 6: trim + case-fold only, never strip dots or plus-tags)', () => {
  it('trims and lowercases', () => expect(normaliseEmail('  Amin.Yahaya@Gmail.com  ')).toBe('amin.yahaya@gmail.com'));
  it('does not strip dots', () => expect(normaliseEmail('a.b.c@example.com')).toBe('a.b.c@example.com'));
  it('does not strip plus-addressing', () => expect(normaliseEmail('amin+test@example.com')).toBe('amin+test@example.com'));
  it('treats case-only variants as the same address', () => expect(normaliseEmail('USER@EXAMPLE.COM')).toBe(normaliseEmail('user@example.com')));
  it('treats dot/plus variants as genuinely distinct addresses', () => {
    expect(normaliseEmail('user@example.com')).not.toBe(normaliseEmail('u.ser@example.com'));
    expect(normaliseEmail('user@example.com')).not.toBe(normaliseEmail('user+tag@example.com'));
  });
});

describe('browser-scored free assessment storage and result download', () => {
  beforeAll(async () => { await ensureReference(); });

  it('serves questions without identity, stores only the completed result, and enforces one completion per email/platform', async () => {
    const questions = await dispatch(new Request('http://localhost/api/v1/public/assessments/questions/SME360'));
    expect(questions.status).toBe(200);
    const qBody = await questions.json();
    expect(qBody.data.questions).toHaveLength(25);
    expect(JSON.stringify(qBody)).not.toMatch(/email|answers|fullName/i);

    const email = `browser-score-${Date.now()}@test.samakose.test`;
    const complete = await post('/public/assessments/complete', {
      email, fullName: 'Browser Score Test', platform: 'SME360',
      result: sme360Result(100),
      answers: { SHOULD_NOT_BE_STORED: 'A' }, businessName: 'Not allowed', marketingConsent: true
    });
    expect(complete.status).toBe(200);
    const completed = await complete.json();
    expect(completed.data.eligible).toBe(true);
    const [stored] = await db().select().from(schema.freeAssessmentResults).where(eq(schema.freeAssessmentResults.id, completed.data.id)).limit(1);
    expect(stored.email).toBe(email.toLowerCase());
    expect(stored.fullName).toBe('Browser Score Test');
    expect(stored.platform).toBe('SME360');
    expect(stored.result.overallScore).toBe(100);
    expect(stored.createdAt).toBeInstanceOf(Date);
    expect(Object.keys(stored)).toEqual(['id', 'email', 'fullName', 'platform', 'createdAt', 'result', 'matchedOrgId']);
    const leads = await db().select().from(schema.inquiries).where(eq(schema.inquiries.publicAssessmentId, stored.id));
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      kind: 'assessment', name: 'Browser Score Test', email: email.toLowerCase(), consent: false,
      source: 'free-assessment', publicAssessmentId: stored.id, platform: 'SME360',
      overallScore: 100, classification: 'Strong Foundation'
    });

    const duplicate = await post('/public/assessments/complete', {
      email: email.toUpperCase(), fullName: 'Browser Score Test', platform: 'SME360',
      result: sme360Result(100)
    });
    expect((await duplicate.json()).data.eligible).toBe(false);
    expect(await db().select().from(schema.inquiries).where(eq(schema.inquiries.publicAssessmentId, stored.id))).toHaveLength(1);
  });

  it('the download action returns an actual one-page application/pdf', async () => {
    const email = `pdf-download-${Date.now()}@test.samakose.test`;
    const complete = await post('/public/assessments/complete', {
      email, fullName: 'PDF Download Test', platform: 'SME360',
      result: sme360Result(100)
    });
    const { id } = (await complete.json()).data;
    const res = await post(`/public/assessments/${id}/actions/download`, {});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="SME360-result\.pdf"/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);

    // Downloading is a client-requested action and does not create a stored action/progress record.
    const again = await post(`/public/assessments/${id}/actions/download`, {});
    expect(again.status).toBe(200);
  });

  it('the email action sends the same A4 PDF as an attachment, not a plain-text score dump', async () => {
    const mail = await import('@/lib/mail');
    const spy = vi.spyOn(mail, 'sendMail');
    const email = `pdf-email-${Date.now()}@test.samakose.test`;
    const complete = await post('/public/assessments/complete', {
      email, fullName: 'PDF Email Test', platform: 'SME360',
      result: sme360Result(100)
    });
    const { id } = (await complete.json()).data;
    const res = await post(`/public/assessments/${id}/actions/email`, {});
    expect(res.status).toBe(200);
    expect((await res.json()).data.ok).toBe(true);

    expect(spy).toHaveBeenCalledTimes(1);
    const [to, subject, , attachments] = spy.mock.calls[0];
    expect(to).toBe(email);
    expect(subject).toMatch(/SME360 Business Health result/);
    expect(attachments).toHaveLength(1);
    expect(attachments![0].filename).toBe('SME360-result.pdf');
    expect(attachments![0].contentType).toBe('application/pdf');
    expect(Buffer.from(attachments![0].content.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(attachments![0].content);
    expect(pdf.getPageCount()).toBe(1);
    spy.mockRestore();
  });
});

describe('free assessment result consistency (audit Section B: cannot prove the raw answers, can reject an inconsistent forgery)', () => {
  const base = () => sme360Result(90);

  it('rejects a classification that does not match the band for the submitted score', async () => {
    const res = await post('/public/assessments/complete', {
      email: `forge-band-${Date.now()}@test.samakose.test`, fullName: 'Forge Test', platform: 'SME360',
      result: { ...base(), overallScore: 10, classification: 'Strong Foundation' } // 10 is Critical Attention, not Strong Foundation
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.details).toHaveProperty(['result.classification']);
  });

  it('rejects a dimension name that does not belong to the platform\'s published question set', async () => {
    const r = base();
    const res = await post('/public/assessments/complete', {
      email: `forge-dim-${Date.now()}@test.samakose.test`, fullName: 'Forge Test', platform: 'SME360',
      result: { ...r, dimensionScores: [...r.dimensionScores.slice(1), { dimension: 'Made Up Dimension', score: 90 }] }
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.details).toHaveProperty(['result.dimensionScores']);
  });

  it('rejects a dimension count that does not match the platform\'s actual dimension count', async () => {
    const r = base();
    const res = await post('/public/assessments/complete', {
      email: `forge-count-${Date.now()}@test.samakose.test`, fullName: 'Forge Test', platform: 'SME360',
      result: { ...r, dimensionScores: r.dimensionScores.slice(0, 2) }
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.details).toHaveProperty(['result.dimensionScores']);
  });

  it('rejects an overall score far from the average of the submitted dimension scores', async () => {
    const r = base();
    const res = await post('/public/assessments/complete', {
      email: `forge-avg-${Date.now()}@test.samakose.test`, fullName: 'Forge Test', platform: 'SME360',
      result: { ...r, overallScore: 95, classification: 'Strong Foundation', dimensionScores: r.dimensionScores.map((d) => ({ ...d, score: 10 })) }
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.details).toHaveProperty(['result.overallScore']);
  });

  it('accepts a genuinely self-consistent result (the limit of what the server can check without the raw answers)', async () => {
    const res = await post('/public/assessments/complete', {
      email: `genuine-${Date.now()}@test.samakose.test`, fullName: 'Genuine Test', platform: 'SME360', result: base()
    });
    expect(res.status).toBe(200);
  });
});
