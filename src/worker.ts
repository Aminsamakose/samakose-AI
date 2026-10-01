/** Stand-alone job worker: `npm run worker`. Also queues the recurring jobs on a timer. */
import { sql } from 'drizzle-orm';
import { db, closeDb } from './db/client';
import { drainJobs } from './domain/jobs';

const RECURRING: [string, number][] = [['send_emails', 60], ['overdue_scan', 3600], ['invoice_scan', 3600], ['expire_sessions', 6 * 3600], ['content_scan', 900], ['kobo_pull', 900]];
const last = new Map<string, number>();
let stopping = false;

async function tick() {
  const now = Date.now();
  for (const [kind, everySec] of RECURRING) {
    if (kind === 'kobo_pull' && !(process.env.KOBO_TOKEN && process.env.KOBO_ASSET_UID)) continue;
    if (now - (last.get(kind) ?? 0) < everySec * 1000) continue;
    last.set(kind, now);
    await db().execute(sql`insert into jobs (kind, payload) select ${kind}, '{}'::jsonb where not exists (select 1 from jobs where kind = ${kind} and status in ('queued','running'))`);
  }
  await drainJobs();
}
async function main() {
  console.log('worker started');
  while (!stopping) {
    try { await tick(); } catch (e) { console.error('worker tick failed', e); }
    await new Promise((r) => setTimeout(r, 3000));
  }
  await closeDb();
}
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
main();
