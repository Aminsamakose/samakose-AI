/** Bank v2 in the browser: anchors, evidence guidance, not applicable, and the extended score view. Publishes SME360 bank v2, so run it last and only on a throwaway database. */
import fs from 'node:fs';
import { check, launch, login, problems, tally } from './lib';

(async () => {
  const b = await launch();
  const { page } = await login(b, 'admin@demo.samakose.test');
  const req = page.context().request;
  const j = async (r: any) => (await r.json()).data;
  const bank = JSON.parse(fs.readFileSync('docs/frameworks/drafts/sme360-bank-v1-loadable.json', 'utf8'));
  const fws = await j(await req.get('/api/v1/settings/frameworks'));
  for (const v of fws.find((f: any) => f.code === 'SME360').versions.filter((v: any) => v.status === 'Draft')) await req.delete(`/api/v1/settings/frameworks/versions/${v.id}`);
  const d = await req.post('/api/v1/settings/frameworks/SME360/versions', { data: bank });
  check(d.status() === 201, 'bank loads as a draft', await d.text());
  const id = (await j(d)).id;
  const p = await req.post(`/api/v1/settings/frameworks/versions/${id}/publish`, { data: { note: 'e2e publish of bank v2' } });
  check(p.status() === 200, 'bank publishes', await p.text());

  const cases = await j(await req.get('/api/v1/cases'));
  const list = Array.isArray(cases) ? cases : cases.items ?? cases.rows ?? [];
  const c = list.find((x: any) => ['PROFILED', 'DIAGNOSTIC', 'DIAGNOSED'].includes(x.status)) ?? list[0];
  console.log('case', c?.code, c?.status);
  await page.goto(`/cases/${c.id}?tab=diagnostic`); await page.waitForLoadState('networkidle');
  check(await page.getByText('SM-001').first().isVisible().catch(() => false), 'bank questions are shown');
  check(await page.getByText('What each rating means').first().isVisible(), 'anchors are available');
  const na = page.getByRole('checkbox', { name: /Does not apply to this business/ });
  check((await na.count()) > 0 && (await na.count()) <= 8, `N/A shown only on conditional questions (${await na.count()})`);
  // answer everything with 3, mark the first three conditional questions not applicable
  const sets = page.locator('fieldset');
  const n = await sets.count(); check(n === 100, `100 questions rendered (${n})`);
  let marked = 0;
  for (let i = 0; i < n; i++) {
    const f = sets.nth(i);
    const box = f.getByRole('checkbox', { name: /Does not apply/ });
    if (marked < 3 && (await box.count())) { await box.check(); marked++; continue; }
    await f.locator('input[type=radio][value="3"]').check();
  }
  check(await page.getByText(/answered/).first().isVisible(), 'progress is shown');
  await page.getByRole('button', { name: 'Check data quality' }).click();
  check(await page.getByText(/data quality check passed at 100%/).isVisible({ timeout: 10000 }).catch(() => false), 'gate passes at 100 percent with N/A left out');
  await page.getByRole('button', { name: 'Submit diagnostic' }).click();
  await page.getByRole('button', { name: 'Confirm and submit' }).click();
  await page.waitForTimeout(2500); await page.screenshot({ path: 'e2e/shots/bank-v2-after-submit.png' });
  check(await page.getByText(/was accepted and scored/).first().isVisible({ timeout: 20000 }).catch(() => false), 'submission accepted and scored');
  await page.goto(`/cases/${c.id}?tab=score`); await page.waitForLoadState('networkidle');
  check(await page.getByText('Readiness', { exact: true }).first().isVisible({ timeout: 10000 }).catch(() => false), 'score page shows readiness');
  check(await page.getByText('Priority areas').isVisible(), 'priority areas shown');
  check(await page.getByRole('heading', { name: 'Score by sub-dimension' }).isVisible(), 'sub-dimension scores shown');
  check(await page.getByText(/3 questions marked not applicable/).isVisible(), 'N/A count shown');
  await page.screenshot({ path: 'e2e/shots/bank-v2-score.png', fullPage: true });
  await b.close();
  console.log('Runtime problems:', problems.length); for (const x of problems.slice(0, 10)) console.log(' -', x.where, '|', x.what);
  const t = tally(); console.log(`${t.pass} passed, ${t.fail} failed`); process.exit(t.fail || problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 8).join('\n')); process.exit(2); });
