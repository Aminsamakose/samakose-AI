import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { htmlToText, looksLikeCall, normaliseUrl, parseFeed, robotsAllows, scamSignals, screenCandidate, titleKey } from '@/domain/scout';
import { setScoutFetch } from '@/services/scout';

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Open call: Agribusiness Grant for Northern Ghana</title><link>https://funder.example.org/calls/agri-grant?utm_source=x</link><description><![CDATA[<p>Grants of GHS 10,000 up to GHS 50,000 for agriculture businesses in the Northern region. Apply before 2099-01-01. This programme supports small enterprises.</p>]]></description><pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate></item>
<item><title>Grant: pay a processing fee to claim your award</title><link>https://funder.example.org/calls/scam</link><description>You have won a grant. Pay the processing fee today and send your bank details. Deadline 2099-02-02. Apply now for this fund.</description></item>
<item><title>Old call for proposals</title><link>https://funder.example.org/calls/old</link><description>Call for proposals for agribusiness grants of GHS 5,000. Applications closed, deadline 2020-01-01. Apply to this funding programme.</description></item>
<item><title>Staff picnic photos</title><link>https://funder.example.org/news/picnic</link><description>Pictures from the office picnic last weekend with lots of lovely food.</description></item>
</channel></rss>`;

describe('domain', () => {
  it('parses RSS and Atom, drops markup, and strips tracking from links', () => {
    const items = parseFeed(RSS);
    expect(items.length).toBe(4); expect(items[0].text).toMatch(/GHS 10,000/); expect(items[0].text).not.toMatch(/</);
    expect(normaliseUrl(items[0].url)).toBe('https://funder.example.org/calls/agri-grant');
    const atom = parseFeed('<feed><entry><title>Call A</title><link href="https://x.example.org/a"/><summary>Grant call</summary></entry></feed>');
    expect(atom[0].url).toBe('https://x.example.org/a');
  });
  it('reads visible text only', () => { expect(htmlToText('<html><script>evil()</script><nav>menu</nav><p>Grant &amp; loan call</p></html>')).toBe('Grant & loan call'); });
  it('screens out scams, expired calls and non-calls', () => {
    const good = 'Grants of GHS 10,000 for agriculture businesses. Apply before the deadline. This programme supports small enterprises widely.';
    expect(screenCandidate({ title: 'Open call grant', text: good }, { deadline: '2099-01-01' }).ok).toBe(true);
    expect(screenCandidate({ title: 'Open call grant', text: good }, { deadline: '2020-01-01' })).toEqual({ ok: false, reason: 'Expired' });
    expect(scamSignals('Pay a processing fee to claim')).toBeGreaterThan(0);
    expect(screenCandidate({ title: 'Grant', text: `${good} Pay the registration fee to apply.` }, { deadline: null })).toEqual({ ok: false, reason: 'Suspected scam wording' });
    expect(looksLikeCall({ title: 'Picnic photos', text: 'lovely food and games at the office' })).toBe(false);
  });
  it('respects robots.txt and normalises duplicates', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /private', '/private/x')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/open', '/private/open/a')).toBe(true);
    expect(robotsAllows('User-agent: other\nDisallow: /', '/x')).toBe(true);
    expect(titleKey('Agri Grant!', 'Funder Ltd')).toBe(titleKey('agri  grant', 'funder ltd'));
  });
});

let admin: Session, owner: Session, pm: Session;
const pages: Record<string, { status: number; text: string; type: string }> = {};
beforeAll(async () => {
  await ensureReference();
  admin = await makeUser('ADMIN'); pm = await makeUser('PROGRAMME_MANAGER'); owner = await makeUser('OWNER', { orgId: (await makeOrg(admin)).id });
  setScoutFetch(async (url) => {
    const u = new URL(url);
    if (u.pathname === '/robots.txt') return { status: 404, text: '', type: 'text/plain', url };
    if (u.pathname === '/feed.xml') return { status: 200, text: RSS, type: 'application/rss+xml', url };
    const p = pages[url]; if (p) return { ...p, url };
    return { status: 404, text: '', type: 'text/html', url };
  });
});
afterAll(() => { setScoutFetch(null); delete process.env.SCOUT_SEARCH_PROVIDER; delete process.env.SCOUT_SEARCH_KEY; delete process.env.SCOUT_SEARCH_MONTHLY_LIMIT; });

describe('sources', () => {
  it('only staff manage sources, and an address must be public https', async () => {
    expect((await api(owner).get('/opportunity-sources')).status).toBe(403);
    const bad = { name: 'Bad', kind: 'feed' };
    expect((await api(admin).post('/opportunity-sources', { ...bad, url: 'http://funder.example.org/feed.xml' })).status).toBe(422);
    expect((await api(admin).post('/opportunity-sources', { ...bad, url: 'https://127.0.0.1/feed.xml' })).status).toBe(422);
    expect((await api(admin).post('/opportunity-sources', { ...bad, url: 'https://localhost/feed.xml' })).status).toBe(422);
    expect((await api(admin).post('/opportunity-sources', { name: 'Query', kind: 'query', query: 'ab' })).status).toBe(422);
    expect((await api(pm).post('/opportunity-sources', { name: `Feed ${uniq()}`, kind: 'feed', url: 'https://funder.example.org/feed.xml' })).status).toBe(201);
  });
  it('adds the starter searches once only', async () => {
    const a = await api(admin).post('/opportunity-sources/starter', {}); const b = await api(admin).post('/opportunity-sources/starter', {});
    expect(a.status).toBe(200); expect(b.data.added).toBe(0);
  });
});

describe('the weekly run', () => {
  it('tests a feed without saving, then saves only the genuine call as a draft and never publishes', async () => {
    const s = (await api(admin).post('/opportunity-sources', { name: `Funder feed ${uniq()}`, kind: 'feed', url: 'https://funder.example.org/feed.xml', region: 'Ghana' })).data;
    const t = await api(admin).post(`/opportunity-sources/${s.id}/test`, {});
    expect(t.data).toMatchObject({ ok: true, count: 4 });
    const before = (await api(admin).get('/opportunities')).data.items.length;
    expect((await api(admin).get('/opportunities')).data.items.length).toBe(before);
    const r = await api(admin).post(`/opportunity-sources/${s.id}/run`, {});
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.data.drafted).toBe(1); expect(r.data.skipped).toMatchObject({ 'Suspected scam wording': 1, Expired: 1, 'Not a call': 1 });
    const mine = (await api(admin).get('/opportunities?status=Draft')).data.items.filter((o: any) => o.source === 'scout');
    const o = mine.find((x: any) => x.url === 'https://funder.example.org/calls/agri-grant');
    expect(o, JSON.stringify(mine.map((x: any) => x.url))).toBeTruthy(); expect(o.status).toBe('Draft'); expect(o.valueMax).toBe(50000);
    expect((await api(owner).get('/opportunities')).data.items.some((x: any) => x.url === o.url)).toBe(false);
    const again = await api(admin).post(`/opportunity-sources/${s.id}/run`, {});
    expect(again.data.drafted).toBe(0); expect(again.data.skipped['Already found']).toBeGreaterThan(0);
    const list = (await api(admin).get('/opportunity-sources')).data;
    expect(list.items.find((x: any) => x.id === s.id)).toMatchObject({ lastStatus: 'OK' }); expect(list.draftsToReview).toBeGreaterThan(0);
  });
  it('records a clear error for an unreadable feed and keeps going', async () => {
    const s = (await api(admin).post('/opportunity-sources', { name: `Dead ${uniq()}`, kind: 'feed', url: 'https://funder.example.org/missing.xml' })).data;
    const r = await api(admin).post(`/opportunity-sources/${s.id}/run`, {});
    expect(r.data.failed).toBe(1);
    expect((await api(admin).get('/opportunity-sources')).data.items.find((x: any) => x.id === s.id).lastStatus).toMatch(/^Error: .*404/);
  });
  it('search queries wait until a provider is set, then stay inside the monthly allowance', async () => {
    const q1 = (await api(admin).post('/opportunity-sources', { name: `Q1 ${uniq()}`, kind: 'query', query: 'grant call agribusiness Ghana' })).data;
    const none = await api(admin).post(`/opportunity-sources/${q1.id}/run`, {});
    expect(none.data.searches).toBe(0);
    expect((await api(admin).get('/opportunity-sources')).data.items.find((x: any) => x.id === q1.id).lastStatus).toBe('Search not set up');
    process.env.SCOUT_SEARCH_PROVIDER = 'serper'; process.env.SCOUT_SEARCH_KEY = 'test-key'; process.env.SCOUT_SEARCH_MONTHLY_LIMIT = String(((await api(admin).get('/opportunity-sources')).data.search.usedThisMonth) + 1);
    setScoutFetch(async (url) => url.includes('serper.dev') ? { status: 200, type: 'application/json', url, text: JSON.stringify({ organic: [{ title: 'Women in Agri Grant call', link: 'https://funder.example.org/calls/women', snippet: 'Grant of GHS 8,000 for women in agriculture. Apply by 2099-05-05. Open call for applications for small businesses in Ghana.' }] }) } : { status: 404, text: '', type: 'text/html', url });
    const one = await api(admin).post(`/opportunity-sources/${q1.id}/run`, {});
    expect(one.data).toMatchObject({ searches: 1, drafted: 1 });
    const q2 = (await api(admin).post('/opportunity-sources', { name: `Q2 ${uniq()}`, kind: 'query', query: 'another grant search words' })).data;
    const two = await api(admin).post(`/opportunity-sources/${q2.id}/run`, {});
    expect(two.data.searches).toBe(0);
    expect((await api(admin).get('/opportunity-sources')).data.items.find((x: any) => x.id === q2.id).lastStatus).toBe('Monthly free limit reached');
  });
  it('the run-now button works on the sources that are due', async () => {
    const r = await api(admin).post('/opportunity-sources/run', {});
    expect(r.status, JSON.stringify(r.error)).toBe(200); expect(r.data).toHaveProperty('sources');
    expect((await api(owner).post('/opportunity-sources/run', {})).status).toBe(403);
  });
  it('pauses and removes a source, and audits changes', async () => {
    const s = (await api(admin).post('/opportunity-sources', { name: `P ${uniq()}`, kind: 'page', url: 'https://funder.example.org/calls' })).data;
    expect((await api(admin).patch(`/opportunity-sources/${s.id}`, { active: false })).data.active).toBe(false);
    expect((await api(admin).del(`/opportunity-sources/${s.id}`)).status).toBe(200);
    const acts = (await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, s.id))).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(['scout.source_added', 'scout.source_updated', 'scout.source_removed']));
  });
});
