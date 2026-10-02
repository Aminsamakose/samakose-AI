/**
 * The AI gateway. Every model call goes through runAgent, which:
 * sends only the minimum context, asks for JSON, validates it against the rules,
 * retries once with the validation errors, and records every attempt.
 * AI_MODE=mock produces deterministic drafts from the same context, so the whole workflow runs without a key.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { env } from '@/lib/env';
import { extractJson } from '@/domain/logic';
import { gate } from './agent-gate';

export class NonRetryable extends Error {}
/** The registry refused the task: paused, disabled, over a limit, or not approved for the live model. Nothing was sent to a model. */
export class AgentBlocked extends NonRetryable {}
export type ModelReply = { text: string; inputTokens: number; outputTokens: number };
export type Transport = (system: string, user: string, signal: AbortSignal, model?: string | null) => Promise<ModelReply>;

const claudeTransport: Transport = async (system, user, signal, model) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': env.claudeKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model ?? env.claudeModel, max_tokens: 3000, temperature: 0.2, system, messages: [{ role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`Model service answered ${res.status}`);
  const j: any = await res.json();
  return { text: (j.content ?? []).map((b: any) => b.text ?? '').join(''), inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 };
};
let transportOverride: Transport | null = null;
/** Tests replace the transport to exercise retries and invalid output. */
export const setAiTransport = (t: Transport | null) => { transportOverride = t; };
export const aiIsMock = () => !transportOverride && !(env.aiMode === 'claude' && env.claudeKey);
let liveOverride: boolean | null = null;
/** True when requests would go to the real model. Tests can force it to exercise the live-model gate. */
export const aiIsLive = () => (liveOverride ?? (env.aiMode === 'claude' && !!env.claudeKey));
export const setAiLiveOverride = (v: boolean | null) => { liveOverride = v; };

export async function runAgent<T>(o: {
  agent: string; caseId: string | null; requestedBy: string | null; context: Record<string, unknown>;
  validate: (o: any) => string[]; mock: () => T; textOnly?: boolean;
  /** An evaluation run may use the live model while the agent is still in Testing or Evaluation. */
  evaluation?: boolean;
}): Promise<{ output: T; requestId: string; requestCode: string }> {
  const payload = JSON.stringify(o.context);
  const mock = aiIsMock();
  // The registry decides first. A refused task is recorded, nothing is sent to a model, and the requester is told.
  const g = await gate(db(), o.agent, { live: aiIsLive(), evaluation: o.evaluation });
  if (!g.ok) {
    await db().insert(schema.aiRequests).values({ agent: o.agent, caseId: o.caseId, model: mock ? 'mock' : env.claudeModel, contextBytes: Buffer.byteLength(payload), requestedBy: o.requestedBy, ok: false, agentId: g.agentId, agentVersionId: g.versionId, blockedReason: g.reason });
    throw new AgentBlocked(g.reason);
  }
  const [req] = await db().insert(schema.aiRequests).values({ agent: o.agent, caseId: o.caseId, model: mock ? 'mock' : (g.model ?? env.claudeModel), contextBytes: Buffer.byteLength(payload), requestedBy: o.requestedBy, agentId: g.agentId, agentVersionId: g.versionId }).returning();
  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    let raw = '', inTok = 0, outTok = 0, error: string | null = null, parsed: any = null, problems: string[] = [];
    try {
      if (mock) { parsed = o.mock(); raw = JSON.stringify(parsed); }
      else {
        const r = await (transportOverride ?? claudeTransport)(g.prompt, payload + feedback, AbortSignal.timeout(45_000), g.model);
        raw = r.text; inTok = r.inputTokens; outTok = r.outputTokens;
        parsed = extractJson(raw);
      }
      problems = parsed ? o.validate(parsed) : ['The reply was not valid JSON'];
    } catch (e) { error = String((e as Error).message ?? e).slice(0, 300); problems = [error]; }
    const valid = problems.length === 0 && !error;
    await db().insert(schema.aiAttempts).values({ requestId: req.id, attempt, valid, raw: raw.slice(0, 20_000), inputTokens: inTok, outputTokens: outTok, latencyMs: Date.now() - started, error: valid ? null : problems.join('; ').slice(0, 500) });
    if (valid) { await db().update(schema.aiRequests).set({ ok: true }).where(eq(schema.aiRequests.id, req.id)); return { output: parsed as T, requestId: req.id, requestCode: req.code }; }
    feedback = `\n\nYour previous answer was rejected for these reasons: ${problems.join('; ')}. Answer again with corrected JSON only.`;
  }
  await db().update(schema.aiRequests).set({ ok: false }).where(eq(schema.aiRequests.id, req.id));
  throw new NonRetryable(`The ${o.agent} agent did not produce a valid answer after two attempts`);
}

export { SYSTEM } from '@/domain/prompts';
