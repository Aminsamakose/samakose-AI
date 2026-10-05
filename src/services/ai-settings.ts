import { eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError } from '@/lib/errors';
import { env } from '@/lib/env';
import { allow, need } from './common';
import { AI_RULE_KEYS, PROVIDERS, activeProvider, modelFor, providerHasKey, providerHost, providerModel, refreshAiConfig, setAiConfig, transportFor, type Provider } from './ai-providers';
import { aiIsMock } from './ai';
import { TIERS, TIER_LABEL, FAMILIES, tierKey, AGENT_TIER } from '@/domain/model-tiers';

const LABEL: Record<Provider, string> = { anthropic: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)', 'openai-compatible': 'Other OpenAI-compatible service' };

export async function readAiSettings(ctx: Ctx) {
  allow(ctx, 'settings', 'read');
  await refreshAiConfig(ctx.db, true);
  const rows = await ctx.db.select().from(schema.rules);
  const m = new Map(rows.filter((r) => (AI_RULE_KEYS as readonly string[]).includes(r.key)).map((r) => [r.key, r]));
  const active = activeProvider();
  return {
    mode: aiIsMock() ? 'mock' : 'live', active, activeLabel: LABEL[active], host: providerHost(active), model: providerModel(active),
    chosen: m.get('ai.provider')?.value ?? null, claudeModel: m.get('ai.claude_model')?.value ?? '', openaiModel: m.get('ai.openai_model')?.value ?? '', openaiBaseUrl: m.get('ai.openai_base_url')?.value ?? '',
    tiers: TIERS.map((t) => ({ tier: t, label: TIER_LABEL[t], agents: Object.entries(AGENT_TIER).filter(([, v]) => v === t).map(([k]) => k), claude: m.get(tierKey(t, 'claude'))?.value ?? '', openai: m.get(tierKey(t, 'openai'))?.value ?? '' })),
    envDefaults: { provider: env.aiProvider, claudeModel: env.claudeModel, openaiModel: env.openaiModel, openaiBaseUrl: env.openaiBaseUrl },
    providers: PROVIDERS.map((p) => ({ id: p, label: LABEL[p], keySet: providerHasKey(p), keyName: p === 'anthropic' ? 'CLAUDE_API_KEY' : 'OPENAI_API_KEY' })),
    aiModeOn: env.aiMode === 'claude',
    updatedAt: m.get('ai.provider')?.updatedAt ?? null
  };
}

const modelOk = (v: string) => /^[A-Za-z0-9._:\/-]{2,80}$/.test(v);
function urlOk(v: string) {
  try { const u = new URL(v); if (u.protocol !== 'https:') return false; const h = u.hostname; if (h === 'localhost' || /^[\d.]+$/.test(h) || h.startsWith('[') || h.endsWith('.local') || h.endsWith('.internal')) return false; return !u.username && !u.password; } catch { return false; }
}

/** Changing provider sends client business data to a different company. It needs an explicit confirmation and a reason, and is recorded. */
export async function saveAiSettings(ctx: Ctx, b: { provider: Provider; claudeModel?: string; openaiModel?: string; openaiBaseUrl?: string; tiers?: Record<string, { claude?: string; openai?: string }>; confirm?: boolean; reason?: string }) {
  allow(ctx, 'settings', 'edit');
  const errs: Record<string, string> = {};
  if (b.claudeModel && !modelOk(b.claudeModel)) errs.claudeModel = 'Use letters, numbers, dots and dashes only';
  if (b.openaiModel && !modelOk(b.openaiModel)) errs.openaiModel = 'Use letters, numbers, dots and dashes only';
  for (const [t, v] of Object.entries(b.tiers ?? {})) {
    if (!(TIERS as readonly string[]).includes(t)) errs[`tier_${t}`] = 'Unknown tier';
    for (const f of FAMILIES) if (v?.[f] && !modelOk(v[f]!)) errs[`tier_${t}_${f}`] = 'Use letters, numbers, dots and dashes only';
  }
  if (b.openaiBaseUrl && !urlOk(b.openaiBaseUrl)) errs.openaiBaseUrl = 'Enter a public https address, for example https://api.openai.com/v1';
  if (b.provider === 'openai-compatible' && !b.openaiBaseUrl && !env.openaiBaseUrl) errs.openaiBaseUrl = 'An address is required for this option';
  const before = await readAiSettings(ctx);
  const changing = b.provider !== before.active;
  if (changing && b.confirm !== true) errs.confirm = 'Confirm that you understand client data will be sent to this provider';
  if (changing && (b.reason ?? '').trim().length < 10) errs.reason = 'Give a reason of at least 10 characters';
  if (Object.keys(errs).length) throw fieldError(errs);
  const uid = need(ctx).user.id;
  const put = async (key: string, value: string | undefined) => {
    if (!value) { await ctx.db.delete(schema.rules).where(eq(schema.rules.key, key)); return; }
    await ctx.db.insert(schema.rules).values({ key, value, updatedBy: uid }).onConflictDoUpdate({ target: schema.rules.key, set: { value, updatedBy: uid, updatedAt: new Date() } });
  };
  await put('ai.provider', b.provider); await put('ai.claude_model', b.claudeModel?.trim()); await put('ai.openai_model', b.openaiModel?.trim()); await put('ai.openai_base_url', b.openaiBaseUrl?.trim());
  if (b.tiers) for (const t of TIERS) for (const f of FAMILIES) if (b.tiers[t] && f in b.tiers[t]) await put(tierKey(t, f), b.tiers[t][f]?.trim());
  setAiConfig(null);
  await audit(ctx, changing ? 'settings.ai_provider_changed' : 'settings.ai_settings_changed', 'settings', null,
    { provider: before.active, model: before.model, host: before.host }, { provider: b.provider, claudeModel: b.claudeModel ?? null, openaiModel: b.openaiModel ?? null, openaiBaseUrl: b.openaiBaseUrl ?? null, tiers: b.tiers ?? null, reason: b.reason ?? null });
  return readAiSettings(ctx);
}

/** One tiny request to the chosen provider with a fixed harmless prompt. No client data is sent. */
export async function testAiProvider(ctx: Ctx) {
  allow(ctx, 'integrations', 'edit');
  await refreshAiConfig(ctx.db, true);
  const p = activeProvider();
  if (!providerHasKey(p)) return { ok: false, provider: p, message: `No key is set for ${LABEL[p]}. Add ${p === 'anthropic' ? 'CLAUDE_API_KEY' : 'OPENAI_API_KEY'} in the host settings and redeploy.` };
  const started = Date.now();
  try {
    const r = await transportFor(p)('Reply with the JSON {"ok":true} and nothing else.', 'Connection test.', AbortSignal.timeout(20_000), modelFor(null, p));
    await audit(ctx, 'settings.ai_provider_tested', 'settings', null, undefined, { provider: p, ok: true });
    return { ok: true, provider: p, message: `${LABEL[p]} answered in ${Date.now() - started} ms using ${providerModel(p)}.`, tokens: r.inputTokens + r.outputTokens };
  } catch (e) {
    await audit(ctx, 'settings.ai_provider_tested', 'settings', null, undefined, { provider: p, ok: false });
    return { ok: false, provider: p, message: `${LABEL[p]} did not answer: ${String((e as Error).message ?? e).slice(0, 160)}` };
  }
}
