/** Case messaging and escalation through the UI. Owner and practitioner exchange messages, a manager reads for oversight, a stalled case shows on the manager's dashboard. */
import { check, launch, login, problems, tally } from './lib';
import fs from 'node:fs';
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

(async () => {
  const b = await launch();
  // Use the case the demo owner actually belongs to, so both sides of the conversation are on one case.
  const { page: ow } = await login(b, 'owner@demo.samakose.test');
  const caseId: string = await ow.evaluate(async () => { const r = await (await fetch('/api/v1/cases')).json(); const rows = r.data?.items ?? r.data ?? r.items ?? []; return rows[0]?.id; });
  const { page: co } = await login(b, 'consultant@demo.samakose.test');
  await co.goto(`/cases/${caseId}`); await co.waitForURL(/\/cases\/[0-9a-f-]{36}/);
  console.log('Practitioner sends');
  await co.getByRole('tab', { name: 'Messages' }).click();
  await co.getByRole('textbox', { name: 'Message', exact: false }).waitFor({ timeout: 10000 });
  const text = `Please bring last month's cash book ${Date.now()}`;
  await co.getByRole('textbox', { name: 'Message', exact: false }).fill(text);
  await co.getByRole('button', { name: 'Send message' }).click();
  check(await co.getByText(text).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false), 'message appears in the thread');
  check(await co.getByText('Do not put passwords or bank details').count() === 1, 'privacy notice is shown');
  check(await co.getByRole('button', { name: 'Send message' }).isDisabled(), 'send is disabled once the box is empty');

  console.log('Owner reads and replies');
  await ow.goto('/my-case'); await ow.waitForLoadState('networkidle');
  const hasCard = await ow.getByRole('heading', { name: 'Messages with your team' }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check(hasCard, 'owner has a messages card');
  if (hasCard) {
    const seen = await ow.getByText(text).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    check(seen, 'owner sees the practitioner message (if this is the owner of the case)');
    if (seen) {
      check(await ow.getByText('New', { exact: true }).first().isVisible().catch(() => false), 'unread message is marked new');
      await ow.getByRole('textbox', { name: 'Message', exact: false }).fill('Thank you. I will bring it on Thursday.');
      await ow.getByRole('button', { name: 'Send message' }).click();
      check(await ow.getByText('Thank you. I will bring it on Thursday.').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false), 'owner reply appears');
    }
  }

  console.log('Manager oversight');
  const { page: ad } = await login(b, 'admin@demo.samakose.test');
  await ad.goto(`/cases/${caseId}?tab=messages`);
  check(await ad.getByText('Oversight view').waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'administrator sees the oversight view');
  check(await ad.getByRole('button', { name: 'Send message' }).count() === 0, 'administrator cannot write');
  const res: any = await ad.evaluate(AXE).then(() => ad.evaluate(() => (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })));
  check(res.violations.length === 0, 'messages tab has no accessibility violations', res.violations.map((v: any) => v.id).join(','));

  console.log('Escalations card');
  await ad.goto('/dashboard'); await ad.waitForLoadState('networkidle');
  check(await ad.getByRole('heading', { name: 'Needs attention' }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'manager dashboard shows Needs attention');
  const { page: fu } = await login(b, 'funder@demo.samakose.test');
  await fu.goto('/dashboard'); await fu.waitForLoadState('networkidle');
  check(await fu.getByRole('heading', { name: 'Needs attention' }).count() === 0, 'funder does not see escalations');
  await b.close();
  console.log('\nRuntime problems:', problems.length); for (const p of problems.slice(0, 10)) console.log(' -', p.where, '|', p.what);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`); process.exit(t.fail || problems.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n').slice(0, 8).join('\n')); process.exit(2); });
