/**
 * Two agents that work on opportunities. Pure functions, no database.
 *   Opportunity Reader (Luna)   turns the text of a call or advert into a draft opportunity for a person to check and publish.
 *   Opportunity Matcher (Sol)   explains, in plain words, why one business does or does not fit one opportunity, and what to do next.
 * Neither decides anything. Eligibility and ranking stay with the rules engine in unlock.ts, and a referral still needs the owner's consent and a person's approval.
 */
import { OPPORTUNITY_TYPES } from '@/db/schema';
import type { Evaluation } from './unlock';

export const READER_MAX_CHARS = 12_000;
const digits = (s: string) => s.replace(/[,\s]/g, '');
const REGIONS = ['Greater Accra', 'Ashanti', 'Northern', 'Upper East', 'Upper West', 'Savannah', 'North East', 'Bono', 'Bono East', 'Ahafo', 'Western', 'Western North', 'Central', 'Eastern', 'Volta', 'Oti'];
const SECTORS: [RegExp, string][] = [[/agri|farm|crop|grain|shea|cashew/i, 'Agribusiness'], [/retail|trading/i, 'Retail'], [/manufactur|processing/i, 'Manufacturing'], [/tailor|garment|textile/i, 'Textiles'], [/tourism|hospitality/i, 'Hospitality']];

export type ReaderOutput = {
  title: string; type: string; provider: string; summary: string; url: string | null;
  valueMin: number | null; valueMax: number | null; currency: string; deadline: string | null;
  criteria: Record<string, unknown>; uncertain: string[];
};

/** The reader may only report what the text says. Amounts, years and the deadline year must appear in the source. */
export function validateReading(o: any, source: string): string[] {
  const p: string[] = [];
  if (!o || typeof o !== 'object') return ['The reply is not an object'];
  if (typeof o.title !== 'string' || o.title.trim().length < 3) p.push('title missing');
  if (!(OPPORTUNITY_TYPES as readonly string[]).includes(o.type)) p.push(`type must be one of ${OPPORTUNITY_TYPES.join(', ')}`);
  if (typeof o.provider !== 'string' || !o.provider.trim()) p.push('provider missing');
  if (typeof o.summary !== 'string' || o.summary.trim().length < 10 || o.summary.length > 1200) p.push('summary must be 10 to 1200 characters');
  if (!Array.isArray(o.uncertain)) p.push('uncertain must be a list');
  const src = digits(source);
  for (const k of ['valueMin', 'valueMax'] as const) if (o[k] != null && (typeof o[k] !== 'number' || !src.includes(String(Math.round(o[k]))))) p.push(`${k} ${o[k]} does not appear in the text`);
  if (o.deadline != null) {
    if (typeof o.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.deadline) || Number.isNaN(Date.parse(o.deadline))) p.push('deadline must be YYYY-MM-DD');
    else if (!source.includes(o.deadline.slice(0, 4))) p.push('deadline year does not appear in the text');
  }
  const c = o.criteria;
  if (!c || typeof c !== 'object' || Array.isArray(c)) p.push('criteria must be an object');
  else {
    for (const k of ['minOverall', 'minYearsOperating'] as const) if (c[k] !== undefined && !src.includes(String(c[k]))) p.push(`criteria.${k} ${c[k]} does not appear in the text`);
    for (const k of ['regions', 'sectors', 'sizes', 'orgTypes', 'countries'] as const) for (const v of c[k] ?? []) if (typeof v !== 'string' || !source.toLowerCase().includes(v.toLowerCase())) p.push(`criteria.${k} "${v}" does not appear in the text`);
  }
  return p;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthNo = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3))) + 1;
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);
const CLOSING_CUE = /(deadline|closing date|clos(?:e|es|ing|ed)|apply (?:by|before|until)|applications? (?:due|by|before|until|must)|submit(?:ted)? (?:by|before)|due (?:on|by|date)|until|expires?|no later than|by)\W[^.\n]{0,50}$/i;
/** The closing date, only when the text ties a date to a closing word. A date with no such cue (a publication date, say) is never taken as the deadline. Day-first for numeric dates, as in Ghana. */
export function findDeadline(text: string): string | null {
  const found: { at: number; date: string }[] = [];
  const M = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)';
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) { const d = iso(+m[1], +m[2], +m[3]); if (d) found.push({ at: m.index!, date: d }); }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${M}\\.?,?\\s+(20\\d{2})\\b`, 'gi'))) { const d = iso(+m[3], monthNo(m[2]), +m[1]); if (d) found.push({ at: m.index!, date: d }); }
  for (const m of text.matchAll(new RegExp(`\\b${M}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, 'gi'))) { const d = iso(+m[3], monthNo(m[1]), +m[2]); if (d) found.push({ at: m.index!, date: d }); }
  for (const m of text.matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/g)) { const d = iso(+m[3], +m[2], +m[1]); if (d) found.push({ at: m.index!, date: d }); }
  const cued = found.filter((f) => CLOSING_CUE.test(text.slice(Math.max(0, f.at - 70), f.at)));
  if (!cued.length) return null;
  return cued.sort((a, b) => a.at - b.at)[0].date;
}

/** Wording that says the call is already over. */
const CLOSED = [/\b(applications?|call|calls|submissions?|window|registration|competition|programme|program|funding|opportunity)\s+(?:is|are|has|have|was|were)?\s*(?:now\s+|already\s+|officially\s+)?(?:closed|ended|expired)\b/i, /\bno longer (?:accepting|open|available|taking)\b/i, /\b(?:deadline|closing date)\s+(?:has|have)?\s*(?:already\s+)?(?:passed|elapsed|expired)\b/i, /\bclosed (?:call|opportunity|for applications|to applications)\b/i, /^\s*\[?closed\]?\s*[:\-]/i, /\b(?:this|the) (?:call|opportunity|programme|program) (?:has )?(?:closed|ended)\b/i, /\bapplications? (?:have )?(?:closed|ended)\b/i];
export const closedWording = (text: string) => CLOSED.some((r) => r.test(text));

/** The built-in stand-in used when no live model is on. Simple, honest and checked by the same validator. */
export function mockReading(source: string): ReaderOutput {
  // Lines that read as instructions to the reader are data, never followed and never mined for values.
  const lines = source.split('\n').map((l) => l.trim()).filter((l) => l && !/\b(ignore|disregard|forget)\b.*\b(instruction|rule|previous|above)s?\b|\bset the\b.*\b(score|amount|minimum)\b/i.test(l));
  const text = lines.join(' ').replace(/\s+/g, ' ');
  const amounts = [...text.matchAll(/(?:GH[S₵]|GHC|₵)\s?([\d][\d,]*)/gi)].map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => n > 0);
  const deadline = findDeadline(text);
  const type = /\bgrant\b/i.test(text) ? 'Grant' : /\bloan\b/i.test(text) ? 'Loan' : /\bequity|invest/i.test(text) ? 'Equity' : /\btender|procure/i.test(text) ? 'Procurement' : /\btrain|workshop/i.test(text) ? 'Training' : /\bprogramme|program\b/i.test(text) ? 'Programme' : 'Assistance';
  const regions = REGIONS.filter((r) => new RegExp(`\\b${r}\\b`, 'i').test(text)).filter((r) => !REGIONS.some((x) => x !== r && x.includes(r) && new RegExp(`\\b${x}\\b`, 'i').test(text)));
  const sectors = SECTORS.filter(([re]) => re.test(text)).map(([, s]) => s).filter((s) => text.toLowerCase().includes(s.toLowerCase()));
  const criteria: Record<string, unknown> = {};
  if (regions.length) criteria.regions = regions;
  if (sectors.length) criteria.sectors = sectors;
  const yrs = /at least (\d{1,2}) years?/i.exec(text)?.[1]; if (yrs) criteria.minYearsOperating = Number(yrs);
  const uncertain = ['Provider was not stated clearly', ...(deadline ? [] : ['No deadline found']), ...(amounts.length ? [] : ['No amount found']), 'Readiness requirements were not extracted. Add a minimum score or certification by hand if the call sets one'];
  return { title: lines[0]?.slice(0, 160) || 'Untitled opportunity', type, provider: 'Not stated', summary: text.slice(0, 600) || 'No summary found', url: null, valueMin: amounts.length ? Math.min(...amounts) : null, valueMax: amounts.length ? Math.max(...amounts) : null, currency: 'GHS', deadline, criteria, uncertain };
}

export type MatcherContext = {
  opportunity: { title: string; type: string; provider: string; summary: string; valueMin: number | null; valueMax: number | null; currency: string; deadline: string | null };
  match: Evaluation;
  readiness: { overall: number; maturity: string; confidence: string } | null;
};
export type MatcherOutput = { explanation: string; next_steps: string[]; caveat: string | null };

const PROMISE = /\b(guarantee[sd]?|will be approved|will receive|certain to (win|get|receive)|sure to (win|get)|you will (win|get|be awarded))\b/i;
const nums = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** The matcher may not change the verdict, promise an outcome, or invent a figure. */
export function validateMatch(o: any, c: MatcherContext): string[] {
  const p: string[] = [];
  if (!o || typeof o !== 'object') return ['The reply is not an object'];
  if (typeof o.explanation !== 'string' || o.explanation.trim().length < 20 || o.explanation.length > 1200) p.push('explanation must be 20 to 1200 characters');
  if (!Array.isArray(o.next_steps) || o.next_steps.length > 5 || o.next_steps.some((s: unknown) => typeof s !== 'string' || !s.trim() || (s as string).length > 240)) p.push('next_steps must be at most 5 short steps');
  const text = [o.explanation, ...(Array.isArray(o.next_steps) ? o.next_steps : []), o.caveat ?? ''].join(' ');
  if (PROMISE.test(text)) p.push('The text promises or guarantees an outcome');
  if (c.match.status !== 'Eligible' && /\byou (are|qualify as) eligible\b|\byou meet all\b/i.test(text)) p.push(`The verdict is "${c.match.status}", but the text says the business is eligible`);
  if (c.match.status === 'Not a fit' && Array.isArray(o.next_steps) && o.next_steps.some((s: string) => /\b(raise|improve|increase|reach|certif)/i.test(s))) p.push('A "Not a fit" result cannot be fixed by improving readiness, so do not suggest it');
  const allowed = new Set<number>([0, 1, 2, 3, 4, 5, 100, c.readiness?.overall ?? -1, c.opportunity.valueMin ?? -1, c.opportunity.valueMax ?? -1, ...nums(JSON.stringify(c.match)), ...nums(c.opportunity.deadline ?? ''), ...nums(c.opportunity.title), ...nums(c.opportunity.summary)]);
  for (const n of nums(text)) if (!allowed.has(n) && !allowed.has(n * 1000) && !allowed.has(n * 1_000_000)) p.push(`Number ${n} does not appear in the supplied data`);
  return p;
}

export function mockMatch(c: MatcherContext): MatcherOutput {
  const m = c.match;
  const steps = m.status === 'Not a fit' ? ['Look for opportunities that fit your sector, region and size.', 'Ask your adviser whether a different programme suits you.']
    : m.status === 'Eligible' ? ['Tell your adviser you want to be considered.', 'Agree what information may be shared before anything is sent.']
    : m.status === 'Unknown' ? ['Complete your Business Health check so we can compare you with the requirements.']
    : [...m.gaps.slice(0, 3).map((g) => g.label), 'Ask your adviser how your prescription can close these gaps.'];
  const head = m.status === 'Eligible' ? 'You meet what this opportunity asks for.' : m.status === 'Close' ? 'You are close. A few things stand between you and this opportunity.' : m.status === 'Not yet' ? 'You do not meet the readiness requirements yet.' : m.status === 'Unknown' ? 'We cannot compare you yet.' : 'This opportunity is not for your kind of business.';
  return { explanation: `${head} ${m.summary}${m.met.length ? ` What you already meet: ${m.met.join('; ')}.` : ''}`.slice(0, 1200), next_steps: steps, caveat: m.caution };
}
