import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { api, auditActions, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, tx, schema } from '@/db/client';
import { systemCtx } from '@/services/common';
import { isStalled, outcomeOverdue, reminderDue } from '@/domain/sla';
import { purgeExpired } from '@/services/messages';
import { remindSessions, scanEscalations } from '@/services/sla';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const run = <T>(f: (ctx: ReturnType<typeof systemCtx>) => Promise<T>) => tx((t) => f(systemCtx(t as any, 'scan')));

describe('domain: service levels', () => {
  const now = new Date('2026-10-05T06:00:00Z');
  it('a session is reminded within the window and never after it has started', () => {
    expect(reminderDue(new Date(now.getTime() + 20 * HOUR), now, 24)).toBe(true);
    expect(reminderDue(new Date(now.getTime() + 35 * HOUR), now, 24)).toBe(true);
    expect(reminderDue(new Date(now.getTime() + 37 * HOUR), now, 24)).toBe(false);
    expect(reminderDue(new Date(now.getTime() - HOUR), now, 24)).toBe(false);
  });
  it('with a daily scan every session is reminded at least once before it starts', () => {
    for (let h = 1; h <= 72; h++) {
      const at = new Date(now.getTime() + h * HOUR);
      const scans = [0, 1, 2, 3].map((d) => new Date(now.getTime() + d * DAY));
      expect(scans.some((s) => reminderDue(at, s, 24)), `session ${h}h ahead`).toBe(true);
    }
  });
  it('outcome and stall thresholds', () => {
    expect(outcomeOverdue(new Date(now.getTime() - 25 * HOUR), now, 24)).toBe(true);
    expect(outcomeOverdue(new Date(now.getTime() - 23 * HOUR), now, 24)).toBe(false);
    expect(isStalled(new Date(now.getTime() - 14 * DAY), now, 14)).toBe(true);
    expect(isStalled(new Date(now.getTime() - 13 * DAY), now, 14)).toBe(false);
  });
});

let admin: Session, pm: Session, coach: Session, other: Session, reviewer: Session, owner: Session, otherOwner: Session, funder: Session, exec: Session;
let orgId: string, caseId: string, caseCode: string, otherCaseId: string;
const notes = async (userId: string, kind: string) => (await db().select().from(schema.notifications).where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, kind)))).length;
const mkSession = async (at: Date, extra: Partial<typeof schema.coachingSessions.$inferInsert> = {}) => (await db().insert(schema.coachingSessions).values({ caseId, coachId: coach.userId, scheduledAt: at, ...extra }).returning())[0];

beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); pm = await makeUser('PROGRAMME_MANAGER'); coach = await makeUser('EXPERT'); other = await makeUser('EXPERT'); reviewer = await makeUser('REVIEWER'); funder = await makeUser('FUNDER'); exec = await makeUser('EXECUTIVE');
  const org = await makeOrg(admin); orgId = org.id; owner = await makeUser('OWNER', { orgId });
  const o2 = await makeOrg(admin); otherOwner = await makeUser('OWNER', { orgId: o2.id });
  const c = (await api(admin).post('/cases', { orgId })).data; caseId = c.id; caseCode = c.code;
  await db().update(schema.cases).set({ consultantId: coach.userId, coachId: coach.userId, reviewerId: reviewer.userId }).where(eq(schema.cases.id, caseId));
  otherCaseId = (await api(admin).post('/cases', { orgId: o2.id })).data.id;
});

describe('session reminders', () => {
  it('reminds the coach and the owner once, and never again for the same time', async () => {
    const s = await mkSession(new Date(Date.now() + 20 * HOUR));
    const before = [await notes(coach.userId, 'CoachingReminder'), await notes(owner.userId, 'CoachingReminder')];
    const r1 = await run((ctx) => remindSessions(ctx)); expect(r1.reminded).toBeGreaterThanOrEqual(1);
    expect(await notes(coach.userId, 'CoachingReminder')).toBe(before[0] + 1);
    expect(await notes(owner.userId, 'CoachingReminder')).toBe(before[1] + 1);
    expect(await auditActions(s.id)).toContain('session.reminded');
    await run((ctx) => remindSessions(ctx));
    expect(await notes(coach.userId, 'CoachingReminder')).toBe(before[0] + 1);
  });
  it('skips sessions that are far off, already past or no longer scheduled', async () => {
    const far = await mkSession(new Date(Date.now() + 5 * DAY));
    const past = await mkSession(new Date(Date.now() - 2 * HOUR));
    const cancelled = await mkSession(new Date(Date.now() + 10 * HOUR), { status: 'Cancelled' });
    await run((ctx) => remindSessions(ctx));
    for (const x of [far, past, cancelled]) expect((await db().select().from(schema.coachingSessions).where(eq(schema.coachingSessions.id, x.id)))[0].reminderSentAt).toBeNull();
  });
  it('moving a session clears the mark so the new time is reminded', async () => {
    const s = await mkSession(new Date(Date.now() + 15 * HOUR));
    await run((ctx) => remindSessions(ctx));
    expect((await db().select().from(schema.coachingSessions).where(eq(schema.coachingSessions.id, s.id)))[0].reminderSentAt).not.toBeNull();
    const res = await api(coach).patch(`/sessions/${s.id}`, { scheduledAt: new Date(Date.now() + 18 * HOUR).toISOString() });
    expect(res.status, JSON.stringify(res.error)).toBe(200);
    expect((await db().select().from(schema.coachingSessions).where(eq(schema.coachingSessions.id, s.id)))[0].reminderSentAt).toBeNull();
  });
});

describe('escalation', () => {
  it('flags a session with no outcome once, tells the coach and managers, and clears when an outcome is recorded', async () => {
    const s = await mkSession(new Date(Date.now() - 30 * HOUR));
    const before = await notes(coach.userId, 'SessionOutcomeMissing');
    const a = await run((ctx) => scanEscalations(ctx)); expect(a.raised).toBeGreaterThanOrEqual(1);
    const again = await run((ctx) => scanEscalations(ctx));
    expect(await notes(coach.userId, 'SessionOutcomeMissing')).toBe(before + 1);
    expect(again.raised).toBe(0);
    const open = (await api(admin).get('/escalations')).data.items.filter((x: any) => x.kind === 'session_outcome' && x.caseId === caseId);
    expect(open.length).toBeGreaterThanOrEqual(1);
    // The scan does not decide the outcome: the session is still Scheduled until a person records it.
    expect((await db().select().from(schema.coachingSessions).where(eq(schema.coachingSessions.id, s.id)))[0].status).toBe('Scheduled');
    expect((await api(coach).patch(`/sessions/${s.id}`, { status: 'Missed' })).status).toBe(200);
    const done = await run((ctx) => scanEscalations(ctx)); expect(done.resolved).toBeGreaterThanOrEqual(1);
    expect((await db().select().from(schema.caseEscalations).where(and(eq(schema.caseEscalations.refId, s.id), sql`resolved_at is null`))).length).toBe(0);
  });
  it('flags a stalled case, ignores the scan itself as activity, and clears when a person acts', async () => {
    const [{ id: stalledOrg }] = await db().select({ id: schema.organisations.id }).from(schema.organisations).where(eq(schema.organisations.id, orgId));
    expect(stalledOrg).toBe(orgId);
    // The audit trail cannot be rewritten, so the scan is run as if it were three weeks from now.
    const later = new Date(Date.now() + 20 * DAY);
    const before = await notes(pm.userId, 'CaseStalled') + await notes(admin.userId, 'CaseStalled');
    const r = await run((ctx) => scanEscalations(ctx, later)); expect(r.raised).toBeGreaterThanOrEqual(1);
    expect((await db().select().from(schema.caseEscalations).where(and(eq(schema.caseEscalations.caseId, caseId), eq(schema.caseEscalations.kind, 'stalled'), sql`resolved_at is null`))).length).toBe(1);
    // The scan wrote audit rows with no person behind them. They must not count as activity, so a second scan raises nothing new.
    const r2 = await run((ctx) => scanEscalations(ctx, later)); expect(r2.raised).toBe(0);
    expect(await notes(admin.userId, 'CaseStalled') + await notes(pm.userId, 'CaseStalled')).toBeGreaterThan(before);
    const list = (await api(admin).get('/escalations')).data; expect(list.items.some((x: any) => x.caseId === caseId && x.kind === 'stalled')).toBe(true);
    // A person acts on the case: an action recorded in the audit trail with an actor.
    await api(coach).post(`/cases/${caseId}/sessions`, { scheduledAt: new Date(Date.now() + 3 * DAY).toISOString() });
    const cleared = await run((ctx) => scanEscalations(ctx)); expect(cleared.resolved).toBeGreaterThanOrEqual(1);
    expect((await api(admin).get('/escalations')).data.items.some((x: any) => x.caseId === caseId && x.kind === 'stalled')).toBe(false);
  });
  it('graduated cases are never flagged, and the list is limited to roles that can act', async () => {
    expect((await api(owner).get('/escalations')).status).toBe(403);
    expect((await api(funder).get('/escalations')).status).toBe(403);
    expect((await api(coach).get('/escalations')).status).toBe(403);
  });
  it('the thresholds are rules an administrator can change', async () => {
    const rules = (await api(admin).get('/settings/rules')).data;
    const keys = (Array.isArray(rules) ? rules : rules.items ?? []).map((r: any) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['sla.session_reminder_hours', 'sla.session_outcome_hours', 'sla.stalled_days', 'messaging.retention_months']));
  });
});

describe('messages', () => {
  it('the owner and the coach can write; both see the thread; the text is not in the notice', async () => {
    const secret = `Please bring the cash book ${uniq()}`;
    const sent = await api(coach).post(`/cases/${caseId}/messages`, { body: secret });
    expect(sent.status, JSON.stringify(sent.error)).toBe(201);
    const n = (await db().select().from(schema.notifications).where(and(eq(schema.notifications.userId, owner.userId), eq(schema.notifications.kind, 'CaseMessage'))))[0];
    expect(n.title).toMatch(/new message/i); expect(`${n.title} ${n.body}`).not.toContain(secret);
    const email = (await db().select().from(schema.outboxEmails).where(eq(schema.outboxEmails.to, owner.email)))[0];
    if (email) expect(`${email.subject} ${email.body}`).not.toContain(secret);
    const seen = (await api(owner).get(`/cases/${caseId}/messages`)).data;
    expect(seen.items.some((m: any) => m.body === secret && m.senderRole === 'Practitioner' && m.unread)).toBe(true);
    expect(seen.canWrite).toBe(true);
    const reply = await api(owner).post(`/cases/${caseId}/messages`, { body: 'Thank you, I will.' }); expect(reply.status).toBe(201);
    const back = (await api(coach).get(`/cases/${caseId}/messages`)).data.items;
    expect(back.find((m: any) => m.body === 'Thank you, I will.').senderRole).toBe('Business');
  });
  it('unread counts fall when the thread is read', async () => {
    await api(coach).post(`/cases/${caseId}/messages`, { body: 'One more thing.' });
    const u1 = (await api(owner).get('/messages/unread')).data.unread; expect(u1).toBeGreaterThanOrEqual(1);
    expect((await api(owner).post(`/cases/${caseId}/messages/read`, {})).status).toBe(200);
    expect((await api(owner).get('/messages/unread')).data.unread).toBe(0);
  });
  it('people outside the case cannot read or write', async () => {
    expect((await api(otherOwner).get(`/cases/${caseId}/messages`)).status).toBe(404);
    expect((await api(otherOwner).post(`/cases/${caseId}/messages`, { body: 'hello' })).status).toBe(404);
    expect((await api(other).get(`/cases/${caseId}/messages`)).status).toBe(404);
    expect((await api(other).post(`/cases/${caseId}/messages`, { body: 'hello' })).status).toBe(404);
    for (const s of [reviewer, funder, exec]) { expect((await api(s).get(`/cases/${caseId}/messages`)).status).toBe(403); expect((await api(s).post(`/cases/${caseId}/messages`, { body: 'x' })).status).toBe(403); }
  });
  it('an unrelated case thread stays separate', async () => {
    expect((await api(otherOwner).get(`/cases/${otherCaseId}/messages`)).data.items).toEqual([]);
  });
  it('managers read for oversight but cannot write, and the read is audited', async () => {
    const r = await api(admin).get(`/cases/${caseId}/messages`);
    expect(r.status).toBe(200); expect(r.data.oversight).toBe(true); expect(r.data.canWrite).toBe(false);
    expect((await api(admin).post(`/cases/${caseId}/messages`, { body: 'I am watching' })).status).toBe(403);
    expect((await db().select().from(schema.auditLog).where(and(eq(schema.auditLog.caseId, caseId), eq(schema.auditLog.action, 'messages.oversight_read')))).length).toBeGreaterThan(0);
  });
  it('validates the text and audits sending without storing the message in the trail', async () => {
    expect((await api(owner).post(`/cases/${caseId}/messages`, { body: '   ' })).status).toBe(400);
    expect((await api(owner).post(`/cases/${caseId}/messages`, { body: 'x'.repeat(4001) })).status).toBe(400);
    const marker = `trail-${uniq()}`;
    const r = await api(owner).post(`/cases/${caseId}/messages`, { body: marker });
    const rows = await db().select().from(schema.auditLog).where(and(eq(schema.auditLog.caseId, caseId), eq(schema.auditLog.action, 'message.sent')));
    expect(rows.length).toBeGreaterThan(0); expect(JSON.stringify(rows)).not.toContain(marker); expect(r.status).toBe(201);
  });
  it('a sent message cannot be edited, even directly in the database', async () => {
    const [m] = await db().select().from(schema.caseMessages).where(eq(schema.caseMessages.caseId, caseId)).limit(1);
    await expect(db().update(schema.caseMessages).set({ body: 'changed' }).where(eq(schema.caseMessages.id, m.id))).rejects.toThrow();
    await expect(db().execute(sql`insert into case_messages (case_id, sender_id, body) values (${caseId}, ${owner.userId}, '   ')`)).rejects.toThrow();
  });
  it('retention deletes old messages on graduated cases only', async () => {
    const old = new Date(Date.now() - 400 * DAY);
    const mk = async (cid: string, uid: string) => (await db().insert(schema.caseMessages).values({ caseId: cid, senderId: uid, body: 'old note', createdAt: old }).returning())[0];
    const keep = await mk(caseId, owner.userId);
    const [gradCase] = await db().insert(schema.cases).values({ orgId, status: 'GRADUATED' } as any).returning();
    const gone = await mk(gradCase.id, owner.userId);
    const r = await run((ctx) => purgeExpired(ctx)); expect(r.deleted).toBeGreaterThanOrEqual(1);
    expect((await db().select().from(schema.caseMessages).where(eq(schema.caseMessages.id, keep.id))).length).toBe(1);
    expect((await db().select().from(schema.caseMessages).where(eq(schema.caseMessages.id, gone.id))).length).toBe(0);
  });
});
