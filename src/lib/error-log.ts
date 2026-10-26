import { db, schema } from '@/db/client';

/**
 * Best-effort capture of an unhandled server error, so it shows up on the admin System page
 * (GET /admin/system/errors) instead of only in stdout/Vercel logs. Never the request body or any
 * failing values -- just enough (name, code, message, where) to recognise and triage a recurring
 * failure. Fire-and-forget: a failure to log must never affect the response already being sent, and
 * it runs on its own connection, not inside the transaction that just rolled back.
 */
export function logServerError(source: 'request' | 'after_commit' | 'worker', e: unknown, extra?: { requestId?: string; method?: string; path?: string }) {
  const err = e as { name?: string; code?: string; cause?: { code?: string }; message?: string } | undefined;
  const message = (err instanceof Error ? err.message : String(err ?? 'Unknown error')).slice(0, 500);
  const code = (err?.cause?.code ?? err?.code ?? undefined)?.toString().slice(0, 40);
  const name = err?.name?.toString().slice(0, 100);
  db().insert(schema.serverErrors).values({
    source, requestId: extra?.requestId ?? null, method: extra?.method ?? null, path: extra?.path ?? null, name: name ?? null, code: code ?? null, message
  }).catch((logErr) => console.error('[error-log] failed to record server error', logErr));
}
