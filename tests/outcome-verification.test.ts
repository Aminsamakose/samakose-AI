import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';

/**
 * GAP 11 (funder-accountability gap register): a higher health score or a completed coaching
 * session does not by itself prove increased income, profitability, employment or access to
 * finance. These tests cover the outcome-definition / outcome-record model, kept deliberately
 * separate from programmeIndicators (which only tracks score-derived metrics): defining a
 * real-world outcome, recording an enterprise's baseline/followup result against it, verifying
 * or rejecting with a reason, and correcting a decided record without losing the original.
 */
describe('outcome verification (results distinct from health-score delta)', () => {
  let admin: Session;
  let programmeId: string, caseId: string;

  beforeAll(async () => {
    await ensureReference();
    admin = await makeUser('ADMIN');
    const prog = (await api(admin).post('/programmes', { name: `Outcomes ${uniq()}` })).data;
    programmeId = prog.id;
    const org = await makeOrg(admin);
    const c = (await api(admin).post('/cases', { orgId: org.id, programmeId })).data;
    caseId = c.id;
  });

  it('defines an outcome and records a baseline-only result pending verification', async () => {
    const def = await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Household income ${uniq()}`, unit: 'GHS/month' });
    expect(def.status, JSON.stringify(def.error)).toBe(201);

    const rec = await api(admin).post(`/outcome-definitions/${def.data.id}/records`, { caseId, baselineValue: 1200, baselineDate: '2026-01-15', evidenceClass: 'Self-reported' });
    expect(rec.status, JSON.stringify(rec.error)).toBe(201);

    const list = await api(admin).get(`/outcome-definitions/${def.data.id}/records`);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].status).toBe('PENDING');
    expect(Number(list.data[0].baselineValue)).toBe(1200);
  });

  it('rejects a record with neither baseline nor followup value', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Jobs created ${uniq()}`, unit: 'count' })).data;
    const rec = await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId });
    expect(rec.status).toBe(400);
  });

  it('rejects an enterprise that does not belong to the definition’s programme', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Revenue ${uniq()}`, unit: 'GHS' })).data;
    const otherOrg = await makeOrg(admin);
    const otherCase = (await api(admin).post('/cases', { orgId: otherOrg.id })).data; // no programmeId
    const rec = await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId: otherCase.id, followupValue: 500 });
    expect(rec.status).toBe(400);
  });

  it('verifies a record with a decision and reason, and refuses to re-verify it', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Profit margin ${uniq()}`, unit: '%' })).data;
    const rec = (await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId, followupValue: 18 })).data;

    const verified = await api(admin).post(`/outcome-records/${rec.id}/verify`, { decision: 'VERIFIED', reason: 'Confirmed against bank statement' });
    expect(verified.status, JSON.stringify(verified.error)).toBe(200);

    const reVerify = await api(admin).post(`/outcome-records/${rec.id}/verify`, { decision: 'REJECTED', reason: 'Changed my mind' });
    expect(reVerify.status).toBe(422);
  });

  it('records a rejection separately rather than discarding it', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Access to finance ${uniq()}`, unit: 'boolean' })).data;
    const rec = (await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId, followupValue: 0, evidenceClass: 'Unverified' })).data;
    const rejected = await api(admin).post(`/outcome-records/${rec.id}/verify`, { decision: 'REJECTED', reason: 'No supporting document provided' });
    expect(rejected.status).toBe(200);

    const list = await api(admin).get(`/outcome-definitions/${def.id}/records`);
    const row = list.data.find((r: any) => r.id === rec.id);
    expect(row.status).toBe('REJECTED');
    expect(row.reason).toContain('No supporting document');
  });

  it('corrects a decided record by superseding it, keeping the original intact', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Employment count ${uniq()}`, unit: 'count' })).data;
    const rec = (await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId, followupValue: 3 })).data;
    await api(admin).post(`/outcome-records/${rec.id}/verify`, { decision: 'VERIFIED', reason: 'Payroll checked' });

    const corrected = await api(admin).post(`/outcome-records/${rec.id}/correct`, { followupValue: 5, reason: 'Payroll was re-run; two additional hires found' });
    expect(corrected.status, JSON.stringify(corrected.error)).toBe(201);
    expect(corrected.data.id).not.toBe(rec.id);

    const list = await api(admin).get(`/outcome-definitions/${def.id}/records`);
    const original = list.data.find((r: any) => r.id === rec.id);
    const replacement = list.data.find((r: any) => r.id === corrected.data.id);
    expect(original.status).toBe('SUPERSEDED');
    expect(original.decision).toBe('VERIFIED'); // the original decision history is untouched
    expect(Number(original.followupValue)).toBe(3);
    expect(replacement.status).toBe('PENDING');
    expect(Number(replacement.followupValue)).toBe(5);
    expect(replacement.supersedesId).toBe(rec.id);
  });

  it('cannot delete a definition that already has recorded results', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Productivity ${uniq()}`, unit: 'units/day' })).data;
    await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId, baselineValue: 10 });
    const del = await api(admin).del(`/outcome-definitions/${def.id}`);
    expect(del.status).toBe(409);
  });
});

/**
 * #91 (structural outcome attribution): attributionNote is free text on the outcome record itself,
 * never inferred automatically. These tests cover the separate, structural half -- a named link from
 * one outcome record to the specific intervention(s) believed to have contributed to it, each with
 * its own weight and confidence -- so a result with no attribution row (correlation only) is
 * distinguishable in the data from one with a high-confidence attribution to a named intervention
 * (closer to verified attribution).
 */
describe('outcome attribution (structural link from an outcome to the intervention that produced it)', () => {
  let admin: Session;
  let programmeId: string, caseId: string, interventionId: string, otherCaseInterventionId: string;

  async function makeIntervention(cid: string) {
    const [diag] = await db().insert(schema.diagnostics).values({ caseId: cid, status: 'Validated' }).returning({ id: schema.diagnostics.id });
    const [dgn] = await db().insert(schema.diagnoses).values({ caseId: cid, diagnosticId: diag.id, summary: 'Weak records and systems', rootCauses: [], priority: 'High', risks: [] }).returning({ id: schema.diagnoses.id });
    const [rx] = await db().insert(schema.prescriptions).values({ caseId: cid, diagnosisId: dgn.id, status: 'APPROVED', items: [] }).returning({ id: schema.prescriptions.id });
    const [iv] = await db().insert(schema.interventions).values({ caseId: cid, prescriptionId: rx.id, libraryCode: 'bookkeeping-basics', status: 'PLANNED' }).returning({ id: schema.interventions.id });
    return iv.id;
  }

  beforeAll(async () => {
    await ensureReference();
    admin = await makeUser('ADMIN');
    const prog = (await api(admin).post('/programmes', { name: `Attribution ${uniq()}` })).data;
    programmeId = prog.id;
    const org = await makeOrg(admin);
    const c = (await api(admin).post('/cases', { orgId: org.id, programmeId })).data;
    caseId = c.id;
    interventionId = await makeIntervention(caseId);
    const otherOrg = await makeOrg(admin);
    const otherCase = (await api(admin).post('/cases', { orgId: otherOrg.id, programmeId })).data;
    otherCaseInterventionId = await makeIntervention(otherCase.id);
  });

  it('credits an intervention with a weight and confidence, and lists it back', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Revenue growth ${uniq()}`, unit: 'GHS/month' })).data;
    const rec = (await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId, followupValue: 2000 })).data;

    const attr = await api(admin).post(`/outcome-records/${rec.id}/attributions`, { interventionId, contributionWeight: 70, confidence: 'High', note: 'Bookkeeping fixed led directly to pricing corrections' });
    expect(attr.status, JSON.stringify(attr.error)).toBe(201);

    const list = await api(admin).get(`/outcome-records/${rec.id}/attributions`);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].interventionId).toBe(interventionId);
    expect(Number(list.data[0].contributionWeight)).toBe(70);
    expect(list.data[0].confidence).toBe('High');
  });

  it('rejects an intervention that belongs to a different enterprise than the outcome record', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Jobs retained ${uniq()}`, unit: 'count' })).data;
    const rec = (await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId, followupValue: 4 })).data;

    const attr = await api(admin).post(`/outcome-records/${rec.id}/attributions`, { interventionId: otherCaseInterventionId, contributionWeight: 50 });
    expect(attr.status).toBe(400);
  });

  it('rejects a weight outside 0-100, and the same intervention cannot be linked twice', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Loan access ${uniq()}`, unit: 'boolean' })).data;
    const rec = (await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId, followupValue: 1 })).data;

    const tooHigh = await api(admin).post(`/outcome-records/${rec.id}/attributions`, { interventionId, contributionWeight: 150 });
    expect(tooHigh.status).toBe(400);

    const first = await api(admin).post(`/outcome-records/${rec.id}/attributions`, { interventionId, contributionWeight: 40 });
    expect(first.status).toBe(201);
    const duplicate = await api(admin).post(`/outcome-records/${rec.id}/attributions`, { interventionId, contributionWeight: 10 });
    expect(duplicate.status).toBe(409);
  });

  it('updates and removes an attribution', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Market expansion ${uniq()}`, unit: 'boolean' })).data;
    const rec = (await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId, followupValue: 1 })).data;
    const attr = (await api(admin).post(`/outcome-records/${rec.id}/attributions`, { interventionId, contributionWeight: 20, confidence: 'Low' })).data;

    const updated = await api(admin).patch(`/outcome-attributions/${attr.id}`, { contributionWeight: 85, confidence: 'High' });
    expect(updated.status, JSON.stringify(updated.error)).toBe(200);
    const after = await api(admin).get(`/outcome-records/${rec.id}/attributions`);
    expect(Number(after.data[0].contributionWeight)).toBe(85);
    expect(after.data[0].confidence).toBe('High');

    const removed = await api(admin).del(`/outcome-attributions/${attr.id}`);
    expect(removed.status).toBe(200);
    const empty = await api(admin).get(`/outcome-records/${rec.id}/attributions`);
    expect(empty.data).toHaveLength(0);
  });

  it('refuses to attribute or edit on a record that has been superseded by a correction', async () => {
    const def = (await api(admin).post(`/programmes/${programmeId}/outcome-definitions`, { name: `Export sales ${uniq()}`, unit: 'GHS' })).data;
    const rec = (await api(admin).post(`/outcome-definitions/${def.id}/records`, { caseId, followupValue: 500 })).data;
    await api(admin).post(`/outcome-records/${rec.id}/verify`, { decision: 'VERIFIED', reason: 'Checked against invoice' });
    const corrected = await api(admin).post(`/outcome-records/${rec.id}/correct`, { followupValue: 600, reason: 'Found one more invoice' });
    expect(corrected.status).toBe(201);

    const attr = await api(admin).post(`/outcome-records/${rec.id}/attributions`, { interventionId, contributionWeight: 30 });
    expect(attr.status).toBe(409);

    const onReplacement = await api(admin).post(`/outcome-records/${corrected.data.id}/attributions`, { interventionId, contributionWeight: 30 });
    expect(onReplacement.status, JSON.stringify(onReplacement.error)).toBe(201);
  });
});
