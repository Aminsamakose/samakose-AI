/** RE-CHECK trend on the Business Health Record: renders, is described in words, flags framework changes, fits a phone, has no axe violations. */
import fs from 'node:fs';
import { launch, login, check, tally, problems } from './lib';

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const ORG = process.env.TREND_ORG ?? '';
(async () => {
  const b = await launch();
  const { page: ad } = await login(b, 'admin@demo.samakose.test');
  const org = ORG || await ad.evaluate(async () => { const r = await (await fetch('/api/v1/organisations')).json(); return (r.items ?? r.data ?? r)[0]?.id; });
  console.log('Trend chart on', org);
  await ad.goto(`/organisations/${org}/record`);
  await ad.getByRole('heading', { name: 'Health trend' }).waitFor({ timeout: 15000 });
  const svg = ad.locator('svg[role=img]').first();
  check(await svg.count() === 1, 'trend chart is drawn');
  const label = await svg.getAttribute('aria-label') ?? '';
  check(/score/i.test(label), 'chart has a plain-language description', label.slice(0, 120));
  check(await ad.locator('svg[role=img] circle, svg[role=img] rect').count() >= 1, 'chart has points');
  check(await ad.getByText('Framework version changed').first().isVisible().catch(() => false), 'legend explains framework change markers');
  await ad.waitForTimeout(600);
  const res: any = await ad.evaluate(AXE).then(() => ad.evaluate(() => (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })));
  check(res.violations.length === 0, 'no accessibility violations', res.violations.map((v: any) => v.id + ':' + v.nodes.slice(0,3).map((n: any) => n.target.join(' ') + ' ' + (n.failureSummary||'').split('\n')[1]).join(' | ')).join(';'));
  await ad.setViewportSize({ width: 390, height: 800 });
  await ad.reload(); await ad.getByRole('heading', { name: 'Health trend' }).waitFor({ timeout: 15000 });
  check(!(await ad.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)), 'no sideways scroll on a phone');
  await b.close();
  console.log('\nRuntime problems:', problems.length); for (const p of problems.slice(0, 10)) console.log(' -', p.where, '|', p.what);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`); process.exit(t.fail || problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 8).join('\n')); process.exit(2); });
