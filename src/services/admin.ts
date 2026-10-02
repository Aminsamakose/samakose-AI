import { agentsSummary } from './agents';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { storage as fileStorage } from '@/lib/storage';
import { db, schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, conflict, fieldError, notFound } from '@/lib/errors';
import { DEFAULT_RULES, DIMENSIONS, RULE_NOTES } from '@/domain/logic';
import { caseScope, orgScope, programmeScope } from '@/domain/scope';
import { can } from '@/lib/rbac';
import { env } from '@/lib/env';
import { aiIsMock } from './ai';
import { paystackIsMock } from './finance';
import { mailConfigured } from '@/lib/mail';
import { orderBy, search, countOf, escapeLike, type ListQuery } from '@/api/list';
import { allow, loadRules, need, respondList } from './common';

/* --------------------------------- audit ------------------------------- */
export async function listAudit(ctx: Ctx, q: ListQuery & { actor?: string; action?: string; entity?: string; from?: string; to?: string; caseId?: string }) {
  allow(ctx, 'audit', 'read');
  const t = schema.auditLog;
  const where = and(search(q.q, [t.actorEmail, t.action, t.entity, t.entityId]), q.actor ? sql`${t.actorEmail} ilike ${'%' + escapeLike(q.actor) + '%'}` : undefined,
    q.action ? sql`${t.action} ilike ${escapeLike(q.action) + '%'}` : undefined, q.entity ? eq(t.entity, q.entity) : undefined, q.caseId ? eq(t.caseId, q.caseId) : undefined,
    q.from ? gte(t.at, new Date(q.from)) : undefined, q.to ? lte(t.at, new Date(new Date(q.to).getTime() + 86400_000)) : undefined);
  return respondList(ctx, 'audit', q,
    (limit, off) => ctx.db.select().from(t).where(where).orderBy(orderBy(q, { at: t.at, action: t.action, actor: t.actorEmail }, t.id)).limit(limit).offset(off),
    async () => Number((await ctx.db.select({ n: countOf }).from(t).where(where))[0].n),
    { filename: 'audit-log.csv', columns: [['at', 'When'], ['actorEmail', 'Who'], ['action', 'Action'], ['entity', 'Entity'], ['entityId', 'Entity id'], ['ip', 'IP'], ['requestId', 'Request']].map(([key, label]) => ({ key, label })) });
}
export async function listEvents(ctx: Ctx, q: ListQuery & { type?: string }) {
  allow(ctx, 'audit', 'read');
  const t = schema.events;
  const where = and(q.type ? eq(t.type, q.type) : undefined);
  return respondList(ctx, 'audit', q,
    (limit, off) => ctx.db.select().from(t).where(where).orderBy(desc(t.id)).limit(limit).offset(off),
    async () => Number((await ctx.db.select({ n: countOf }).from(t).where(where))[0].n),
    { filename: 'events.csv', columns: [['id', 'Id'], ['type', 'Type'], ['caseId', 'Case'], ['actorId', 'Actor'], ['createdAt', 'When']].map(([key, label]) => ({ key, label })) });
}

/* ------------------------------- settings ------------------------------ */
export async function getRules(ctx: Ctx) {
  allow(ctx, 'settings', 'read');
  const cur = await loadRules(ctx.db);
  const rows = await ctx.db.select().from(schema.rules);
  const meta = new Map(rows.map((r) => [r.key, r]));
  return Object.keys(DEFAULT_RULES).map((key) => ({ key, value: cur[key], default: DEFAULT_RULES[key], note: RULE_NOTES[key] ?? null, changed: meta.has(key), updatedAt: meta.get(key)?.updatedAt ?? null }));
}
export async function updateRules(ctx: Ctx, values: Record<string, number>) {
  allow(ctx, 'settings', 'edit');
  const cur = await loadRules(ctx.db);
  const next: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULT_RULES)) { errors[k] = 'Unknown rule'; continue; }
    if (typeof v !== 'number' || Number.isNaN(v)) { errors[k] = 'Enter a number'; continue; }
    if (k.startsWith('evidence.multiplier.') && (v < 0 || v > 1)) errors[k] = 'Use a value from 0 to 1';
    if (k === 'validation.min_completion' && (v < 0.5 || v > 1)) errors[k] = 'Use a value from 0.5 to 1';
    if (k.startsWith('maturity.') && (v <= 0 || v >= 100)) errors[k] = 'Use a value between 0 and 100';
    if (k.startsWith('confidence.') && (v <= 0 || v > 1)) errors[k] = 'Use a value above 0 and up to 1';
    if (k.startsWith('ai.') && (v < 0 || v > 100000)) errors[k] = 'Use a value from 0 to 100000';
    if (k === 'privacy.min_cell_size' && (v < 3 || v > 50)) errors[k] = 'Use a value from 3 to 50';
    if (k.startsWith('prescription.') && (!Number.isInteger(v) || v < 1 || v > 730)) errors[k] = 'Use whole days from 1 to 730';
    if (k === 'session.min_for_monitoring' && (!Number.isInteger(v) || v < 1 || v > 12)) errors[k] = 'Use a whole number from 1 to 12';
    next[k] = v;
  }
  const m = { ...cur, ...next } as Record<string, number>;
  if (!(m['maturity.critical_below'] < m['maturity.fragile_below'] && m['maturity.fragile_below'] < m['maturity.developing_below'])) errors['maturity.fragile_below'] = 'Critical must be below Fragile, and Fragile below Developing';
  if (!(m['confidence.medium_share'] < m['confidence.high_share'])) errors['confidence.high_share'] = 'The High share must be above the Medium share';
  if (!(m['prescription.min_days'] <= m['prescription.max_days'])) errors['prescription.max_days'] = 'Longest deadline must be at least the shortest';
  if (Object.keys(errors).length) throw fieldError(errors);
  const before: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if (cur[k] === v) continue;
    before[k] = cur[k];
    await ctx.db.insert(schema.rules).values({ key: k, value: String(v), note: RULE_NOTES[k] ?? null, updatedBy: need(ctx).user.id }).onConflictDoUpdate({ target: schema.rules.key, set: { value: String(v), updatedBy: need(ctx).user.id, updatedAt: new Date() } });
  }
  if (Object.keys(before).length) await audit(ctx, 'settings.rules_changed', 'rules', null, before, Object.fromEntries(Object.keys(before).map((k) => [k, next[k]])));
  return { changed: Object.keys(before).length };
}

export async function listQuestions(ctx: Ctx) {
  allow(ctx, 'settings', 'read');
  return ctx.db.select().from(schema.questions).orderBy(asc(schema.questions.sort), asc(schema.questions.code));
}
export async function createQuestion(ctx: Ctx, b: { code: string; dimension: string; text: string; weight: number; sort?: number }) {
  allow(ctx, 'settings', 'create');
  if (!(DIMENSIONS as readonly string[]).includes(b.dimension)) throw fieldError({ dimension: 'Choose one of the six dimensions' });
  const [row] = await ctx.db.insert(schema.questions).values({ ...b, code: b.code.trim().toUpperCase(), text: b.text.trim(), sort: b.sort ?? 0 }).returning();
  await audit(ctx, 'question.created', 'question', row.id, undefined, b);
  return row;
}
export async function updateQuestion(ctx: Ctx, id: string, b: { text?: string; weight?: number; sort?: number; active?: boolean; dimension?: string }) {
  allow(ctx, 'settings', 'edit');
  const [before] = await ctx.db.select().from(schema.questions).where(eq(schema.questions.id, id)).limit(1);
  if (!before) throw notFound('Question not found');
  if (b.dimension && !(DIMENSIONS as readonly string[]).includes(b.dimension)) throw fieldError({ dimension: 'Choose one of the six dimensions' });
  await ctx.db.update(schema.questions).set({ ...b, updatedAt: new Date() }).where(eq(schema.questions.id, id));
  await audit(ctx, 'question.updated', 'question', id, before, b);
  return { ok: true };
}
export async function listLibrary(ctx: Ctx) {
  allow(ctx, 'settings', 'read');
  return ctx.db.select().from(schema.libraryItems).orderBy(asc(schema.libraryItems.code));
}
export async function createLibraryItem(ctx: Ctx, b: { code: string; title: string; dimension: string; description: string; typicalDays: number; kpiHint?: string | null }) {
  allow(ctx, 'settings', 'create');
  if (!(DIMENSIONS as readonly string[]).includes(b.dimension)) throw fieldError({ dimension: 'Choose one of the six dimensions' });
  const [row] = await ctx.db.insert(schema.libraryItems).values({ ...b, code: b.code.trim().toUpperCase() }).returning();
  await audit(ctx, 'library.created', 'library_item', row.id, undefined, b);
  return row;
}
export async function updateLibraryItem(ctx: Ctx, id: string, b: { title?: string; description?: string; typicalDays?: number; kpiHint?: string | null; active?: boolean; dimension?: string }) {
  allow(ctx, 'settings', 'edit');
  const [before] = await ctx.db.select().from(schema.libraryItems).where(eq(schema.libraryItems.id, id)).limit(1);
  if (!before) throw notFound('Library item not found');
  if (b.dimension && !(DIMENSIONS as readonly string[]).includes(b.dimension)) throw fieldError({ dimension: 'Choose one of the six dimensions' });
  await ctx.db.update(schema.libraryItems).set({ ...b, updatedAt: new Date() }).where(eq(schema.libraryItems.id, id));
  await audit(ctx, 'library.updated', 'library_item', id, before, b);
  return { ok: true };
}

/* -------------------------------- system ------------------------------- */
export async function systemStatus(ctx: Ctx) {
  allow(ctx, 'integrations', 'read');
  const t0 = Date.now();
  await ctx.db.execute(sql`select 1`);
  const latency = Date.now() - t0;
  const jobs = (await ctx.db.execute(sql`select status, count(*)::int n from jobs group by status`)).rows as { status: string; n: number }[];
  const failed = await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.status, 'failed')).orderBy(desc(schema.jobs.updatedAt)).limit(20);
  const mail = (await ctx.db.execute(sql`select status, count(*)::int n from outbox_emails group by status`)).rows as { status: string; n: number }[];
  const storageStatus = await fileStorage().health();
  return {
    database: { ok: true, latencyMs: latency }, jobs: Object.fromEntries(jobs.map((j) => [j.status, j.n])), failedJobs: failed.map((j) => ({ id: j.id, kind: j.kind, attempts: j.attempts, lastError: j.lastError, updatedAt: j.updatedAt })),
    email: { mode: mailConfigured() ? 'smtp' : 'log-only', queue: Object.fromEntries(mail.map((m) => [m.status, m.n])) },
    ai: { mode: aiIsMock() ? 'mock' : 'claude', model: aiIsMock() ? null : env.claudeModel },
    payments: { provider: 'paystack', mode: paystackIsMock() ? 'mock' : 'live' },
    kobo: { configured: !!env.koboSecret, pullConfigured: !!(env.koboToken && env.koboAsset), server: env.koboServer },
    storage: { driver: env.storageDriver, location: fileStorage().location, status: storageStatus, maxUploadMb: env.maxUploadBytes / 1048576 },
    security: { mfaRequiredRoles: env.mfaRequiredRoles, trustProxy: env.trustProxy, https: env.appUrl.startsWith('https://') },
    runtime: { node: process.version, uptimeSec: Math.round(process.uptime()), env: env.nodeEnv }
  };
}
export async function retryJob(ctx: Ctx, id: string) {
  allow(ctx, 'integrations', 'edit');
  const r = await ctx.db.update(schema.jobs).set({ status: 'queued', attempts: 0, runAt: new Date(), lastError: null, updatedAt: new Date() }).where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, 'failed'))).returning({ id: schema.jobs.id });
  if (!r.length) throw conflict('Only a failed job can be retried');
  await audit(ctx, 'job.retried', 'job', id);
  return { ok: true };
}
export async function health() {
  const t0 = Date.now();
  await db().execute(sql`select 1`);
  return { ok: true, db: 'up', latencyMs: Date.now() - t0 };
}

/* ------------------------------ notifications -------------------------- */
export async function listNotifications(ctx: Ctx, q: { page: number; pageSize: number; unread?: string }) {
  const u = need(ctx).user;
  const n = schema.notifications;
  const where = and(eq(n.userId, u.id), q.unread === 'true' ? sql`${n.readAt} is null` : undefined);
  const items = await ctx.db.select().from(n).where(where).orderBy(desc(n.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const total = Number((await ctx.db.select({ n: countOf }).from(n).where(where))[0].n);
  const unread = Number((await ctx.db.select({ n: countOf }).from(n).where(and(eq(n.userId, u.id), sql`${n.readAt} is null`)))[0].n);
  return { items, total, unread, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
}
export async function markRead(ctx: Ctx, id: string) {
  const u = need(ctx).user;
  const r = await ctx.db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, u.id))).returning({ id: schema.notifications.id });
  if (!r.length) throw notFound('Notification not found');
  return { ok: true };
}
export async function markAllRead(ctx: Ctx) {
  const u = need(ctx).user;
  await ctx.db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, u.id), sql`${schema.notifications.readAt} is null`));
  return { ok: true };
}

/* --------------------------------- search ------------------------------ */
export async function globalSearch(ctx: Ctx, term: string) {
  const u = need(ctx).user;
  const pat = `%${escapeLike(term)}%`;
  const out: { type: string; id: string; title: string; subtitle: string | null; href: string }[] = [];
  if (can(u.role, 'organisations', 'read')) {
    const o = schema.organisations;
    const r = await ctx.db.select({ id: o.id, name: o.name, code: o.code, region: o.region }).from(o).where(and(orgScope(u), sql`${o.deletedAt} is null`, sql`(${o.name} ilike ${pat} or ${o.code} ilike ${pat})`)).limit(5);
    r.forEach((x) => out.push({ type: 'Organisation', id: x.id, title: x.name, subtitle: `${x.code}${x.region ? ' · ' + x.region : ''}`, href: `/organisations/${x.id}` }));
  }
  if (can(u.role, 'cases', 'read')) {
    const c = schema.cases, o = schema.organisations;
    const r = await ctx.db.select({ id: c.id, code: c.code, status: c.status, org: o.name }).from(c).innerJoin(o, eq(o.id, c.orgId)).where(and(caseScope(u), sql`(${c.code} ilike ${pat} or ${o.name} ilike ${pat})`)).limit(5);
    r.forEach((x) => out.push({ type: 'Case', id: x.id, title: x.code, subtitle: `${x.org} · ${x.status}`, href: `/cases/${x.id}` }));
  }
  if (can(u.role, 'programmes', 'read')) {
    const p = schema.programmes;
    const r = await ctx.db.select({ id: p.id, name: p.name, code: p.code }).from(p).where(and(programmeScope(u), sql`(${p.name} ilike ${pat} or ${p.code} ilike ${pat})`)).limit(5);
    r.forEach((x) => out.push({ type: 'Programme', id: x.id, title: x.name, subtitle: x.code, href: `/programmes/${x.id}` }));
  }
  if (u.role === 'ADMIN') {
    const us = schema.users;
    const r = await ctx.db.select({ id: us.id, name: us.name, email: us.email }).from(us).where(sql`(${us.name} ilike ${pat} or ${us.email} ilike ${pat})`).limit(5);
    r.forEach((x) => out.push({ type: 'User', id: x.id, title: x.name, subtitle: x.email, href: `/admin/users/${x.id}` }));
  }
  if (can(u.role, 'invoices', 'read') && u.role !== 'OWNER') {
    const i = schema.invoices, o = schema.organisations;
    const r = await ctx.db.select({ id: i.id, code: i.code, org: o.name, status: i.status }).from(i).innerJoin(o, eq(o.id, i.orgId)).where(sql`(${i.code} ilike ${pat} or ${o.name} ilike ${pat})`).limit(5);
    r.forEach((x) => out.push({ type: 'Invoice', id: x.id, title: x.code, subtitle: `${x.org} · ${x.status}`, href: `/finance/invoices/${x.id}` }));
  }
  return out;
}
export { ApiError };

/** The Administrator Command Centre: what needs attention, in one place. Counts only, no client detail. */
export async function commandCentre(ctx: Ctx) {
  allow(ctx, 'users', 'create');
  const one = async (q: ReturnType<typeof sql>) => ((await ctx.db.execute(q)).rows[0] ?? {}) as Record<string, any>;
  const t0 = Date.now(); await ctx.db.execute(sql`select 1`); const latency = Date.now() - t0;
  const c = await one(sql`select
    (select count(*)::int from organisations where deleted_at is null) organisations,
    (select count(*)::int from organisations where deleted_at is null and status = 'Pending verification') pending_orgs,
    (select count(*)::int from users where approval_status = 'pending' and email_verified) pending_registrations,
    (select count(*)::int from users where active) active_users,
    (select count(*)::int from health_scores) assessments_completed,
    (select count(*)::int from prescriptions p where p.status = 'IN REVIEW' and not exists (select 1 from prescriptions x where x.supersedes_id = p.id)) awaiting_review,
    (select count(*)::int from reports where status = 'Released') reports_released,
    (select count(*)::int from reports where status <> 'Released') reports_draft,
    (select count(*)::int from jobs where status = 'failed') failed_jobs,
    (select count(*)::int from outbox_emails where status = 'Failed') failed_emails,
    (select count(*)::int from inquiries where status = 'New') new_enquiries,
    (select count(*)::int from content_docs where status = 'In review') content_in_review,
    (select count(*)::int from content_docs where status = 'Scheduled') content_scheduled,
    (select coalesce(sum(size),0)::bigint from documents) + (select coalesce(sum(size),0)::bigint from media_assets) storage_bytes`);
  const recent = (await ctx.db.execute(sql`select at, actor_email, action, entity from audit_log where action not like 'export.%' order by id desc limit 8`)).rows;
  const alerts: { tone: string; text: string; href: string }[] = [];
  if (c.pending_orgs > 0) alerts.push({ tone: 'warn', text: `${c.pending_orgs} organisation${c.pending_orgs === 1 ? '' : 's'} waiting for verification`, href: '/organisations' });
  if (c.pending_registrations > 0) alerts.push({ tone: 'warn', text: `${c.pending_registrations} registration${c.pending_registrations === 1 ? '' : 's'} waiting for approval`, href: '/admin/registrations' });
  if (c.failed_jobs > 0) alerts.push({ tone: 'bad', text: `${c.failed_jobs} background job${c.failed_jobs === 1 ? '' : 's'} failed`, href: '/admin/system' });
  if (c.failed_emails > 0) alerts.push({ tone: 'bad', text: `${c.failed_emails} email${c.failed_emails === 1 ? '' : 's'} could not be sent`, href: '/admin/system' });
  if (c.content_in_review > 0) alerts.push({ tone: 'info', text: `${c.content_in_review} website item${c.content_in_review === 1 ? '' : 's'} waiting for review`, href: '/admin/website' });
  if (c.new_enquiries > 0) alerts.push({ tone: 'info', text: `${c.new_enquiries} new website enquir${c.new_enquiries === 1 ? 'y' : 'ies'}`, href: '/admin/website?tab=enquiries' });
  const agents = await agentsSummary(ctx);
  if (agents.paused.length) alerts.push({ tone: 'warn', text: `${agents.paused.length} AI agent${agents.paused.length === 1 ? ' is' : 's are'} paused: ${agents.paused.join(', ')}`, href: '/admin/agents' });
  if (agents.limited.length) alerts.push({ tone: 'warn', text: `AI usage is near or over its limit for ${agents.limited.join(', ')}`, href: '/admin/agents' });
  if (agents.blocked24 > 0) alerts.push({ tone: 'info', text: `${agents.blocked24} AI task${agents.blocked24 === 1 ? ' was' : 's were'} refused in the last 24 hours`, href: '/admin/agents' });
  const mailMode = mailConfigured() ? 'smtp' : 'log-only';
  const store = await fileStorage().health();
  return { counts: c, agents, alerts, recent, health: { database: latency, email: mailMode, storage: store, https: env.appUrl.startsWith('https://') } };
}
