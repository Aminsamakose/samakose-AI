import { and, eq, gte } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { sha256 } from '@/lib/crypto';
import { env } from '@/lib/env';
import { sendMail } from '@/lib/mail';
import { notFound } from '@/lib/errors';
import { orderBy, search, countOf, type ListQuery } from '@/api/list';
import { allow, respondList } from './common';

export type InquiryInput = {
  kind: 'contact' | 'demo' | 'newsletter'; name?: string | null; email: string; organisation?: string | null; phone?: string | null;
  interest?: string | null; message?: string | null; consent: true; source?: string | null; website?: string | null;
};

/**
 * Stores one website enquiry. A filled honeypot field means a bot: we answer success and store nothing,
 * so the bot learns nothing. Repeat submissions from the same address within a day are collapsed.
 */
export async function submitInquiry(ctx: Ctx, input: InquiryInput) {
  if (input.website) return { received: true };
  const email = input.email.toLowerCase();
  const since = new Date(Date.now() - 24 * 3600_000);
  const t = schema.inquiries;
  const [dup] = await ctx.db.select({ id: t.id }).from(t).where(and(eq(t.email, email), eq(t.kind, input.kind), gte(t.createdAt, since))).limit(1);
  if (dup) return { received: true };
  await ctx.db.insert(t).values({
    kind: input.kind, name: input.name ?? null, email, organisation: input.organisation ?? null, phone: input.phone ?? null,
    interest: input.interest ?? null, message: input.message ?? null, consent: true, source: input.source ?? null,
    ipHash: ctx.ip && ctx.ip !== 'direct' && ctx.ip !== 'unknown' ? sha256(ctx.ip) : null
  });
  // Tell the team. Never fail the visitor's request because of a mail problem, and keep visitor text out of the subject.
  try {
    const lines = [`Type: ${input.kind}`, `Name: ${input.name ?? '-'}`, `Email: ${email}`, `Organisation: ${input.organisation ?? '-'}`, `Phone: ${input.phone ?? '-'}`, `Interest: ${input.interest ?? '-'}`, '', input.message ?? ''];
    await sendMail(env.inquiryTo, `New website enquiry (${input.kind})`, lines.join('\n'));
  } catch (e) { console.error('[inquiry] notification failed', (e as Error).message); }
  return { received: true };
}

export async function listInquiries(ctx: Ctx, q: ListQuery & { status?: string; kind?: string }) {
  allow(ctx, 'inquiries', 'read');
  const t = schema.inquiries;
  const where = and(search(q.q, [t.name, t.email, t.organisation, t.message]), q.status ? eq(t.status, q.status) : undefined, q.kind ? eq(t.kind, q.kind) : undefined);
  return respondList(ctx, 'inquiries', q,
    (limit, off) => ctx.db.select().from(t).where(where).orderBy(orderBy(q, { createdAt: t.createdAt, status: t.status, name: t.name }, t.id)).limit(limit).offset(off),
    async () => Number((await ctx.db.select({ n: countOf }).from(t).where(where))[0].n),
    { filename: 'enquiries.csv', columns: [['createdAt', 'Received'], ['kind', 'Type'], ['name', 'Name'], ['email', 'Email'], ['organisation', 'Organisation'], ['phone', 'Phone'], ['interest', 'Interest'], ['status', 'Status'], ['message', 'Message']].map(([key, label]) => ({ key, label })) });
}

export async function setInquiryStatus(ctx: Ctx, id: string, status: 'New' | 'Handled' | 'Spam') {
  allow(ctx, 'inquiries', 'edit');
  const t = schema.inquiries;
  const [before] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!before) throw notFound();
  const [after] = await ctx.db.update(t).set({ status, handledBy: status === 'New' ? null : ctx.user!.id, handledAt: status === 'New' ? null : new Date() }).where(eq(t.id, id)).returning();
  await audit(ctx, 'inquiry.status', 'inquiry', id, { status: before.status }, { status });
  return after;
}
