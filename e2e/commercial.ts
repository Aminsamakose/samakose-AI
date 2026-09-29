/** Finance to owner: invoice, online payment (test checkout), and reconciliation, through the UI. */
import { check, launch, login, problems, tally } from './lib';

(async () => {
  const b = await launch();
  const { page: fp } = await login(b, 'finance@demo.samakose.test');
  console.log('Finance creates and sends an invoice');
  await fp.goto('/finance/invoices'); await fp.waitForLoadState('networkidle');
  await fp.getByRole('button', { name: /New invoice|Create invoice/i }).first().click();
  const dlg = fp.locator('dialog[open]'); await dlg.waitFor();
  await dlg.getByLabel(/Organisation/).selectOption({ index: 1 });
  await dlg.getByLabel(/Amount/).fill('750');
  await dlg.getByLabel(/Due/).fill('2026-12-31');
  await dlg.locator('.btn.primary').last().click();
  await fp.waitForURL(/\/finance\/invoices\/[0-9a-f-]{36}/, { timeout: 10000 }).catch(() => {});
  const inv = fp.url(); check(/invoices\/[0-9a-f-]{36}/.test(inv), 'invoice created', inv);
  await fp.getByRole('button', { name: /Mark as sent|Send invoice|Mark sent/i }).first().click();
  const d2 = fp.locator('dialog[open]'); if (await d2.waitFor({ timeout: 2500 }).then(() => true).catch(() => false)) await d2.locator('.btn.primary, .btn.danger').last().click();
  check(await fp.getByText('Sent', { exact: true }).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false), 'invoice marked Sent');

  console.log('Owner pays through the test checkout');
  const { page: op } = await login(b, 'owner@demo.samakose.test');
  await op.goto(new URL(inv).pathname); await op.waitForLoadState('networkidle');
  await op.getByRole('button', { name: /Pay online|Pay now/i }).first().click();
  await op.waitForURL(/\/pay\/mock\//, { timeout: 15000 }).catch(() => {});
  check(/\/pay\/mock\//.test(op.url()), 'redirected to the test checkout', op.url());
  check(await op.getByText(/test/i).first().isVisible(), 'checkout is clearly labelled as a test');
  await op.getByRole('button', { name: /Complete test payment/i }).click();
  await op.waitForURL(/\/pay\/return/, { timeout: 15000 });
  check(await op.getByText(/success|paid|received|thank/i).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false), 'return page confirms payment');

  console.log('Finance sees it reconciled');
  await fp.goto(new URL(inv).pathname); await fp.waitForLoadState('networkidle');
  check(await fp.getByText('Paid', { exact: true }).first().isVisible(), 'invoice shows Paid');
  await fp.goto('/finance/payments'); await fp.waitForLoadState('networkidle');
  check(await fp.locator('.badge', { hasText: 'Succeeded' }).first().isVisible().catch(() => false), 'payment listed as Succeeded');
  // owner cannot reach finance lists
  await op.goto('/finance/payments'); await op.waitForTimeout(1500);
  check(!(await op.locator('.badge', { hasText: 'Succeeded' }).first().isVisible().catch(() => false)), 'owner cannot list payments');

  await b.close();
  console.log('\nRuntime problems:', problems.length); for (const p of problems.slice(0, 15)) console.log(' -', p.where, '|', p.what);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`); process.exit(t.fail || problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 6).join('\n')); process.exit(2); });
