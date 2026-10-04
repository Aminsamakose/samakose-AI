import { inArray } from 'drizzle-orm';
import { env } from '@/lib/env';
import { schema } from '@/db/client';

export type ModelReply = { text: string; inputTokens: number; outputTokens: number };
export type Transport = (system: string, user: string, signal: AbortSignal, model?: string | null) => Promise<ModelReply>;
export const PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Choices saved on the System screen. They override the environment for provider, model and base URL. Keys always stay in the environment. */
export type AiConfig = { provider?: string; claudeModel?: string; openaiModel?: string; openaiBaseUrl?: string };
let cfg: AiConfig = {}; let loadedAt = 0;
export const AI_RULE_KEYS = ['ai.provider', 'ai.claude_model', 'ai.openai_model', 'ai.openai_base_url'] as const;
export const setAiConfig = (c: AiConfig | null) => { cfg = c ?? {}; loadedAt = c ? Date.now() : 0; };
/** Reads the saved choices, at most once every 30 seconds per server instance. A failed read keeps what was loaded before. */
export async function refreshAiConfig(db: { select: any }, force = false) {
  if (!force && Date.now() - loadedAt < 30_000) return;
  try {
    const rows: { key: string; value: string }[] = await db.select().from(schema.rules).where(inArray(schema.rules.key, [...AI_RULE_KEYS]));
    const m = new Map(rows.map((r) => [r.key, r.value.trim()]));
    cfg = { provider: m.get('ai.provider') || undefined, claudeModel: m.get('ai.claude_model') || undefined, openaiModel: m.get('ai.openai_model') || undefined, openaiBaseUrl: m.get('ai.openai_base_url') || undefined };
    loadedAt = Date.now();
  } catch { /* keep the previous values */ }
}
const baseUrl = () => (cfg.openaiBaseUrl ?? env.openaiBaseUrl).replace(/\/$/, '');

/** The provider chosen on the System screen, else the one named in AI_PROVIDER. An unknown name is treated as 'anthropic' so a typo never sends data somewhere unintended; the admin status shows what is active. */
export const activeProvider = (): Provider => { const n = (cfg.provider ?? env.aiProvider).trim().toLowerCase(); return ((PROVIDERS as readonly string[]).includes(n) ? n : 'anthropic') as Provider; };
export const providerKey = (p: Provider = activeProvider()) => (p === 'anthropic' ? env.claudeKey : env.openaiKey);
export const providerModel = (p: Provider = activeProvider()) => (p === 'anthropic' ? (cfg.claudeModel ?? env.claudeModel) : (cfg.openaiModel ?? env.openaiModel));
export const providerHasKey = (p: Provider = activeProvider()) => !!providerKey(p);
/** Where requests go, for the admin screen. Never includes a key. */
export const providerHost = (p: Provider = activeProvider()) => (p === 'anthropic' ? 'api.anthropic.com' : new URL(baseUrl()).host);

/** An agent version may pin a model name. A Claude model name means nothing to another provider, so it is ignored there and the provider's own model is used. */
export function modelFor(pinned: string | null | undefined, p: Provider = activeProvider()) {
  if (!pinned) return providerModel(p);
  const isClaude = /^claude/i.test(pinned);
  return p === 'anthropic' ? (isClaude ? pinned : providerModel(p)) : (isClaude ? providerModel(p) : pinned);
}

const anthropicTransport: Transport = async (system, user, signal, model) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': env.claudeKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: modelFor(model, 'anthropic'), max_tokens: 3000, temperature: 0.2, system, messages: [{ role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`Model service answered ${res.status}`);
  const j: any = await res.json();
  return { text: (j.content ?? []).map((b: any) => b.text ?? '').join(''), inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 };
};

/** OpenAI chat completions format. Newer models reject max_tokens and temperature, so only the common fields are sent and JSON output is requested. */
const openaiTransport: Transport = async (system, user, signal, model) => {
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.openaiKey}` },
    body: JSON.stringify({ model: modelFor(model, activeProvider()), response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`Model service answered ${res.status}`);
  const j: any = await res.json();
  return { text: String(j.choices?.[0]?.message?.content ?? ''), inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 };
};

export const transportFor = (p: Provider = activeProvider()): Transport => (p === 'anthropic' ? anthropicTransport : openaiTransport);
