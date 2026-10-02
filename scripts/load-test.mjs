/** Load test against a running app (default http://localhost:3100). Public pages and signed-in reads at rising concurrency. Local numbers are a relative guide, not a capacity promise. */
import autocannon from 'autocannon';
const BASE = process.env.LOAD_BASE ?? 'http://localhost:3100';
const PASSWORD = 'Demo-Passw0rd-2026';
async function cookieFor(email) {
  const r = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!r.ok) throw new Error('login failed ' + r.status);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
const run = (opts) => new Promise((res) => autocannon({ ...opts, url: BASE + opts.path }, (e, r) => res(r)));
const row = (name, c, r) => console.log(`${name.padEnd(34)} c=${String(c).padEnd(3)} ${String(Math.round(r.requests.average)).padStart(6)} req/s  p50 ${String(r.latency.p50).padStart(4)} ms  p97.5 ${String(r.latency.p97_5).padStart(5)} ms  p99 ${String(r.latency.p99).padStart(5)} ms  non2xx ${r.non2xx}  errors ${r.errors}  timeouts ${r.timeouts}`);
(async () => {
  const admin = await cookieFor('admin@demo.samakose.test');
  const owner = await cookieFor('owner@demo.samakose.test');
  const plan = [
    ['Public home page', '/', null], ['Public pricing page', '/pricing', null], ['Health check', '/api/v1/health', null],
    ['Admin: case list', '/api/v1/cases', admin], ['Admin: dashboard', '/api/v1/dashboard', admin], ['Admin: command centre', '/api/v1/admin/command-centre', admin],
    ['Owner: notifications', '/api/v1/notifications', owner], ['Owner: invoices', '/api/v1/invoices', owner]
  ];
  for (const c of [10, 50, 100]) {
    console.log(`\n--- ${c} concurrent connections, 12 s each ---`);
    for (const [name, path, cookie] of plan) row(name, c, await run({ path, connections: c, duration: 12, headers: cookie ? { cookie } : {} }));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
