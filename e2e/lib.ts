import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

export const BASE = process.env.E2E_BASE ?? 'http://localhost:3100';
export const PASSWORD = 'Demo-Passw0rd-2026';
export const EXE = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export type Problem = { where: string; what: string };
export const problems: Problem[] = [];
let pass = 0, fail = 0;
export const check = (ok: boolean, name: string, detail = '') => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); } };
export const tally = () => ({ pass, fail });

export async function launch(): Promise<Browser> { return chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] }); }

/** New isolated browser context per user, with error watchers attached to every page. */
export async function newContext(b: Browser, viewport = { width: 1280, height: 800 }): Promise<BrowserContext> {
  const ctx = await b.newContext({ viewport, baseURL: BASE });
  ctx.on('page', (p) => watch(p));
  return ctx;
}
export function watch(p: Page) {
  p.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/Failed to load resource.*(401|403|404|409|422)/.test(t)) problems.push({ where: p.url(), what: 'console: ' + t.slice(0, 300) }); } });
  p.on('pageerror', (e) => problems.push({ where: p.url(), what: 'pageerror: ' + e.message.slice(0, 300) }));
  p.on('response', (r) => { if (r.status() >= 500) problems.push({ where: p.url(), what: `HTTP ${r.status()} ${r.url()}` }); });
}
export async function login(b: Browser, email: string, viewport?: { width: number; height: number }) {
  const ctx = await newContext(b, viewport);
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  return { ctx, page };
}
/** A page is healthy when it shows no error box and no unexpected boundary. */
export async function healthy(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const status = res?.status() ?? 0;
  const errBox = await page.locator('.errbox, [role=alert]:has-text("Something went wrong")').count();
  const h1 = await page.locator('h1').first().textContent().catch(() => null);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  return { status, errBox, h1, overflow, url: page.url() };
}
