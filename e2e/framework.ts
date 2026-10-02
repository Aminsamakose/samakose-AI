/** Business Health Record page and the Frameworks settings tab, through the browser. Runs after journey.ts. */
import { check, healthy, launch, login, problems, tally } from './lib';

(async () => {
  const b = await launch();
  const { page } = await login(b, 'admin@demo.samakose.test');

  console.log('Business Health Record');
  await page.goto('/organisations'); await page.waitForLoadState('networkidle');
  await page.locator('tbody tr a').first().click(); await page.waitForURL(/\/organisations\/[0-9a-f-]{36}/);
  const orgUrl = page.url();
  const link = page.getByRole('link', { name: /Business Health Record|Health record/i }).first();
  check(await link.waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'organisation page links to the record');
  await link.click(); await page.waitForURL(/\/record$/);
  const h = await healthy(page, orgUrl + '/record');
  check(h.status === 200 && h.errBox === 0 && !h.overflow, 'record page renders without errors', JSON.stringify(h));
  check(await page.getByText(/Score history|No score yet/i).first().isVisible().catch(() => false), 'record shows score history or an honest empty state');

  console.log('Frameworks tab');
  await page.goto('/admin/settings'); await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: 'Frameworks' }).click(); await page.waitForTimeout(1500);
  for (const name of ['SME360', 'AGRIFOOD360', 'ESO360'])
    check(await page.getByText(name).first().isVisible().catch(() => false), `${name} listed`);
  check(await page.getByText(/Published|v1/).first().isVisible().catch(() => false), 'a published version is shown');

  console.log('Role restriction');
  const { page: cp } = await login(b, 'consultant@demo.samakose.test');
  const res = await cp.goto('/admin/settings'); await cp.waitForLoadState('networkidle');
  const tab = await cp.getByRole('tab', { name: 'Frameworks' }).isVisible().catch(() => false);
  check(!tab || res?.status() === 403, 'consultant cannot reach framework administration');

  await b.close();
  console.log('\nRuntime problems:', problems.length); for (const p of problems.slice(0, 15)) console.log(' -', p.where, '|', p.what);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`); process.exit(t.fail || problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 8).join('\n')); process.exit(2); });
