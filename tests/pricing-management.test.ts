import { beforeAll, describe, expect, it } from 'vitest';
import { api, ensureReference, makeOrg, makeUser, type Session } from './helpers';
import { emptyPricingData } from '@/services/pricing';

let admin: Session, admin2: Session, fin: Session, owner: Session;

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); admin2 = await makeUser('ADMIN'); fin = await makeUser('FINANCE');
  const org = await makeOrg(admin);
  owner = await makeUser('OWNER', { orgId: org.id });
});

function fullData() {
  const d = emptyPricingData();
  d.packages = [
    { key: 'diagnostic', name: 'Diagnostic', durationLabel: 'Per assessment', durationDays: null, sortOrder: 0, pricesGhs: { SME: 650, AGRIFOOD: 650, ESO: 650 } },
    { key: 'transform_fix', name: 'Transform Fix', durationLabel: '30 days', durationDays: 30, sortOrder: 1, pricesGhs: { SME: 1500, AGRIFOOD: 1500, ESO: 1500 } }
  ];
  d.tax = { mode: 'estimate', components: [{ name: 'VAT', pct: 15 }, { name: 'NHIL', pct: 2.5 }, { name: 'GETFund levy', pct: 2.5 }], confirmedBy: null, confirmedAt: null };
  return d;
}

describe('pricing draft lifecycle', () => {
  it('seeds a new draft from an empty configuration when nothing is published, and persists edits', async () => {
    const draft = (await api(admin).get('/pricing/draft')).data;
    expect(draft.status).toBe('draft');
    const data = fullData();
    const edited = await api(admin).patch(`/pricing/configs/${draft.id}`, { data });
    expect(edited.status, JSON.stringify(edited.error)).toBe(200);
    expect(edited.data.data.packages).toHaveLength(2);
  });

  it('rejects an out-of-range discount at the request-validation layer', async () => {
    const draft = (await api(admin).get('/pricing/draft')).data;
    const bad = fullData();
    bad.programmeRules[0].discountPct = 150;
    const patch = await api(admin).patch(`/pricing/configs/${draft.id}`, { data: bad });
    expect(patch.status).toBe(400);
  });

  it('blocks submission when a package has a zero price for an enabled platform', async () => {
    const draft = (await api(admin).get('/pricing/draft')).data;
    const bad = fullData();
    bad.packages[0].pricesGhs.ESO = 0;
    const patched = await api(admin).patch(`/pricing/configs/${draft.id}`, { data: bad });
    expect(patched.status, JSON.stringify(patched.error)).toBe(200);
    const submit = await api(admin).post(`/pricing/configs/${draft.id}/submit`, {});
    expect(submit.status).toBe(400);
  });

  it('runs the full submit -> approve -> publish path, and exposes it on the public endpoint', async () => {
    const draft = (await api(admin).get('/pricing/draft')).data;
    const ok = await api(admin).patch(`/pricing/configs/${draft.id}`, { data: fullData() });
    expect(ok.status).toBe(200);
    const submit = await api(admin).post(`/pricing/configs/${draft.id}/submit`, {});
    expect(submit.status, JSON.stringify(submit.error)).toBe(200);
    expect(submit.data.status).toBe('pending_approval');

    const approve = await api(fin).post(`/pricing/configs/${draft.id}/approve`, {});
    expect(approve.status, JSON.stringify(approve.error)).toBe(200);
    expect(approve.data.status).toBe('approved');

    const publish = await api(fin).post(`/pricing/configs/${draft.id}/publish`, {});
    expect(publish.status, JSON.stringify(publish.error)).toBe(200);
    expect(publish.data.isPublished).toBe(true);

    const pub = await api(null).get('/public/pricing');
    expect(pub.status).toBe(200);
    expect(pub.data.packages).toHaveLength(2);
  });

  it('never lets the submitter approve their own submission, even as ADMIN with approve rights', async () => {
    const draft = (await api(admin).get('/pricing/draft')).data;
    await api(admin).patch(`/pricing/configs/${draft.id}`, { data: fullData() });
    await api(admin).post(`/pricing/configs/${draft.id}/submit`, {});

    const selfApprove = await api(admin).post(`/pricing/configs/${draft.id}/approve`, {});
    expect(selfApprove.status).toBe(403);

    const otherApprove = await api(admin2).post(`/pricing/configs/${draft.id}/approve`, {});
    expect(otherApprove.status, JSON.stringify(otherApprove.error)).toBe(200);
  });

  it('rejects with a recorded reason, and the draft becomes editable again', async () => {
    const draft = (await api(admin).get('/pricing/draft')).data;
    await api(admin).patch(`/pricing/configs/${draft.id}`, { data: fullData() });
    await api(admin).post(`/pricing/configs/${draft.id}/submit`, {});

    const noReason = await api(fin).post(`/pricing/configs/${draft.id}/reject`, { reason: '' });
    expect(noReason.status).toBe(400);

    const rejected = await api(fin).post(`/pricing/configs/${draft.id}/reject`, { reason: 'ESO360 rate looks like a typo, please confirm' });
    expect(rejected.status).toBe(200);
    expect(rejected.data.status).toBe('rejected');
    expect(rejected.data.rejectionReason).toContain('typo');

    const resubmit = await api(admin).post(`/pricing/configs/${draft.id}/submit`, {});
    expect(resubmit.status).toBe(200);
  });

  it('keeps only one published configuration at a time (the newest supersedes the old)', async () => {
    const listBefore = (await api(admin).get('/pricing/configs')).data as any[];
    const publishedBefore = listBefore.filter((c) => c.isPublished);
    expect(publishedBefore.length).toBeLessThanOrEqual(1);

    const draft = (await api(admin).get('/pricing/draft')).data;
    const data = fullData(); data.packages[1].pricesGhs.SME = 700;
    await api(admin).patch(`/pricing/configs/${draft.id}`, { data });
    await api(admin).post(`/pricing/configs/${draft.id}/submit`, {});
    await api(fin).post(`/pricing/configs/${draft.id}/approve`, {});
    await api(fin).post(`/pricing/configs/${draft.id}/publish`, {});

    const listAfter = (await api(admin).get('/pricing/configs')).data as any[];
    const publishedAfter = listAfter.filter((c) => c.isPublished);
    expect(publishedAfter).toHaveLength(1);
    expect(publishedAfter[0].id).toBe(draft.id);

    const pub = await api(null).get('/public/pricing');
    expect(pub.data.packages[1].pricesGhs.SME).toBe(700);
  });

  it('a business owner (no pricing permissions) cannot read drafts or approve', async () => {
    expect((await api(owner).get('/pricing/draft')).status).toBe(403);
    expect((await api(owner).post('/pricing/configs/00000000-0000-0000-0000-000000000000/approve', {})).status).toBe(403);
  });
});

describe('programme cohort quote calculation', () => {
  it('computes subtotal = participants x package price x (1 - discount), never multiplying by duration', async () => {
    const q = await api(null).get('/public/pricing/quote/programme?toolSetup=samakose_only&platform=SME&packageKey=transform_fix&participantCount=30');
    expect(q.status, JSON.stringify(q.error)).toBe(200);
    // Transform Fix list price is 700 GHS per the last published config above (SME), 75% off, 30 participants.
    expect(q.data.listSubtotalGhs).toBe(30 * 700);
    expect(q.data.discountPct).toBe(75);
    expect(q.data.subtotalGhs).toBeCloseTo(30 * 700 * 0.25, 2);
    // Tax applied AFTER discount, not before.
    expect(q.data.totalGhs).toBeGreaterThan(q.data.subtotalGhs);
  });

  it('rejects a partner-only cohort missing participant count validation and a samakose_only cohort with no platform', async () => {
    const badCount = await api(null).get('/public/pricing/quote/programme?toolSetup=samakose_only&platform=SME&packageKey=transform_fix&participantCount=0');
    expect(badCount.status).toBe(400);
    const noPlatform = await api(null).get('/public/pricing/quote/programme?toolSetup=samakose_only&packageKey=transform_fix&participantCount=5');
    expect(noPlatform.status).toBe(400);
  });

  it('computes a one-business quote with tax applied and rejects an unpriced platform/package combo', async () => {
    const q = await api(null).get('/public/pricing/quote/one-business?platform=SME&packageKey=transform_fix');
    expect(q.status, JSON.stringify(q.error)).toBe(200);
    expect(q.data.subtotalGhs).toBe(700);
    expect(q.data.totalGhs).toBeCloseTo(700 * 1.2, 2);

    const missing = await api(null).get('/public/pricing/quote/one-business?platform=SME&packageKey=does-not-exist');
    expect(missing.status).toBe(404);
  });
});
