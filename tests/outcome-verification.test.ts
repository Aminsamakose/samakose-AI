import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';

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
