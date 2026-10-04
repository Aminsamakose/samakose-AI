/** Automated accessibility audit (axe-core, WCAG 2.0/2.1 A and AA) across public pages and every role's pages. Findings are printed, grouped by rule. */
import fs from 'node:fs';
import { launch, login, newContext, BASE } from './lib';
import { can, type Resource } from '../src/lib/rbac';

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const PUBLIC = ['/', '/platform', '/solutions', '/impact', '/resources', '/pricing', '/login', '/register', '/contact', '/about', '/privacy', '/terms', '/resources/why-evidence-matters-for-your-score'];
const USERS: [string, string][] = [['ADMIN', 'admin'], ['EXECUTIVE', 'exec'], ['PROGRAMME_MANAGER', 'pm'], ['EXPERT', 'consultant'], ['REVIEWER', 'reviewer'], ['FINANCE', 'finance'], ['OWNER', 'owner'], ['FUNDER', 'funder']];
const PAGES: { path: string; need?: [Resource, any]; roles?: string[] }[] = [
  { path: '/dashboard', need: ['dashboard', 'read'] }, { path: '/cases', need: ['cases', 'read'] }, { path: '/my-case', roles: ['OWNER'] }, { path: '/team', need: ['team', 'read'] }, { path: '/answer', roles: ['OWNER'] }, { path: '/reviews', need: ['prescriptions', 'approve'] },
  { path: '/actions', need: ['actions', 'read'] }, { path: '/organisations', need: ['organisations', 'read'] }, { path: '/finance/invoices', need: ['invoices', 'read'] },
  { path: '/admin/users', need: ['users', 'create'] }, { path: '/admin/settings', need: ['settings', 'read'] }, { path: '/admin/agents', need: ['agents', 'read'] }, { path: '/admin/feedback', need: ['feedback', 'read'] },
  { path: '/notifications' }, { path: '/profile' }, { path: '/admin/practitioners', need: ['practitioners', 'approve'] }, { path: '/cases/new', need: ['cases', 'create'] }
];
type V = { id: string; impact: string; help: string; nodes: string[] };
let scanned = 0;
const found = new Map<string, { v: V; where: Set<string> }>();

async function scan(page: any, path: string, label: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  let res: any = null;
  for (let i = 0; i < 3 && !res; i++) {
    try { await page.waitForTimeout(400); await page.evaluate(AXE); res = await page.evaluate((tags: string[]) => (window as any).axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS); }
    catch { await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}); }
  }
  if (!res) { console.log('  could not scan ' + label + ' ' + path); return; }
  scanned++;
  for (const x of res.violations) {
    const key = x.id; const cur: { v: V; where: Set<string> } = found.get(key) ?? { v: { id: x.id, impact: x.impact, help: x.help, nodes: [] as string[] }, where: new Set<string>() };
    cur.where.add(label + ' ' + path);
    for (const n of x.nodes.slice(0, 2)) if (cur.v.nodes.length < 4) cur.v.nodes.push((n.target || []).join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1]?.trim());
    found.set(key, cur);
  }
}
(async () => {
  const b = await launch();
  const anon = await (await newContext(b)).newPage();
  // Self-test: the scanner must catch a page that is known to be broken.
  await anon.setContent('<html><body><img src="x.png"><button></button><input type="text"></body></html>');
  await anon.evaluate(AXE);
  const self = await anon.evaluate((tags: string[]) => (window as any).axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS);
  console.log('Scanner self-test found', self.violations.length, 'violations on a deliberately broken page (expected 3 or more)');
  for (const p of PUBLIC) await scan(anon, p, 'public');
  for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 740 }]) {
    for (const [role, slug] of USERS) {
      const { ctx, page } = await login(b, `${slug}@demo.samakose.test`, vp);
      for (const p of PAGES) {
        const ok = p.roles ? p.roles.includes(role) : p.need ? can(role as any, p.need[0], p.need[1]) : true;
        if (ok) await scan(page, p.path, `${role}@${vp.width}`);
      }
      if (role === 'ADMIN' && vp.width === 1280) {
        await page.goto('/cases'); await page.waitForLoadState('networkidle').catch(() => {});
        const href = await page.locator('a[href^="/cases/"]').first().getAttribute('href').catch(() => null);
        if (href && /\/cases\/[0-9a-f-]{36}/.test(href)) await scan(page, href, 'ADMIN case');
      }
      await ctx.close();
    }
  }
  await b.close();
  const order: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const all = [...found.values()].sort((a, b2) => (order[a.v.impact] ?? 9) - (order[b2.v.impact] ?? 9));
  console.log(`\nAccessibility audit: ${scanned} page views scanned, ${all.length} distinct rule violations`);
  for (const { v, where } of all) { console.log(`\n[${v.impact}] ${v.id}: ${v.help}  (${where.size} page views)`); console.log('  e.g. ' + [...where].slice(0, 3).join(' | ')); for (const n of v.nodes.slice(0, 3)) console.log('   - ' + n); }
  process.exit(all.length ? 1 : 0);
})();
