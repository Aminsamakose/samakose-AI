/**
 * AI agent governance rules. Pure functions, no database.
 * An agent is a worker inside the platform. It has no login and no permissions of its own: it runs under the
 * requesting person's account and case scope. What it is allowed to do is a matter of status, autonomy and limits.
 */
export const AGENT_STATUSES = ['Draft', 'Configured', 'Testing', 'Evaluation', 'Approval required', 'Active', 'Paused', 'Disabled', 'Archived'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Autonomy is capped at Level 2. Levels 3 to 5 need a separate approval per action type and are not built. */
export const AUTONOMY_MAX = 2;
export const AUTONOMY_LABEL = ['Level 0: observe only', 'Level 1: assist, drafts for a human', 'Level 2: recommend, a human approves'] as const;

export const EVALUATIONS = ['Not run', 'Passed', 'Failed'] as const;
export type Evaluation = (typeof EVALUATIONS)[number];

export type AgentLimits = { requestsPerDay: number; requestsPerMonth: number; tokensPerDay: number; tokensPerMonth: number; alertPct: number; onLimit: 'throttle' | 'pause' };
/** Placeholders until a monthly cost cap is set. They stop a runaway loop, not normal use. */
export const DEFAULT_LIMITS: AgentLimits = { requestsPerDay: 200, requestsPerMonth: 3000, tokensPerDay: 400_000, tokensPerMonth: 6_000_000, alertPct: 80, onLimit: 'throttle' };

export type AgentConfig = {
  autonomy: number; tools: string[]; resources: string[]; permittedActions: string[]; forbiddenActions: string[]; approval: string; escalation: string;
};

/** Actions no agent may take, whatever its configuration. Shown on screen, enforced by there being no code path for them. */
export const ALWAYS_FORBIDDEN = [
  'Change or recompute an official score', 'Alter or delete audit records', 'Modify or delete source evidence', 'Approve its own output',
  'Certify an organisation', 'Change roles or permissions', 'Read another organisation\'s data', 'Bypass required human review'
] as const;

/** Allowed lifecycle moves. Pause and disable are available from any running state so an administrator can always stop an agent. */
const MOVES: Record<AgentStatus, AgentStatus[]> = {
  Draft: ['Configured', 'Disabled', 'Archived'],
  Configured: ['Testing', 'Draft', 'Paused', 'Disabled'],
  Testing: ['Evaluation', 'Configured', 'Paused', 'Disabled'],
  Evaluation: ['Approval required', 'Testing', 'Paused', 'Disabled'],
  'Approval required': ['Active', 'Evaluation', 'Testing', 'Paused', 'Disabled'],
  Active: ['Paused', 'Testing', 'Disabled'],
  Paused: ['Disabled'], // resume goes back to the status it was paused from
  Disabled: ['Testing', 'Archived'],
  Archived: ['Disabled'] // restore
};
export const nextStatuses = (s: AgentStatus): AgentStatus[] => MOVES[s] ?? [];
export const canMove = (from: AgentStatus, to: AgentStatus) => MOVES[from]?.includes(to) ?? false;
export const RUNNING: AgentStatus[] = ['Configured', 'Testing', 'Evaluation', 'Approval required', 'Active'];

export type RunDecision = { ok: true } | { ok: false; reason: string };
/**
 * May this agent take a task now?
 * On the mock model any agent in Testing, Evaluation, Approval required or Active may run, so the workflow can be exercised.
 * On the live model only an Active agent may run, and Active needs a passed evaluation of its current version.
 * An evaluation run is the one exception: it may use the live model while the agent is in Testing or Evaluation.
 */
export function mayRun(status: AgentStatus, autonomy: number, o: { live: boolean; evaluation?: boolean }): RunDecision {
  if (status === 'Paused') return { ok: false, reason: 'This agent is paused by an administrator' };
  if (status === 'Disabled') return { ok: false, reason: 'This agent is disabled' };
  if (status === 'Archived') return { ok: false, reason: 'This agent is archived' };
  if (status === 'Draft' || status === 'Configured') return { ok: false, reason: 'This agent has not reached testing yet' };
  if (autonomy < 1) return { ok: false, reason: 'This agent is set to observe only, so it cannot produce drafts' };
  if (o.live && status !== 'Active' && !(o.evaluation && (status === 'Testing' || status === 'Evaluation'))) return { ok: false, reason: 'This agent is not approved for the live model. It needs a passed evaluation and administrator approval' };
  return { ok: true };
}

export type Usage = { requestsDay: number; requestsMonth: number; tokensDay: number; tokensMonth: number };
export type LimitState = { state: 'ok' | 'warn' | 'over'; worst: number; hit: string | null };
/** Compare usage with limits. A limit of 0 means no limit. */
export function limitState(u: Usage, l: AgentLimits): LimitState {
  const checks: [string, number, number][] = [
    ['requests today', u.requestsDay, l.requestsPerDay], ['requests this month', u.requestsMonth, l.requestsPerMonth],
    ['tokens today', u.tokensDay, l.tokensPerDay], ['tokens this month', u.tokensMonth, l.tokensPerMonth]
  ];
  let worst = 0, hit: string | null = null;
  for (const [name, used, cap] of checks) {
    if (!cap) continue;
    const r = used / cap;
    if (r > worst) { worst = r; hit = name; }
  }
  const state = worst >= 1 ? 'over' : worst >= l.alertPct / 100 ? 'warn' : 'ok';
  return { state, worst, hit };
}

export function normaliseLimits(raw: Partial<AgentLimits> | null | undefined): AgentLimits {
  const r = raw ?? {};
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : d);
  return {
    requestsPerDay: n(r.requestsPerDay, DEFAULT_LIMITS.requestsPerDay), requestsPerMonth: n(r.requestsPerMonth, DEFAULT_LIMITS.requestsPerMonth),
    tokensPerDay: n(r.tokensPerDay, DEFAULT_LIMITS.tokensPerDay), tokensPerMonth: n(r.tokensPerMonth, DEFAULT_LIMITS.tokensPerMonth),
    alertPct: Math.min(99, Math.max(1, n(r.alertPct, DEFAULT_LIMITS.alertPct))), onLimit: r.onLimit === 'pause' ? 'pause' : 'throttle'
  };
}

export function validateConfig(c: Partial<AgentConfig>): string[] {
  const p: string[] = [];
  if (c.autonomy === undefined || !Number.isInteger(c.autonomy) || c.autonomy < 0) p.push('Autonomy must be 0, 1 or 2');
  else if (c.autonomy > AUTONOMY_MAX) p.push(`Autonomy above Level ${AUTONOMY_MAX} is not available. It needs a separate approval per action type`);
  for (const k of ['tools', 'resources', 'permittedActions', 'forbiddenActions'] as const) if (c[k] !== undefined && !Array.isArray(c[k])) p.push(`${k} must be a list`);
  const permitted = (c.permittedActions ?? []).map((a) => a.toLowerCase());
  for (const f of ['certify', 'approve its own', 'delete evidence', 'change score', 'override score', 'alter audit', 'bypass']) if (permitted.some((a) => a.includes(f))) p.push(`An agent may not be permitted to "${f}"`);
  return p;
}

/** Estimated live AI spend this month against the platform cap. A cap of 0 means no cap. */
export function costState(inputTokens: number, outputTokens: number, r: { cap: number; inPerM: number; outPerM: number; alertPct?: number }) {
  const spend = (inputTokens / 1e6) * r.inPerM + (outputTokens / 1e6) * r.outPerM;
  const share = r.cap > 0 ? spend / r.cap : 0;
  const state: 'ok' | 'warn' | 'over' = r.cap > 0 && share >= 1 ? 'over' : r.cap > 0 && share >= (r.alertPct ?? 80) / 100 ? 'warn' : 'ok';
  return { spend: Math.round(spend * 100) / 100, cap: r.cap, share, state };
}
