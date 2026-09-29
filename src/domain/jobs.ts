/**
 * Postgres-backed job queue. Workers claim rows with FOR UPDATE SKIP LOCKED, so any number of
 * workers can run safely. Failed jobs retry with backoff, then stay as failed for review.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { NonRetryable } from '@/services/ai';

export type JobHandler = (payload: any, job: { id: string; requestedBy: string | null }) => Promise<unknown>;
const registry = new Map<string, JobHandler>();
export const registerJob = (kind: string, fn: JobHandler) => { registry.set(kind, fn); };
let loaded = false;
async function load() { if (!loaded) { loaded = true; await import('./job-handlers'); } }

export async function enqueue(ctx: Pick<Ctx, 'db' | 'after' | 'user'>, kind: string, payload: Record<string, unknown> = {}, o: { runAt?: Date; maxAttempts?: number } = {}) {
  const [j] = await ctx.db.insert(schema.jobs).values({ kind, payload, runAt: o.runAt ?? new Date(), maxAttempts: o.maxAttempts ?? 3, requestedBy: ctx.user?.id ?? null }).returning({ id: schema.jobs.id });
  ctx.after(() => kick());
  return j.id;
}

let kicking = false;
/** Run due jobs in the background of this process. Safe to call often. */
export function kick() {
  if (kicking || process.env.DISABLE_INPROCESS_JOBS === '1') return;
  kicking = true;
  setImmediate(async () => {
    try { while ((await runOnce(5)) > 0) { /* drain */ } } catch (e) { console.error('job runner', e); } finally { kicking = false; }
  });
}

export async function runOnce(limit = 5): Promise<number> {
  await load();
  await db().execute(sql`UPDATE jobs SET status='queued', locked_at=NULL WHERE status='running' AND locked_at < now() - interval '10 minutes'`);
  const claimed = await db().execute(sql`
    UPDATE jobs SET status='running', locked_at=now(), attempts=attempts+1, updated_at=now()
    WHERE id IN (SELECT id FROM jobs WHERE status='queued' AND run_at <= now() ORDER BY run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, kind, payload, attempts, max_attempts AS "maxAttempts", requested_by AS "requestedBy"`);
  const rows = claimed.rows as { id: string; kind: string; payload: unknown; attempts: number; maxAttempts: number; requestedBy: string | null }[];
  for (const j of rows) {
    const h = registry.get(j.kind);
    try {
      if (!h) throw new Error(`No handler for job kind ${j.kind}`);
      const result = await h(j.payload, { id: j.id, requestedBy: j.requestedBy });
      await db().update(schema.jobs).set({ status: 'done', result: (result ?? null) as any, lockedAt: null, updatedAt: new Date(), lastError: null }).where(eq(schema.jobs.id, j.id));
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 500);
      const final = j.attempts >= j.maxAttempts || e instanceof NonRetryable;
      await db().update(schema.jobs).set({
        status: final ? 'failed' : 'queued', lastError: msg, lockedAt: null, updatedAt: new Date(),
        runAt: final ? new Date() : new Date(Date.now() + 2 ** j.attempts * 5_000)
      }).where(eq(schema.jobs.id, j.id));
    }
  }
  return rows.length;
}

/** Test and cron helper: run until nothing is due. */
export async function drainJobs(max = 50) {
  let total = 0;
  for (let i = 0; i < max; i++) { const n = await runOnce(10); total += n; if (!n) break; }
  return total;
}

export async function getJob(id: string) {
  const [j] = await db().select().from(schema.jobs).where(eq(schema.jobs.id, id)).limit(1);
  return j ?? null;
}
