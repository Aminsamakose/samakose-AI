/**
 * Administration of the AI workforce: agents, versions, lifecycle, limits, emergency pause, activity.
 * Administrators configure agents here. They cannot change scores, permissions or audit history through an agent.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, notFound, unprocessable } from '@/lib/errors';
import {
  AGENT_STATUSES, ALWAYS_FORBIDDEN, AUTONOMY_LABEL, canMove, limitState, nextStatuses, normaliseLimits, validateConfig,
  type AgentConfig, type AgentLimits, type AgentStatus
} from '@/domain/agents';
import { allow, need } from './common';
import { ensureBuiltIns, monthlyCost, usageOf } from './agent-gate';
import { aiIsLive, aiIsMock } from './ai';

const OWNER_ROLES = ['ADMIN', 'EXECUTIVE', 'PROGRAMME_MANAGER', 'EXPERT', 'REVIEWER'];
const jobKind = (code: string) => `ai_${code}`;

async function row(ctx: Ctx, id: string) {
  const [a] = await ctx.db.select().from(schema.aiAgents).where(eq(schema.aiAgents.id, id)).limit(1);
  if (!a) throw notFound('Agent not found');
  return a;
}
async function currentVersion(ctx: Ctx, a: { currentVersionId: string | null }) {
  if (!a.currentVersionId) return null;
  const [v] = await ctx.db.select().from(schema.aiAgentVersions).where(eq(schema.aiAgentVersions.id, a.currentVersionId)).limit(1);
  return v ?? null;
}
async function queued(ctx: Ctx, code: string) {
  const r = (await ctx.db.execute(sql`select count(*)::int n from jobs where kind = ${jobKind(code)} and status in ('queued','running')`)).rows[0] as { n: number };
  return Number(r.n);
}

export async function listAgents(ctx: Ctx) {
  allow(ctx, 'agents', 'read');
  await ensureBuiltIns(ctx.db);
  const agents = await ctx.db.select().from(schema.aiAgents).orderBy(schema.aiAgents.name);
  const owners = agents.length ? await ctx.db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, agents.map((a) => a.ownerId).filter(Boolean) as string[])) : [];
  const out = [];
  for (const a of agents) {
    const [v, usage, vitals] = await Promise.all([
      currentVersion(ctx, a), usageOf(ctx.db, a.id),
      ctx.db.execute(sql`select
        count(*) filter (where blocked_reason is null and created_at > now() - interval '30 days')::int total30,
        count(*) filter (where blocked_reason is null and ok = false and created_at > now() - interval '30 days')::int failed30,
        count(*) filter (where blocked_reason is not null and created_at > now() - interval '24 hours')::int blocked24,
        max(created_at) filter (where ok) last_ok from ai_requests where agent_id = ${a.id}`)
    ]);
    const vt = vitals.rows[0] as { total30: number; failed30: number; blocked24: number; last_ok: string | null };
    const limits = normaliseLimits(a.limits as Partial<AgentLimits>);
    const cfg = (v?.config ?? {}) as Partial<AgentConfig>;
    const owner = owners.find((o) => o.id === a.ownerId);
    out.push({
      id: a.id, code: a.code, name: a.name, role: a.role, status: a.status as AgentStatus, statusReason: a.statusReason,
      version: v?.version ?? null, evaluation: v?.evaluation ?? 'Not run', autonomy: cfg.autonomy ?? 0, autonomyLabel: AUTONOMY_LABEL[Number(cfg.autonomy ?? 0)] ?? '',
      owner: owner ? { id: owner.id, name: owner.name } : null, limits, usage, limit: limitState(usage, limits),
      vitals: { requests30: vt.total30, failed30: vt.failed30, errorRate: vt.total30 ? Math.round((vt.failed30 / vt.total30) * 1000) / 10 : null, blocked24: vt.blocked24, lastSuccess: vt.last_ok },
      queuedTasks: await queued(ctx, a.code), next: nextStatuses(a.status as AgentStatus)
    });
  }
  return { agents: out, model: { mock: aiIsMock(), live: aiIsLive() }, statuses: AGENT_STATUSES, cost: await monthlyCost(ctx.db) };
}

export async function getAgent(ctx: Ctx, id: string) {
  allow(ctx, 'agents', 'read');
  const a = await row(ctx, id);
  const versions = await ctx.db.select().from(schema.aiAgentVersions).where(eq(schema.aiAgentVersions.agentId, id)).orderBy(desc(schema.aiAgentVersions.version));
  const requests = (await ctx.db.execute(sql`select q.code, q.created_at, q.model, q.ok, q.blocked_reason, q.agent_version_id,
      (select count(*)::int from ai_attempts a where a.request_id = q.id) attempts,
      (select coalesce(sum(coalesce(a.input_tokens,0) + coalesce(a.output_tokens,0)),0)::int from ai_attempts a where a.request_id = q.id) tokens
      from ai_requests q where q.agent_id = ${id} order by q.created_at desc limit 25`)).rows;
  const trail = await ctx.db.select({ at: schema.auditLog.at, action: schema.auditLog.action, actorEmail: schema.auditLog.actorEmail, actorType: schema.auditLog.actorType, after: schema.auditLog.after })
    .from(schema.auditLog).where(and(eq(schema.auditLog.entity, 'ai_agent'), eq(schema.auditLog.entityId, id))).orderBy(desc(schema.auditLog.id)).limit(25);
  const [owner] = a.ownerId ? await ctx.db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, a.ownerId)) : [];
  const usage = await usageOf(ctx.db, id), limits = normaliseLimits(a.limits as Partial<AgentLimits>);
  const owners = await ctx.db.select({ id: schema.users.id, name: schema.users.name, role: schema.users.role }).from(schema.users).where(and(inArray(schema.users.role, OWNER_ROLES as any), eq(schema.users.active, true))).orderBy(schema.users.name);
  return {
    agent: { ...a, limits, owner: owner ?? null, next: nextStatuses(a.status as AgentStatus) }, versions, requests, trail, usage, limit: limitState(usage, limits),
    queuedTasks: await queued(ctx, a.code), alwaysForbidden: ALWAYS_FORBIDDEN, ownerChoices: owners, autonomyLabels: AUTONOMY_LABEL
  };
}

export async function updateAgent(ctx: Ctx, id: string, b: { ownerId?: string | null; name?: string; description?: string | null; purpose?: string | null; limits?: Partial<AgentLimits> }) {
  allow(ctx, 'agents', 'edit');
  const a = await row(ctx, id);
  if (a.status === 'Archived') throw unprocessable('An archived agent cannot be edited. Restore it first');
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (b.ownerId !== undefined) {
    if (b.ownerId) {
      const [u] = await ctx.db.select({ role: schema.users.role, active: schema.users.active }).from(schema.users).where(eq(schema.users.id, b.ownerId));
      if (!u || !u.active || !OWNER_ROLES.includes(u.role)) throw fieldError({ ownerId: 'Choose an active administrator, executive, programme manager, expert or reviewer' });
    }
    set.ownerId = b.ownerId;
  }
  if (b.name !== undefined) set.name = b.name;
  if (b.description !== undefined) set.description = b.description;
  if (b.purpose !== undefined) set.purpose = b.purpose;
  if (b.limits) set.limits = normaliseLimits({ ...(a.limits as Partial<AgentLimits>), ...b.limits });
  await ctx.db.update(schema.aiAgents).set(set).where(eq(schema.aiAgents.id, id));
  await audit(ctx, 'agent.updated', 'ai_agent', id, { owner: a.ownerId, name: a.name, limits: a.limits }, { owner: set.ownerId ?? a.ownerId, name: set.name ?? a.name, limits: set.limits ?? a.limits });
  return getAgent(ctx, id);
}

/** A change to the prompt, model or configuration is a new version. It does not take effect until it is made current. */
export async function createVersion(ctx: Ctx, id: string, b: { prompt?: string; model?: string | null; config?: Partial<AgentConfig>; note: string }) {
  allow(ctx, 'agents', 'edit');
  const u = need(ctx).user;
  const a = await row(ctx, id);
  if (a.status === 'Archived') throw unprocessable('An archived agent cannot be edited. Restore it first');
  const base = (await currentVersion(ctx, a)) ?? (await ctx.db.select().from(schema.aiAgentVersions).where(eq(schema.aiAgentVersions.agentId, id)).orderBy(desc(schema.aiAgentVersions.version)).limit(1))[0];
  if (!base) throw unprocessable('This agent has no version to copy from');
  const prompt = b.prompt ?? base.prompt, model = b.model === undefined ? base.model : b.model;
  const config = { ...(base.config as unknown as AgentConfig), ...(b.config ?? {}) };
  const problems = validateConfig(config);
  if (problems.length) throw fieldError({ config: problems.join('. ') });
  if (prompt.trim().length < 40) throw fieldError({ prompt: 'The instructions are too short to be a real prompt' });
  if (prompt === base.prompt && model === base.model && JSON.stringify(config) === JSON.stringify(base.config)) throw unprocessable('Nothing changed from the version it was copied from');
  const [{ n }] = await ctx.db.select({ n: sql<number>`coalesce(max(${schema.aiAgentVersions.version}), 0)::int` }).from(schema.aiAgentVersions).where(eq(schema.aiAgentVersions.agentId, id));
  const [v] = await ctx.db.insert(schema.aiAgentVersions).values({ agentId: id, version: Number(n) + 1, prompt, model, config: config as any, note: b.note, createdBy: u.id }).returning();
  await audit(ctx, 'agent.version_created', 'ai_agent', id, { fromVersion: base.version }, { version: v.version, note: b.note, promptChanged: prompt !== base.prompt, modelChanged: model !== base.model, configChanged: JSON.stringify(config) !== JSON.stringify(base.config) });
  return v;
}

/** Make a version the one agents run. An Active agent falls back to Testing unless the new version has passed evaluation. */
export async function setCurrentVersion(ctx: Ctx, id: string, versionId: string, reason: string) {
  allow(ctx, 'agents', 'edit');
  const a = await row(ctx, id);
  if (a.status === 'Archived') throw unprocessable('An archived agent cannot be edited. Restore it first');
  const [v] = await ctx.db.select().from(schema.aiAgentVersions).where(and(eq(schema.aiAgentVersions.id, versionId), eq(schema.aiAgentVersions.agentId, id)));
  if (!v) throw notFound('Version not found for this agent');
  if (a.currentVersionId === v.id) throw unprocessable('That version is already current');
  const [prev] = a.currentVersionId ? await ctx.db.select().from(schema.aiAgentVersions).where(eq(schema.aiAgentVersions.id, a.currentVersionId)) : [];
  const demote = a.status === 'Active' && v.evaluation !== 'Passed';
  await ctx.db.update(schema.aiAgents).set({ currentVersionId: v.id, updatedAt: new Date(), ...(demote ? { status: 'Testing', statusReason: 'A new version was made current before it passed evaluation', statusBy: need(ctx).user.id, statusAt: new Date() } : {}) }).where(eq(schema.aiAgents.id, id));
  await audit(ctx, 'agent.version_current', 'ai_agent', id, { version: prev?.version ?? null, status: a.status }, { version: v.version, reason, status: demote ? 'Testing' : a.status, evaluation: v.evaluation });
  return getAgent(ctx, id);
}

/** Lifecycle moves, including the emergency pause. Every move needs a reason and is audited with the version that was active. */
export async function changeStatus(ctx: Ctx, id: string, b: { to: AgentStatus | 'Resume'; reason: string }) {
  allow(ctx, 'agents', 'edit');
  const u = need(ctx).user;
  const a = await row(ctx, id);
  const from = a.status as AgentStatus;
  let to: AgentStatus;
  if (b.to === 'Resume') {
    if (from !== 'Paused') throw unprocessable('Only a paused agent can be resumed');
    to = ((a.pausedFrom as AgentStatus | null) ?? 'Testing');
  } else {
    to = b.to;
    if (!canMove(from, to)) throw unprocessable(`An agent cannot move from ${from} to ${to}. Allowed: ${nextStatuses(from).join(', ') || 'none'}`);
  }
  const v = await currentVersion(ctx, a);
  if (to === 'Active') {
    allow(ctx, 'agents', 'approve');
    if (!v) throw unprocessable('This agent has no current version');
    if (v.evaluation !== 'Passed') throw unprocessable('An agent cannot become Active until its current version has passed evaluation. No live evaluation has passed yet');
  }
  // Resuming into Active needs the same proof, in case the current version changed while the agent was paused.
  if (b.to === 'Resume' && to === 'Active' && v?.evaluation !== 'Passed') to = 'Testing';
  const stopping = to === 'Paused' || to === 'Disabled';
  const affected = stopping ? await queued(ctx, a.code) : 0;
  await ctx.db.update(schema.aiAgents).set({
    status: to, updatedAt: new Date(), statusReason: b.reason, statusBy: u.id, statusAt: new Date(),
    pausedFrom: to === 'Paused' ? from : null
  }).where(eq(schema.aiAgents.id, id));
  await audit(ctx, `agent.${b.to === 'Resume' ? 'resumed' : to === 'Paused' ? 'paused' : to === 'Disabled' ? 'disabled' : 'status_changed'}`, 'ai_agent', id, { status: from },
    { status: to, reason: b.reason, activeVersion: v?.version ?? null, evaluation: v?.evaluation ?? null, ...(stopping ? { affectedTasks: affected, taskHandling: 'Queued tasks stay queued. When they run they are refused and the requester is told to do the work by hand.' } : {}) });
  return getAgent(ctx, id);
}

/** For the Command Centre: one line per concern, and a count. */
export async function agentsSummary(ctx: Ctx) {
  await ensureBuiltIns(ctx.db);
  const agents = await ctx.db.select().from(schema.aiAgents);
  const blocked = Number(((await ctx.db.execute(sql`select count(*)::int n from ai_requests where blocked_reason is not null and created_at > now() - interval '24 hours'`)).rows[0] as { n: number }).n);
  const byStatus: Record<string, number> = {};
  for (const a of agents) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  const limited: string[] = [];
  for (const a of agents) { const s = limitState(await usageOf(ctx.db, a.id), normaliseLimits(a.limits as Partial<AgentLimits>)); if (s.state !== 'ok') limited.push(a.name); }
  return { total: agents.length, byStatus, paused: agents.filter((a) => a.status === 'Paused').map((a) => a.name), limited, blocked24: blocked };
}
