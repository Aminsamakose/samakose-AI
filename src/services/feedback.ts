import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/session';
import { fieldError, forbidden, notFound, tooMany, unprocessable } from '@/lib/errors';
import { assertCase } from '@/domain/scope';
import { orderBy, search, countOf, type ListQuery } from '@/api/list';
import { allow, need, respondList } from './common';

/** Feedback from signed-in people: UAT notes about a screen, and the owner's view of whether a score matched their business.
 *  It is read only by the administrator (and executives), and it never reaches scoring, diagnosis or any report. */
export const FEEDBACK_STATUSES = ['New', 'Triaged', 'Resolved', 'Not an issue'] as const;
export const ACCURACY = ['accurate', 'partly', 'not_accurate'] as const;
const DAILY_LIMIT = 20;

const clean = (s: string | null | undefined, max: number) => { const v = (s ?? '').replace(/\s+/g, ' ').trim(); return v ? v.slice(0, max) : null; };
const safePath = (p: string | null | undefined) => { const v = (p ?? '').trim(); return v.startsWith('/') && !v.startsWith('//') ? v.split('?')[0].slice(0, 200) : null; };

async function limit(ctx: Ctx) {
  const c = need(ctx);
  if ((await rateLimit('feedback:' + c.user.id, 24 * 3600)) > DAILY_LIMIT) throw tooMany('You have sent a lot of feedback today. Please try again tomorrow.');
  return c;
}

/** Feedback about a screen. Anyone signed in may send it, whatever their role. */
export async function submitAppFeedback(ctx: Ctx, b: { page?: string | null; rating?: number | null; message: string }) {
  const c = await limit(ctx);
  const message = clean(b.message, 2000);
  if (!message || message.length < 5) throw fieldError({ message: 'Tell us a little more: what you tried and what happened, or what should change' });
  const [r] = await ctx.db.insert(schema.feedback).values({ userId: c.user.id, role: c.user.role, orgId: c.user.orgId ?? null, kind: 'app', page: safePath(b.page), rating: b.rating ?? null, message }).returning({ id: schema.feedback.id });
  return { id: r.id };
}

/** The owner's view of their latest score. One answer per person per score; sending again updates it. */
export async function submitResultFeedback(ctx: Ctx, b: { caseId: string; accuracy: (typeof ACCURACY)[number]; rating?: number | null; message?: string | null }) {
  const c = await limit(ctx);
  if (c.user.role !== 'OWNER') throw forbidden('Only a business owner can give feedback on their own score');
  const cs = await assertCase(ctx, b.caseId);
  const [score] = await ctx.db.select({ id: schema.healthScores.id }).from(schema.healthScores).where(eq(schema.healthScores.caseId, cs.id)).orderBy(desc(schema.healthScores.createdAt)).limit(1);
  if (!score) throw unprocessable('There is no score to give feedback on yet');
  const message = clean(b.message, 2000);
  const set = { accuracy: b.accuracy, rating: b.rating ?? null, message, status: 'New', updatedAt: new Date() };
  await ctx.db.insert(schema.feedback).values({ userId: c.user.id, role: c.user.role, orgId: cs.orgId, kind: 'result', accuracy: b.accuracy, rating: b.rating ?? null, message, caseId: cs.id, healthScoreId: score.id })
    .onConflictDoUpdate({ target: [schema.feedback.userId, schema.feedback.healthScoreId], targetWhere: sql`${schema.feedback.kind} = 'result'`, set });
  return { ok: true };
}

export async function myResultFeedback(ctx: Ctx, caseId: string) {
  const c = need(ctx);
  const cs = await assertCase(ctx, caseId);
  const [score] = await ctx.db.select({ id: schema.healthScores.id }).from(schema.healthScores).where(eq(schema.healthScores.caseId, cs.id)).orderBy(desc(schema.healthScores.createdAt)).limit(1);
  if (!score) return { scored: false as const, given: null };
  const [f] = await ctx.db.select({ accuracy: schema.feedback.accuracy, rating: schema.feedback.rating, message: schema.feedback.message }).from(schema.feedback)
    .where(and(eq(schema.feedback.userId, c.user.id), eq(schema.feedback.healthScoreId, score.id), eq(schema.feedback.kind, 'result'))).limit(1);
  return { scored: true as const, given: f ?? null };
}

export async function listFeedback(ctx: Ctx, q: ListQuery & { status?: string; kind?: string }) {
  allow(ctx, 'feedback', 'read');
  const t = schema.feedback; const u = schema.users;
  const where = and(search(q.q, [t.message, t.page, u.name, u.email]), q.status ? eq(t.status, q.status) : undefined, q.kind ? eq(t.kind, q.kind) : undefined);
  const cols = { id: t.id, createdAt: t.createdAt, kind: t.kind, role: t.role, page: t.page, rating: t.rating, accuracy: t.accuracy, message: t.message, status: t.status, adminNote: t.adminNote, caseId: t.caseId, name: u.name, email: u.email };
  return respondList(ctx, 'feedback', q,
    (limit, off) => ctx.db.select(cols).from(t).innerJoin(u, eq(u.id, t.userId)).where(where).orderBy(orderBy(q, { createdAt: t.createdAt, status: t.status, rating: t.rating }, t.id)).limit(limit).offset(off),
    async () => Number((await ctx.db.select({ n: countOf }).from(t).innerJoin(u, eq(u.id, t.userId)).where(where))[0].n),
    { filename: 'feedback.csv', columns: [{ key: 'createdAt', label: 'Received' }, { key: 'kind', label: 'Type' }, { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'page', label: 'Page' }, { key: 'rating', label: 'Rating' }, { key: 'accuracy', label: 'Score matched' }, { key: 'message', label: 'Message' }, { key: 'status', label: 'Status' }, { key: 'adminNote', label: 'Note' }] });
}

export async function feedbackSummary(ctx: Ctx) {
  allow(ctx, 'feedback', 'read');
  const t = schema.feedback;
  const status = await ctx.db.select({ k: t.status, n: sql<number>`count(*)::int` }).from(t).groupBy(t.status);
  const acc = await ctx.db.select({ k: t.accuracy, n: sql<number>`count(*)::int` }).from(t).where(eq(t.kind, 'result')).groupBy(t.accuracy);
  const [avg] = await ctx.db.select({ a: sql<string | null>`round(avg(${t.rating})::numeric, 1)::text`, n: sql<number>`count(${t.rating})::int` }).from(t).where(eq(t.kind, 'app'));
  return {
    byStatus: Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, status.find((x) => x.k === s)?.n ?? 0])),
    scoreMatched: Object.fromEntries(ACCURACY.map((s) => [s, acc.find((x) => x.k === s)?.n ?? 0])),
    averageRating: avg.a ? Number(avg.a) : null, ratings: avg.n
  };
}

export async function setFeedbackStatus(ctx: Ctx, id: string, b: { status: (typeof FEEDBACK_STATUSES)[number]; note?: string | null }) {
  allow(ctx, 'feedback', 'edit');
  const t = schema.feedback;
  const [before] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!before) throw notFound('Feedback not found');
  const note = b.note === undefined ? before.adminNote : clean(b.note, 1000);
  const [after] = await ctx.db.update(t).set({ status: b.status, adminNote: note, handledBy: b.status === 'New' ? null : ctx.user!.id, handledAt: b.status === 'New' ? null : new Date(), updatedAt: new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'feedback.status', 'feedback', id, { status: before.status, note: before.adminNote }, { status: b.status, note });
  return { id: after.id, status: after.status, adminNote: after.adminNote };
}
