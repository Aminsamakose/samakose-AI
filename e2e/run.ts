/** Runs every browser journey against a running app (E2E_BASE, default http://localhost:3100) seeded with SEED_DEMO=1. */
import { spawnSync } from 'node:child_process';
import pg from 'pg';

/** Each journey signs in several roles. The login limiter is per address, so clear it between journeys on the local dev database. */
async function resetLoginLimits() {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/samakose_dev';
  if (!/localhost|127\.0\.0\.1/.test(url)) return; // never touch a remote database
  const c = new pg.Client({ connectionString: url });
  try { await c.connect(); await c.query('delete from rate_limits'); } catch { /* the limiter table is optional for the run */ } finally { await c.end().catch(() => {}); }
}
const steps = ['sweep', 'journey', 'commercial', 'delivery', 'framework', 'agents', 'trust'];
let failed = 0;
(async () => {
for (const s of steps) {
  await resetLoginLimits();
  console.log(`\n=== e2e/${s}.ts ===`);
  const r = spawnSync('npx', ['tsx', `e2e/${s}.ts`], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} journey(s) failed` : '\nAll journeys passed');
process.exit(failed ? 1 : 0);
})();
