/** AI workforce screen through the browser. Runs after journey.ts. */
import { check, healthy, launch, login, problems, tally } from './lib';

(async () => {
  const b = await launch();
  const { page } = await login(b, 'admin@demo.samakose.test');
  console.log('AI workforce');
  const h = await healthy(page, '/admin/agents');
  check(h.status === 200 && h.errBox === 0 && !h.overflow, 'page renders without errors', JSON.stringify(h));
  for (const n of ['Diagnostic Agent', 'Prescription Agent', 'Coaching Brief Agent', 'Progress Report Agent']) check(await page.getByText(n).first().isVisible().catch(() => false), `${n} listed`);
  check(await page.getByText(/built-in mock model|live model is on/).first().isVisible().catch(() => false), 'model mode is stated');
  await page.getByRole('button', { name: 'Open' }).first().click();
  check(await page.getByText('Always forbidden').waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'detail shows what the agent may never do');
  await page.getByRole('button', { name: 'Emergency pause' }).click();
  const confirm = page.getByRole('button', { name: 'Confirm' });
  check(await confirm.isDisabled(), 'pause needs a reason first');
  await page.getByLabel(/Reason for: Emergency pause/).fill('End to end check');
  await confirm.click();
  check(await page.getByRole('button', { name: 'Resume' }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'agent is paused and can be resumed');
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByLabel(/Reason for: Resume/).fill('End to end check done');
  await page.getByRole('button', { name: 'Confirm' }).click();
  check(await page.getByRole('button', { name: 'Emergency pause' }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'agent is running again');
  await page.goto('/admin'); await page.waitForLoadState('networkidle');
  check(await page.getByText('AI agents').first().isVisible().catch(() => false), 'command centre shows the AI agents tile');

  console.log('Role restriction');
  const { page: cp } = await login(b, 'consultant@demo.samakose.test');
  await cp.goto('/admin/agents'); await cp.waitForLoadState('networkidle');
  check(await cp.getByText('You do not have access to this page').isVisible().catch(() => false), 'expert cannot open the AI workforce page');

  await b.close();
  console.log('\nRuntime problems:', problems.length); for (const p of problems.slice(0, 15)) console.log(' -', p.where, '|', p.what);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`); process.exit(t.fail || problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 8).join('\n')); process.exit(2); });
