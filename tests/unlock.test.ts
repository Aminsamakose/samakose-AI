import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { answerSheet, api, auditActions, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { acceptingReferrals, canAdvance, evaluate, type Criteria, type Facts } from '@/domain/unlock';

const facts = (o: Partial<Facts> = {}): Facts => ({
  org: { type: 'SME', sector: 'Agriculture', region: 'Northern', size: 'Small', countryCode: 'GH', yearsOperating: 4 },
  score: { overall: 62, confidence: 'Medium', maturity: 'Developing', dimensions: [{ dimension: 'Finance', value: 55 }, { dimension: 'Market', value: 70 }], readiness: [{ code: 'LOAN', name: 'Loan readiness', level: 'Conditionally ready' }] },
  certification: 'Foundation', ...o
});

describe('domain: eligibility explains itself and never overstates', () => {
  it('an opportunity with no readiness requirement is open to any enterprise that fits', () => {
    expect(evaluate({ sectors: ['agriculture'] }, facts({ score: null })).status).toBe('Eligible');
  });
  it('a fit miss means not a fit and names the reason, because the enterprise cannot change it', () => {
    const e = evaluate({ regions: ['Ashanti'], minOverall: 10 }, facts());
    expect(e.status).toBe('Not a fit'); expect(e.mismatches[0]).toMatch(/Region must be Ashanti \(yours is Northern\)/); expect(e.gaps).toEqual([]);
    expect(evaluate({ sizes: ['Medium'] }, facts({ org: { ...facts().org, size: null } })).mismatches[0]).toMatch(/not recorded/);
    expect(evaluate({ minYearsOperating: 5 }, facts()).status).toBe('Not a fit');
  });
  it('without a score the answer is Unknown and says what to do', () => {
    const e = evaluate({ minOverall: 50 }, facts({ score: null }));
    expect(e.status).toBe('Unknown'); expect(e.gaps[0].label).toMatch(/No health score/);
  });
  it('meeting every readiness requirement is Eligible, and each met item is listed', () => {
    const c: Criteria = { minOverall: 60, dimensionMin: { Market: 65 }, readiness: [{ code: 'LOAN', min: 'Conditionally ready' }], certification: 'Foundation', minConfidence: 'Medium' };
    const e = evaluate(c, facts());
    expect(e.status).toBe('Eligible'); expect(e.gaps).toEqual([]); expect(e.met.length).toBe(5);
  });
  it('a few gaps is Close and many is Not yet, each gap being something the enterprise can act on', () => {
    const close = evaluate({ minOverall: 70, dimensionMin: { Finance: 65 } }, facts());
    expect(close.status).toBe('Close'); expect(close.gaps.map((g) => g.id)).toEqual(['overall', 'dim:Finance']); expect(close.gaps[0].detail).toMatch(/8 short/);
    const far = evaluate({ minOverall: 90, dimensionMin: { Finance: 80, Market: 90 }, readiness: [{ code: 'LOAN', min: 'Ready' }], certification: 'Investment-ready' }, facts());
    expect(far.status).toBe('Not yet'); expect(far.gaps.length).toBe(5);
  });
  it('certification and readiness are compared by level order, and a missing certificate is a gap', () => {
    expect(evaluate({ certification: 'Foundation' }, facts({ certification: 'Investment-ready' })).status).toBe('Eligible');
    expect(evaluate({ certification: 'Established' }, facts({ certification: 'Foundation' })).gaps[0].detail).toMatch(/Now Foundation/);
    expect(evaluate({ certification: 'Foundation' }, facts({ certification: null })).gaps[0].detail).toMatch(/No current certificate/);
    expect(evaluate({ readiness: [{ code: 'GRANT', min: 'Ready' }] }, facts()).gaps[0].detail).toMatch(/Not measured/);
  });
  it('a score with Low confidence is never called Eligible, and the caution is shown', () => {
    const low = facts(); low.score!.confidence = 'Low';
    const e = evaluate({ minOverall: 50 }, low);
    expect(e.status).toBe('Close'); expect(e.caution).toMatch(/Low confidence/); expect(e.gaps[0].id).toBe('confidence');
    expect(evaluate({ minOverall: 50, minConfidence: 'Medium' }, low).gaps.some((g) => g.id === 'confidence')).toBe(true);
  });
  it('closed or past-deadline opportunities take no referrals, and a rolling one always does', () => {
    expect(acceptingReferrals({ status: 'Open', deadline: null })).toBe(true);
    expect(acceptingReferrals({ status: 'Closed', deadline: null })).toBe(false);
    expect(acceptingReferrals({ status: 'Open', deadline: '2026-01-01' }, new Date('2026-06-01'))).toBe(false);
    expect(acceptingReferrals({ status: 'Open', deadline: '2026-06-01' }, new Date('2026-06-01T12:00:00Z'))).toBe(true);
  });
  it('referrals move only along allowed steps', () => {
    expect(canAdvance('Approved', 'Referred')).toBe(true); expect(canAdvance('Approved', 'Awarded')).toBe(false);
    expect(canAdvance('Consented', 'Referred')).toBe(false); expect(canAdvance('Awarded', 'Declined')).toBe(false); expect(canAdvance('Applied', 'Awarded')).toBe(true);
  });
});

let admin: Session, pm: Session, expert: Session, funder: Session, owner: Session, otherOwner: Session, bare: Session;
let orgId: string, otherOrgId: string, bareOrgId: string;
const mkOpp = async (over: Record<string, unknown> = {}, publish = true) => {
  const r = await api(admin).post('/opportunities', { title: `Window ${uniq()}`, type: 'Funding', provider: 'Test Partner', summary: 'A test opportunity for matching and referral.', ...over });
  expect(r.status, JSON.stringify(r.error)).toBe(201);
  if (publish) expect((await api(admin).post(`/opportunities/${r.data.id}/publish`, {})).status).toBe(200);
  return r.data.id as string;
};

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); pm = await makeUser('PROGRAMME_MANAGER'); expert = await makeUser('EXPERT'); funder = await makeUser('FUNDER');
  const org = await makeOrg(admin); orgId = org.id; owner = await makeUser('OWNER', { orgId });
  otherOrgId = (await makeOrg(admin)).id; otherOwner = await makeUser('OWNER', { orgId: otherOrgId });
  bareOrgId = (await makeOrg(admin)).id; bare = await makeUser('OWNER', { orgId: bareOrgId });
  const c = (await api(admin).post('/cases', { orgId })).data;
  await api(owner).post(`/cases/${c.id}/diagnostics`, { answers: await answerSheet(4, 'Self-reported') });
});

describe('catalogue', () => {
  it('drafts are staff-only until published, and only an administrator or programme manager can publish', async () => {
    const id = await mkOpp({}, false);
    expect((await api(owner).get('/opportunities')).data.items.some((x: any) => x.id === id)).toBe(false);
    expect((await api(admin).get('/opportunities')).data.items.some((x: any) => x.id === id)).toBe(true);
    expect((await api(expert).post(`/opportunities/${id}/publish`, {})).status).toBe(403);
    expect((await api(pm).post(`/opportunities/${id}/publish`, {})).status).toBe(200);
    expect((await api(owner).get('/opportunities')).data.items.some((x: any) => x.id === id)).toBe(true);
    expect((await api(funder).get('/opportunities')).status).toBe(403);
    expect(await auditActions(id)).toEqual(expect.arrayContaining(['opportunity.created', 'opportunity.published']));
  });
  it('rejects a bad type, an inverted value range, a bad link and unknown criteria', async () => {
    const base = { title: 'Bad one', provider: 'X Partner', summary: 'Long enough summary here.' };
    expect((await api(admin).post('/opportunities', { ...base, type: 'Lottery' })).status).toBe(400);
    expect((await api(admin).post('/opportunities', { ...base, type: 'Loan', valueMin: 500, valueMax: 100 })).status).toBe(422);
    expect((await api(admin).post('/opportunities', { ...base, type: 'Loan', url: 'javascript:alert(1)' })).status).toBe(422);
    expect((await api(admin).post('/opportunities', { ...base, type: 'Loan', criteria: { minOverall: 150 } })).status).toBe(400);
    expect((await api(admin).post('/opportunities', { ...base, type: 'Loan', criteria: { secretRule: true } })).status).toBe(400);
  });
  it('cannot publish past its deadline, and closing stops new referrals', async () => {
    const past = await mkOpp({ deadline: '2020-01-01' }, false);
    expect((await api(admin).post(`/opportunities/${past}/publish`, {})).status).toBe(422);
    const id = await mkOpp();
    expect((await api(admin).post(`/opportunities/${id}/close`, {})).status).toBe(200);
    expect((await api(owner).post(`/organisations/${orgId}/opportunities/${id}/request`, { scope: ['overall'] })).status).toBe(422);
    expect((await api(admin).post(`/opportunities/${id}/publish`, {})).status).toBe(200);
  });
  it('imports from another system as drafts with no criteria, and never twice', async () => {
    const ref = `sopis-${uniq()}`;
    const body = { source: 'sopis', items: [{ sourceRef: ref, title: 'Imported window', type: 'Grant', provider: 'Some Foundation', summary: 'Found by the opportunity scanner.' }, { sourceRef: `${ref}-b`, title: 'Bad type row', type: 'Funding', provider: 'Provider Ltd', summary: 'Valid enough text here.', valueMin: 9, valueMax: 1 }] };
    const first = await api(admin).post('/opportunities/import', body); expect(first.status, JSON.stringify(first.error)).toBe(200);
    expect(first.data.created).toBe(1); expect(first.data.rejected.length).toBe(1);
    const second = await api(admin).post('/opportunities/import', body);
    expect(second.data.created).toBe(0); expect(second.data.skipped).toBe(1);
    const row = (await api(admin).get('/opportunities?status=Draft')).data.items.find((x: any) => x.sourceRef === ref);
    expect(row.source).toBe('sopis'); expect(row.criteria).toEqual({});
    expect((await api(expert).post('/opportunities/import', body)).status).toBe(403);
  });
});

describe('pathway', () => {
  it('shows a matched enterprise what it meets, what is missing and what is not for it, and an unscored one is told to take the check', async () => {
    const fits = await mkOpp({ criteria: { minOverall: 5 } });
    const gap = await mkOpp({ criteria: { minOverall: 100 } });
    const wrong = await mkOpp({ criteria: { regions: ['Nowhere Region'] } });
    const p = (await api(owner).get(`/organisations/${orgId}/pathway`)).data;
    expect(p.readiness.scored).toBe(true);
    const by = (id: string) => p.items.find((i: any) => i.opportunity.id === id);
    expect(['Eligible', 'Close']).toContain(by(fits).match.status);
    if (p.readiness.confidence === 'Low') expect(by(fits).match.caution).toMatch(/Low confidence/);
    expect(['Close', 'Not yet']).toContain(by(gap).match.status); expect(by(gap).match.gaps[0].label).toMatch(/Raise the overall score to 100/);
    expect(by(wrong)).toBeUndefined(); expect(p.notAFit).toBeGreaterThan(0);
    const order = p.items.map((i: any) => i.match.status);
    expect(order).toEqual([...order].sort((a: string, b: string) => ['Eligible', 'Close', 'Not yet', 'Unknown'].indexOf(a) - ['Eligible', 'Close', 'Not yet', 'Unknown'].indexOf(b)));
    const u = (await api(bare).get(`/organisations/${bareOrgId}/pathway`)).data;
    expect(u.readiness.scored).toBe(false);
    expect(u.items.find((i: any) => i.opportunity.id === gap).match.status).toBe('Unknown');
  });
  it('is private to the enterprise and its staff', async () => {
    expect((await api(otherOwner).get(`/organisations/${orgId}/pathway`)).status).toBe(404);
    expect((await api(funder).get(`/organisations/${orgId}/pathway`)).status).toBe(403);
    expect((await api(admin).get(`/organisations/${orgId}/pathway`)).status).toBe(200);
  });
});

describe('referral: consent first, a person decides, history is kept', () => {
  let oppId: string, refId: string;
  beforeAll(async () => { oppId = await mkOpp({ type: 'Loan', criteria: {} }); });
  it('needs the owner to say what may be shared, and only the owner can ask', async () => {
    const path = `/organisations/${orgId}/opportunities/${oppId}/request`;
    expect((await api(owner).post(path, { scope: [] })).status).toBe(400);
    expect((await api(owner).post(path, { scope: ['bank_details'] })).status).toBe(400);
    expect((await api(admin).post(path, { scope: ['overall'] })).status).toBe(403);
    expect((await api(otherOwner).post(path, { scope: ['overall'] })).status).toBe(404);
    const r = await api(owner).post(path, { scope: ['overall', 'certification'] });
    expect(r.status).toBe(201); expect(r.data.status).toBe('Consented'); expect(r.data.consentScope).toEqual(['overall', 'certification']);
    refId = r.data.id;
    expect((await api(owner).post(path, { scope: ['overall'] })).status).toBe(409);
  });
  it('a person approves it, the owner cannot approve their own referral, and nothing skips a step', async () => {
    expect((await api(owner).post(`/referrals/${refId}/approve`, {})).status).toBe(403);
    expect((await api(admin).post(`/referrals/${refId}/status`, { to: 'Referred' })).status).toBe(422);
    expect((await api(admin).post(`/referrals/${refId}/approve`, {})).status).toBe(200);
    expect((await api(admin).post(`/referrals/${refId}/approve`, {})).status).toBe(422);
    expect((await api(expert).post(`/referrals/${refId}/status`, { to: 'Referred' })).status).toBe(403);
  });
  it('moves to an award with an amount, requires a reason to decline, and keeps every step', async () => {
    expect((await api(admin).post(`/referrals/${refId}/status`, { to: 'Referred' })).data.referredAt).toBeTruthy();
    expect((await api(admin).post(`/referrals/${refId}/status`, { to: 'Applied' })).status).toBe(200);
    expect((await api(admin).post(`/referrals/${refId}/status`, { to: 'Shortlisted', amountGhs: 5 })).status).toBe(422);
    const aw = await api(admin).post(`/referrals/${refId}/status`, { to: 'Awarded', amountGhs: 25000, note: 'Loan of GHS 25,000 approved' });
    expect(aw.status).toBe(200); expect(aw.data.amountGhs).toBe(25000);
    expect((await api(admin).post(`/referrals/${refId}/status`, { to: 'Declined', note: 'Changed our mind' })).status).toBe(422);
    const h = (await api(owner).get(`/referrals/${refId}/history`)).data.items.map((x: any) => x.to);
    expect(h).toEqual(['Consented', 'Approved', 'Referred', 'Applied', 'Awarded']);
    expect(await auditActions(refId)).toEqual(expect.arrayContaining(['referral.requested', 'referral.approved', 'referral.awarded']));
    expect((await api(otherOwner).get(`/referrals/${refId}/history`)).status).toBe(404);
  });
  it('staff can suggest, the owner must consent, then the owner can withdraw and later start again', async () => {
    const id = await mkOpp({ criteria: {} });
    const s = await api(admin).post(`/organisations/${orgId}/opportunities/${id}/suggest`, {});
    expect(s.status).toBe(201); expect(s.data.status).toBe('Suggested');
    expect((await api(admin).post(`/referrals/${s.data.id}/approve`, {})).status).toBe(422);
    expect((await api(owner).post(`/organisations/${orgId}/opportunities/${id}/suggest`, {})).status).toBe(403);
    const note = (await db().select().from(schema.notifications).where(eq(schema.notifications.userId, owner.userId))).filter((n) => n.kind === 'unlock');
    expect(note.length).toBeGreaterThan(0);
    expect((await api(owner).post(`/referrals/${s.data.id}/consent`, { scope: ['overall'] })).data.status).toBe('Consented');
    expect((await api(owner).post(`/referrals/${s.data.id}/consent`, { scope: ['overall'] })).status).toBe(422);
    expect((await api(otherOwner).post(`/referrals/${s.data.id}/withdraw`, {})).status).toBe(404);
    expect((await api(owner).post(`/referrals/${s.data.id}/withdraw`, { note: 'Not now' })).data.status).toBe('Withdrawn');
    expect((await api(owner).post(`/referrals/${s.data.id}/withdraw`, {})).status).toBe(422);
    expect((await api(owner).post(`/organisations/${orgId}/opportunities/${id}/request`, { scope: ['overall'] })).status).toBe(201);
  });
  it('will not approve when the enterprise does not meet the requirements, and will not accept a miss on fit', async () => {
    const hard = await mkOpp({ criteria: { minOverall: 100 } });
    const r = await api(owner).post(`/organisations/${orgId}/opportunities/${hard}/request`, { scope: ['overall'] });
    expect(r.status).toBe(201);
    const a = await api(admin).post(`/referrals/${r.data.id}/approve`, {});
    expect(a.status).toBe(422); expect(a.error.message).toMatch(/does not meet the requirements/);
    expect((await api(admin).post(`/referrals/${r.data.id}/status`, { to: 'Declined', note: 'Not ready yet, revisit after the next check' })).status).toBe(200);
    const fit = await mkOpp({ criteria: { sectors: ['Aerospace'] } });
    const bad = await api(owner).post(`/organisations/${orgId}/opportunities/${fit}/request`, { scope: ['overall'] });
    expect(bad.status).toBe(422); expect(bad.error.message).toMatch(/not a fit/i);
  });
  it('the database itself refuses to pass Approved without consent and approval, or an amount on anything but an award', async () => {
    const id = await mkOpp({ criteria: {} });
    const r = (await api(admin).post(`/organisations/${orgId}/opportunities/${id}/suggest`, {})).data;
    const t = schema.opportunityReferrals;
    await expect(db().update(t).set({ status: 'Referred' }).where(eq(t.id, r.id))).rejects.toThrow();
    await expect(db().update(t).set({ status: 'Approved', consentAt: new Date(), consentBy: owner.userId, consentScope: ['overall'] }).where(eq(t.id, r.id))).rejects.toThrow();
    await expect(db().update(t).set({ amountGhs: '10' }).where(eq(t.id, r.id))).rejects.toThrow();
    const [still] = await db().select().from(t).where(eq(t.id, r.id)); expect(still.status).toBe('Suggested');
    await expect(db().insert(t).values({ orgId, opportunityId: id, status: 'Suggested' })).rejects.toThrow();
  });
});

describe('queue and totals', () => {
  it('give staff the queue and the funding mobilised, and keep both away from owners and funders', async () => {
    const q = await api(admin).get('/referrals?status=Awarded');
    expect(q.status).toBe(200); expect(q.data.items.length).toBeGreaterThan(0); expect(q.data.items[0].org).toBeTruthy();
    const s = (await api(admin).get('/unlock/summary')).data;
    expect(s.fundingMobilisedGhs).toBeGreaterThanOrEqual(25000); expect(s.awardedCount).toBeGreaterThan(0); expect(s.opportunitiesOpen).toBeGreaterThan(0);
    for (const who of [owner, funder]) { expect((await api(who).get('/referrals')).status).toBe(403); expect((await api(who).get('/unlock/summary')).status).toBe(403); }
  });
  it('a programme manager outside the enterprise\'s case scope cannot read its pathway or referrals', async () => {
    expect((await api(pm).get(`/organisations/${orgId}/pathway`)).status).toBe(404);
    expect((await api(pm).get('/referrals')).data.items.every((x: any) => x.orgId !== orgId)).toBe(true);
  });
});
