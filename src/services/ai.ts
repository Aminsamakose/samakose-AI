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

export class NonRetryable extends Error {}
export type ModelReply = { text: string; inputTokens: number; outputTokens: number };
export type Transport = (system: string, user: string, signal: AbortSignal) => Promise<ModelReply>;

const claudeTransport: Transport = async (system, user, signal) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': env.claudeKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.claudeModel, max_tokens: 3000, temperature: 0.2, system, messages: [{ role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`Model service answered ${res.status}`);
  const j: any = await res.json();
  return { text: (j.content ?? []).map((b: any) => b.text ?? '').join(''), inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 };
};
let transportOverride: Transport | null = null;
/** Tests replace the transport to exercise retries and invalid output. */
export const setAiTransport = (t: Transport | null) => { transportOverride = t; };
export const aiIsMock = () => !transportOverride && !(env.aiMode === 'claude' && env.claudeKey);

export async function runAgent<T>(o: {
  agent: string; caseId: string | null; requestedBy: string | null; system: string; context: Record<string, unknown>;
  validate: (o: any) => string[]; mock: () => T; textOnly?: boolean;
}): Promise<{ output: T; requestId: string; requestCode: string }> {
  const payload = JSON.stringify(o.context);
  const mock = aiIsMock();
  const [req] = await db().insert(schema.aiRequests).values({ agent: o.agent, caseId: o.caseId, model: mock ? 'mock' : env.claudeModel, contextBytes: Buffer.byteLength(payload), requestedBy: o.requestedBy }).returning();
  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    let raw = '', inTok = 0, outTok = 0, error: string | null = null, parsed: any = null, problems: string[] = [];
    try {
      if (mock) { parsed = o.mock(); raw = JSON.stringify(parsed); }
      else {
        const r = await (transportOverride ?? claudeTransport)(o.system, payload + feedback, AbortSignal.timeout(45_000));
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

export const SYSTEM = {
  diagnosis: `You are the diagnostic analyst for a business advisory firm in Ghana. You receive scored diagnostic data for one business. Explain the weakest areas and their root causes using ONLY the evidence ids provided. Never invent evidence ids, figures or facts. Reply with JSON only: {"summary": string, "root_causes": [{"cause": string, "evidence_ids": [string]}], "priority": "High"|"Medium"|"Low", "risks": [{"text": string, "severity": "High"|"Medium"|"Low"}], "model_confidence": number between 0 and 1}.`,
  prescription: `You are a business advisor. Build a prescription from the approved intervention library ONLY: choose library ids from the list given and write concrete actions for a small business in Northern Ghana. Reply with JSON only: {"items": [{"library_id": string, "actions": [{"text": string, "owner_role": "OWNER"|"COACH"|"CONSULTANT", "deadline_days": integer within the allowed range}]}]}.`,
  brief: `You prepare a one page coaching brief from the case summary given. Reply with JSON only: {"brief": string}. Cover: where the business stands, what changed since last time, the three most useful questions to ask, and what to agree before closing.`,
  report: `You write a plain-language progress report for the owner of a small business. Use only the figures given. Do not overstate: say clearly which results rest on verified evidence and which are self-reported. Reply with JSON only: {"sections": [{"heading": string, "body": string}]}.`
};
