import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/crypto';
import { drainJobs, registerJob } from '@/domain/jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Called by a scheduler (cron, systemd timer or the PaaS scheduler) with the CRON_SECRET. Queues the recurring jobs, then runs what is due. */
async function run(req: Request) {
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.cronSecret || !safeEqual(given, env.cronSecret)) return NextResponse.json({ error: { code: 'unauthorized', message: 'Bad secret' } }, { status: 401 });
  void registerJob;
  for (const kind of ['overdue_scan', 'invoice_scan', 'expire_sessions', 'send_emails']) {
    await db().execute(sql`insert into jobs (kind, payload) select ${kind}, '{}'::jsonb where not exists (select 1 from jobs where kind = ${kind} and status in ('queued','running'))`);
  }
  if (env.koboToken && env.koboAsset) await db().execute(sql`insert into jobs (kind, payload) select 'kobo_pull', '{}'::jsonb where not exists (select 1 from jobs where kind='kobo_pull' and status in ('queued','running'))`);
  const ran = await drainJobs();
  return NextResponse.json({ ok: true, ran });
}

// Vercel Cron issues GET with `Authorization: Bearer $CRON_SECRET`; other schedulers can POST.
export const GET = run;
export const POST = run;
