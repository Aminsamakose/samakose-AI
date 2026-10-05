/**
 * Model routing. Work is sent to the cheapest tier that can do it safely.
 *   Luna  high volume, simple work (reading, extracting, answering from published text)
 *   Sol   standard reasoning (briefs, reports)
 *   Astra complex reasoning (diagnosis, prescription), where being wrong costs the most
 * The tier names are platform names. The administrator maps each tier to a real model for each provider on the System screen.
 * A tier with no model set uses the provider's default model, so nothing changes until someone chooses.
 * Tiers choose a model only. They never change what an agent may do: scores stay deterministic and a human reviews every diagnosis and prescription.
 */
export const TIERS = ['luna', 'sol', 'astra'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = { luna: 'Luna (high volume)', sol: 'Sol (standard reasoning)', astra: 'Astra (complex reasoning)' };
export const AGENT_TIER: Record<string, Tier> = { enquiry: 'luna', opportunity_reader: 'luna', brief: 'sol', report: 'sol', opportunity_matcher: 'sol', diagnosis: 'astra', prescription: 'astra' };
export const tierOf = (agent: string): Tier => AGENT_TIER[agent] ?? 'sol';
/** Models are set per provider family, because a Claude model name means nothing to ChatGPT. */
export const FAMILIES = ['claude', 'openai'] as const;
export type Family = (typeof FAMILIES)[number];
export const tierKey = (t: Tier, f: Family) => `ai.tier.${t}.${f}`;
export const TIER_RULE_KEYS = TIERS.flatMap((t) => FAMILIES.map((f) => tierKey(t, f)));
