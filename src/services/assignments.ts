/**
 * Who works on a case. Every placement is a row in case_assignments, so history, reasons and responses are kept.
 * cases.consultantId, coachId and reviewerId remain as a read-through pointer to the active lead, coach and reviewer,
 * and are written only here. Specialists are held in assignments alone.
 * A person decides every assignment. Matching only recommends.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { notifyUsers } from '@/domain/notify';
import { assertCase, caseScope } from '@/domain/scope';
import { assignability } from '@/domain/practitioners';
import { rankMatches, scoreMatch, type Match, type MatchNeed, type MatchProfile } from '@/domain/matching';
import { platformForOrgType } from '@/domain/routing';
import { allow, loadRules, lockCapacityScope, need } from './common';
import { approvedPractitioners, loadFor } from './practitioners';
import { photoUrl } from './auth';

const a = schema.caseAssignments;
const c = schema.cases;
const u = schema.users;
export type Fn = 'lead' | 'specialist' | 'coach' | 'reviewer';
const POINTER: Record<Exclude<Fn, 'specialist'>, 'consultantId' | 'coachId' | 'reviewerId'> = { lead: 'consultantId', coach: 'coachId', reviewer: 'reviewerId' };
const FN_LABEL: Record<Fn, string> = { lead: 'lead expert', specialist: 'specialist expert', coach: 'coach', reviewer: 'reviewer' };

/**
 * The automatic-assignment ceiling for coaches. A coach already carrying this many active cases is
 * never picked by the automatic picker below, however well they otherwise fit -- the case is left for
 * a human to staff instead. This is a ceiling on the picker only: it does not stop an administrator or
 * programme manager from placing a coach manually past it in a genuine exception (place() still warns
 * when a manual placement is at or past the person's own configured maxActive, same as always).
 */
export const COACH_AUTO_ASSIGN_CAP = 50;

/** True when the signed-in expert is the coach on this case, so they can manage its team (lead and
 *  specialists) without needing the full programme-manager/administrator assignment permission. */
export async function isCaseCoach(ctx: Ctx, caseId: string): Promise<boolean> {
  const user = ctx.user;
  if (!user || user.role !== 'EXPERT') return false;
  const [cs] = await ctx.db.select({ coachId: c.coachId }).from(c).where(eq(c.id, caseId)).limit(1);
  return !!cs && cs.coachId === user.id;
}

/**
 * System-driven coach staffing: scores every approved, available coach against the business's platform,
 * sector and region (the same engine a human's "recommended matches" screen uses) and places the best
 * fit, skipping anyone at or past COACH_AUTO_ASSIGN_CAP active cases. Never throws -- if no one
 * qualifies, the case is simply left uncoached for a programme manager or administrator to staff by
 * hand, exactly as it would be without automatic assignment.
 */
export async function autoAssignCoach(ctx: Ctx, caseId: string): Promise<{ placed: boolean; userId?: string; reason?: string }> {
  const [cs] = await ctx.db.select().from(c).where(eq(c.id, caseId)).limit(1);
  if (!cs) return { placed: false, reason: 'Case not found' };
  if (cs.coachId) return { placed: false, reason: 'This case already has a coach' };
  const [org] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, cs.orgId)).limit(1);
  if (!org) return { placed: false, reason: 'Organisation not found' };
  const needs: MatchNeed = { fn: 'coach', platform: platformForOrgType(org.type), sector: org.sector, size: org.size, region: org.region, weakDimensions: [] };
  const [people, conflicts, onCase] = await Promise.all([
    approvedPractitioners(ctx),
    ctx.db.select({ userId: schema.practitionerConflicts.userId }).from(schema.practitionerConflicts).where(eq(schema.practitionerConflicts.orgId, cs.orgId)),
    ctx.db.select({ userId: a.userId }).from(a).where(and(eq(a.caseId, caseId), eq(a.status, 'Active')))
  ]);
  const load = await loadFor(ctx, people.map((x) => x.user.id));
  const scored = people.map((x) => {
    const p: MatchProfile = { userId: x.user.id, name: x.user.name, functions: x.p.functions, specialisations: x.p.specialisations, strengths: x.p.strengths, sectors: x.p.sectors, platforms: x.p.platforms, businessSizes: x.p.businessSizes, regions: x.p.regions, languages: x.p.languages, yearsExperience: x.p.yearsExperience, availability: x.p.availability, maxActive: x.p.maxActive, vettingStatus: x.p.vettingStatus };
    const active = load[x.user.id] ?? 0;
    return scoreMatch(p, needs, { active, conflict: conflicts.some((k) => k.userId === x.user.id), onCase: onCase.some((k) => k.userId === x.user.id) });
  }).filter((m) => m.eligible && m.active < Math.min(m.maxActive, COACH_AUTO_ASSIGN_CAP));
  const best = rankMatches(scored)[0];
  if (!best) return { placed: false, reason: `No eligible, available coach under the ${COACH_AUTO_ASSIGN_CAP}-case automatic-assignment limit` };
  await place(ctx, caseId, { fn: 'coach', userId: best.userId, reason: `Automatically assigned by platform, sector and region fit (score ${best.score})`, match: best, auto: true });
  return { placed: true, userId: best.userId };
}

/**
 * System-driven reviewer staffing. Reviewers carry no practitioner profile -- no sector, platform or
 * region data is collected for them -- so there is nothing to score a "type of business" fit against.
 * This instead picks the active reviewer with the lightest current reviewing load, excluding anyone
 * already working this case in another capacity (the independence rule a human assignment enforces
 * too). Never throws -- an unstaffed reviewer slot is left for a human if no one qualifies.
 */
export async function autoAssignReviewer(ctx: Ctx, caseId: string): Promise<{ placed: boolean; userId?: string; reason?: string }> {
  const [cs] = await ctx.db.select().from(c).where(eq(c.id, caseId)).limit(1);
  if (!cs) return { placed: false, reason: 'Case not found' };
  if (cs.reviewerId) return { placed: false, reason: 'This case already has a reviewer' };
  const onCase = await ctx.db.select({ userId: a.userId }).from(a).where(and(eq(a.caseId, caseId), eq(a.status, 'Active')));
  const onCaseIds = new Set(onCase.map((r) => r.userId));
  const reviewers = await ctx.db.select({ id: u.id }).from(u).where(and(eq(u.role, 'REVIEWER'), eq(u.active, true)));
  const eligible = reviewers.filter((r) => !onCaseIds.has(r.id));
  if (!eligible.length) return { placed: false, reason: 'No eligible reviewer -- independent of everyone already on this case' };
  const loadRows = await ctx.db.execute(sql`select user_id, count(*)::int n from case_assignments where status = 'Active' and function = 'reviewer' and user_id in (${sql.join(eligible.map((r) => sql`${r.id}`), sql`, `)}) group by user_id`);
  const byId = new Map((loadRows.rows as { user_id: string; n: number }[]).map((r) => [r.user_id, r.n]));
  const ranked = eligible.map((r) => ({ id: r.id, n: byId.get(r.id) ?? 0 })).sort((x, y) => x.n - y.n || x.id.localeCompare(y.id));
  const pick = ranked[0];
  await place(ctx, caseId, { fn: 'reviewer', userId: pick.id, reason: 'Automatically assigned: lightest current reviewing load', auto: true });
  return { placed: true, userId: pick.id };
}

/** Independence rules. They hold whoever does the assigning. */
async function independence(ctx: Ctx, caseId: string, fn: Fn, userId: string) {
  const rows = await ctx.db.select({ fn: a.fn, userId: a.userId }).from(a).where(and(eq(a.caseId, caseId), eq(a.status, 'Active')));
  const mine = rows.filter((r) => r.userId === userId && r.fn !== fn);
  if (fn === 'reviewer' && mine.length) throw fieldError({ reviewerId: 'The reviewer must be a different person from everyone who works on the case' });
  if (fn !== 'reviewer' && mine.some((r) => r.fn === 'reviewer')) throw fieldError({ [fn === 'coach' ? 'coachId' : 'consultantId']: 'This person is the reviewer on this case' });
  if (fn === 'coach' && mine.some((r) => r.fn === 'specialist')) throw fieldError({ coachId: 'A specialist on this case cannot also coach it. Remove one role first.' });
  if (fn === 'specialist' && mine.some((r) => r.fn === 'coach')) throw fieldError({ userId: 'The coach on this case cannot also be a specialist. Remove one role first.' });
}

export type Placement = { fn: Fn; userId: string | null; reason?: string | null; specialisation?: string | null; match?: Match | null; auto?: boolean };

/** Places, replaces or removes one person in one capacity. Returns the new assignment id, if any. */
export async function place(ctx: Ctx, caseId: string, p: Placement): Promise<{ id: string | null; warnings: string[] }> {
  // A system-driven placement (auto?: true, used by autoAssignCoach/autoAssignReviewer) is recorded with
  // no assignedBy, even though a human request triggered the case's creation -- no person chose this
  // placement, so none should be credited or blamed for it. That in turn means replacing it later is a
  // first placement from a human's point of view, not a reassignment, so it never demands the "say why
  // you are replacing" justification below -- only overriding another person's actual choice does.
  const actor = p.auto ? null : ctx.user;
  const [cs] = await ctx.db.select().from(c).where(eq(c.id, caseId)).limit(1);
  if (!cs) throw notFound('Case not found');
  const field = p.fn === 'lead' ? 'consultantId' : p.fn === 'coach' ? 'coachId' : p.fn === 'reviewer' ? 'reviewerId' : 'userId';
  // Single-seat functions (lead/coach/reviewer) read the currently Active assignment and then
  // replace it with a new one. Without a lock, two concurrent placements for the same case+fn
  // (two different people accepting/being given the same slot) could both read the same `cur`,
  // both mark it Replaced and both insert a new Active row -- two Active assignments for one
  // seat. `specialist` has no such seat (several specialists can be active at once), so it is
  // excluded, matching the dup-check already below for it.
  if (p.fn !== 'specialist') await lockCapacityScope(ctx, `case-assignment:${caseId}:${p.fn}`);
  const [cur] = p.fn === 'specialist' ? [undefined] : await ctx.db.select().from(a).where(and(eq(a.caseId, caseId), eq(a.fn, p.fn), eq(a.status, 'Active'))).limit(1);
  if (cur && p.userId === cur.userId) return { id: cur.id, warnings: [] };
  const reason = p.reason?.trim() || null;
  if (cur && p.userId && cur.assignedBy && (reason?.length ?? 0) < 5 && ctx.user) throw fieldError({ reason: `Say why you are replacing the ${FN_LABEL[p.fn]}` });
  const warnings: string[] = [];
  let newId: string | null = null;
  if (p.userId) {
    const [person] = await ctx.db.select().from(u).where(eq(u.id, p.userId)).limit(1);
    const need = p.fn === 'reviewer' ? 'REVIEWER' : 'EXPERT';
    if (!person || !person.active || person.role !== need) throw fieldError({ [field]: `Choose an active ${need.toLowerCase()}` });
    if (p.fn !== 'reviewer') {
      const [prof] = await ctx.db.select().from(schema.practitionerProfiles).where(eq(schema.practitionerProfiles.userId, p.userId)).limit(1);
      const ok = assignability(prof ?? null, p.fn);
      if (!ok.ok) throw fieldError({ [field]: ok.reason ?? 'This person cannot take this work' });
      const [conf] = await ctx.db.select().from(schema.practitionerConflicts).where(and(eq(schema.practitionerConflicts.userId, p.userId), eq(schema.practitionerConflicts.orgId, cs.orgId))).limit(1);
      if (conf) throw fieldError({ [field]: 'This person has declared a conflict with this business' });
      const load = (await loadFor(ctx, [p.userId]))[p.userId] ?? 0;
      if (prof.availability === 'Unavailable') warnings.push('This person is marked unavailable');
      if (load >= prof.maxActive) warnings.push(`This person is at capacity (${load} of ${prof.maxActive} active cases)`);
    }
    await independence(ctx, caseId, p.fn, p.userId);
    if (p.fn === 'specialist') {
      // Two concurrent addSpecialist calls for the same case+person could otherwise both pass
      // this "already active?" read before either insert commits, adding the same person twice.
      await lockCapacityScope(ctx, `case-specialist:${caseId}:${p.userId}`);
      const dup = await ctx.db.select({ id: a.id }).from(a).where(and(eq(a.caseId, caseId), eq(a.userId, p.userId), eq(a.status, 'Active'), eq(a.fn, 'specialist'))).limit(1);
      if (dup.length) return { id: dup[0].id, warnings };
      if (cs.consultantId === p.userId) throw fieldError({ userId: 'This person is already the lead expert' });
    }
  }
  const now = new Date();
  if (cur) await ctx.db.update(a).set({ status: 'Replaced', endedAt: now, updatedAt: now }).where(eq(a.id, cur.id));
  if (p.userId) {
    const rules = await loadRules(ctx.db);
    const hours = Number((rules as any)['assignment_ack_hours'] ?? 72);
    const [row] = await ctx.db.insert(a).values({
      caseId, userId: p.userId, fn: p.fn, specialisation: p.specialisation?.trim() || null, assignedBy: actor?.id ?? null, reason, replacesId: cur?.id ?? null,
      matchScore: p.match?.score ?? null, matchBreakdown: p.match ? { factors: p.match.factors, warnings } : warnings.length ? { warnings } : null,
      // The assigner coordinates first, so the work starts at once. The person can still decline, and a reminder goes out if they do not respond.
      acknowledgeBy: p.fn === 'reviewer' ? null : new Date(now.getTime() + hours * 3600_000)
    }).returning({ id: a.id });
    newId = row.id;
  }
  if (p.fn !== 'specialist') await ctx.db.update(c).set({ [POINTER[p.fn]]: p.userId, updatedAt: now }).where(eq(c.id, caseId));
  await audit(ctx, 'assignment.changed', 'case', caseId, { fn: p.fn, userId: cur?.userId ?? null }, { fn: p.fn, userId: p.userId, reason, matchScore: p.match?.score ?? null, warnings }, caseId);
  const notify = p.userId && p.userId !== cur?.userId ? [p.userId] : [];
  if (notify.length) await notifyUsers(ctx, notify, { kind: 'CaseAssigned', title: `You were assigned to ${cs.code} as ${FN_LABEL[p.fn]}`, body: p.fn === 'reviewer' ? undefined : 'Open the case, then accept the assignment or decline it with a reason.', link: `/cases/${caseId}`, email: true });
  if (cur && cur.userId !== p.userId) await notifyUsers(ctx, [cur.userId], { kind: 'CaseAssigned', title: `You are no longer the ${FN_LABEL[p.fn]} on ${cs.code}`, body: reason ?? undefined, link: `/cases/${caseId}`, email: false });
  return { id: newId, warnings };
}

export async function assignCase(ctx: Ctx, id: string, b: { consultantId?: string | null; coachId?: string | null; reviewerId?: string | null; reason?: string | null }) {
  allow(ctx, 'cases', 'assign');
  const user = need(ctx).user;
  const coach = user.role === 'EXPERT' && (await isCaseCoach(ctx, id));
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(user.role) && !coach) throw forbidden('Only administrators, programme managers, or the coach on this case assign people to it');
  // A coach picks the lead expert and specialists for their own case (see addSpecialist), but the coach
  // and reviewer roles stay out of their hands -- those are staffed automatically or by a human manager.
  if (coach && (b.coachId !== undefined || b.reviewerId !== undefined)) throw forbidden('A coach can assign the lead expert on this case, but not the coach or reviewer role');
  const before = await assertCase(ctx, id);
  const warnings: string[] = [];
  for (const [fn, key] of [['lead', 'consultantId'], ['coach', 'coachId'], ['reviewer', 'reviewerId']] as const) {
    if (b[key] === undefined) continue;
    const r = await place(ctx, id, { fn, userId: b[key] ?? null, reason: b.reason });
    warnings.push(...r.warnings);
  }
  await audit(ctx, 'case.assigned', 'case', id, { consultantId: before.consultantId, coachId: before.coachId, reviewerId: before.reviewerId }, { consultantId: b.consultantId ?? before.consultantId, coachId: b.coachId === undefined ? before.coachId : b.coachId, reviewerId: b.reviewerId === undefined ? before.reviewerId : b.reviewerId, reason: b.reason ?? null }, id);
  return { ok: true, warnings };
}

export async function addSpecialist(ctx: Ctx, caseId: string, b: { userId: string; specialisation?: string | null; reason?: string | null; matchScore?: number }) {
  allow(ctx, 'cases', 'assign');
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(need(ctx).user.role) && !(await isCaseCoach(ctx, caseId))) throw forbidden('Only administrators, programme managers, or the coach on this case assign people to it');
  await assertCase(ctx, caseId);
  return place(ctx, caseId, { fn: 'specialist', userId: b.userId, specialisation: b.specialisation, reason: b.reason });
}
export async function removeSpecialist(ctx: Ctx, caseId: string, userId: string, reason?: string | null) {
  allow(ctx, 'cases', 'assign');
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(need(ctx).user.role) && !(await isCaseCoach(ctx, caseId))) throw forbidden();
  await assertCase(ctx, caseId);
  const [row] = await ctx.db.select().from(a).where(and(eq(a.caseId, caseId), eq(a.userId, userId), eq(a.fn, 'specialist'), eq(a.status, 'Active'))).limit(1);
  if (!row) throw notFound('Specialist not found on this case');
  if ((reason ?? '').trim().length < 5) throw fieldError({ reason: 'Say why you are removing this specialist' });
  await ctx.db.update(a).set({ status: 'Replaced', endedAt: new Date(), reason: [row.reason, `Removed: ${reason!.trim()}`].filter(Boolean).join(' | '), updatedAt: new Date() }).where(eq(a.id, row.id));
  await audit(ctx, 'assignment.changed', 'case', caseId, { fn: 'specialist', userId }, { fn: 'specialist', userId: null, reason }, caseId);
  return { ok: true };
}

/** The person accepts the work or declines it with a reason. A decline frees the place and tells the programme manager. */
export async function respond(ctx: Ctx, assignmentId: string, b: { decision: 'accept' | 'decline'; reason?: string | null }) {
  const user = need(ctx).user;
  const [row] = await ctx.db.select().from(a).where(eq(a.id, assignmentId)).limit(1);
  if (!row || row.userId !== user.id || row.status !== 'Active' || row.fn === 'reviewer') throw notFound('Assignment not found');
  const now = new Date();
  if (b.decision === 'accept') {
    await ctx.db.update(a).set({ acknowledgedAt: now, updatedAt: now }).where(eq(a.id, row.id));
    await audit(ctx, 'assignment.accepted', 'case', row.caseId, undefined, { fn: row.fn }, row.caseId);
    return { ok: true, status: 'Active' };
  }
  if ((b.reason ?? '').trim().length < 5) throw fieldError({ reason: 'Say why you are declining, so the programme manager can reassign' });
  await ctx.db.update(a).set({ status: 'Declined', declineReason: b.reason!.trim(), endedAt: now, updatedAt: now }).where(eq(a.id, row.id));
  if (row.fn !== 'specialist') await ctx.db.update(c).set({ [POINTER[row.fn as Exclude<Fn, 'specialist'>]]: null, updatedAt: now }).where(eq(c.id, row.caseId));
  await audit(ctx, 'assignment.declined', 'case', row.caseId, { fn: row.fn, userId: user.id }, { reason: b.reason!.trim() }, row.caseId);
  const [cs] = await ctx.db.select().from(c).where(eq(c.id, row.caseId)).limit(1);
  const managers = await managersFor(ctx, cs.programmeId);
  await notifyUsers(ctx, managers, { kind: 'AssignmentDeclined', title: `${user.name} declined ${cs.code} as ${FN_LABEL[row.fn as Fn]}`, body: b.reason!.trim(), link: `/cases/${row.caseId}`, email: true });
  return { ok: true, status: 'Declined' };
}

/** Administrators, plus the programme managers of the case's programme. */
export async function managersFor(ctx: Ctx, programmeId: string | null): Promise<string[]> {
  const admins = await ctx.db.select({ id: u.id }).from(u).where(and(eq(u.role, 'ADMIN'), eq(u.active, true)));
  const pms = programmeId ? await ctx.db.select({ id: u.id }).from(u).innerJoin(schema.userProgrammes, eq(schema.userProgrammes.userId, u.id)).where(and(eq(schema.userProgrammes.programmeId, programmeId), eq(u.active, true))) : [];
  return [...new Set([...admins, ...pms].map((x) => x.id))];
}

/** Assignments waiting for a response past their time. One reminder, to the people who can reassign. */
export async function scanUnacknowledged(ctx: Ctx) {
  const rows = await ctx.db.select().from(a).where(and(eq(a.status, 'Active'), sql`${a.acknowledgedAt} is null`, sql`${a.acknowledgeBy} < now()`, sql`${a.overdueNotifiedAt} is null`));
  for (const r of rows) {
    await ctx.db.update(a).set({ overdueNotifiedAt: new Date() }).where(eq(a.id, r.id));
    const [cs] = await ctx.db.select().from(c).where(eq(c.id, r.caseId)).limit(1);
    const [who] = await ctx.db.select({ name: u.name }).from(u).where(eq(u.id, r.userId)).limit(1);
    await notifyUsers(ctx, await managersFor(ctx, cs?.programmeId ?? null), { kind: 'AssignmentOverdue', title: `${who?.name ?? 'A practitioner'} has not responded on ${cs?.code ?? 'a case'}`, body: `The ${FN_LABEL[r.fn as Fn]} assignment has been waiting past its response time.`, link: `/cases/${r.caseId}` });
    await audit(ctx, 'assignment.unacknowledged', 'case', r.caseId, undefined, { fn: r.fn, userId: r.userId }, r.caseId);
  }
  return { flagged: rows.length };
}

/** The finished case closes its specialist, lead and coach engagements so they can be rated and counted. */
export async function completeForCase(ctx: Ctx, caseId: string) {
  const now = new Date();
  await ctx.db.update(a).set({ status: 'Completed', endedAt: now, updatedAt: now }).where(and(eq(a.caseId, caseId), eq(a.status, 'Active'), inArray(a.fn, ['lead', 'specialist', 'coach'])));
}

/** The team on a case. Staff see history and match detail. A business sees only the current team and what a practitioner chose to show. */
export async function caseTeam(ctx: Ctx, caseId: string) {
  const user = need(ctx).user;
  await assertCase(ctx, caseId);
  const owner = ['OWNER', 'RESPONDENT', 'FUNDER'].includes(user.role);
  const rows = await ctx.db.select({ a, name: u.name, photoKey: u.photoKey, photoUpdatedAt: u.photoUpdatedAt, uid: u.id, headline: schema.practitionerProfiles.headline, bio: schema.practitionerProfiles.bio, specialisations: schema.practitionerProfiles.specialisations, languages: schema.practitionerProfiles.languages, credentials: schema.practitionerProfiles.credentials })
    .from(a).innerJoin(u, eq(u.id, a.userId)).leftJoin(schema.practitionerProfiles, eq(schema.practitionerProfiles.userId, a.userId))
    .where(and(eq(a.caseId, caseId), owner ? eq(a.status, 'Active') : sql`true`)).orderBy(desc(a.createdAt));
  const ids = rows.map((r) => r.a.id);
  const rated = ids.length ? await ctx.db.select({ assignmentId: schema.engagementRatings.assignmentId, source: schema.engagementRatings.source, raterId: schema.engagementRatings.raterId }).from(schema.engagementRatings).where(inArray(schema.engagementRatings.assignmentId, ids)) : [];
  return {
    items: rows.map((r) => ({
      id: r.a.id, fn: r.a.fn, label: FN_LABEL[r.a.fn as Fn], specialisation: r.a.specialisation, status: r.a.status, userId: r.uid, name: r.name, photoUrl: photoUrl({ id: r.uid, photoKey: r.photoKey, photoUpdatedAt: r.photoUpdatedAt }),
      headline: r.headline, bio: owner ? r.bio : undefined, specialisations: r.specialisations ?? [], languages: r.languages ?? [], credentials: owner ? r.credentials : undefined,
      startedAt: r.a.createdAt, endedAt: r.a.endedAt, acknowledgedAt: r.a.acknowledgedAt, acknowledgeBy: owner ? undefined : r.a.acknowledgeBy,
      mine: r.uid === user.id, rated: rated.some((x) => x.assignmentId === r.a.id && x.raterId === user.id),
      ...(owner ? {} : { reason: r.a.reason, declineReason: r.a.declineReason, matchScore: r.a.matchScore, matchBreakdown: r.a.matchBreakdown, replacesId: r.a.replacesId })
    }))
  };
}

/** Recommended people for one kind of work on one case. Ranked and explained; the programme manager decides. */
export async function matches(ctx: Ctx, caseId: string, q: { fn: 'lead' | 'specialist' | 'coach'; specialisation?: string }) {
  allow(ctx, 'cases', 'assign');
  const user = need(ctx).user;
  const coach = user.role === 'EXPERT' && (await isCaseCoach(ctx, caseId));
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(user.role) && !coach) throw forbidden();
  // A coach may look up candidates for their own case's lead and specialist slots, not for the coach role itself.
  if (coach && q.fn === 'coach') throw forbidden('A coach cannot reassign the coach role on their own case');
  const cs = await assertCase(ctx, caseId);
  const [org] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, cs.orgId)).limit(1);
  const [score] = await ctx.db.select().from(schema.healthScores).where(eq(schema.healthScores.caseId, caseId)).orderBy(desc(schema.healthScores.createdAt)).limit(1);
  const weak = score ? [...(score.dimensions as { dimension: string; value: number }[])].sort((x, y) => x.value - y.value).slice(0, 3).map((d) => d.dimension) : [];
  const needs: MatchNeed = { fn: q.fn, platform: platformForOrgType(org?.type), sector: org?.sector, size: org?.size, region: org?.region, weakDimensions: weak, specialisation: q.specialisation ?? null };
  const [people, conflicts, onCase] = await Promise.all([
    approvedPractitioners(ctx),
    ctx.db.select({ userId: schema.practitionerConflicts.userId }).from(schema.practitionerConflicts).where(eq(schema.practitionerConflicts.orgId, cs.orgId)),
    ctx.db.select({ userId: a.userId }).from(a).where(and(eq(a.caseId, caseId), eq(a.status, 'Active')))
  ]);
  const load = await loadFor(ctx, people.map((x) => x.user.id));
  const out = people.map((x) => {
    const p: MatchProfile = { userId: x.user.id, name: x.user.name, functions: x.p.functions, specialisations: x.p.specialisations, strengths: x.p.strengths, sectors: x.p.sectors, platforms: x.p.platforms, businessSizes: x.p.businessSizes, regions: x.p.regions, languages: x.p.languages, yearsExperience: x.p.yearsExperience, availability: x.p.availability, maxActive: x.p.maxActive, vettingStatus: x.p.vettingStatus };
    const m = scoreMatch(p, needs, { active: load[x.user.id] ?? 0, conflict: conflicts.some((k) => k.userId === x.user.id), onCase: onCase.some((k) => k.userId === x.user.id) });
    return { ...m, photoUrl: photoUrl(x.user), headline: x.p.headline };
  });
  return { need: { ...needs, weakDimensions: weak }, items: rankMatches(out), note: 'A recommendation only. Performance is not scored until practitioners have rated engagements.' };
}

/** Cases a person is working on now. Used before a suspension, a departure or a long absence. */
export async function caseloadOf(ctx: Ctx, userId: string) {
  allow(ctx, 'cases', 'assign');
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(need(ctx).user.role)) throw forbidden();
  const rows = await ctx.db.select({ id: a.id, fn: a.fn, caseId: a.caseId, code: c.code, status: c.status, org: schema.organisations.name })
    .from(a).innerJoin(c, eq(c.id, a.caseId)).innerJoin(schema.organisations, eq(schema.organisations.id, c.orgId))
    .where(and(eq(a.userId, userId), eq(a.status, 'Active'), inArray(a.fn, ['lead', 'coach', 'specialist']), sql`${c.status} <> 'GRADUATED'`, caseScope(need(ctx).user))).orderBy(c.code);
  return { items: rows };
}

/**
 * Hands every active case of one expert to another in one step. Each case follows the normal placement rules
 * (approved, no conflict, independence from the reviewer), so a case that cannot move is reported, never forced.
 */
export async function transferCaseload(ctx: Ctx, fromId: string, b: { toUserId: string; reason: string }) {
  allow(ctx, 'cases', 'assign');
  if (!['ADMIN', 'PROGRAMME_MANAGER'].includes(need(ctx).user.role)) throw forbidden('Only administrators and programme managers move cases');
  if (fromId === b.toUserId) throw fieldError({ toUserId: 'Choose a different person' });
  if ((b.reason ?? '').trim().length < 5) throw fieldError({ reason: 'Say why the cases are moving' });
  const { items } = await caseloadOf(ctx, fromId);
  const moved: string[] = []; const skipped: { code: string; why: string }[] = []; const warnings = new Set<string>();
  for (const it of items) {
    try {
      // PMs see only their programmes' cases; assertCase enforces that for each one.
      await assertCase(ctx, it.caseId);
      const r = await place(ctx, it.caseId, { fn: it.fn as Fn, userId: b.toUserId, reason: `Caseload transfer: ${b.reason.trim()}` });
      r.warnings.forEach((w) => warnings.add(w));
      if (it.fn === 'specialist') await ctx.db.update(a).set({ status: 'Replaced', endedAt: new Date(), reason: `Caseload transfer: ${b.reason.trim()}`, updatedAt: new Date() }).where(eq(a.id, it.id));
      moved.push(it.code);
    } catch (e) { skipped.push({ code: it.code, why: (() => { const d = (e as { details?: Record<string, string> }).details; return d ? Object.values(d)[0]! : String((e as Error).message); })() }); }
  }
  await audit(ctx, 'assignment.caseload_transferred', 'user', fromId, { cases: items.length }, { toUserId: b.toUserId, moved, skipped, reason: b.reason }, fromId);
  return { moved, skipped, warnings: [...warnings] };
}
