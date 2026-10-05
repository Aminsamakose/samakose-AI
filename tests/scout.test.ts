import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, ensureReference, makeOrg, makeUser, uniq, type Session } from './helpers';
import { db, schema } from '@/db/client';
import { findDeadline, closedWording } from '@/domain/opportunity-agents';
import { extractLinks, regionFromUrl, htmlToText, looksLikeCall, normaliseUrl, parseFeed, robotsAllows, scamSignals, screenCandidate, titleKey } from '@/domain/scout';
import { setScoutFetch } from '@/services/scout';

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Open call: Agribusiness Grant for Northern Ghana</title><link>https://funder.example.org/calls/agri-grant?utm_source=x</link><description><![CDATA[<p>Grants of GHS 10,000 up to GHS 50,000 for agriculture businesses in the Northern region. Apply before 2099-01-01. This programme supports small enterprises.</p>]]></description><pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate></item>
<item><title>Grant: pay a processing fee to claim your award</title><link>https://funder.example.org/calls/scam</link><description>You have won a grant. Pay the processing fee today and send your bank details. Deadline 2099-02-02. Apply now for this fund.</description></item>
<item><title>Old call for proposals</title><link>https://funder.example.org/calls/old</link><description>Call for proposals for agribusiness grants of GHS 5,000. Applications closed, deadline 2020-01-01. Apply to this funding programme.</description></item>
<item><title>Women in agriculture grant call</title><link>https://funder.example.org/calls/women-closed</link><description>This funding call for women in agriculture offers grants of GHS 9,000. Applications are now closed. Apply to future calls when announced.</description></item>
<item><title>Farmers grant call 2019</title><link>https://funder.example.org/calls/farmers-2019</link><description>Open call for farmers: grants of GHS 4,000 for smallholder agriculture programmes, apply through the 2019 programme portal in your district office.</description></item>
<item><title>Staff picnic photos</title><link>https://funder.example.org/news/picnic</link><description>Pictures from the office picnic last weekend with lots of lovely food.</description></item>
</channel></rss>`;

describe('closing dates and closed calls', () => {
  it('reads closing dates in common formats, only when tied to a closing word', () => {
    expect(findDeadline('Deadline: 30 November 2026')).toBe('2026-11-30');
    expect(findDeadline('Applications close on November 30th, 2026.')).toBe('2026-11-30');
    expect(findDeadline('Apply before 15/01/2027 to be considered')).toBe('2027-01-15');
    expect(findDeadline('Closing date: 5 Jan 2027')).toBe('2027-01-05');
    expect(findDeadline('Published on 1 March 2026. The programme supports farmers.')).toBeNull();
  });
  it('recognises wording that says a call is over', () => {
    for (const t of ['Applications are now closed', 'This call has closed', 'No longer accepting applications', 'The deadline has passed', 'CLOSED: Youth grant']) expect(closedWording(t), t).toBe(true);
    expect(closedWording('Applications close on 30 November 2026')).toBe(false);
  });
  it('screens closed and out-of-date items', () => {
    const t = 'Open call for farmers: grants of GHS 4,000 for agriculture programmes. Apply through the portal. More text to pass length.';
    expect(screenCandidate({ title: 'Grant', text: `${t} Applications closed.` }, { deadline: null })).toEqual({ ok: false, reason: 'Already closed' });
    expect(screenCandidate({ title: 'Grant 2019', text: t }, { deadline: null })).toEqual({ ok: false, reason: 'Looks out of date' });
    expect(screenCandidate({ title: 'Grant', text: t, published: '2020-01-01' }, { deadline: null })).toEqual({ ok: false, reason: 'Looks out of date' });
    expect(screenCandidate({ title: 'Grant', text: t }, { deadline: null }).ok).toBe(true);
  });
});

describe('domain', () => {
  it('parses RSS and Atom, drops markup, and strips tracking from links', () => {
    const items = parseFeed(RSS);
    expect(items.length).toBe(6); expect(items[0].text).toMatch(/GHS 10,000/); expect(items[0].text).not.toMatch(/</);
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
    expect(t.data).toMatchObject({ ok: true, count: 6 });
    const before = (await api(admin).get('/opportunities')).data.items.length;
    expect((await api(admin).get('/opportunities')).data.items.length).toBe(before);
    const r = await api(admin).post(`/opportunity-sources/${s.id}/run`, {});
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(r.data.drafted).toBe(1); expect(r.data.skipped).toMatchObject({ 'Suspected scam wording': 1, Expired: 1, 'Not a call': 1, 'Already closed': 1, 'Looks out of date': 1 });
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
  it('closes what has ended: expired scout drafts are archived and expired open opportunities are closed', async () => {
    const { sweepExpired } = await import('@/services/scout');
    const [d] = await db().insert(schema.opportunities).values({ title: `Old draft ${uniq()}`, type: 'Grant', provider: 'X', summary: 'An old call that has ended.', source: 'scout', sourceRef: `https://funder.example.org/old-${uniq()}`, deadline: '2020-01-01' }).returning();
    const [o] = await db().insert(schema.opportunities).values({ title: `Old open ${uniq()}`, type: 'Grant', provider: 'X', summary: 'An old call that has ended.', status: 'Open', deadline: '2020-01-01' }).returning();
    const r = await sweepExpired(db());
    expect(r.archived).toBeGreaterThanOrEqual(1); expect(r.closed).toBeGreaterThanOrEqual(1);
    expect((await db().select().from(schema.opportunities).where(eq(schema.opportunities.id, d.id)))[0].status).toBe('Archived');
    expect((await db().select().from(schema.opportunities).where(eq(schema.opportunities.id, o.id)))[0].status).toBe('Closed');
  });
  it('lists what the Scout found with the closing date and the platform searches are in the starter set', async () => {
    const l = (await api(admin).get('/opportunity-sources')).data;
    expect(Array.isArray(l.found)).toBe(true); expect(l.found[0]).toHaveProperty('deadline');
    expect((await api(admin).get('/opportunity-sources')).data.items.some((x: any) => /^Platform:/.test(x.name))).toBe(true);
  });
  it('pauses and removes a source, and audits changes', async () => {
    const s = (await api(admin).post('/opportunity-sources', { name: `P ${uniq()}`, kind: 'page', url: 'https://funder.example.org/calls' })).data;
    expect((await api(admin).patch(`/opportunity-sources/${s.id}`, { active: false })).data.active).toBe(false);
    expect((await api(admin).del(`/opportunity-sources/${s.id}`)).status).toBe(200);
    const acts = (await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, s.id))).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(['scout.source_added', 'scout.source_updated', 'scout.source_removed']));
  });
});

describe('whole websites', () => {
  beforeAll(() => {
    setScoutFetch(async (url) => {
      const u = new URL(url);
      if (u.pathname === '/robots.txt') return { status: 404, text: '', type: 'text/plain', url };
      const p = pages[url]; if (p) return { ...p, url };
      return { status: 404, text: '', type: 'text/html', url };
    });
  });
  const HOME = `<html><body><nav><a href="/about">About us</a><a href="/careers">Careers</a></nav>
  <a href="/calls/youth-agri-grant">Youth agribusiness grant call 2099</a>
  <a href="https://other.example.net/funding/open-call">Open call for SMEs</a>
  <a href="/files/guide.pdf">Grant guide</a><a href="mailto:a@b.org">Apply by email</a><a href="#top">Apply</a>
  <a href="/calls/youth-agri-grant">Youth agribusiness grant call 2099 (again)</a></body></html>`;
  it('follows only the links that look like calls, once each', () => {
    const l = extractLinks(HOME, 'https://sitetest.example.org/');
    expect(l.map((x) => x.url)).toEqual(expect.arrayContaining(['https://sitetest.example.org/calls/youth-agri-grant', 'https://other.example.net/funding/open-call']));
    expect(l.length).toBe(2);
    expect(extractLinks('<a href="/x">hello</a>', 'https://a.example.org/')).toEqual([]);
  });
  it('guesses the region from the address', () => {
    expect(regionFromUrl('https://www.gipc.gov.gh/')).toBe('Ghana');
    expect(regionFromUrl('https://www.nigeria.gov.ng/')).toBe('West Africa');
    expect(regionFromUrl('https://www.afdb.org/')).toBe('Africa');
    expect(regionFromUrl('https://www.bmz.de/')).toBe('Europe');
    expect(regionFromUrl('https://www.sba.gov/')).toBe('North America');
    expect(regionFromUrl('https://www.dti.gov.ph/')).toBe('Asia');
    expect(regionFromUrl('https://www.worldbank.org/')).toBe('Global');
  });
  it('reads a website, follows its call links, saves a draft, and respects the weekly reading limit', async () => {
    pages['https://sitetest.example.org/'] = { status: 200, type: 'text/html', text: HOME };
    pages['https://sitetest.example.org/calls/youth-agri-grant'] = { status: 200, type: 'text/html', text: '<html><title>Youth agribusiness grant call</title><body><p>Open call for applications. Grants of GHS 20,000 for youth agribusinesses in Northern Ghana. Apply by 2099-06-30. Eligible applicants must be registered businesses operating for at least one year in Ghana and run by people aged 18 to 35. Apply online.</p></body></html>' };
    const src = (await api(admin).post('/opportunity-sources', { name: `Site ${uniq()}`, kind: 'site', url: 'https://sitetest.example.org/' })).data;
    expect(src.kind).toBe('site');
    const t = (await api(admin).post(`/opportunity-sources/${src.id}/test`, {})).data;
    expect(t.ok).toBe(true); expect(t.count).toBe(2);
    process.env.SCOUT_WEEKLY_READS = '0';
    try {
      const blocked = (await api(admin).post(`/opportunity-sources/${src.id}/run`, {})).data;
      expect(blocked.drafted).toBe(0); expect(blocked.note).toMatch(/Weekly reading limit/);
    } finally { delete process.env.SCOUT_WEEKLY_READS; }
    const r = (await api(admin).post(`/opportunity-sources/${src.id}/run`, {})).data;
    expect(r.drafted).toBe(1);
    const d = await db().select().from(schema.opportunities).where(eq(schema.opportunities.sourceRef, 'https://sitetest.example.org/calls/youth-agri-grant'));
    expect(d.length).toBe(1); expect(d[0].status).toBe('Draft');
  });
  it('says clearly when a site shows no call links', async () => {
    pages['https://empty.example.org/'] = { status: 200, type: 'text/html', text: '<html><body><a href="/about">About</a></body></html>' };
    const src = (await api(admin).post('/opportunity-sources', { name: `Empty ${uniq()}`, kind: 'site', url: 'https://empty.example.org/' })).data;
    const t = (await api(admin).post(`/opportunity-sources/${src.id}/test`, {})).data;
    expect(t.ok).toBe(false); expect(t.error).toMatch(/No call links/);
  });
  it('adds the worldwide website list once only', async () => {
    await db().delete(schema.opportunitySources).where(eq(schema.opportunitySources.kind, 'site'));
    const a = await api(admin).post('/opportunity-sources/sites', {}); const b = await api(admin).post('/opportunity-sources/sites', {});
    expect(a.status, JSON.stringify(a.error)).toBe(200); expect(a.data.added).toBeGreaterThan(300); expect(b.data.added).toBe(0);
    expect((await api(owner).post('/opportunity-sources/sites', {})).status).toBe(403);
    const list = (await api(admin).get('/opportunity-sources')).data.items.filter((x: any) => x.kind === 'site');
    expect(list.some((x: any) => x.region === 'Ghana')).toBe(true);
    await db().delete(schema.opportunitySources).where(eq(schema.opportunitySources.kind, 'site'));
  });
});
