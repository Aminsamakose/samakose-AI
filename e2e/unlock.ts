/** UNLOCK through the real UI: staff publish an opportunity, the owner consents, a person approves and tracks it to an award. */
import { check, launch, login, problems, tally } from './lib';
import type { Page } from 'playwright-core';

const seen = (page: Page, text: string | RegExp, ms = 15000) => page.getByText(text).first().waitFor({ timeout: ms }).then(() => true).catch(() => false);
const confirm = async (page: Page, name: string | RegExp) => { const d = page.locator('dialog[open]'); await d.waitFor(); await d.getByRole('button', { name }).click(); };

(async () => {
  const title = `E2E Growth Loan ${Date.now()}`;
  const b = await launch();

  console.log('Admin adds and publishes an opportunity');
  const { page: ad } = await login(b, 'admin@demo.samakose.test');
  await ad.goto('/admin/opportunities'); await ad.waitForLoadState('networkidle');
  check(await ad.getByRole('heading', { name: 'Opportunities' }).first().isVisible(), 'catalogue page opens');
  await ad.getByRole('button', { name: 'Add opportunity' }).click();
  const f = ad.locator('dialog[open]'); await f.waitFor();
  await f.getByLabel(/^Title/).fill(title);
  await f.getByLabel('Type', { exact: true }).selectOption('Loan');
  await f.getByLabel(/^Provider/).fill('Demo Community Bank');
  await f.getByLabel(/^Summary/).fill('Working capital loan for growing agribusinesses with a record of steady trading.');
  await f.getByLabel('Largest amount (GHS)').fill('50000');
  await f.getByRole('button', { name: 'Save' }).click();
  check(await seen(ad, 'Saved as a draft'), 'saved as a draft');
  const row = ad.locator('tr', { hasText: title });
  await row.waitFor({ timeout: 10000 });
  check(await row.getByText('Draft').isVisible(), 'draft is not yet public');

  console.log('Owner cannot see a draft');
  const { page: ow } = await login(b, 'owner@demo.samakose.test');
  await ow.goto('/pathway'); await ow.waitForURL(/\/organisations\/[0-9a-f-]{36}\/pathway/); await ow.waitForLoadState('networkidle');
  check(!(await ow.getByText(title).first().isVisible().catch(() => false)), 'draft hidden from the owner');

  await row.getByRole('button', { name: 'Publish' }).click();
  check(await seen(ad, 'Published'), 'published');

  console.log('Owner sees it with a plain match and asks to be referred');
  await ow.reload(); await ow.waitForLoadState('networkidle');
  check(await seen(ow, title), 'owner sees the opportunity');
  check(await ow.getByRole('button', { name: 'Ask to be referred' }).first().isVisible().catch(() => false) || await seen(ow, /Close: a few things/, 1500), 'match shown with a next step');
  const card = ow.locator('section.card', { hasText: title }).first();
  await card.getByRole('button', { name: 'Ask to be referred' }).click();
  const c = ow.locator('dialog[open]'); await c.waitFor();
  await c.getByLabel('My overall health score').uncheck(); // nothing chosen must be refused
  await c.getByRole('button', { name: 'I agree' }).click();
  check(await c.getByText(/Choose at least one item/).isVisible(), 'consent needs at least one item');
  await c.getByLabel('My overall health score').check(); await c.getByLabel('My certification level').check();
  await c.getByRole('button', { name: 'I agree' }).click();
  check(await seen(ow, 'Thank you. Your adviser will review this'), 'consent recorded');
  await ow.waitForLoadState('networkidle');
  check(await seen(ow, /Agreed to share: overall, certification/), 'owner sees what was agreed');

  console.log('Admin approves and tracks it to an award');
  const orgId = ow.url().match(/organisations\/([0-9a-f-]{36})/)![1];
  await ad.goto(`/organisations/${orgId}/pathway`); await ad.waitForLoadState('networkidle');
  const acard = ad.locator('div.stack', { hasText: title }).filter({ has: ad.getByRole('button', { name: 'Approve the match' }) }).first();
  await acard.getByRole('button', { name: 'Approve the match' }).click();
  check(await seen(ad, 'Approved', 8000), 'approved by a person');
  for (const [btn, nextBtn] of [['Mark referred', 'Mark applied'], ['Mark applied', 'Mark awarded']] as const) {
    await ad.getByRole('button', { name: btn }).first().click(); await confirm(ad, 'Confirm');
    check(await ad.getByRole('button', { name: nextBtn }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false), `${btn} then ${nextBtn} is offered`);
  }
  await ad.getByRole('button', { name: 'Mark awarded' }).first().click();
  const aw = ad.locator('dialog[open]'); await aw.waitFor();
  await aw.getByLabel(/Amount awarded/).fill('30000'); await aw.getByRole('button', { name: 'Confirm' }).click();
  check(await seen(ad, /Awarded GHS 30,000/, 10000), 'award recorded with the amount');

  console.log('Owner sees the award and the history');
  await ow.reload();
  check(await seen(ow, /Awarded GHS 30,000/), 'owner sees the award');
  await ow.getByRole('button', { name: 'History' }).first().click();
  check(await seen(ow, /Approved to Referred|Referred to Applied/, 8000), 'history lists each step');

  console.log('Totals');
  await ad.goto('/admin/opportunities');
  await ad.getByText('Funding mobilised').first().waitFor({ timeout: 10000 });
  const tile = await ad.locator('.tile', { hasText: 'Funding mobilised' }).first().innerText();
  const total = Number((/GHS\s*([\d,]+(?:\.\d+)?)/.exec(tile) ?? [])[1]?.replace(/,/g, '') ?? 0);
  check(total >= 30000, 'funding mobilised includes the award', tile.replace(/\n/g, ' '));

  await b.close();
  console.log('\nRuntime problems:', problems.length); for (const p of problems.slice(0, 15)) console.log(' -', p.where, '|', p.what);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`); process.exit(t.fail || problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 8).join('\n')); process.exit(2); });
