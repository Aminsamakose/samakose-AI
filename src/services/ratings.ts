/**
 * Ratings of practitioner engagements. Three sources rate separately (the business, the reviewer, the programme manager)
 * and the platform adds what it can measure itself. Ratings are append-only: a correction is a new row.
 * Nothing here changes a score, a prescription or a certificate, and nothing here decides a person's standing.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertCase } from '@/domain/scope';
import { CRITERIA, performance, scoreRating, type RatingSource, type RatingRow } from '@/domain/ratings';
import { CASE_STATES } from '@/db/schema';
import { allow, need } from './common';
import { photoUrl } from './auth';

const a = schema.caseAssignments, r = schema.engagementRatings, u = schema.users;
const SOURCE_BY_ROLE: Record<string, RatingSource> = { OWNER: 'client', REVIEWER: 'reviewer', PROGRAMME_MANAGER: 'programme_manager' };
const RATE_FROM = CASE_STATES.indexOf('COACHING');

async function context(ctx: Ctx, assignmentId: string) {
  const [row] = await ctx.db.select().from(a).where(eq(a.id, assignmentId)).limit(1);
  if (!row || row.fn === 'reviewer') throw notFound('Engagement not found');
  const cs = await assertCase(ctx, row.caseId); // out of scope reads as not found
  return { row, cs };
}
const sourceFor = (ctx: Ctx): RatingSource => {
  const s = SOURCE_BY_ROLE[need(ctx).user.role];
  if (!s) throw forbidden('Your role does not rate engagements');
  return s;
};

export async function ratingForm(ctx: Ctx, assignmentId: string) {
  allow(ctx, 'ratings', 'create');
  const { row, cs } = await context(ctx, assignmentId);
  const source = sourceFor(ctx);
  const [who] = await ctx.db.select({ name: u.name }).from(u).where(eq(u.id, row.userId)).limit(1);
  const prior = await ctx.db.select().from(r).where(and(eq(r.assignmentId, assignmentId), eq(r.raterId, need(ctx).user.id))).orderBy(desc(r.createdAt)).limit(1);
  return { assignmentId, practitioner: who?.name, fn: row.fn, caseCode: cs.code, source, criteria: CRITERIA[source], canRate: canRate(ctx, row, cs), previous: prior[0] ? { scores: prior[0].scores, comment: prior[0].comment, at: prior[0].createdAt } : null };
}
function canRate(ctx: Ctx, row: typeof a.$inferSelect, cs: typeof schema.cases.$inferSelect): { ok: boolean; reason?: string } {
  const user = need(ctx).user;
  if (row.userId === user.id) return { ok: false, reason: 'You cannot rate your own work' };
  if (user.role === 'REVIEWER' && cs.reviewerId !== user.id) return { ok: false, reason: 'Only the reviewer on this case can rate it as the reviewer' };
  if (user.role === 'OWNER' && user.orgId !== cs.orgId) return { ok: false, reason: 'Only the business can rate its own engagement' };
  if (!['Active', 'Completed'].includes(row.status)) return { ok: false, reason: 'This engagement has ended without completing' };
  if (CASE_STATES.indexOf(cs.status) < RATE_FROM && row.status !== 'Completed') return { ok: false, reason: 'Ratings open once coaching has started, so there is real work to rate' };
  return { ok: true };
}

export async function rate(ctx: Ctx, assignmentId: string, b: { scores: Record<string, unknown>; comment?: string | null }) {
  allow(ctx, 'ratings', 'create');
  const user = need(ctx).user;
  const { row, cs } = await context(ctx, assignmentId);
  const source = sourceFor(ctx);
  const ok = canRate(ctx, row, cs);
  if (!ok.ok) throw unprocessable(ok.reason!);
  const s = scoreRating(source, b.scores ?? {});
  if (!s.ok) throw fieldError({ scores: s.error });
  const [prev] = await ctx.db.select({ id: r.id }).from(r).where(and(eq(r.assignmentId, assignmentId), eq(r.raterId, user.id), eq(r.source, source))).orderBy(desc(r.createdAt)).limit(1);
  const [x] = await ctx.db.insert(r).values({ assignmentId, source, raterId: user.id, scores: s.clean, overall: s.overall, comment: b.comment?.trim().slice(0, 1000) || null, supersedesId: prev?.id ?? null }).returning({ id: r.id });
  await audit(ctx, 'rating.added', 'case', row.caseId, undefined, { assignmentId, source, overall: s.overall, correction: !!prev }, row.caseId);
  return { id: x.id, overall: s.overall, correction: !!prev };
}

/** Engagements this person can rate and has not yet rated, for a prompt on their dashboard. */
export async function pending(ctx: Ctx) {
  const user = need(ctx).user;
  const source = SOURCE_BY_ROLE[user.role];
  if (!source) return { items: [] };
  const rows = await ctx.db.select({ a, code: schema.cases.code, name: u.name, caseStatus: schema.cases.status, orgId: schema.cases.orgId, reviewerId: schema.cases.reviewerId, programmeId: schema.cases.programmeId, photoKey: u.photoKey, photoUpdatedAt: u.photoUpdatedAt, uid: u.id })
    .from(a).innerJoin(schema.cases, eq(schema.cases.id, a.caseId)).innerJoin(u, eq(u.id, a.userId)).where(and(inArray(a.status, ['Active', 'Completed']), inArray(a.fn, ['lead', 'specialist', 'coach'])));
  const mine = rows.filter((x) => (user.role === 'OWNER' ? x.orgId === user.orgId : user.role === 'REVIEWER' ? x.reviewerId === user.id : !!x.programmeId && user.programmeIds.includes(x.programmeId))
    && (a.status && (CASE_STATES.indexOf(x.caseStatus) >= RATE_FROM || x.a.status === 'Completed')));
  const done = mine.length ? await ctx.db.select({ assignmentId: r.assignmentId }).from(r).where(and(eq(r.raterId, user.id), inArray(r.assignmentId, mine.map((x) => x.a.id)))) : [];
  const set = new Set(done.map((d) => d.assignmentId));
  return { items: mine.filter((x) => !set.has(x.a.id)).map((x) => ({ assignmentId: x.a.id, caseCode: x.code, caseId: x.a.caseId, practitioner: x.name, photoUrl: photoUrl({ id: x.uid, photoKey: x.photoKey, photoUpdatedAt: x.photoUpdatedAt }), fn: x.a.fn })) };
}

/** A practitioner's performance with its evidence. Visible to the person and to administrators. Executives see the figures without comments. */
export async function performanceFor(ctx: Ctx, rawId: string) {
  const user = need(ctx).user;
  const id = rawId === 'me' ? user.id : rawId;
  if (!(user.id === id || ['ADMIN', 'EXECUTIVE'].includes(user.role))) throw forbidden();
  const asgs = await ctx.db.select().from(a).where(and(eq(a.userId, id), inArray(a.fn, ['lead', 'specialist', 'coach'])));
  const ids = asgs.map((x) => x.id);
  const rows = ids.length ? await ctx.db.select().from(r).where(inArray(r.assignmentId, ids)).orderBy(desc(r.createdAt)) : [];
  // The latest row per rater and source is the effective rating.
  const seen = new Set<string>(); const latest = rows.filter((x) => { const k = `${x.assignmentId}|${x.raterId}|${x.source}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const byAsg = ids.map((i) => latest.filter((x) => x.assignmentId === i).map((x) => ({ source: x.source as RatingSource, scores: x.scores })) as RatingRow[]);
  const completed = asgs.filter((x) => x.status === 'Completed').length;
  const caseIds = [...new Set(asgs.map((x) => x.caseId))];
  const sys = { sessionsHeld: 0, sessionsMissed: 0, actionsDone: 0, actionsTotal: 0, scoreChange: null as number | null };
  if (caseIds.length) {
    const ss = await ctx.db.execute(sql`select count(*) filter (where status='Held')::int held, count(*) filter (where status='Missed')::int missed from coaching_sessions where coach_id = ${id}`);
    const ac = await ctx.db.execute(sql`select count(*) filter (where status='Done')::int done, count(*)::int total from actions where assignee_id = ${id}`);
    const sc = await ctx.db.execute(sql`select avg(last.overall - first.overall)::float change from (select distinct case_id from health_scores where case_id in (${sql.join(caseIds.map((c) => sql`${c}`), sql`, `)})) k
      join lateral (select overall from health_scores where case_id = k.case_id order by created_at asc limit 1) first on true join lateral (select overall from health_scores where case_id = k.case_id order by created_at desc limit 1) last on true
      where (select count(*) from health_scores where case_id = k.case_id) > 1`);
    const s1 = ss.rows[0] as any, a1 = ac.rows[0] as any, c1 = sc.rows[0] as any;
    sys.sessionsHeld = s1?.held ?? 0; sys.sessionsMissed = s1?.missed ?? 0; sys.actionsDone = a1?.done ?? 0; sys.actionsTotal = a1?.total ?? 0; sys.scoreChange = c1?.change ?? null;
  }
  const perf = performance(byAsg, sys, completed);
  const comments = user.role === 'ADMIN' || user.id === id ? latest.filter((x) => x.comment).slice(0, 20).map((x) => ({ source: x.source, overall: x.overall, comment: x.comment, at: x.createdAt })) : [];
  return { ...perf, engagements: { total: asgs.length, completed, active: asgs.filter((x) => x.status === 'Active').length }, system: sys, comments };
}
