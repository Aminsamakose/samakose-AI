/**
 * Delivery service levels: a reminder before each coaching session, and escalation of work that has stalled.
 * Scans are idempotent. A reminder is sent once per scheduled time. An escalation is open once until the cause clears.
 * Nothing here changes a case or marks a session Missed: a person records the outcome. The scan only makes sure someone is told.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { notifyUsers } from '@/domain/notify';
import { caseParties } from '@/domain/events';
import { caseScope } from '@/domain/scope';
import { ago, isStalled, outcomeOverdue, reminderDue, SCAN_SLACK_HOURS } from '@/domain/sla';
import { allow, loadRules, need } from './common';
import { managersFor } from './assignments';

const s = schema.coachingSessions, c = schema.cases, e = schema.caseEscalations;
const uniq = (...xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];
/** Audit rows written by the scans themselves are not human activity. */
export const SYSTEM_AUDIT = ['escalation.raised', 'escalation.resolved', 'session.reminded'];

/**
 * Incomplete-diagnostic reminders. Escalates in up to three configurable tiers (hours since the draft
 * was last saved, read fresh from `rules` every scan -- never hard-coded): first to the business, second
 * to the business and the assigned lead/coach, final to both plus the programme's managers. A draft that
 * is worked on again (saveDraft) resets `reminderTier` to 0, so it starts over; one that is submitted or
 * withdrawn is deleted entirely (clearDraft / no draft to scan), so a completed diagnostic never keeps
 * generating these. Idempotent: each tier fires once for the draft currently sitting in `answers`.
 */
export async function scanIncompleteDiagnostics(ctx: Ctx, now = new Date()) {
  const rules = await loadRules(ctx.db);
  const tiers = [Number(rules['diagnostic.reminder_first_hours']), Number(rules['diagnostic.reminder_second_hours']), Number(rules['diagnostic.reminder_final_hours'])];
  const dd = schema.diagnosticDrafts;
  const due = await ctx.db.select().from(dd).where(sql`${dd.reminderTier} < 3`).for('update', { skipLocked: true }).limit(500);
  let sent = 0;
  for (const draft of due) {
    const tier = draft.reminderTier;
    const hours = tiers[tier];
    if (!Number.isFinite(hours)) continue;
    const dueAt = new Date(draft.updatedAt.getTime() + hours * 3_600_000);
    if (now < dueAt) continue;
    const p = await caseParties(ctx, draft.caseId);
    if (!p) { await ctx.db.delete(dd).where(eq(dd.id, draft.id)); continue; }
    const answered = Object.keys(draft.answers as Record<string, unknown>).length;
    await ctx.db.update(dd).set({ reminderTier: tier + 1, lastReminderAt: now }).where(eq(dd.id, draft.id));
    await notifyUsers(ctx, p.ownerIds, { kind: 'DiagnosticIncomplete', title: 'Your Business Diagnostic is Incomplete', body: `You started your diagnostic (${answered} question${answered === 1 ? '' : 's'} answered so far) but have not completed it. Continue where you left off.`, link: '/my-case?tab=diagnostic', email: true });
    if (tier >= 1) await notifyUsers(ctx, uniq(p.consultantId, p.coachId), { kind: 'DiagnosticIncomplete', title: `Diagnostic completion reminder for ${p.c.code}`, body: 'The assigned business has an incomplete diagnostic requiring follow-up.', link: `/cases/${draft.caseId}?tab=diagnostic`, email: true });
    if (tier >= 2) await notifyUsers(ctx, await managersFor(ctx, p.c.programmeId), { kind: 'DiagnosticIncomplete', title: `${p.c.code}'s diagnostic is still incomplete`, body: 'Escalated: no progress since the earlier reminders.', link: `/cases/${draft.caseId}?tab=diagnostic`, email: true });
    await audit(ctx, 'diagnostic.reminded', 'case', draft.caseId, undefined, { tier: tier + 1, answered }, draft.caseId);
    sent++;
  }
  return { reminded: sent };
}

/** One reminder per session to the coach, the lead and the owners. Moving a session clears the mark, so the new time is reminded too. */
export async function remindSessions(ctx: Ctx, now = new Date()) {
  const rules = await loadRules(ctx.db);
  const hours = Number(rules['sla.session_reminder_hours']);
  const until = new Date(now.getTime() + (hours + SCAN_SLACK_HOURS) * 3_600_000);
  const due = await ctx.db.select().from(s).where(and(eq(s.status, 'Scheduled'), sql`${s.reminderSentAt} is null`, sql`${s.scheduledAt} > ${now.toISOString()}`, sql`${s.scheduledAt} <= ${until.toISOString()}`)).for('update', { skipLocked: true }).limit(500);
  let sent = 0;
  for (const x of due) {
    if (!reminderDue(x.scheduledAt, now, hours)) continue;
    await ctx.db.update(s).set({ reminderSentAt: now }).where(eq(s.id, x.id));
    const p = await caseParties(ctx, x.caseId);
    if (!p) continue;
    const when = x.scheduledAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    await notifyUsers(ctx, uniq(x.coachId, p.coachId, p.consultantId), { kind: 'CoachingReminder', title: `Coaching session coming up for ${p.c.code}`, body: `Scheduled for ${when}. Open the brief and prepare.`, link: `/cases/${x.caseId}?tab=coaching`, email: true });
    await notifyUsers(ctx, p.ownerIds, { kind: 'CoachingReminder', title: 'Your coaching session is coming up', body: `Scheduled for ${when}.`, link: '/my-case', email: true });
    await audit(ctx, 'session.reminded', 'session', x.id, undefined, { at: x.scheduledAt.toISOString() }, x.caseId);
    sent++;
  }
  return { reminded: sent };
}

async function raise(ctx: Ctx, caseId: string, kind: 'stalled' | 'session_outcome', refId: string | null, detail: string) {
  const open = await ctx.db.select({ id: e.id }).from(e).where(and(eq(e.caseId, caseId), eq(e.kind, kind), refId ? eq(e.refId, refId) : sql`${e.refId} is null`, sql`${e.resolvedAt} is null`)).limit(1);
  if (open.length) return false;
  await ctx.db.insert(e).values({ caseId, kind, refId, detail });
  await audit(ctx, 'escalation.raised', 'case', caseId, undefined, { kind, detail }, caseId);
  return true;
}

/**
 * Open escalations are raised and cleared here.
 * Stalled: no human action on a case for `sla.stalled_days`. Session outcome: a Scheduled session whose time passed `sla.session_outcome_hours` ago.
 */
export async function scanEscalations(ctx: Ctx, now = new Date()) {
  const rules = await loadRules(ctx.db);
  const days = Number(rules['sla.stalled_days']), hours = Number(rules['sla.session_outcome_hours']);
  let raised = 0, resolved = 0;

  // Stalled cases. Activity is the latest thing a person did on the case; a case with none counts from when it was opened.
  const live = await ctx.db.select({ id: c.id, code: c.code, programmeId: c.programmeId, createdAt: c.createdAt, coachId: c.coachId, consultantId: c.consultantId,
    last: sql<Date | null>`(select max(a.at) from audit_log a where a.case_id = "cases"."id" and a.actor_id is not null and a.action <> all(${sql.raw(`ARRAY[${SYSTEM_AUDIT.map((x) => `'${x}'`).join(',')}]`)}))` })
    .from(c).where(sql`${c.status} <> 'GRADUATED'`);
  for (const k of live) {
    const last = k.last ? new Date(k.last) : k.createdAt;
    const stalled = isStalled(last, now, days);
    if (stalled) {
      if (await raise(ctx, k.id, 'stalled', null, `No action since ${last.toISOString().slice(0, 10)}`)) {
        raised++;
        await notifyUsers(ctx, uniq(...(await managersFor(ctx, k.programmeId)), k.coachId, k.consultantId), { kind: 'CaseStalled', title: `${k.code} has had no activity for ${days} days`, body: `Last action ${ago(last, now)}. Check what is blocking it.`, link: `/cases/${k.id}`, email: true });
      }
    } else {
      const r = await ctx.db.update(e).set({ resolvedAt: now }).where(and(eq(e.caseId, k.id), eq(e.kind, 'stalled'), sql`${e.resolvedAt} is null`)).returning({ id: e.id });
      for (const x of r) { resolved++; await audit(ctx, 'escalation.resolved', 'case', k.id, undefined, { kind: 'stalled', id: x.id }, k.id); }
    }
  }

  // Sessions with no recorded outcome.
  const past = await ctx.db.select().from(s).where(and(eq(s.status, 'Scheduled'), sql`${s.scheduledAt} <= ${new Date(now.getTime() - hours * 3_600_000).toISOString()}`)).limit(1000);
  for (const x of past) {
    if (!outcomeOverdue(x.scheduledAt, now, hours)) continue;
    if (await raise(ctx, x.caseId, 'session_outcome', x.id, `Session ${x.code} was due ${x.scheduledAt.toISOString().slice(0, 10)}`)) {
      raised++;
      const [cs] = await ctx.db.select().from(c).where(eq(c.id, x.caseId)).limit(1);
      await notifyUsers(ctx, uniq(x.coachId, cs?.coachId, cs?.consultantId, ...(await managersFor(ctx, cs?.programmeId ?? null))), { kind: 'SessionOutcomeMissing', title: `Record what happened at ${x.code}`, body: 'The session time has passed. Mark it Held, Missed or Cancelled.', link: `/cases/${x.caseId}?tab=coaching`, email: true });
    }
  }
  // Clear session escalations once the session has an outcome.
  const open = await ctx.db.select({ id: e.id, refId: e.refId, caseId: e.caseId }).from(e).where(and(eq(e.kind, 'session_outcome'), sql`${e.resolvedAt} is null`));
  if (open.length) {
    const sess = await ctx.db.select({ id: s.id, status: s.status }).from(s).where(inArray(s.id, open.map((x) => x.refId!)));
    const still = new Set(sess.filter((x) => x.status === 'Scheduled').map((x) => x.id));
    for (const x of open.filter((o) => !still.has(o.refId!))) {
      await ctx.db.update(e).set({ resolvedAt: now }).where(eq(e.id, x.id)); resolved++;
      await audit(ctx, 'escalation.resolved', 'case', x.caseId, undefined, { kind: 'session_outcome', id: x.id }, x.caseId);
    }
  }
  return { raised, resolved };
}

/** Open escalations within the person's reach, newest first. Programme managers and administrators work them. */
export async function listEscalations(ctx: Ctx) {
  allow(ctx, 'escalations', 'read');
  const u = need(ctx).user;
  const rows = await ctx.db.select({ id: e.id, kind: e.kind, detail: e.detail, flaggedAt: e.flaggedAt, caseId: e.caseId, caseCode: c.code, org: schema.organisations.name })
    .from(e).innerJoin(c, eq(c.id, e.caseId)).innerJoin(schema.organisations, eq(schema.organisations.id, c.orgId))
    .where(and(sql`${e.resolvedAt} is null`, caseScope(u))).orderBy(desc(e.flaggedAt)).limit(200);
  return { items: rows, count: rows.length };
}
