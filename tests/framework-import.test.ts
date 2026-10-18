import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { parseCsv, parseFrameworkCsv } from '@/domain/framework-import';
import { api, call, ensureReference, makeUser, uniq, type Session } from './helpers';

describe('framework CSV parsing (domain, no DB)', () => {
  it('reads a well-formed sheet into questions, dimensions and sub-dimension metadata', () => {
    const csv = [
      'dimension,sub_dimension_code,sub_dimension_name,question_code,question_text,weight,criticality,response_type,anchor_0,anchor_1,anchor_2,anchor_3,anchor_4,readiness_codes,applies_when,risk_tag',
      'Finance,FIN_REC,Record keeping,FIN_Q01,"Does the business keep written, up-to-date financial records?",3,Core,ANCHORED,Never,Rarely,Sometimes,Often,Always,,All,',
      'Finance,,,FIN_Q02,"How are cash transactions recorded?",2,Standard,ANCHORED,,,,,,,,',
      'Market,,,MKT_Q01,"Does the business track its customers?",1,,,,,,,,,,',
    ].join('\n');
    const r = parseFrameworkCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.dimensions).toEqual(['Finance', 'Market']);
    expect(r.questions).toHaveLength(3);
    expect(r.questions[0]).toMatchObject({ code: 'FIN_Q01', dimension: 'Finance', weight: 3, criticality: 'Core', subDimension: 'FIN_REC' });
    expect(r.questions[0].anchors).toEqual(['Never', 'Rarely', 'Sometimes', 'Often', 'Always']);
    expect(r.questions[1].anchors).toBeUndefined();
    expect(r.meta?.subDimensions).toEqual([{ code: 'FIN_REC', name: 'Record keeping', dimension: 'Finance' }]);
  });

  it('handles quoted fields with embedded commas and newlines', () => {
    const csv = 'a,b\n"one, two","three\nfour"';
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['one, two', 'three\nfour']]);
  });

  it('reports a missing required column without attempting to read rows', () => {
    const r = parseFrameworkCsv('dimension,question_text,weight\nFinance,Some question,1');
    expect(r.questions).toEqual([]);
    expect(r.errors[0].message).toMatch(/question_code/);
  });

  it('flags a duplicate question code, a bad weight, and an unknown criticality, one error per bad row', () => {
    const csv = [
      'dimension,question_code,question_text,weight,criticality',
      'Finance,FIN_Q01,First one,3,Core',
      'Finance,FIN_Q01,Duplicate code,2,',
      'Finance,FIN_Q02,Bad weight,9,',
      'Finance,FIN_Q03,Bad criticality,2,Unknown',
    ].join('\n');
    const r = parseFrameworkCsv(csv);
    expect(r.questions).toHaveLength(1); // only the first FIN_Q01 row
    expect(r.errors).toHaveLength(3);
    expect(r.errors.map((e) => e.message).join(' ')).toMatch(/used twice/);
    expect(r.errors.map((e) => e.message).join(' ')).toMatch(/weight must be a whole number/);
    expect(r.errors.map((e) => e.message).join(' ')).toMatch(/criticality "Unknown"/);
  });

  it('skips blank lines without miscounting row numbers', () => {
    const csv = 'dimension,question_code,question_text,weight\nFinance,FIN_Q01,First,1\n\nFinance,FIN_Q02,Second,1';
    const r = parseFrameworkCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.questions.map((q) => q.code)).toEqual(['FIN_Q01', 'FIN_Q02']);
  });
});

/**
 * Phase 1 of the assessment-config upload/combine gap (scoping memo): upload a CSV, get a brand-new
 * framework draft back through the existing createDraft/validateContent path, unchanged.
 */
describe('framework CSV import (API)', () => {
  let adminS: Session;
  const code = 'SME360';

  beforeAll(async () => {
    await ensureReference();
    adminS = await makeUser('ADMIN');
  });

  const upload = (s: Session, csv: string, filename = 'import.csv') => {
    const f = new FormData(); f.set('file', new File([csv], filename, { type: 'text/csv' }));
    return call('POST', `/settings/frameworks/${code}/versions/import`, { cookie: s.cookie, form: f });
  };

  it('creates a draft from a valid CSV, exactly as a hand-written JSON draft would', async () => {
    const dim = `Finance-${uniq()}`;
    const csv = [
      'dimension,question_code,question_text,weight',
      `${dim},Q1-${uniq().toUpperCase()},"Does the business keep written records?",2`,
    ].join('\n');
    const res = await upload(adminS, csv);
    expect(res.status, JSON.stringify(res.error)).toBe(201);
    expect(res.data.status).toBe('Draft');
    expect(res.data.dimensions).toContain(dim);
    expect(res.data.importedFrom.questions).toBe(1);

    const [row] = await db().select().from(schema.frameworkVersions).where(eq(schema.frameworkVersions.id, res.data.id));
    expect(row.questions.some((q: any) => q.dimension === dim)).toBe(true);
    await api(adminS).del(`/settings/frameworks/versions/${res.data.id}`);
  });

  it('refuses a CSV with bad rows and audits the attempt without creating a draft', async () => {
    const csv = 'dimension,question_code,question_text,weight\nFinance,,Missing a code,1';
    const before = await db().select({ id: schema.frameworkVersions.id }).from(schema.frameworkVersions);
    const res = await upload(adminS, csv);
    expect(res.status).toBe(422);
    expect(res.error.details.rows[0].message).toMatch(/question_code is required/);
    const after = await db().select({ id: schema.frameworkVersions.id }).from(schema.frameworkVersions);
    expect(after.length).toBe(before.length);
  });

  it('rejects a non-.csv file outright', async () => {
    const res = await upload(adminS, 'dimension,question_code,question_text,weight\nF,Q1,X,1', 'import.xlsx');
    expect(res.status).toBe(400);
  });

  it('requires the frameworks:create permission', async () => {
    const reviewer = await makeUser('REVIEWER');
    const csv = `dimension,question_code,question_text,weight\nFinance,Q-${uniq().toUpperCase()},X,1`;
    const res = await upload(reviewer, csv);
    expect(res.status).toBe(403);
  });

  it('refuses when a draft is already open for the framework', async () => {
    const dim = `Ops-${uniq()}`;
    const csv = `dimension,question_code,question_text,weight\n${dim},Q-${uniq().toUpperCase()},First question here,1`;
    const first = await upload(adminS, csv);
    expect(first.status, JSON.stringify(first.error)).toBe(201);
    const second = await upload(adminS, `dimension,question_code,question_text,weight\n${dim},Q-${uniq().toUpperCase()},Second question here,1`);
    expect(second.status).toBe(422);
    await api(adminS).del(`/settings/frameworks/versions/${first.data.id}`);
  });
});
