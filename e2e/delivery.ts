/** Delivery through the UI: KPI reading, coaching session, report draft and reviewer release. Runs after journey.ts. */
import { check, launch, login, problems, tally } from './lib';
import type { Page } from 'playwright-core';
const dialogConfirm = async (page: Page) => { const d = page.locator('dialog[open]'); if (await d.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) await d.locator('.btn.primary, .btn.danger').last().click(); };
const seen = (page: Page, t: string | RegExp, ms = 15000) => page.getByText(t).first().waitFor({ timeout: ms }).then(() => true).catch(() => false);

(async () => {
  const b = await launch();
  const { page } = await login(b, 'consultant@demo.samakose.test');
  await page.goto('/cases?status=IN%20EXECUTION'); await page.waitForLoadState('networkidle');
  await page.locator('tbody tr a').first().click(); await page.waitForURL(/\/cases\/[0-9a-f-]{36}/);
  const caseUrl = page.url();

  console.log('KPI reading');
  await page.getByRole('tab', { name: 'KPIs' }).click(); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Add reading' }).first().click();
  const d = page.locator('dialog[open]'); await d.waitFor();
  await d.getByLabel(/Value/i).fill('12');
  await d.locator('.btn.primary').last().click();
  check(await seen(page, /Reading added|saved|recorded/i, 6000) || !(await d.isVisible().catch(() => false)), 'reading saved');

  console.log('Coaching session');
  await page.getByRole('tab', { name: 'Coaching' }).click(); await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Schedule session' }).click();
  const s = page.locator('dialog[open]'); await s.waitFor();
  const when = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 16);
  await s.getByLabel(/date|when|time/i).first().fill(when);
  await s.getByRole('button', { name: 'Schedule', exact: true }).click();
  check(await seen(page, 'Scheduled', 8000), 'session scheduled');

  console.log('Report draft, then reviewer release');
  await page.goto(caseUrl + '?tab=reports'); await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Generate report' }).click();
  check(await page.getByRole('link', { name: 'Open' }).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false), 'report draft appears');
  await page.getByRole('link', { name: 'Open' }).first().click(); await page.waitForURL(/\/reports\/[0-9a-f-]{36}/);
  const rurl = page.url();
  const { page: rp } = await login(b, 'reviewer@demo.samakose.test');
  await rp.goto(rurl); await rp.waitForLoadState('networkidle');
  await rp.getByRole('button', { name: /Release/i }).first().click(); await dialogConfirm(rp);
  check(await seen(rp, /Released/i, 10000), 'reviewer released the report');
  const { page: op } = await login(b, 'owner@demo.samakose.test');
  await op.goto('/my-case'); await op.waitForLoadState('networkidle');
  check(await op.getByText(/RPT-|report/i).first().isVisible().catch(() => false), 'owner sees the released report');

  await b.close();
  console.log('\nRuntime problems:', problems.length); for (const p of problems.slice(0, 15)) console.log(' -', p.where, '|', p.what);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`); process.exit(t.fail || problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 8).join('\n')); process.exit(2); });
