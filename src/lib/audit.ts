import { schema } from '@/db/client';
import type { Ctx } from './context';

const SECRET_KEYS = new Set(['passwordHash', 'password_hash', 'password', 'mfaSecret', 'mfa_secret', 'tokenHash', 'token_hash', 'token', 'code', 'secret']);
/** Remove secrets before anything is written to the audit trail. */
export function redact(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined || depth > 5) return v ?? null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = SECRET_KEYS.has(k) && k !== 'code' ? '[redacted]' : redact(val, depth + 1);
    return o;
  }
  return v;
}

/** Write one audit row inside the caller's transaction. */
export async function audit(ctx: Ctx, action: string, entity: string, entityId: string | null, before?: unknown, after?: unknown, caseId?: string | null, actorType: 'HUMAN' | 'AI' | 'HYBRID' = 'HUMAN') {
  await ctx.db.insert(schema.auditLog).values({
    actorId: ctx.user?.id ?? null, actorEmail: ctx.user?.email ?? null, ip: ctx.ip, requestId: ctx.requestId,
    action, entity, entityId, caseId: caseId ?? null, before: before === undefined ? null : redact(before), after: after === undefined ? null : redact(after), actorType
  });
}
