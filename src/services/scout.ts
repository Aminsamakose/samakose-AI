/**
 * Opportunity Scout (Luna tier work, run by the weekly job).
 * Finds candidate calls from feeds, pages and search queries, has the Opportunity Reader read each one, screens it, and saves a Draft.
 * It never publishes. A person reviews every Draft. Every source is read at most about once a week, within a time budget and a free search allowance.
 */
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { env } from '@/lib/env';
import { audit } from '@/lib/audit';
import { conflict, notFound, unprocessable } from '@/lib/errors';
import { notifyUsers } from '@/domain/notify';
import { allow } from './common';
import { AgentBlocked, NonRetryable, runAgent } from './ai';
import { publicHttpsUrl } from './ai-providers';
import { criteriaSchema } from './unlock';
import { mockReading, validateReading, type ReaderOutput } from '@/domain/opportunity-agents';
import { REGIONS, STARTER_QUERIES, htmlToText, looksLikeCall, normaliseUrl, pageTitle, parseFeed, robotsAllows, screenCandidate, titleKey, type Candidate } from '@/domain/scout';

const S = schema.opportunitySources, O = schema.opportunities, R = schema.scoutRuns;
export const SCOUT_SOURCE = 'scout';
const UA = 'BusinessDoctorScout/1.0 (+https://samakose-ai.vercel.app)';
const WEEK_MS = 6 * 24 * 3600 * 1000;
const PER_SOURCE = 8, MAX_BYTES = 1_000_000;

/* ------------------------------- fetching ------------------------------- */
export type FetchResult = { status: number; text: string; type: string; url: string };
type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResult>;
const realFetch: Fetcher = async (url, init) => {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!publicHttpsUrl(cur)) throw new Error('Only public https addresses are read');
    const res = await fetch(cur, { method: init?.method ?? 'GET', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml,application/json;q=0.8,*/*;q=0.5', ...(init?.headers ?? {}) }, body: init?.body, redirect: 'manual', signal: AbortSignal.timeout(9000) });
    if ([301, 302, 303, 307, 308].includes(res.status)) { const loc = res.headers.get('location'); if (!loc) throw new Error('Bad redirect'); cur = new URL(loc, cur).toString(); continue; }
    const type = res.headers.get('content-type') ?? '';
    if (!/(text|xml|json)/i.test(type)) throw new Error(`Not a readable page (${type || 'unknown type'})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, text: new TextDecoder().decode(buf.slice(0, MAX_BYTES)), type, url: cur };
  }
  throw new Error('Too many redirects');
};
let fetcher: Fetcher = realFetch;
/** Tests replace the network. Pass null to restore. */
export const setScoutFetch = (f: Fetcher | null) => { fetcher = f ?? realFetch; };

async function allowedByRobots(url: string) {
  try { const u = new URL(url); const r = await fetcher(`${u.origin}/robots.txt`); if (r.status !== 200) return true; return robotsAllows(r.text, u.pathname + u.search); } catch { return true; }
}

/* -------------------------------- search -------------------------------- */
export const searchStatus = async (db: Ctx['db']) => {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const [u] = await db.select({ n: sql<number>`coalesce(sum(${R.searches}), 0)::int` }).from(R).where(gte(R.startedAt, start));
  const provider = env.scoutProvider;
  const known = ['brave', 'tavily', 'serper', 'google'].includes(provider);
  const configured = known && !!env.scoutKey && (provider !== 'google' || !!env.scoutCx);
  return { provider: known ? provider : 'none', configured, monthlyLimit: env.scoutMonthlyLimit, usedThisMonth: u?.n ?? 0, remaining: configured ? Math.max(0, env.scoutMonthlyLimit - (u?.n ?? 0)) : 0 };
};

async function searchWeb(q: string): Promise<Candidate[]> {
  const p = env.scoutProvider, k = env.scoutKey, enc = encodeURIComponent(q);
  const J = (r: FetchResult) => { try { return JSON.parse(r.text); } catch { throw new Error('Search service sent an unreadable answer'); } };
  const ok = (r: FetchResult) => { if (r.status !== 200) throw new Error(`Search service answered ${r.status}`); return r; };
  let rows: { title: string; url: string; text: string }[] = [];
  if (p === 'brave') rows = (J(ok(await fetcher(`https://api.search.brave.com/res/v1/web/search?q=${enc}&count=8`, { headers: { 'x-subscription-token': k, accept: 'application/json' } }))).web?.results ?? []).map((x: any) => ({ title: x.title, url: x.url, text: x.description ?? '' }));
  else if (p === 'tavily') rows = (J(ok(await fetcher('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${k}` }, body: JSON.stringify({ query: q, max_results: 8 }) }))).results ?? []).map((x: any) => ({ title: x.title, url: x.url, text: x.content ?? '' }));
  else if (p === 'serper') rows = (J(ok(await fetcher('https://google.serper.dev/search', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': k }, body: JSON.stringify({ q, num: 8 }) }))).organic ?? []).map((x: any) => ({ title: x.title, url: x.link, text: x.snippet ?? '' }));
  else if (p === 'google') rows = (J(ok(await fetcher(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(k)}&cx=${encodeURIComponent(env.scoutCx)}&q=${enc}&num=8`))).items ?? []).map((x: any) => ({ title: x.title, url: x.link, text: x.snippet ?? '' }));
  else throw new Error('No search provider is set');
  return rows.filter((x) => typeof x.url === 'string' && typeof x.title === 'string').map((x) => ({ url: x.url, title: String(x.title).slice(0, 200), text: String(x.text).slice(0, 1000), published: null }));
}

/* ------------------------------ candidates ------------------------------ */
type Src = typeof S.$inferSelect;
export async function candidatesFor(src: Pick<Src, 'kind' | 'url' | 'query' | 'name'>): Promise<{ items: Candidate[]; searches: number }> {
  if (src.kind === 'query') return { items: await searchWeb(src.query!), searches: 1 };
  const r = await fetcher(src.url!);
  if (r.status !== 200) throw new Error(`The address answered ${r.status}`);
  if (src.kind === 'feed') { const items = parseFeed(r.text); if (!items.length) throw new Error('No items found. Check that this is an RSS or Atom feed'); return { items, searches: 0 }; }
  return { items: [{ url: r.url, title: pageTitle(r.text) || src.name, text: htmlToText(r.text), published: null }], searches: 0 };
}

/* --------------------------------- run ---------------------------------- */
export type RunResult = { runId: string; sources: number; candidates: number; drafted: number; skipped: Record<string, number>; failed: number; searches: number; note: string | null };

async function readOne(c: Candidate, srcName: string, db: Ctx['db']): Promise<'drafted' | string> {
  const url = normaliseUrl(c.url);
  if (!publicHttpsUrl(url)) return 'Not a public https address';
  const [seen] = await db.select({ id: O.id }).from(O).where(and(eq(O.source, SCOUT_SOURCE), eq(O.sourceRef, url))).limit(1);
  if (seen) return 'Already found';
  let text = c.text;
  if (text.length < 400) {
    if (!(await allowedByRobots(url))) return 'Site asks not to be read';
    try { const r = await fetcher(url); if (r.status === 200) text = htmlToText(/html/i.test(r.type) ? r.text : r.text.replace(/<[^>]+>/g, ' ')); } catch { /* the snippet is all we have */ }
  }
  const cand = { title: c.title, text };
  if (!looksLikeCall(cand)) return 'Not a call';
  let reading: ReaderOutput;
  try {
    const res = await runAgent({ agent: 'opportunity_reader', caseId: null, requestedBy: null, context: { text: text.slice(0, 12_000) }, validate: (o) => validateReading(o, text.slice(0, 12_000)), mock: () => mockReading(text.slice(0, 12_000)) });
    reading = res.output as ReaderOutput;
  } catch (e) { if (e instanceof AgentBlocked) throw e; if (e instanceof NonRetryable) return 'Could not be read'; return 'Could not be read'; }
  const screen = screenCandidate(cand, reading);
  if (!screen.ok) return screen.reason;
  const parsed = criteriaSchema.safeParse(reading.criteria);
  const provider = reading.provider && reading.provider !== 'Not stated' ? reading.provider.trim().slice(0, 160) : srcName.slice(0, 160);
  const title = (reading.title || c.title).trim().slice(0, 160);
  const key = titleKey(title, provider);
  const same = await db.select({ t: O.title, p: O.provider }).from(O).where(and(sql`${O.status} <> 'Archived'`, sql`lower(${O.title}) = lower(${title})`)).limit(20);
  if (same.some((x) => titleKey(x.t, x.p) === key)) return 'Duplicate';
  const vMin = reading.valueMin, vMax = reading.valueMax;
  const rows = await db.insert(O).values({
    title, type: reading.type, provider, summary: reading.summary.trim().slice(0, 1200), url, valueMin: vMin == null ? null : String(vMin), valueMax: vMax == null ? null : String(vMax),
    currency: (reading.currency || 'GHS').slice(0, 8), deadline: reading.deadline, criteria: (parsed.success ? parsed.data : {}) as Record<string, unknown>, source: SCOUT_SOURCE, sourceRef: url
  }).onConflictDoNothing().returning({ id: O.id });
  return rows.length ? 'drafted' : 'Already found';
}

/** One pass. Reads the sources that are due, oldest first, until the time budget or the search allowance runs out. Safe to call daily. */
export async function runScout(o: { db?: Ctx['db']; budgetMs?: number; sourceIds?: string[]; actor?: string | null } = {}): Promise<RunResult> {
  const db = o.db ?? defaultDb(); const budget = o.budgetMs ?? 35_000; const t0 = Date.now();
  const [run] = await db.insert(R).values({}).returning();
  const due = o.sourceIds?.length
    ? await db.select().from(S).where(inArray(S.id, o.sourceIds))
    : await db.select().from(S).where(and(eq(S.active, true), or(isNull(S.lastRunAt), lt(S.lastRunAt, new Date(Date.now() - WEEK_MS))))).orderBy(sql`${S.lastRunAt} asc nulls first`, asc(S.createdAt)).limit(60);
  const sc = await searchStatus(db);
  let remaining = sc.remaining, sources = 0, candidates = 0, drafted = 0, failed = 0, searches = 0; const skipped: Record<string, number> = {}; let note: string | null = null;
  const skip = (r: string) => { skipped[r] = (skipped[r] ?? 0) + 1; };
  outer: for (const s of due) {
    if (Date.now() - t0 > budget) { note = 'Time budget reached. The remaining sources run next time.'; break; }
    if (s.kind === 'query' && remaining <= 0) { await db.update(S).set({ lastStatus: sc.configured ? 'Monthly free limit reached' : 'Search not set up' }).where(eq(S.id, s.id)); continue; }
    sources++;
    let found = 0, status = 'OK';
    try {
      const { items, searches: n } = await candidatesFor(s);
      searches += n; remaining -= n;
      for (const c of items.slice(0, PER_SOURCE)) {
        if (Date.now() - t0 > budget) { note = 'Time budget reached. The remaining items run next time.'; break; }
        candidates++;
        let r: string;
        try { r = await readOne(c, s.name, db); } catch (e) { if (e instanceof AgentBlocked) { note = `Opportunity Reader is not available: ${e.message}`; status = 'Reader unavailable'; await db.update(S).set({ lastStatus: status }).where(eq(S.id, s.id)); break outer; } throw e; }
        if (r === 'drafted') { drafted++; found++; } else skip(r);
      }
    } catch (e: any) { failed++; status = `Error: ${String(e?.message ?? e).slice(0, 160)}`; }
    await db.update(S).set({ lastRunAt: new Date(), lastStatus: status, lastFound: found, updatedAt: new Date() }).where(eq(S.id, s.id));
  }
  const skippedN = Object.values(skipped).reduce((a, b) => a + b, 0);
  await db.update(R).set({ finishedAt: new Date(), sources, candidates, drafted, skipped: skippedN, failed, searches, note }).where(eq(R.id, run.id));
  if (drafted > 0) {
    const staff = await db.select({ id: schema.users.id }).from(schema.users).where(and(inArray(schema.users.role, ['ADMIN', 'PROGRAMME_MANAGER']), eq(schema.users.active, true)));
    const ctx = { user: null, ip: 'scout', requestId: `scout-${run.id.slice(0, 8)}`, db, after: () => undefined } as unknown as Ctx;
    await notifyUsers(ctx, staff.map((x) => x.id), { kind: 'ScoutFound', title: `${drafted} new opportunit${drafted === 1 ? 'y' : 'ies'} found`, body: 'The Opportunity Scout saved new drafts for review. Nothing is published until you approve it.', link: '/admin/opportunity-sources' });
  }
  return { runId: run.id, sources, candidates, drafted, skipped, failed, searches, note };
}

/* ------------------------------ management ------------------------------ */
export type SourceInput = { name: string; kind: 'feed' | 'page' | 'query'; url?: string | null; query?: string | null; region?: string; active?: boolean };
function checkSource(b: SourceInput) {
  if (b.kind === 'query') { if (!b.query || b.query.trim().length < 3) throw unprocessable('Write the search words, at least three characters'); }
  else { if (!b.url || !publicHttpsUrl(b.url.trim())) throw unprocessable('The address must be a public https address'); }
  if (b.region && !(REGIONS as readonly string[]).includes(b.region)) throw unprocessable(`Region must be one of ${REGIONS.join(', ')}`);
}
const view = (x: Src) => ({ id: x.id, name: x.name, kind: x.kind, url: x.url, query: x.query, region: x.region, active: x.active, lastRunAt: x.lastRunAt, lastStatus: x.lastStatus, lastFound: x.lastFound });

export async function listSources(ctx: Ctx) {
  allow(ctx, 'opportunities', 'create');
  const items = await ctx.db.select().from(S).orderBy(asc(S.region), asc(S.name));
  const runs = await ctx.db.select().from(R).orderBy(sql`${R.startedAt} desc`).limit(8);
  const [pending] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(O).where(and(eq(O.source, SCOUT_SOURCE), eq(O.status, 'Draft')));
  return { items: items.map(view), search: await searchStatus(ctx.db), runs, draftsToReview: pending?.n ?? 0, regions: REGIONS };
}
export async function addSource(ctx: Ctx, b: SourceInput) {
  allow(ctx, 'opportunities', 'create'); checkSource(b);
  const [row] = await ctx.db.insert(S).values({ name: b.name.trim(), kind: b.kind, url: b.kind === 'query' ? null : b.url!.trim(), query: b.kind === 'query' ? b.query!.trim() : null, region: b.region ?? 'Global', active: b.active ?? true, createdBy: ctx.user!.id }).returning();
  await audit(ctx, 'scout.source_added', 'opportunity_source', row.id, undefined, { name: row.name, kind: row.kind });
  return view(row);
}
export async function updateSource(ctx: Ctx, id: string, b: Partial<SourceInput>) {
  allow(ctx, 'opportunities', 'edit');
  const [cur] = await ctx.db.select().from(S).where(eq(S.id, id)).limit(1); if (!cur) throw notFound('Source not found');
  const next = { name: b.name ?? cur.name, kind: (b.kind ?? cur.kind) as SourceInput['kind'], url: b.url !== undefined ? b.url : cur.url, query: b.query !== undefined ? b.query : cur.query, region: b.region ?? cur.region };
  checkSource(next);
  const [row] = await ctx.db.update(S).set({ name: next.name.trim(), kind: next.kind, url: next.kind === 'query' ? null : next.url!.trim(), query: next.kind === 'query' ? next.query!.trim() : null, region: next.region, ...(b.active !== undefined ? { active: b.active } : {}), updatedAt: new Date() }).where(eq(S.id, id)).returning();
  await audit(ctx, 'scout.source_updated', 'opportunity_source', id, undefined, { fields: Object.keys(b) });
  return view(row);
}
export async function removeSource(ctx: Ctx, id: string) {
  allow(ctx, 'opportunities', 'edit');
  const rows = await ctx.db.delete(S).where(eq(S.id, id)).returning({ id: S.id }); if (!rows.length) throw notFound('Source not found');
  await audit(ctx, 'scout.source_removed', 'opportunity_source', id);
  return { ok: true };
}
export async function addStarter(ctx: Ctx) {
  allow(ctx, 'opportunities', 'create');
  const have = new Set((await ctx.db.select({ n: S.name }).from(S)).map((x) => x.n));
  const fresh = STARTER_QUERIES.filter((q) => !have.has(q.name));
  if (fresh.length) await ctx.db.insert(S).values(fresh.map((q) => ({ name: q.name, kind: 'query', query: q.query, region: q.region, active: true, createdBy: ctx.user!.id })));
  await audit(ctx, 'scout.starter_added', 'opportunity_source', null, undefined, { added: fresh.length });
  return { added: fresh.length };
}
/** Fetch only. Shows what the Scout would see. Saves nothing and uses no search allowance for feeds and pages. */
export async function testSource(ctx: Ctx, id: string) {
  allow(ctx, 'opportunities', 'create');
  const [s] = await ctx.db.select().from(S).where(eq(S.id, id)).limit(1); if (!s) throw notFound('Source not found');
  if (s.kind === 'query') throw conflict('Search queries use the free allowance, so they are not tested. Use Run now');
  try { const { items } = await candidatesFor(s); return { ok: true, count: items.length, sample: items.slice(0, 5).map((i) => ({ title: i.title, url: i.url, looksLikeCall: looksLikeCall(i) })) }; }
  catch (e: any) { return { ok: false, count: 0, sample: [], error: String(e?.message ?? e).slice(0, 200) }; }
}
export async function runNow(ctx: Ctx, id?: string) {
  allow(ctx, 'opportunities', 'create');
  const res = await runScout({ db: ctx.db, budgetMs: 25_000, sourceIds: id ? [id] : undefined });
  await audit(ctx, 'scout.run_now', 'opportunity_source', id ?? null, undefined, { drafted: res.drafted, candidates: res.candidates });
  return res;
}
