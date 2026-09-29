import { inArray } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { enqueue } from './jobs';

export type Notice = { kind: string; title: string; body?: string; link?: string; email?: boolean };

/** In-app notification for each user, and an email in the outbox when asked. Never notifies the actor about their own action. */
export async function notifyUsers(ctx: Ctx, userIds: string[], n: Notice) {
  const ids = [...new Set(userIds)].filter((id) => id !== ctx.user?.id);
  if (!ids.length) return;
  await ctx.db.insert(schema.notifications).values(ids.map((userId) => ({ userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null })));
  if (n.email) {
    const us = await ctx.db.select({ email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, ids));
    const rows = us.map((u) => ({ to: u.email, subject: n.title, body: `${n.body ?? ''}\n\nOpen: ${process.env.APP_URL ?? ''}${n.link ?? '/'}` }));
    if (rows.length) {
      await ctx.db.insert(schema.outboxEmails).values(rows);
      await enqueue(ctx, 'send_emails', {});
    }
  }
}

/** Email outside the notification flow (invites, password resets). */
export async function queueEmail(ctx: Ctx, to: string, subject: string, body: string) {
  await ctx.db.insert(schema.outboxEmails).values({ to, subject, body });
  await enqueue(ctx, 'send_emails', {});
}
