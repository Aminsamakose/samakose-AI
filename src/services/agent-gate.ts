/**
 * The gateway side of the agent registry. Used by the AI gateway before every model call.
 * Imports only the database and the pure rules, so the gateway can depend on it without a cycle.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { schema, type DbOrTx } from '@/db/client';
import { DEFAULT_RULES } from '@/domain/logic';
import { SYSTEM } from '@/domain/prompts';
import {
  ALWAYS_FORBIDDEN, costState, limitState, mayRun, normaliseLimits, DEFAULT_LIMITS,
  type AgentConfig, type AgentLimits, type AgentStatus, type Usage
} from '@/domain/agents';

type BuiltIn = { code: keyof typeof SYSTEM; name: string; description: string; purpose: string; resources: string[]; permitted: string[]; approval: string };
const BUILT_INS: BuiltIn[] = [
  { code: 'diagnosis', name: 'Diagnostic Agent', description: 'Explains the weakest areas of a scored diagnostic and their likely causes, citing evidence ids.', purpose: 'Draft a diagnosis for expert review.',
    resources: ['Scored diagnostic', 'Evidence ids supplied for the case', 'Framework version'], permitted: ['Read the case context supplied to it', 'Draft a diagnosis for expert review'], approval: 'The diagnosis stays a draft until an expert reviews it.' },
  { code: 'prescription', name: 'Prescription Agent', description: 'Builds a prescription only from the approved intervention library.', purpose: 'Draft a prescription for expert editing and reviewer approval.',
    resources: ['Approved intervention library', 'Reviewed diagnosis', 'Prescription rules'], permitted: ['Read the case context supplied to it', 'Draft a prescription from library items'], approval: 'The expert edits it and a reviewer approves it.' },
  { code: 'brief', name: 'Coaching Brief Agent', description: 'Prepares a one page coaching brief for a session.', purpose: 'Draft a session brief for the expert.',
    resources: ['Case summary', 'Latest score and actions'], permitted: ['Read the case summary supplied to it', 'Draft a coaching brief'], approval: 'The expert reads the brief before the session. The owner never sees it.' },
  { code: 'enquiry', name: 'Enquiry Assistant', description: 'Answers website visitors from published content only and hands anything else to a person.', purpose: 'Answer public questions from published website content and pass the rest to the team.',
    resources: ['Published website content (FAQs and articles)'], permitted: ['Read the published passages supplied to it', 'Answer a visitor question from those passages', 'Hand the visitor to a person'], approval: 'It publishes nothing and records nothing about the visitor. Anything it cannot answer goes to a person.' },
  { code: 'report', name: 'Progress Report Agent', description: 'Writes a plain-language progress report from the figures given.', purpose: 'Draft a progress report for reviewer release.',
    resources: ['Scores and KPI figures', 'Evidence classes'], permitted: ['Read the figures supplied to it', 'Draft a progress report'], approval: 'A reviewer releases the report to the owner.' }
];
const configFor = (b: BuiltIn): AgentConfig => ({
  autonomy: 1, tools: ['AI gateway', 'Case database (read only, minimum context)'], resources: b.resources, permittedActions: b.permitted,
  forbiddenActions: [...ALWAYS_FORBIDDEN], approval: b.approval, escalation: 'After two invalid replies the agent stops, the requester is told, and the work is done by hand.'
});

let seeded = false;
/** Register the four built-in agents once. Safe to call often and from several processes at once. */
export async function ensureBuiltIns(db: DbOrTx) {
  if (seeded) return;
  const [owner] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, 'ADMIN')).orderBy(schema.users.createdAt).limit(1);
  for (const b of BUILT_INS) {
    await (db as any).transaction(async (t: DbOrTx) => {
      const [a] = await t.insert(schema.aiAgents).values({ code: b.code, name: b.name, description: b.description, purpose: b.purpose, role: 'EXPERT', ownerId: owner?.id ?? null, status: 'Testing', limits: DEFAULT_LIMITS as any })
        .onConflictDoNothing({ target: schema.aiAgents.code }).returning();
      if (!a) return;
      const [v] = await t.insert(schema.aiAgentVersions).values({ agentId: a.id, version: 1, prompt: SYSTEM[b.code], model: null, config: configFor(b) as any, note: 'Version 1: the instructions the platform used before the registry existed.' }).returning();
      await t.update(schema.aiAgents).set({ currentVersionId: v.id }).where(eq(schema.aiAgents.id, a.id));
      await t.insert(schema.auditLog).values({ actorId: null, actorEmail: null, ip: 'system', requestId: 'registry-seed', action: 'agent.registered', entity: 'ai_agent', entityId: a.id, before: null, after: { code: b.code, version: 1, status: 'Testing' } as any, actorType: 'AI' });
    });
  }
  seeded = true;
}
/** Tests that rebuild the database call this. */
export const resetSeedCache = () => { seeded = false; };

export type Gate =
  | { ok: true; agentId: string; versionId: string; prompt: string; model: string | null }
  | { ok: false; reason: string; agentId: string | null; versionId: string | null };

const startOfDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
const startOfMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d; };

export async function usageOf(db: DbOrTx, agentId: string): Promise<Usage> {
  const sums = async (since: Date) => {
    const r = (await db.execute(sql`select count(distinct q.id)::int n, coalesce(sum(coalesce(a.input_tokens,0) + coalesce(a.output_tokens,0)),0)::bigint t
      from ai_requests q left join ai_attempts a on a.request_id = q.id where q.agent_id = ${agentId} and q.blocked_reason is null and q.created_at >= ${since.toISOString()}`)).rows[0] as { n: number; t: string };
    return { n: Number(r.n), t: Number(r.t) };
  };
  const [d, m] = await Promise.all([sums(startOfDay()), sums(startOfMonth())]);
  return { requestsDay: d.n, tokensDay: d.t, requestsMonth: m.n, tokensMonth: m.t };
}

async function systemAudit(db: DbOrTx, action: string, agentId: string, after: Record<string, unknown>) {
  await db.insert(schema.auditLog).values({ actorId: null, actorEmail: null, ip: 'system', requestId: 'gateway', action, entity: 'ai_agent', entityId: agentId, before: null, after: after as any, actorType: 'AI' });
}

/** Decide whether a registered agent may take a task now. Never throws for a refusal; the caller records it. */
export async function gate(db: DbOrTx, code: string, o: { live: boolean; evaluation?: boolean }): Promise<Gate> {
  await ensureBuiltIns(db);
  const [agent] = await db.select().from(schema.aiAgents).where(eq(schema.aiAgents.code, code)).limit(1);
  if (!agent) return { ok: false, reason: `The ${code} agent is not registered`, agentId: null, versionId: null };
  const [ver] = agent.currentVersionId ? await db.select().from(schema.aiAgentVersions).where(eq(schema.aiAgentVersions.id, agent.currentVersionId)).limit(1) : [];
  if (!ver) return { ok: false, reason: 'This agent has no current version', agentId: agent.id, versionId: null };
  const cfg = ver.config as unknown as AgentConfig;
  const run = mayRun(agent.status as AgentStatus, Number(cfg.autonomy ?? 0), o);
  if (!run.ok) return { ok: false, reason: run.reason, agentId: agent.id, versionId: ver.id };
  // A live run on the current version also needs that version to have passed its evaluation, unless this is the evaluation itself.
  if (o.live && !o.evaluation && ver.evaluation !== 'Passed') return { ok: false, reason: 'The current version of this agent has not passed its evaluation', agentId: agent.id, versionId: ver.id };

  if (o.live) {
    const cost = await monthlyCost(db);
    if (cost.state === 'over') return { ok: false, reason: `The monthly live AI cost cap (USD ${cost.cap}) has been reached. Live tasks wait until next month or an administrator raises the cap in Settings.`, agentId: agent.id, versionId: ver.id };
  }
  const limits: AgentLimits = normaliseLimits(agent.limits as Partial<AgentLimits>);
  const state = limitState(await usageOf(db, agent.id), limits);
  if (state.state === 'over') {
    const reason = `Usage limit reached (${state.hit}).`;
    if (limits.onLimit === 'pause') {
      await db.update(schema.aiAgents).set({ status: 'Paused', pausedFrom: agent.status, statusReason: reason, statusBy: null, statusAt: new Date(), updatedAt: new Date() }).where(eq(schema.aiAgents.id, agent.id));
      await systemAudit(db, 'agent.paused_by_limit', agent.id, { from: agent.status, to: 'Paused', reason, version: ver.version });
      return { ok: false, reason: `${reason} The agent was paused until an administrator resumes it.`, agentId: agent.id, versionId: ver.id };
    }
    return { ok: false, reason: `${reason} New tasks wait until the limit resets or an administrator raises it.`, agentId: agent.id, versionId: ver.id };
  }
  if (state.state === 'warn') {
    const seen = await db.select({ id: schema.auditLog.id }).from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'agent.usage_warning'), eq(schema.auditLog.entityId, agent.id), gte(schema.auditLog.at, startOfDay()))).limit(1);
    if (!seen.length) await systemAudit(db, 'agent.usage_warning', agent.id, { limit: state.hit, usedShare: Math.round(state.worst * 100) / 100 });
  }
  return { ok: true, agentId: agent.id, versionId: ver.id, prompt: ver.prompt, model: ver.model };
}

/** Estimated live AI spend this calendar month, all agents together, against the cap set in Settings. */
export async function monthlyCost(db: DbOrTx) {
  const rows = await db.select().from(schema.rules);
  const rule = (k: keyof typeof DEFAULT_RULES) => { const r = rows.find((x) => x.key === k); const n = r ? Number(r.value) : NaN; return Number.isFinite(n) ? n : Number(DEFAULT_RULES[k]); };
  const t = (await db.execute(sql`select coalesce(sum(a.input_tokens),0)::bigint i, coalesce(sum(a.output_tokens),0)::bigint o
    from ai_attempts a join ai_requests q on q.id = a.request_id where q.blocked_reason is null and q.model is not null and q.model <> 'mock' and q.created_at >= ${startOfMonth().toISOString()}`)).rows[0] as { i: string; o: string };
  return costState(Number(t.i), Number(t.o), { cap: rule('ai.monthly_cost_cap_usd'), inPerM: rule('ai.usd_per_million_input_tokens'), outPerM: rule('ai.usd_per_million_output_tokens') });
}

/** Set an evaluation result on a version. Used by the evaluation run, never by a screen. */
export async function recordEvaluation(db: DbOrTx, versionId: string, result: 'Passed' | 'Failed', note: string) {
  await db.update(schema.aiAgentVersions).set({ evaluation: result, evaluatedAt: new Date(), evaluationNote: note.slice(0, 600) }).where(eq(schema.aiAgentVersions.id, versionId));
}

