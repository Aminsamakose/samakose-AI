/** Runs every browser journey against a running app (E2E_BASE, default http://localhost:3100) seeded with SEED_DEMO=1. */
import { spawnSync } from 'node:child_process';
const steps = ['sweep', 'journey', 'commercial', 'delivery', 'framework', 'agents', 'trust'];
let failed = 0;
for (const s of steps) {
  console.log(`\n=== e2e/${s}.ts ===`);
  const r = spawnSync('npx', ['tsx', `e2e/${s}.ts`], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} journey(s) failed` : '\nAll journeys passed');
process.exit(failed ? 1 : 0);
