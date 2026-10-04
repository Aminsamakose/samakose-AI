/**
 * The message thread on a case. A short, auditable channel between the business and the people working with it,
 * so the record holds what was agreed and nothing has to move to a private chat.
 * Who may write: the business owners and the practitioners on the case (lead, coach, specialists). The reviewer is independent and is not in the thread.
 * Who may read for oversight: administrators and programme managers whose scope includes the case. Their reads are audited.
 * A sent message cannot be edited (database trigger). It is deleted only by the retention job or an erasure request.
 */
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, forbidden, tooMany } from '@/lib/errors';
import { notifyUsers } from '@/domain/notify';
import { assertCase } from '@/domain/scope';
import { caseParties } from '@/domain/events';
import { allow, loadRules, need } from './common';

const m = schema.caseMessages, r = schema.caseMessageReads, u = schema.users;
export const MAX_BODY = 4000;
const HOURLY_LIMIT = 60;

/** The people who may write on the case, and who is notified of a new message. */
export async function participants(ctx: Ctx, caseId: string) {
  const p = await caseParties(ctx, caseId);
  if (!p) return { ids: [] as string[], owners: [] as string[] };
  const ids = [...new Set([...p.ownerIds, p.consultantId, p.coachId, ...p.specialistIds].filter(Boolean) as string[])];
  return { ids, owners: p.ownerIds };
}

async function view(ctx: Ctx, caseId: string, rows: { id: string; senderId: string; body: string; createdAt: Date; name: string | null; role: string | null }[], readAt: Date | null) {
  const me = need(ctx).user.id;
  return rows.map((x) => ({ id: x.id, body: x.body, at: x.createdAt, senderId: x.senderId, sender: x.name ?? 'Former user', senderRole: x.role === 'OWNER' ? 'Business' : 'Practitioner', mine: x.senderId === me, unread: x.senderId !== me && (!readAt || x.createdAt > readAt) }));
}

export async function listMessages(ctx: Ctx, caseId: string) {
  allow(ctx, 'messages', 'read');
  const user = need(ctx).user;
  await assertCase(ctx, caseId);
  const { ids } = await participants(ctx, caseId);
  const member = ids.includes(user.id);
  if (!member && !['ADMIN', 'PROGRAMME_MANAGER'].includes(user.role)) throw forbidden('You are not part of this conversation');
  const rows = await ctx.db.select({ id: m.id, senderId: m.senderId, body: m.body, createdAt: m.createdAt, name: u.name, role: u.role }).from(m).leftJoin(u, eq(u.id, m.senderId)).where(eq(m.caseId, caseId)).orderBy(asc(m.createdAt)).limit(500);
  const [mark] = await ctx.db.select({ readAt: r.readAt }).from(r).where(and(eq(r.caseId, caseId), eq(r.userId, user.id))).limit(1);
  // An oversight read is recorded, because the business and the practitioner should be able to see that a manager looked.
  if (!member) await audit(ctx, 'messages.oversight_read', 'case', caseId, undefined, { count: rows.length }, caseId);
  return { items: await view(ctx, caseId, rows, mark?.readAt ?? null), canWrite: member && allowWrite(user.role), oversight: !member };
}
const allowWrite = (role: string) => ['OWNER', 'EXPERT'].includes(role);

export async function sendMessage(ctx: Ctx, caseId: string, body: string) {
  allow(ctx, 'messages', 'create');
  const user = need(ctx).user;
  await assertCase(ctx, caseId);
  const { ids, owners } = await participants(ctx, caseId);
  if (!ids.includes(user.id)) throw forbidden('You are not part of this conversation');
  const text = body.trim();
  if (!text) throw fieldError({ body: 'Write a message' });
  if (text.length > MAX_BODY) throw fieldError({ body: `Keep it under ${MAX_BODY} characters` });
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(m).where(and(eq(m.senderId, user.id), gt(m.createdAt, sql`now() - interval '1 hour'`)));
  if (n >= HOURLY_LIMIT) throw tooMany('You have sent a lot of messages in the last hour. Try again shortly.');
  const [row] = await ctx.db.insert(m).values({ caseId, senderId: user.id, body: text }).returning({ id: m.id, createdAt: m.createdAt });
  await ctx.db.insert(r).values({ caseId, userId: user.id }).onConflictDoUpdate({ target: [r.caseId, r.userId], set: { readAt: new Date() } });
  // The notice never carries the message text, so email and the bell do not leak it.
  const [cs] = await ctx.db.select({ code: schema.cases.code }).from(schema.cases).where(eq(schema.cases.id, caseId)).limit(1);
  const toOwner = owners.filter((x) => x !== user.id);
  await notifyUsers(ctx, ids.filter((x) => x !== user.id && !owners.includes(x)), { kind: 'CaseMessage', title: `New message on ${cs?.code ?? 'a case'}`, body: `From ${user.name}.`, link: `/cases/${caseId}?tab=messages` });
  await notifyUsers(ctx, toOwner, { kind: 'CaseMessage', title: 'You have a new message about your case', body: `From ${user.name}.`, link: '/my-case', email: true });
  await audit(ctx, 'message.sent', 'case', caseId, undefined, { id: row.id, length: text.length }, caseId);
  return { id: row.id, at: row.createdAt };
}

export async function markRead(ctx: Ctx, caseId: string) {
  allow(ctx, 'messages', 'read');
  const user = need(ctx).user;
  await assertCase(ctx, caseId);
  const { ids } = await participants(ctx, caseId);
  if (!ids.includes(user.id)) return { ok: true };
  await ctx.db.insert(r).values({ caseId, userId: user.id }).onConflictDoUpdate({ target: [r.caseId, r.userId], set: { readAt: new Date() } });
  return { ok: true };
}

/** Unread messages across the person's cases, for the bell and the case list. */
export async function unreadCount(ctx: Ctx) {
  allow(ctx, 'messages', 'read');
  const user = need(ctx).user;
  const rows = await ctx.db.execute(sql`
    select count(*)::int n from case_messages cm
    where cm.sender_id <> ${user.id}
      and (cm.case_id in (select id from cases where consultant_id = ${user.id} or coach_id = ${user.id})
           or cm.case_id in (select case_id from case_assignments where user_id = ${user.id} and status = 'Active')
           or cm.case_id in (select id from cases where org_id = ${user.orgId ?? null}))
      and cm.created_at > coalesce((select read_at from case_message_reads where case_id = cm.case_id and user_id = ${user.id}), 'epoch')`);
  return { unread: Number((rows.rows[0] as { n: number }).n) };
}

/** Messages on a graduated case are deleted after the retention period. Returns how many went. */
export async function purgeExpired(ctx: Ctx, now = new Date()) {
  const rules = await loadRules(ctx.db);
  const months = Number(rules['messaging.retention_months']);
  const cutoff = new Date(now); cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const res = await ctx.db.execute(sql`delete from case_messages where created_at < ${cutoff.toISOString()} and case_id in (select id from cases where status = 'GRADUATED')`);
  const n = res.rowCount ?? 0;
  if (n) await audit(ctx, 'messages.retention_purge', 'case_messages', null, undefined, { deleted: n, olderThan: cutoff.toISOString() });
  return { deleted: n };
}
