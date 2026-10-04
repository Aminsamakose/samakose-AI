/** The expert and coach network through the real UI: photo, profile, vetting, matching, acceptance, rating. */
import sharp from 'sharp';
import { check, launch, login, problems, tally } from './lib';
import type { Page } from 'playwright-core';
import pg from 'pg';

const seen = async (page: Page, text: string | RegExp, ms = 15000) => page.getByText(text).first().waitFor({ timeout: ms }).then(() => true).catch(() => false);

(async () => {
  // Start the applicant from a blank draft so the journey can be repeated.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/samakose_dev' });
  await db.connect();
  await db.query("update practitioner_profiles set headline=null,bio=null,specialisations='{}',strengths='{}',sectors='{}',platforms='{}',languages='{}',regions='{}',years_experience=null,conduct_accepted_at=null,vetting_status='Draft',vetting_note=null,submitted_at=null where user_id=(select id from users where email='applicant@demo.samakose.test')");
  await db.query("update users set photo_key=null where email='applicant@demo.samakose.test'");
  const orgName = `Network Test Farm ${Date.now()}`;
  await db.query("insert into organisations (name,type,sector,region,district,size,contact_name,contact_email,consent_at,consent_by,created_by) select $1,'SME','Services','Northern','Tamale','11-50','Test Owner','owner@demo.samakose.test',now(),'Test Owner',(select id from users where email='admin@demo.samakose.test')", [orgName]);
  const orgId = (await db.query('select id from organisations where name=$1', [orgName])).rows[0].id as string;
  await db.end();
  const b = await launch();
  const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 30, g: 120, b: 90 } } }).png().toBuffer();

  console.log('Applicant completes a profile');
  const { page: ap } = await login(b, 'applicant@demo.samakose.test');
  await ap.goto('/profile'); await ap.waitForLoadState('networkidle');
  check(await ap.getByRole('heading', { name: 'Profile photo' }).isVisible(), 'photo card is on the profile page');
  await ap.locator('#photo-file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await ap.getByRole('button', { name: 'Save photo' }).click();
  check(await seen(ap, 'Photo saved'), 'photo uploaded');
  await ap.waitForLoadState('networkidle');
  const img = ap.locator('img.avatar').first();
  await img.waitFor({ timeout: 8000 }).catch(() => {}); await ap.waitForFunction(() => { const i = document.querySelector('img.avatar') as HTMLImageElement | null; return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
  check(await img.isVisible() && (await img.evaluate((e: HTMLImageElement) => e.naturalWidth)) > 0, 'photo renders (not initials)');
  const bad = await ap.evaluate(async () => { const fd = new FormData(); fd.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'x.svg'); const r = await fetch('/api/v1/me/photo', { method: 'POST', body: fd }); return r.status; });
  check(bad === 400 || bad === 415 || bad === 422, `SVG upload refused (${bad})`);

  await ap.getByLabel('Headline').fill('Business planning adviser, Tamale');
  await ap.getByLabel('Years of experience').fill('6');
  await ap.getByLabel('Short biography').fill('I help small businesses in Northern Ghana plan, budget and prepare for investors.');
  const chip = (g: string, n: string) => ap.getByRole('group', { name: g }).getByRole('button', { name: n, exact: true });
  await chip('Specialisations', 'Business planning').click(); await chip('Platforms', 'SME360').click(); await chip('Sectors', 'Services').click();
  await chip('Languages', 'English').click(); await chip('Regions I can serve', 'Northern').click(); await chip('Assessment areas I am strong in', 'Finance').click();
  await ap.getByLabel('I have read and accept the code of conduct', { exact: false }).check();
  await ap.getByRole('button', { name: 'Save profile' }).click();
  check(await seen(ap, 'Profile saved'), 'profile saved');
  await ap.waitForLoadState('networkidle');
  const submit = ap.getByRole('button', { name: 'Save and submit for review' });
  await submit.waitFor(); await ap.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent === 'Save and submit for review' && !x.disabled), null, { timeout: 8000 }).catch(() => {});
  check(await submit.isEnabled(), 'submit is enabled once required items are complete');
  await submit.click();
  check(await seen(ap, 'Submitted for review'), 'profile submitted');
  await ap.goto('/dashboard'); check(await seen(ap, /with the administrator for review/), 'dashboard says the profile is awaiting review');

  console.log('Administrator vets');
  const { page: ad } = await login(b, 'admin@demo.samakose.test');
  await ad.goto('/dashboard'); check(await seen(ad, /waiting for your decision/), 'admin dashboard flags waiting profiles');
  await ad.goto('/admin/practitioners'); await ad.waitForLoadState('networkidle');
  await ad.getByRole('button', { name: 'Open profile of Kwame Applicant' }).click();
  check(await seen(ad, 'Business planning adviser, Tamale'), 'admin sees the submitted profile');
  await ad.locator('dialog[open]').getByRole('button', { name: 'Reject' }).click();
  await ad.locator('dialog[open]').getByRole('button', { name: 'Reject' }).last().click();
  check(await seen(ad, 'Give the person a short reason'), 'rejection needs a reason');
  await ad.locator('dialog[open]').locator('textarea').fill('Please add a qualification.');
  await ad.locator('dialog[open]').getByRole('button', { name: 'Reject' }).last().click();
  check(await seen(ad, /kwame applicant: rejected/i), 'rejected with a reason');
  await ap.goto('/profile'); check(await seen(ap, 'Please add a qualification.'), 'applicant sees the reason');

  console.log('Administrator matches and assigns');
  const { page: pm } = await login(b, 'admin@demo.samakose.test');
  const { page: cp } = await login(b, 'consultant@demo.samakose.test');
  await cp.goto('/cases/new'); await cp.getByLabel('Organisation *').selectOption({ value: orgId });
  await cp.getByRole('button', { name: 'Open case' }).click(); await cp.waitForURL(/\/cases\/[0-9a-f-]{36}/);
  const url = cp.url();
  await pm.goto(url); await pm.waitForLoadState('networkidle');
  await pm.getByRole('button', { name: 'Choose coaching expert' }).click();
  check(await seen(pm, /Match \d+/), 'ranked matches shown with a score');
  check(!(await pm.getByText('Kwame Applicant').first().isVisible().catch(() => false)), 'unapproved applicant is not offered');
  await pm.locator('dialog[open]').getByText('Why this score').first().click();
  check(await seen(pm, /Fit with the weakest areas/), 'score is explained by factor');
  await pm.locator('dialog[open] input[type=radio]').first().check();
  await pm.locator('dialog[open]').getByRole('button', { name: 'Assign' }).click();
  check(await seen(pm, 'Coaching expert assigned'), 'coach assigned');
  await cp.reload(); await cp.waitForLoadState('networkidle');
  await pm.screenshot({ path: 'e2e/shots/network-team.png', fullPage: true });

  console.log('Phone width');
  await pm.setViewportSize({ width: 375, height: 740 }); await pm.goto('/admin/practitioners').catch(() => {});
  await pm.goto(url); await pm.waitForLoadState('networkidle');
  check(!(await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)), 'case page has no sideways scroll at 375px');
  await ad.setViewportSize({ width: 375, height: 740 }); await ad.goto('/admin/practitioners'); await ad.waitForLoadState('networkidle');
  check(!(await ad.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)), 'vetting page has no sideways scroll at 375px');
  await ap.setViewportSize({ width: 375, height: 740 }); await ap.goto('/profile'); await ap.waitForLoadState('networkidle');
  check(!(await ap.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)), 'profile page has no sideways scroll at 375px');

  const real = problems.filter((p) => !/status of 400/.test(p.what)); // the one expected 400 is the deliberate SVG upload
  console.log('Runtime problems:', real.length); for (const p of real.slice(0, 10)) console.log(' ', p.where, p.what);
  await b.close();
  const t = tally(); console.log(`${t.pass} passed, ${t.fail} failed`);
  process.exit(t.fail || real.length ? 1 : 0);
})();
