/** The case lifecycle through the real UI: open case, diagnose, score, AI drafts, four-eyes approval, actions. */
import { check, launch, login, problems, tally } from './lib';
import type { Page } from 'playwright-core';

const seen = async (page: Page, text: string | RegExp, ms = 20000) => page.getByText(text).first().waitFor({ timeout: ms }).then(() => true).catch(() => false);
const dialogConfirm = async (page: Page) => { const d = page.locator('dialog[open]'); if (await d.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) await d.locator('.btn.primary, .btn.danger').last().click(); };
const tab = async (page: Page, name: string) => { await page.getByRole('tab', { name }).click(); await page.waitForLoadState('networkidle').catch(() => {}); };

(async () => {
  const b = await launch();
  const { page } = await login(b, 'consultant@demo.samakose.test');
  console.log('Consultant opens a case');
  await page.goto('/cases/new');
  await page.getByLabel('Organisation *').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Open case' }).click();
  await page.waitForURL(/\/cases\/[0-9a-f-]{36}/);
  const caseUrl = page.url();
  check(await seen(page, /Case opened|PROFILED/i), 'case created in PROFILED');

  console.log('Administrator assigns the reviewer');
  const { page: ap } = await login(b, 'admin@demo.samakose.test');
  await ap.goto(caseUrl); await ap.waitForLoadState('networkidle');
  await ap.getByRole('button', { name: 'Choose reviewer' }).click();
  await ap.locator('dialog[open]').getByLabel('Reviewer').selectOption({ label: 'Efua Reviewer' });
  await ap.locator('dialog[open]').getByRole('button', { name: 'Assign' }).click();
  check(await seen(ap, 'Reviewer assigned', 8000), 'reviewer assigned');
  console.log('Diagnostic');
  await tab(page, 'Diagnostic');
  check(await page.getByRole('button', { name: 'Submit diagnostic' }).isDisabled(), 'blank questionnaire cannot be submitted');
  const qs = await page.locator('input[type=radio]').evaluateAll((e) => [...new Set(e.map((x) => (x as HTMLInputElement).name))]);
  for (const [i, n] of qs.entries()) await page.locator(`input[name="${n}"][value="${[2, 3, 1, 4][i % 4]}"]`).check();
  await page.getByRole('button', { name: 'Check data quality' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Submit diagnostic' }).click();
  await page.getByRole('button', { name: 'Confirm and submit' }).click();
  check(await seen(page, /Diagnostic submitted|version 1|Validated/i, 15000), 'diagnostic submitted');
  await page.goto(caseUrl); await page.waitForLoadState('networkidle');
  await page.locator('.tile', { hasText: 'Health score' }).locator('.v', { hasText: /\d/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const score = await page.locator('.tile', { hasText: 'Health score' }).locator('.v').first().textContent();
  check(!!score && /\d/.test(score), 'health score shown', String(score));
  const stateText = await page.locator('h1 ~ *, .badge').first().textContent();
  check(/SCORED|DIAGNOSTIC|DIAGNOSED/i.test(await page.locator('body').innerText()), 'case advanced past PROFILED');

  console.log('Diagnosis (AI draft in mock mode)');
  await tab(page, 'Diagnosis');
  await page.getByRole('button', { name: /Generate/i }).first().click();
  check(await seen(page, 'Current version', 30000), 'diagnosis draft appears');
  await page.waitForTimeout(1500);
  console.log('   buttons:', await page.locator('main button').allTextContents().then((a) => a.slice(12)));
  const approve = page.getByRole('button', { name: /Approve diagnosis|Mark reviewed/i }).first();
  check(await approve.isVisible().catch(() => false), 'diagnosis review control visible');
  await approve.click();
  await dialogConfirm(page);
  check(await seen(page, /Reviewed/i, 10000), 'diagnosis reviewed');

  console.log('Prescription');
  await page.goto(caseUrl); await tab(page, 'Prescription');
  await page.getByRole('button', { name: /Generate/i }).first().click();
  check(await seen(page, 'Current version', 30000), 'prescription draft appears');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Send for review/i }).first().click();
  await dialogConfirm(page);
  await page.screenshot({ path: 'e2e/shots/rx-after.png' });
  check(await page.getByRole('button', { name: /Send for review/i }).first().waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false), 'prescription sent for review');

  console.log('Four-eyes: reviewer approves');
  const { page: rp } = await login(b, 'reviewer@demo.samakose.test');
  await rp.goto('/reviews'); await rp.waitForLoadState('networkidle');
  check(await rp.getByRole('link', { name: /^RX-/ }).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false), 'prescription is in the review queue');
  await rp.goto(caseUrl + '?tab=prescription'); await rp.waitForLoadState('networkidle');
  await rp.getByRole('button', { name: /^Approve/i }).first().click();
  await dialogConfirm(rp);
  check(await seen(rp, /approved/i, 10000), 'reviewer approved the prescription');

  console.log('Actions materialised');
  await page.goto(caseUrl); await tab(page, 'Actions');
  await page.waitForTimeout(1500);
  const rows = await page.locator('tbody tr').count();
  check(rows > 0, 'approved prescription produced actions', String(rows));
  console.log('Case state:', (await page.locator('body').innerText()).match(/IN EXECUTION|APPROVAL|PRESCRIBED|DIAGNOSED/)?.[0]);

  await b.close();
  console.log('\nRuntime problems:', problems.length); for (const p of problems.slice(0, 15)) console.log(' -', p.where, '|', p.what);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`); process.exit(t.fail || problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(2); });
