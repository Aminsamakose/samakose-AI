/**
 * Opportunity Scout: pure helpers. No network, no database.
 * The Scout only finds candidate calls. A candidate is read by the Opportunity Reader, saved as a Draft, and a person decides whether to publish.
 */
export type Candidate = { url: string; title: string; text: string; published: string | null };

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
export const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => entities[m] ?? m).replace(/&#(\d{2,5});/g, (_, n) => { const c = Number(n); return c > 31 && c < 65536 ? String.fromCharCode(c) : ' '; });

/** Visible text of an HTML page. Scripts, styles and markup are dropped. */
export function htmlToText(html: string, max = 12_000): string {
  const t = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decode(t).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*/g, '\n').trim().slice(0, max);
}
export const pageTitle = (html: string) => decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (!m) return '';
  return decode(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).trim();
};
/** RSS 2.0 and Atom. Returns at most `limit` items, newest first as the feed gives them. */
export function parseFeed(xml: string, limit = 30): Candidate[] {
  const out: Candidate[] = [];
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  for (const b of blocks) {
    const body = b[2];
    const href = /<link[^>]*\shref=["']([^"']+)["']/i.exec(body)?.[1];
    const url = (href ?? tag(body, 'link') ?? '').trim();
    const title = tag(body, 'title').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const desc = tag(body, 'description') || tag(body, 'summary') || tag(body, 'content');
    const published = tag(body, 'pubDate') || tag(body, 'published') || tag(body, 'updated') || null;
    if (!url || !title) continue;
    out.push({ url, title: title.slice(0, 200), text: htmlToText(desc, 4000), published });
    if (out.length >= limit) break;
  }
  return out;
}

const CALL_WORDS = /\b(call for (proposals|applications|expressions)|grant|fund(ing)?|apply|application|deadline|loan|fellowship|accelerator|incubator|tender|rfp|rfq|eoi|award|scholarship|competition|challenge|programme|program|opportunit)/i;
/** Cheap first filter, so only plausible calls reach the Reader. */
export const looksLikeCall = (c: { title: string; text: string }) => CALL_WORDS.test(`${c.title} ${c.text.slice(0, 600)}`);

const SCAM = [/\b(processing|registration|application|administrative|claim)\s+fee\b/i, /\bpay(ment)?\s+(a|the)?\s*(fee|deposit)\s+(to|before)\b/i, /\bwestern union|moneygram|gift card|bitcoin\b/i, /\blottery|you have (been )?won\b/i, /\bwhatsapp\s*(us|number|:)/i, /\bsend (your )?(bank|account|passport|ssn)\b/i];
export const scamSignals = (text: string) => SCAM.filter((r) => r.test(text)).length;

import { closedWording } from './opportunity-agents';
export type Screen = { ok: true } | { ok: false; reason: 'Expired' | 'Already closed' | 'Looks out of date' | 'Suspected scam wording' | 'Too little text' | 'Not a call' };
/** Decides whether a read candidate may become a Draft. A rejection is counted, never silently dropped. */
export function screenCandidate(c: { title: string; text: string; published?: string | null }, reading: { deadline: string | null }, today = new Date()): Screen {
  if (c.text.trim().length < 80) return { ok: false, reason: 'Too little text' };
  if (!looksLikeCall(c)) return { ok: false, reason: 'Not a call' };
  if (scamSignals(`${c.title} ${c.text}`) > 0) return { ok: false, reason: 'Suspected scam wording' };
  if (reading.deadline && reading.deadline < today.toISOString().slice(0, 10)) return { ok: false, reason: 'Expired' };
  if (closedWording(`${c.title}\n${c.text}`)) return { ok: false, reason: 'Already closed' };
  if (!reading.deadline) {
    // No closing date found: keep it only if nothing says it is old. The latest year mentioned must be this year or later, and a feed date must be recent.
    const years = [...`${c.title} ${c.text}`.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
    if (years.length && Math.max(...years) < today.getUTCFullYear()) return { ok: false, reason: 'Looks out of date' };
    const pub = c.published ? Date.parse(c.published) : NaN;
    if (!Number.isNaN(pub) && today.getTime() - pub > 400 * 24 * 3600 * 1000) return { ok: false, reason: 'Looks out of date' };
  }
  return { ok: true };
}

export const normaliseUrl = (u: string) => { try { const x = new URL(u); x.hash = ''; ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((k) => x.searchParams.delete(k)); return x.toString().replace(/\/$/, ''); } catch { return u; } };
const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const titleKey = (title: string, provider: string) => `${squash(title)}|${squash(provider)}`;

/** robots.txt: true when our agent may fetch the path. Only the User-agent: * and our own group are read. */
export function robotsAllows(robots: string, path: string, agent = 'businessdoctorscout'): boolean {
  let applies = false, matched = false; const disallow: string[] = [], allow: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const i = line.indexOf(':'); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k === 'user-agent') { applies = v === '*' || v.toLowerCase().includes(agent); if (applies) matched = true; }
    else if (applies && k === 'disallow' && v) disallow.push(v);
    else if (applies && k === 'allow' && v) allow.push(v);
  }
  if (!matched) return true;
  const longest = (l: string[]) => l.filter((p) => path.startsWith(p.replace(/\*$/, ''))).reduce((n, p) => Math.max(n, p.length), -1);
  return longest(allow) >= longest(disallow);
}

export const REGIONS = ['Ghana', 'West Africa', 'Africa', 'Europe', 'North America', 'Asia', 'Global'] as const;
/** Starter search queries. Safe to add because they carry no web address to get wrong. Each runs only within the free quota. */
export const STARTER_QUERIES: { name: string; query: string; region: (typeof REGIONS)[number] }[] = [
  { name: 'Ghana agribusiness grants', query: 'call for proposals agribusiness grant Ghana SMEs', region: 'Ghana' },
  { name: 'Ghana SME funding', query: 'SME funding application open Ghana small business loan grant', region: 'Ghana' },
  { name: 'Northern Ghana programmes', query: 'Northern Ghana programme call for applications enterprises women youth', region: 'Ghana' },
  { name: 'West Africa accelerators', query: 'accelerator programme applications open West Africa startups agribusiness', region: 'West Africa' },
  { name: 'Africa agri-food funding', query: 'Africa agrifood small and medium enterprises grant call 2026', region: 'Africa' },
  { name: 'Africa women entrepreneurs', query: 'Africa women entrepreneurs funding call for applications', region: 'Africa' },
  { name: 'Africa social enterprise grants', query: 'social enterprise grant Africa open call development partners', region: 'Africa' },
  { name: 'Europe Africa cooperation', query: 'EU Africa partnership call for proposals SMEs private sector development', region: 'Europe' },
  { name: 'Europe climate agriculture', query: 'European funding call climate resilient agriculture Africa enterprises', region: 'Europe' },
  { name: 'North America Africa grants', query: 'foundation grant Africa enterprise development open application', region: 'North America' },
  { name: 'Global investment readiness', query: 'investment readiness programme open applications emerging markets SMEs', region: 'Global' },
  { name: 'Platform: fundsforngos', query: 'site:fundsforngos.org Africa OR Ghana grants open', region: 'Global' },
  { name: 'Platform: Opportunity Desk', query: 'site:opportunitydesk.org Africa funding grant', region: 'Africa' },
  { name: 'Platform: ReliefWeb', query: 'site:reliefweb.int funding opportunities Ghana', region: 'Ghana' },
  { name: 'Platform: EU Funding and Tenders', query: 'site:ec.europa.eu funding tenders call Africa SMEs', region: 'Europe' },
  { name: 'Platform: Grants.gov', query: 'site:grants.gov Africa Ghana', region: 'North America' },
  { name: 'Platform: UNGM', query: 'site:ungm.org Ghana notice', region: 'Global' },
  { name: 'Platform: Devex', query: 'site:devex.com funding opportunity Ghana Africa', region: 'Global' },
  { name: 'Platform: LinkedIn calls', query: 'site:linkedin.com call for applications grant Ghana SMEs', region: 'Ghana' },
  { name: 'Global cooperative funding', query: 'cooperatives funding call producer organisations Africa', region: 'Global' }
];
