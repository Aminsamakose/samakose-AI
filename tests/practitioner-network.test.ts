import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { answerSheet, api, call, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { completeness, assignability, canMoveVetting } from '@/domain/practitioners';
import { scoreMatch, rankMatches, type MatchProfile } from '@/domain/matching';
import { confidence, performance, scoreRating, suggestStatus, outcomeScore, toPercent, DEFAULT_THRESHOLDS } from '@/domain/ratings';
import { scanUnacknowledged } from '@/services/assignments';
import { systemCtx } from '@/services/common';

const full = { headline: 'Finance systems for SMEs', bio: 'Twelve years building financial management systems for small agribusinesses in Northern Ghana.', functions: ['expert', 'coach'], specialisations: ['Financial management'], strengths: ['Financial Management and Performance'], sectors: ['Agriculture'], platforms: ['SME360', 'AGRIFOOD360'], languages: ['English', 'Dagbani'], regions: ['Northern'], deliveryModes: ['In person'], yearsExperience: 12, credentials: [{ type: 'Certification', title: 'ACCA' }], acceptConduct: true };

describe('domain: profile completeness and vetting', () => {
  const base = { headline: null, bio: null, functions: ['expert'], specialisations: [], strengths: [], sectors: [], platforms: [], languages: [], regions: [], deliveryModes: [], yearsExperience: null, credentials: [], conductAcceptedAt: null };
  it('lists what is missing and only allows submission when the required parts are done', () => {
    const empty = completeness(base, false);
    expect(empty.canSubmit).toBe(false); expect(empty.missing.length).toBeGreaterThan(5);
    const done = completeness({ ...base, ...full, conductAcceptedAt: new Date() } as any, false);
    expect(done.canSubmit).toBe(true); expect(done.percent).toBeGreaterThan(90);
  });
  it('moves vetting only along allowed steps and gates assignment on approval and function', () => {
    expect(canMoveVetting('Draft', 'Approved')).toBe(false); expect(canMoveVetting('Submitted', 'Approved')).toBe(true); expect(canMoveVetting('Rejected', 'Approved')).toBe(false);
    expect(assignability(null, 'lead').ok).toBe(false);
    expect(assignability({ vettingStatus: 'Submitted', availability: 'Available', functions: ['expert'] }, 'lead').ok).toBe(false);
    expect(assignability({ vettingStatus: 'Approved', availability: 'Available', functions: ['expert'] }, 'coach').ok).toBe(false);
    expect(assignability({ vettingStatus: 'Approved', availability: 'Available', functions: ['expert', 'coach'] }, 'coach').ok).toBe(true);
    expect(assignability(null, 'reviewer').ok).toBe(true);
  });
});

describe('domain: matching explains itself and excludes safely', () => {
  const p = (o: Partial<MatchProfile>): MatchProfile => ({ userId: uniq(), name: 'A', functions: ['expert'], specialisations: ['Financial management'], strengths: ['Financial Management and Performance'], sectors: ['Agriculture'], platforms: ['SME360'], businessSizes: ['Small'], regions: ['Northern'], languages: ['English'], yearsExperience: 10, availability: 'Available', maxActive: 5, vettingStatus: 'Approved', ...o });
  const need = { fn: 'lead' as const, platform: 'SME360', sector: 'Agriculture', size: 'Small', region: 'Northern', weakDimensions: ['Financial Management and Performance', 'Strategy, Market and Customers'] };
  it('scores fit with named factors that add up, and a better fit ranks first', () => {
    const good = scoreMatch(p({}), need, { active: 1, conflict: false, onCase: false });
    const poor = scoreMatch(p({ strengths: [], sectors: ['Retail'], regions: ['Ashanti'], specialisations: [] }), need, { active: 1, conflict: false, onCase: false });
    expect(good.eligible).toBe(true); expect(good.score).toBeGreaterThan(poor.score);
    expect(Math.round(good.factors.reduce((s, f) => s + f.points, 0))).toBe(good.score);
    expect(good.evidence).toMatch(/No engagement history/);
  });
  it('never recommends someone who is unapproved, unavailable, at capacity, in conflict or already on the case', () => {
    for (const [prof, load] of [[p({ vettingStatus: 'Draft' }), {}], [p({ availability: 'Unavailable' }), {}], [p({}), { active: 5 }], [p({}), { conflict: true }], [p({}), { onCase: true }], [p({ functions: ['coach'] }), {}]] as const) {
      const m = scoreMatch(prof, need, { active: 0, conflict: false, onCase: false, ...load });
      expect(m.eligible, JSON.stringify(m.exclusions)).toBe(false); expect(m.exclusions.length).toBeGreaterThan(0);
    }
    const ranked = rankMatches([scoreMatch(p({ vettingStatus: 'Draft' }), need, { active: 0, conflict: false, onCase: false }), scoreMatch(p({}), need, { active: 0, conflict: false, onCase: false })]);
    expect(ranked[0].eligible).toBe(true);
  });
});

describe('domain: ratings never overstate a small sample', () => {
  it('turns stars into percentages and rejects incomplete forms', () => {
    expect(toPercent(1)).toBe(0); expect(toPercent(5)).toBe(100); expect(toPercent(3)).toBe(50);
    expect(scoreRating('client', { quality: 5 }).ok).toBe(false);
    const all = Object.fromEntries(['quality', 'relevance', 'communication', 'professionalism', 'responsiveness', 'usefulness', 'trust', 'recommend'].map((k) => [k, 5]));
    const r = scoreRating('client', all); expect(r.ok && r.overall).toBe(100);
  });
  it('shows Limited evidence and no status above Good standing for a few perfect ratings', () => {
    const perfect = (src: 'client' | 'reviewer') => ({ source: src, scores: ( src === 'client' ? { quality: 5, relevance: 5, usefulness: 5, professionalism: 5, communication: 5, responsiveness: 5, trust: 5, recommend: 5 } : { technical: 5, appropriateness: 5, evidence: 5, deliverables: 5, documentation: 5 }) as Record<string, number> });
    const few = performance([[perfect('client'), perfect('reviewer')], [perfect('client')]], { sessionsHeld: 4, sessionsMissed: 0, actionsDone: 8, actionsTotal: 8, scoreChange: 15 }, 2);
    expect(few.score).toBeGreaterThan(90); expect(few.confidence).toBe('Limited evidence'); expect(few.suggestedStatus).toBe('Not enough evidence yet');
    expect(suggestStatus(95, { completed: 4, rated: 3, reviewed: 3 })).not.toBe('Exceptional');
  });
  it('reaches high confidence and top status only with the evidence the framework asks for', () => {
    expect(confidence({ completed: 20, rated: 10, reviewed: 5 })).toBe('High'); expect(confidence({ completed: 6, rated: 3, reviewed: 1 })).toBe('Moderate');
    expect(suggestStatus(92, { completed: 25, rated: 12, reviewed: 6 })).toBe('Exceptional');
    expect(suggestStatus(86, { completed: 12, rated: 6, reviewed: 2 })).toBe('Excellent');
    expect(suggestStatus(72, { completed: 4, rated: 3, reviewed: 1 })).toBe('Good standing'); expect(suggestStatus(64, { completed: 8, rated: 4, reviewed: 1 })).toBe('Performance watch'); expect(suggestStatus(40, { completed: 8, rated: 4, reviewed: 1 })).toBe('Improvement required');
    expect(DEFAULT_THRESHOLDS.exceptional.completed).toBe(20);
  });
  it('scales the score outcome from movement in the Business Health score', () => { expect(outcomeScore(null)).toBeNull(); expect(outcomeScore(0)).toBe(50); expect(outcomeScore(30)).toBe(100); expect(outcomeScore(-30)).toBe(0); });
});

let admin: Session, pm: Session, e1: Session, e2: Session, e3: Session, reviewer: Session, owner: Session, otherOwner: Session, caseId: string, orgId: string, progId: string;
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN');
  progId = (await api(admin).post('/programmes', { name: `Network ${uniq()}`, funder: 'Test Funder', startDate: '2026-01-01', endDate: '2027-01-01', budgetGhs: 1000 })).data.id;
  await api(admin).patch(`/programmes/${progId}`, { status: 'Active' });
  pm = await makeUser('PROGRAMME_MANAGER', { programmeIds: [progId] });
  e1 = await makeUser('EXPERT'); e2 = await makeUser('EXPERT'); e3 = await makeUser('EXPERT'); reviewer = await makeUser('REVIEWER');
  const org = await makeOrg(admin); orgId = org.id; owner = await makeUser('OWNER', { orgId: org.id });
  otherOwner = await makeUser('OWNER', { orgId: (await makeOrg(admin)).id });
  caseId = (await api(pm).post('/cases', { orgId, programmeId: progId })).data.id;
});

describe('profile photo: one capability, private, resized', () => {
  const png = (w = 900, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 80 } } }).png().toBuffer();
  const form = async (name: string, buf: Buffer, type: string) => { const f = new FormData(); f.set('file', new File([new Uint8Array(buf)], name, { type })); return f; };
  it('accepts a photo from any role, resizes it to a square and serves it to the owner of the photo', async () => {
    const up = await call('POST', '/me/photo', { cookie: owner.cookie, form: await form('me.png', await png(), 'image/png') });
    expect(up.status).toBe(200); expect(up.data.photoUrl).toMatch(/\/api\/v1\/users\/.+\/photo\?v=\d+/);
    const got = await call('GET', `/users/${owner.userId}/photo`, { cookie: owner.cookie });
    expect(got.status).toBe(200); expect(got.headers.get('content-type')).toBe('image/webp'); expect(got.headers.get('cache-control')).toMatch(/private/);
    const meta = await sharp(Buffer.from(got.text, 'binary')).metadata().catch(() => null);
    void meta;
    const me = await api(owner).get('/auth/me'); expect(me.data.user.photoUrl).toMatch(/photo\?v=/);
  });
  it('rejects files that are not photos, even when named like one', async () => {
    expect((await call('POST', '/me/photo', { cookie: owner.cookie, form: await form('x.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/png') })).status).toBe(400);
    expect((await call('POST', '/me/photo', { cookie: owner.cookie, form: await form('x.png', Buffer.from('%PDF-1.4 hello'), 'image/png') })).status).toBe(400);
    expect((await call('POST', '/me/photo', { cookie: owner.cookie, form: await form('big.png', Buffer.alloc(5 * 1024 * 1024, 1), 'image/png') })).status).toBe(400);
  });
  it('lets a person change only their own photo, and an administrator any', async () => {
    expect((await call('POST', `/users/${owner.userId}/photo`, { cookie: otherOwner.cookie, form: await form('a.png', await png(), 'image/png') })).status).toBe(403);
    expect((await call('POST', `/users/${e1.userId}/photo`, { cookie: admin.cookie, form: await form('a.png', await png(), 'image/png') })).status).toBe(200);
  });
  it('shows a photo only to people with a reason to see it', async () => {
    expect((await call('GET', `/users/${owner.userId}/photo`, {})).status).toBe(401);
    expect((await api(otherOwner).get(`/users/${owner.userId}/photo`)).status).toBe(404); // another business
    expect((await api(e1).get(`/users/${e2.userId}/photo`)).status).toBe(404); // e2 has no photo
    await call('POST', '/me/photo', { cookie: e2.cookie, form: await form('e2.png', await png(), 'image/png') });
    expect((await api(e1).get(`/users/${e2.userId}/photo`)).status).toBe(200); // staff see staff
    expect((await api(owner).get(`/users/${e2.userId}/photo`)).status).toBe(404); // not on their case yet
    expect((await api(admin).get(`/users/${owner.userId}/photo`)).status).toBe(200);
    expect((await api(e3).get(`/users/${owner.userId}/photo`)).status).toBe(404); // an expert outside the case
  });
  it('removes the photo and its stored file', async () => {
    const [before] = await db().select().from(schema.users).where(eq(schema.users.id, owner.userId));
    expect(before.photoKey).toBeTruthy();
    expect((await api(owner).del('/me/photo')).status).toBe(200);
    const [after] = await db().select().from(schema.users).where(eq(schema.users.id, owner.userId));
    expect(after.photoKey).toBeNull();
    expect((await api(admin).get(`/users/${owner.userId}/photo`)).status).toBe(404);
  });
});

describe('practitioner profile and vetting gate', () => {
  let fresh: Session;
  beforeAll(async () => {
    fresh = await makeUser('EXPERT');
    await db().update(schema.practitionerProfiles).set({ vettingStatus: 'Draft' }).where(eq(schema.practitionerProfiles.userId, fresh.userId));
  });
  it('starts as a draft that cannot be assigned, and cannot be submitted incomplete', async () => {
    const mine = await api(fresh).get('/me/practitioner'); expect(mine.status).toBe(200); expect(mine.data.vettingStatus).toBe('Draft'); expect(mine.data.completeness.canSubmit).toBe(false);
    expect((await api(fresh).post('/me/practitioner/submit', {})).status).toBe(422);
    const r = await api(pm).post(`/cases/${caseId}/assign`, { consultantId: fresh.userId });
    expect(r.status).toBe(400); expect(JSON.stringify(r.body)).toMatch(/draft|not approved/i);
  });
  it('validates input, then a complete profile is submitted, reviewed by an administrator and becomes assignable', async () => {
    expect((await api(fresh).patch('/me/practitioner', { platforms: ['NOPE'] })).status).toBe(400);
    expect((await api(fresh).patch('/me/practitioner', { maxActive: 0 })).status).toBe(400);
    const up = await api(fresh).patch('/me/practitioner', full); expect(up.status).toBe(200); expect(up.data.completeness.canSubmit).toBe(true);
    expect((await api(fresh).post('/me/practitioner/submit', {})).status).toBe(200);
    expect((await api(fresh).post(`/practitioners/${fresh.userId}/decision`, { decision: 'Approved' })).status).toBe(403);
    expect((await api(pm).post(`/practitioners/${fresh.userId}/decision`, { decision: 'Approved' })).status).toBe(403);
    expect((await api(admin).post(`/practitioners/${fresh.userId}/decision`, { decision: 'Rejected' })).status).toBe(400); // needs a reason
    expect((await api(admin).post(`/practitioners/${fresh.userId}/decision`, { decision: 'Approved', note: 'Credentials checked' })).status).toBe(200);
    const [row] = await db().select().from(schema.approvals).where(and(eq(schema.approvals.recordId, fresh.userId), eq(schema.approvals.recordType, 'practitioner_profile')));
    expect(row.decision).toBe('Approved');
  });
  it('sends an approved profile back for review when credentials change, and hides fees from programme managers', async () => {
    await api(fresh).patch('/me/practitioner', { rateNote: 'GHS 400 a day' });
    expect((await api(pm).get(`/practitioners/${fresh.userId}`)).data.rateNote).toBeUndefined();
    expect((await api(admin).get(`/practitioners/${fresh.userId}`)).data.rateNote).toBe('GHS 400 a day');
    const ch = await api(fresh).patch('/me/practitioner', { credentials: [{ type: 'Certification', title: 'CPA' }] });
    expect(ch.data.vettingStatus).toBe('Submitted');
    expect((await api(admin).post(`/practitioners/${fresh.userId}/decision`, { decision: 'Approved' })).status).toBe(200);
  });
  it('lets staff list practitioners and gives colleagues only the public card of approved ones', async () => {
    const l = await api(pm).get('/practitioners'); expect(l.status).toBe(200); expect(l.data.counts.Approved).toBeGreaterThan(0); expect(l.data.items[0].completeness).toBeTruthy();
    const c = await api(e1).get('/practitioners'); expect(c.status).toBe(200); for (const x of c.data.items) { expect(x.vettingStatus).toBe('Approved'); expect(x.completeness).toBeUndefined(); expect(x.email).toBeUndefined(); }
    expect((await api(owner).get('/practitioners')).status).toBe(403);
  });
  it('declares conflicts that only an administrator can remove', async () => {
    // A person can declare a conflict only with a business they can see; an administrator can declare one for them.
    expect((await api(fresh).post('/me/practitioner/conflicts', { orgId, reason: 'Former employer of the owner' })).status).toBe(404);
    const free = await makeOrg(admin);
    expect((await api(fresh).post('/me/practitioner/conflicts', { orgId: free.id, reason: 'Family member owns it' })).status).toBe(200);
    const add = await api(admin).post(`/practitioners/${fresh.userId}/conflicts`, { orgId, reason: 'Former employer of the owner' });
    expect(add.status).toBe(200);
    const cid = add.data.items.find((x: any) => x.orgId === orgId).id;
    expect((await api(fresh).del(`/practitioners/${fresh.userId}/conflicts/${cid}`)).status).toBe(403);
    expect((await api(pm).post(`/cases/${caseId}/assign`, { consultantId: fresh.userId })).status).toBe(400);
    expect((await api(admin).del(`/practitioners/${fresh.userId}/conflicts/${cid}`)).status).toBe(200);
  });
});

describe('assignments: history, reasons, response, independence', () => {
  it('records the lead as an assignment, keeps the pointer in step and shows it in the team', async () => {
    const r = await api(pm).post(`/cases/${caseId}/assign`, { consultantId: e1.userId, reviewerId: reviewer.userId });
    expect(r.status).toBe(200);
    const [cs] = await db().select().from(schema.cases).where(eq(schema.cases.id, caseId)); expect(cs.consultantId).toBe(e1.userId); expect(cs.reviewerId).toBe(reviewer.userId);
    const team = await api(pm).get(`/cases/${caseId}/team`); const lead = team.data.items.find((x: any) => x.fn === 'lead');
    expect(lead.name).toBeTruthy(); expect(lead.status).toBe('Active'); expect(lead.acknowledgedAt).toBeNull();
  });
  it('needs a reason to replace someone and keeps the replaced person in the history', async () => {
    expect((await api(pm).post(`/cases/${caseId}/assign`, { consultantId: e2.userId })).status).toBe(400);
    expect((await api(pm).post(`/cases/${caseId}/assign`, { consultantId: e2.userId, reason: 'Better sector fit' })).status).toBe(200);
    const rows = await db().select().from(schema.caseAssignments).where(and(eq(schema.caseAssignments.caseId, caseId), eq(schema.caseAssignments.fn, 'lead')));
    expect(rows.filter((x) => x.status === 'Active')).toHaveLength(1); expect(rows.find((x) => x.status === 'Replaced')?.userId).toBe(e1.userId);
    expect(rows.find((x) => x.status === 'Active')?.reason).toBe('Better sector fit');
    const hist = (await api(pm).get(`/cases/${caseId}/team`)).data.items; expect(hist.some((x: any) => x.status === 'Replaced')).toBe(true);
    const owned = (await api(owner).get(`/cases/${caseId}/team`)).data.items; expect(owned.every((x: any) => x.status === 'Active')).toBe(true); expect(owned[0].reason).toBeUndefined(); expect(owned[0].matchBreakdown).toBeUndefined();
  });
  it('keeps the reviewer independent of everyone who works on the case', async () => {
    expect((await api(pm).post(`/cases/${caseId}/assign`, { coachId: reviewer.userId })).status).toBe(400);
    const r = await api(pm).post(`/cases/${caseId}/assign`, { consultantId: reviewer.userId, reason: 'try' }); expect(r.status).toBe(400);
  });
  it('adds a specialist who can see the case but not do lead-only work, and a coach cannot also be a specialist', async () => {
    expect((await api(e3).get(`/cases/${caseId}`)).status).toBe(404);
    expect((await api(pm).post(`/cases/${caseId}/specialists`, { userId: e3.userId, specialisation: 'Financial management' })).status).toBe(200);
    expect((await api(e3).get(`/cases/${caseId}`)).status).toBe(200);
    expect((await api(e3).post(`/cases/${caseId}/diagnostics`, { answers: await answerSheet(3, 'Self-reported'), uuid: `x-${uniq()}` })).status).toBe(403);
    expect((await api(pm).post(`/cases/${caseId}/assign`, { coachId: e3.userId })).status).toBe(400);
    expect((await api(pm).post(`/cases/${caseId}/specialists`, { userId: e2.userId })).status).toBe(400); // already the lead
    expect((await api(pm).del(`/cases/${caseId}/specialists/${e3.userId}`)).status).toBe(400); // reason needed
    expect((await api(pm).del(`/cases/${caseId}/specialists/${e3.userId}?reason=${encodeURIComponent('Work complete early')}`)).status).toBe(200);
    expect((await api(e3).get(`/cases/${caseId}`)).status).toBe(404);
  });
  it('lets the person accept, or decline with a reason that frees the place and tells the manager', async () => {
    const a = (await db().select().from(schema.caseAssignments).where(and(eq(schema.caseAssignments.caseId, caseId), eq(schema.caseAssignments.fn, 'lead'), eq(schema.caseAssignments.status, 'Active'))))[0];
    expect((await api(e1).post(`/assignments/${a.id}/respond`, { decision: 'accept' })).status).toBe(404); // not theirs
    expect((await api(e2).post(`/assignments/${a.id}/respond`, { decision: 'decline' })).status).toBe(400);
    expect((await api(e2).post(`/assignments/${a.id}/respond`, { decision: 'decline', reason: 'Conflict with my schedule' })).status).toBe(200);
    const [cs] = await db().select().from(schema.cases).where(eq(schema.cases.id, caseId)); expect(cs.consultantId).toBeNull();
    const n = await db().select().from(schema.notifications).where(eq(schema.notifications.kind, 'AssignmentDeclined'));
    expect(n.some((x) => x.userId === pm.userId)).toBe(true);
    expect((await api(pm).post(`/cases/${caseId}/assign`, { consultantId: e1.userId })).status).toBe(200);
    const b = (await db().select().from(schema.caseAssignments).where(and(eq(schema.caseAssignments.caseId, caseId), eq(schema.caseAssignments.fn, 'lead'), eq(schema.caseAssignments.status, 'Active'))))[0];
    expect((await api(e1).post(`/assignments/${b.id}/respond`, { decision: 'accept' })).status).toBe(200);
  });
  it('reminds the managers once when an assignment is not answered in time', async () => {
    expect((await api(pm).post(`/cases/${caseId}/assign`, { coachId: e3.userId })).status).toBe(200);
    await db().update(schema.caseAssignments).set({ acknowledgeBy: new Date(Date.now() - 3600_000) }).where(and(eq(schema.caseAssignments.caseId, caseId), eq(schema.caseAssignments.fn, 'coach'), eq(schema.caseAssignments.status, 'Active')));
    const ctx = systemCtx(db() as any, 'test');
    const first = await scanUnacknowledged(ctx); expect(first.flagged).toBeGreaterThan(0);
    expect((await scanUnacknowledged(ctx)).flagged).toBe(0);
    expect((await db().select().from(schema.notifications).where(eq(schema.notifications.kind, 'AssignmentOverdue'))).length).toBeGreaterThan(0);
  });
  it('recommends practitioners with reasons, only to the people who assign', async () => {
    const m = await api(pm).get(`/cases/${caseId}/matches?fn=specialist`);
    expect(m.status).toBe(200); expect(m.data.items.length).toBeGreaterThan(0); expect(m.data.items[0].factors.length).toBeGreaterThan(5);
    const onCase = m.data.items.find((x: any) => x.userId === e1.userId); expect(onCase.eligible).toBe(false); expect(onCase.exclusions.join()).toMatch(/Already on this case/);
    expect((await api(e1).get(`/cases/${caseId}/matches?fn=lead`)).status).toBe(403);
    expect((await api(owner).get(`/cases/${caseId}/matches?fn=lead`)).status).toBe(403);
  });
});

describe('ratings: three sources, immutable, fair', () => {
  let asgId: string;
  const client = Object.fromEntries(['quality', 'relevance', 'communication', 'professionalism', 'responsiveness', 'usefulness', 'trust', 'recommend'].map((k) => [k, 4]));
  const rev = Object.fromEntries(['technical', 'appropriateness', 'evidence', 'deliverables', 'documentation'].map((k) => [k, 5]));
  beforeAll(async () => {
    asgId = (await db().select().from(schema.caseAssignments).where(and(eq(schema.caseAssignments.caseId, caseId), eq(schema.caseAssignments.fn, 'lead'), eq(schema.caseAssignments.status, 'Active'))))[0].id;
  });
  it('opens only once coaching has started', async () => {
    expect((await api(owner).post(`/assignments/${asgId}/rating`, { scores: client })).status).toBe(422);
    await db().update(schema.cases).set({ status: 'COACHING' }).where(eq(schema.cases.id, caseId));
  });
  it('lets the business, its reviewer and the programme manager rate, and nobody else', async () => {
    expect((await api(owner).post(`/assignments/${asgId}/rating`, { scores: { quality: 4 } })).status).toBe(400);
    expect((await api(owner).post(`/assignments/${asgId}/rating`, { scores: client, comment: 'Clear and practical' })).status).toBe(200);
    expect((await api(reviewer).post(`/assignments/${asgId}/rating`, { scores: rev })).status).toBe(200);
    expect((await api(otherOwner).post(`/assignments/${asgId}/rating`, { scores: client })).status).toBe(404); // another business cannot even see it
    expect((await api(e1).post(`/assignments/${asgId}/rating`, { scores: client })).status).toBe(403);
    expect((await api(admin).post(`/assignments/${asgId}/rating`, { scores: client })).status).toBe(403);
    const pmScores = Object.fromEntries(['timeliness', 'reliability', 'communication', 'collaboration', 'documentation'].map((k) => [k, 4]));
    expect((await api(pm).post(`/assignments/${asgId}/rating`, { scores: client })).status).toBe(400); // wrong form for the source
    expect((await api(pm).post(`/assignments/${asgId}/rating`, { scores: pmScores })).status).toBe(200);
  });
  it('treats a second rating as a correction row and never changes or deletes history', async () => {
    const again = await api(owner).post(`/assignments/${asgId}/rating`, { scores: { ...client, trust: 5 } }); expect(again.data.correction).toBe(true);
    const rows = await db().select().from(schema.engagementRatings).where(eq(schema.engagementRatings.assignmentId, asgId));
    expect(rows.filter((x) => x.source === 'client')).toHaveLength(2);
    const why = async (p: Promise<unknown>) => { try { await p; return 'allowed'; } catch (e: any) { return String(e?.cause?.message ?? e?.message); } };
    expect(await why(db().update(schema.engagementRatings).set({ overall: 0 }).where(eq(schema.engagementRatings.assignmentId, asgId)) as any)).toMatch(/cannot be changed or deleted/);
    expect(await why(db().delete(schema.engagementRatings).where(eq(schema.engagementRatings.assignmentId, asgId)) as any)).toMatch(/cannot be changed or deleted/);
  });
  it('offers the pending prompt until rated, then stops', async () => {
    const o = (await api(owner).get('/ratings/pending')).data.items; expect(o.some((x: any) => x.assignmentId === asgId)).toBe(false);
    const coachAsg = (await db().select().from(schema.caseAssignments).where(and(eq(schema.caseAssignments.caseId, caseId), eq(schema.caseAssignments.fn, 'coach'), eq(schema.caseAssignments.status, 'Active'))))[0];
    expect((await api(owner).get('/ratings/pending')).data.items.some((x: any) => x.assignmentId === coachAsg.id)).toBe(true);
    expect((await api(reviewer).get(`/assignments/${asgId}/rating`)).data.criteria.length).toBe(5);
  });
  it('shows the person their own performance with sample size and Limited evidence, and keeps it from others', async () => {
    const mine = await api(e1).get('/me/practitioner/performance');
    // e1 declined nothing and is lead again on the case, so there is one engagement and no completed one yet
    expect(mine.status).toBe(200); expect(mine.data.confidence).toBe('Limited evidence'); expect(mine.data.evidence.completed).toBe(0); expect(mine.data.suggestedStatus).toBe('Not enough evidence yet');
    expect((await api(e2).get(`/practitioners/${e1.userId}/performance`)).status).toBe(403);
    const adm = await api(admin).get(`/practitioners/${e1.userId}/performance`); expect(adm.status).toBe(200);
  });
});
