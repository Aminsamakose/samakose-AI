import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertCase } from '@/domain/scope';
import { notifyUsers } from '@/domain/notify';
import { enqueue } from '@/domain/jobs';
import { status } from '@/api/framework';
import { allow, latestScore, need } from './common';
import { caseParties } from '@/domain/events';

const r = schema.reports;

export async function requestReport(ctx: Ctx, caseId: string) {
  allow(ctx, 'reports', 'create');
  await assertCase(ctx, caseId);
  if (!(await latestScore(ctx, caseId))) throw unprocessable('A report needs a scored diagnostic');
  const q = await ctx.db.execute(sql`select 1 from jobs where kind='ai_report' and status in ('queued','running') and payload->>'caseId' = ${caseId} limit 1`);
  if (q.rows.length) throw conflict('A report is already being prepared');
  const jobId = await enqueue(ctx, 'ai_report', { caseId }, { maxAttempts: 2 });
  await audit(ctx, 'report.requested', 'case', caseId, undefined, { jobId }, caseId);
  return status(202, { jobId });
}

export async function listReports(ctx: Ctx, caseId: string) {
  allow(ctx, 'reports', 'read');
  await assertCase(ctx, caseId);
  const u = need(ctx).user;
  return ctx.db.select({ id: r.id, code: r.code, title: r.title, status: r.status, releasedAt: r.releasedAt, createdAt: r.createdAt, aiDrafted: sql<boolean>`${r.aiRequestId} is not null` })
    .from(r).where(and(eq(r.caseId, caseId), u.role === 'OWNER' ? eq(r.status, 'Released') : undefined)).orderBy(desc(r.createdAt));
}
export async function getReport(ctx: Ctx, id: string) {
  allow(ctx, 'reports', 'read');
  const [row] = await ctx.db.select().from(r).where(eq(r.id, id)).limit(1);
  if (!row) throw notFound('Report not found');
  const cs = await assertCase(ctx, row.caseId);
  if (need(ctx).user.role === 'OWNER' && row.status !== 'Released') throw notFound('Report not found');
  const [org] = await ctx.db.select({ name: schema.organisations.name, code: schema.organisations.code }).from(schema.organisations).where(eq(schema.organisations.id, cs.orgId));
  return { ...row, caseCode: cs.code, org };
}
export async function editReport(ctx: Ctx, id: string, b: { title?: string; content?: { heading: string; body: string }[] }) {
  allow(ctx, 'reports', 'create');
  const [row] = await ctx.db.select().from(r).where(eq(r.id, id)).limit(1);
  if (!row) throw notFound('Report not found');
  await assertCase(ctx, row.caseId);
  if (row.status !== 'Draft') throw unprocessable('A released report cannot be edited');
  await ctx.db.update(r).set({ ...(b.title ? { title: b.title.trim() } : {}), ...(b.content ? { content: b.content } : {}) }).where(eq(r.id, id));
  await audit(ctx, 'report.edited', 'report', id, { title: row.title }, { title: b.title ?? row.title }, row.caseId);
  return { ok: true };
}
export async function releaseReport(ctx: Ctx, id: string, decision: 'release' | 'return', reason?: string) {
  allow(ctx, 'reports', 'approve');
  const u = need(ctx).user;
  const [row] = await ctx.db.select().from(r).where(eq(r.id, id)).for('update').limit(1);
  if (!row) throw notFound('Report not found');
  const cs = await assertCase(ctx, row.caseId);
  if (row.status !== 'Draft') throw unprocessable('This report is already released');
  if (cs.reviewerId !== u.id) throw forbidden('You are not the reviewer of this case');
  if (row.createdBy === u.id || cs.consultantId === u.id) throw forbidden('You cannot release work you wrote or are responsible for');
  if (decision === 'return') {
    if ((reason ?? '').trim().length < 5) throw fieldError({ reason: 'Say what must change' });
    await ctx.db.insert(schema.approvals).values({ recordType: 'report', recordId: id, caseId: row.caseId, userId: u.id, decision: 'RETURNED', reason });
    await audit(ctx, 'report.returned', 'report', id, undefined, { reason }, row.caseId);
    await notifyUsers(ctx, [cs.consultantId].filter(Boolean) as string[], { kind: 'ReportReturned', title: 'Report returned by the reviewer', body: reason, link: `/cases/${row.caseId}` });
    return { status: 'Draft' };
  }
  const [org] = await ctx.db.select({ status: schema.organisations.status }).from(schema.organisations).where(eq(schema.organisations.id, cs.orgId)).limit(1);
  if (org?.status === 'Pending verification') throw unprocessable('This organisation has not been verified yet. An administrator must verify it before a report can be released.');
  await ctx.db.update(r).set({ status: 'Released', releasedBy: u.id, releasedAt: new Date() }).where(eq(r.id, id));
  await ctx.db.insert(schema.approvals).values({ recordType: 'report', recordId: id, caseId: row.caseId, userId: u.id, decision: 'APPROVED', reason: reason ?? null });
  await audit(ctx, 'report.released', 'report', id, { status: 'Draft' }, { status: 'Released' }, row.caseId);
  const p = await caseParties(ctx, row.caseId);
  await notifyUsers(ctx, p?.ownerIds ?? [], { kind: 'ReportReleased', title: 'Your progress report is ready', body: row.title, link: `/cases/${row.caseId}`, email: true });
  return { status: 'Released' };
}
