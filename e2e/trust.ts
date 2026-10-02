/** Certification card on the case page and the public website assistant, through the browser. Runs after journey.ts. */
import { check, healthy, launch, login, problems, tally } from './lib';

(async () => {
  const b = await launch();
  const { page } = await login(b, 'admin@demo.samakose.test');

  console.log('Certification card');
  await page.goto('/cases'); await page.waitForLoadState('networkidle');
  const links = await page.locator('tbody tr a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')).filter((h) => /\/cases\/[0-9a-f-]{36}/.test(h ?? '')));
  let seen = false;
  for (const href of links.slice(0, 6)) {
    await page.goto(`${href}?tab=score`); await page.waitForLoadState('networkidle');
    if (await page.getByText('Business health certificate').first().isVisible().catch(() => false)) { seen = true; break; }
  }
  check(seen, 'a scored case shows the certificate card');
  check(await page.getByText(/Criteria|Certification rests on verified evidence/).first().isVisible().catch(() => false), 'criteria or explanation shown');

  console.log('Website assistant');
  const api = page.context().request;
  await api.put('/api/v1/settings/switches/switch.assistant', { data: { on: true } });
  const { ctx: vctx } = await login(b, 'owner@demo.samakose.test').catch(() => ({ ctx: null as any }));
  const vp = await b.newPage({ baseURL: process.env.E2E_BASE ?? 'http://localhost:3100' });
  const h = await healthy(vp, '/');
  check(h.status === 200 && h.errBox === 0 && !h.overflow, 'home page still renders', JSON.stringify(h));
  const open = vp.getByRole('button', { name: 'Ask The Business Doctor' });
  check(await open.isVisible().catch(() => false), 'assistant button shows when switched on');
  await open.click();
  check(await vp.getByText(/This is an AI assistant/).isVisible().catch(() => false), 'AI notice is shown');
  await vp.getByLabel('Your question').fill('What is the weather in Tamale today?');
  await vp.getByRole('button', { name: 'Send' }).click();
  check(await vp.getByRole('link', { name: 'Send your question to our team' }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'an unanswerable question is handed to the team');
  await vp.keyboard.press('Escape');
  check(await open.isVisible().catch(() => false), 'Escape closes the panel');
  await api.put('/api/v1/settings/switches/switch.assistant', { data: { on: false } });
  await vp.reload({ waitUntil: 'domcontentloaded' }); await vp.waitForTimeout(2500);
  check(!(await vp.getByRole('button', { name: 'Ask The Business Doctor' }).isVisible().catch(() => false)), 'assistant button gone when switched off');
  console.log('Certificate verification page');
  const vr = await vp.goto('/verify/00000000-0000-4000-8000-000000000000');
  check(vr?.status() === 200 && await vp.getByText('No shared certificate found').isVisible().catch(() => false), 'an unshared or unknown certificate reveals nothing');
  void vctx;
  await b.close();
  console.log('\nRuntime problems:', problems.length); for (const p of problems.slice(0, 15)) console.log(' -', p.where, '|', p.what);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`); process.exit(t.fail || problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 8).join('\n')); process.exit(2); });
