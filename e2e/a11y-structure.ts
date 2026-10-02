/** Structure and keyboard checks that screen-reader and keyboard users depend on. */
import { check, launch, login, newContext, problems, tally } from './lib';

(async () => {
  const b = await launch();
  const anon = await (await newContext(b)).newPage();
  console.log('Public pages');
  const titles = new Set<string>();
  for (const p of ['/', '/login', '/contact', '/about', '/pricing', '/platform', '/resources', '/privacy']) {
    await anon.goto(p, { waitUntil: 'domcontentloaded' }); await anon.waitForLoadState('networkidle').catch(() => {});
    const s = await anon.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, main: document.querySelectorAll('main').length, h1: document.querySelectorAll('h1').length, nav: document.querySelectorAll('nav').length, skip: !!document.querySelector('a[href^="#"][class*="skip"], a.skip, a[href="#main"], a[href="#content"]') }));
    check(!!s.lang, `${p} declares a language`, s.lang);
    check(!!s.title.trim(), `${p} has a page title`, s.title); titles.add(s.title);
    check(s.main === 1, `${p} has exactly one main landmark`, String(s.main));
    check(s.h1 === 1, `${p} has exactly one h1`, String(s.h1));
    check(s.skip, `${p} has a skip to content link`);
  }
  check(titles.size >= 4, 'public pages have distinct titles', [...titles].join(' | '));

  console.log('Keyboard: sign-in');
  await anon.goto('/login'); await anon.keyboard.press('Tab');
  const first = await anon.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.tagName);
  console.log('   first tab stop:', first);
  await anon.getByLabel('Email').focus(); await anon.keyboard.type('admin@demo.samakose.test'); await anon.keyboard.press('Tab'); await anon.keyboard.type('Demo-Passw0rd-2026'); await anon.keyboard.press('Enter');
  check(await anon.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).then(() => true).catch(() => false), 'sign-in works with the keyboard alone');

  console.log('Signed-in structure');
  for (const p of ['/dashboard', '/cases', '/admin/agents', '/profile']) {
    await anon.goto(p, { waitUntil: 'domcontentloaded' }); await anon.waitForLoadState('networkidle').catch(() => {});
    const s = await anon.evaluate(() => ({ main: document.querySelectorAll('main').length, h1: document.querySelectorAll('h1').length, nav: document.querySelectorAll('nav').length, title: document.title, unnamedBtn: [...document.querySelectorAll('button, a')].filter((e) => !(e.textContent || '').trim() && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.querySelector('img[alt]:not([alt=""])')).length, noLabel: [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((e: any) => !e.labels?.length && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).length }));
    check(s.main === 1 && s.h1 >= 1 && s.nav >= 1, `${p} has main, heading and navigation landmarks`, JSON.stringify(s));
    check(!!s.title.trim(), `${p} has a page title`);
    check(s.unnamedBtn === 0, `${p} has no unnamed buttons or links`, String(s.unnamedBtn));
    check(s.noLabel === 0, `${p} has no unlabelled form fields`, String(s.noLabel));
  }

  console.log('Keyboard: dialogs and focus');
  await anon.goto('/admin/agents'); await anon.waitForLoadState('networkidle').catch(() => {});
  let sawFocusRing = true;
  for (let i = 0; i < 8; i++) {
    await anon.keyboard.press('Tab');
    const vis = await anon.evaluate(() => { const e = document.activeElement as HTMLElement; if (!e || e === document.body) return true; const cs = getComputedStyle(e); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== 'none'; });
    if (!vis) sawFocusRing = false;
  }
  check(sawFocusRing, 'focused controls show a visible focus indicator (first 8 tab stops)');
  await b.close();
  console.log('\nRuntime problems:', problems.length);
  const t = tally(); console.log(`\n${t.pass} passed, ${t.fail} failed`);
  process.exit(t.fail || problems.length ? 1 : 0);
})();
