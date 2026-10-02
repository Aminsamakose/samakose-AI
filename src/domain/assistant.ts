/**
 * Enquiry Assistant rules. Pure functions, no database.
 * The assistant answers visitors only from published website content. It gives no scores, prices or promises,
 * and anything it cannot answer from that content goes to a person.
 */
import { hasForbiddenClaim } from './logic';

export type Passage = { title: string; text: string; href?: string };
export type AssistantReply = { reply: string; handoff: boolean; sources: string[] };

const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'what', 'how', 'can', 'does', 'with', 'this', 'that', 'have', 'from', 'about', 'will', 'our', 'who', 'why', 'when', 'where', 'is', 'it', 'to', 'of', 'in', 'on', 'a', 'an', 'do', 'we', 'i', 'my', 'me']);
export const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/** Passages that share words with the question, best first. A passage with no shared word is never returned. */
export function rank(question: string, passages: Passage[], top = 3): Passage[] {
  const q = new Set(tokens(question));
  if (!q.size) return [];
  return passages.map((p) => { const t = new Set(tokens(`${p.title} ${p.text}`)); let hit = 0; for (const w of q) if (t.has(w)) hit++; return { p, hit }; })
    .filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit).slice(0, top).map((x) => x.p);
}

export const HANDOFF = 'I can only answer from what is published on this website, and I could not find that here. Please send your question to our team and a person will reply.';
const PRICE = /(GH[S₵]|US\$|USD|\$|₵)\s?\d|\b\d[\d,.]*\s?(ghs|usd|cedis|dollars)\b/i;
const PROMISE = /\b(guarantee[sd]?|promise[sd]?|we will certainly|definitely will)\b/i;
const SCORE = /\b(your|their) (health )?score (is|will be)\b/i;

/** What a reply may never contain, whatever the model wrote. */
export function validateReply(o: any): string[] {
  const p: string[] = [];
  if (!o || typeof o.reply !== 'string' || !o.reply.trim()) return ['reply is required'];
  if (o.reply.length > 900) p.push('The reply is too long');
  if (typeof o.handoff !== 'boolean') p.push('handoff must be true or false');
  if (hasForbiddenClaim(o.reply)) p.push('The reply makes a certification, guarantee or readiness claim');
  if (PRICE.test(o.reply)) p.push('The reply quotes a price');
  if (PROMISE.test(o.reply)) p.push('The reply makes a promise');
  if (SCORE.test(o.reply)) p.push('The reply states a score');
  if (/https?:\/\//i.test(o.reply)) p.push('The reply contains a web address');
  return p;
}

/** The built-in model for tests and for when no live key is set: quotes the best matching published passage, or hands over. */
export function mockAssistant(question: string, passages: Passage[]): AssistantReply {
  const best = rank(question, passages, 2);
  if (!best.length) return { reply: HANDOFF, handoff: true, sources: [] };
  const text = best[0].text.length > 600 ? `${best[0].text.slice(0, 600).replace(/\s+\S*$/, '')}...` : best[0].text;
  return { reply: text, handoff: false, sources: best.map((b) => b.title) };
}
