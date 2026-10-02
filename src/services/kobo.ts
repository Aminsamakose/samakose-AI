import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError } from '@/lib/errors';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/crypto';
import { emitEvent } from '@/domain/events';
import { EVIDENCE_CLASSES, type EvidenceClass } from '@/db/schema';
import { submitDiagnosticCore, type AnswerInput } from './diagnostics';

/** KoboToolbox sends field names that may be prefixed by group names. Use the last segment. */
const leaf = (k: string) => k.split('/').pop()!;

export function mapKobo(sub: Record<string, any>) {
  const flat: Record<string, any> = {};
  for (const [k, v] of Object.entries(sub)) flat[leaf(k)] = v;
  const answers: Record<string, AnswerInput> = {};
  // Field names: Q01 with Q01_evidence and Q01_ref, the earlier q_Q01 with e_Q01 and ref_Q01, and bank codes such as SM-001.
  // Form field names may use an underscore instead of the hyphen (SM_001). A question that does not apply is sent as <field>_na.
  const naFlag = (v: unknown) => ['1', 'true', 'yes', 'y', 'na', 'n/a'].includes(String(v ?? '').trim().toLowerCase());
  for (const [k, v] of Object.entries(flat)) {
    const m = /^(?:q_)?(Q\d{2,3}|[A-Z]{2}[-_]\d{3})$/.exec(k);
    if (!m) continue;
    const raw = m[1], q = raw.replace('_', '-');
    if (naFlag(flat[`${raw}_na`]) || (typeof v === 'string' && ['na', 'n/a'].includes(v.trim().toLowerCase()))) { answers[q] = { notApplicable: true }; continue; }
    if (v === '' || v === null || v === undefined) continue;
    const evidence = flat[`${raw}_evidence`] ?? flat[`e_${raw}`];
    answers[q] = { value: Number(v), evidence: EVIDENCE_CLASSES.includes(evidence) ? (evidence as EvidenceClass) : 'Self-reported', ref: flat[`${raw}_ref`] ?? flat[`ref_${raw}`] ?? null };
  }
  return { uuid: String(sub._uuid ?? flat._uuid ?? ''), caseCode: String(flat.case_code ?? flat.case_id ?? '').trim(), answers };
}

export async function ingestKobo(ctx: Ctx, sub: Record<string, any>) {
  const m = mapKobo(sub);
  if (!m.uuid) throw new ApiError(400, 'bad_request', 'The submission has no _uuid');
  const dupe = await ctx.db.select({ id: schema.diagnostics.id }).from(schema.diagnostics).where(eq(schema.diagnostics.submissionUuid, m.uuid)).limit(1);
  if (dupe.length) return { accepted: false, duplicate: true };
  const [cs] = await ctx.db.select().from(schema.cases).where(eq(schema.cases.code, m.caseCode)).limit(1);
  if (!cs) {
    await audit(ctx, 'kobo.unknown_case', 'diagnostic', null, undefined, { uuid: m.uuid, caseCode: m.caseCode });
    await emitEvent(ctx, 'SystemError', { payload: { message: `KoboToolbox submission ${m.uuid} names an unknown case "${m.caseCode}"` } });
    return { accepted: false, unknownCase: true };
  }
  return submitDiagnosticCore(ctx, cs, m.answers, { uuid: m.uuid, source: 'kobo', persistRejection: true });
}

export async function koboWebhook(ctx: Ctx, secretHeader: string | null, body: unknown) {
  if (!env.koboSecret) throw new ApiError(503, 'not_configured', 'KoboToolbox intake is not configured');
  if (!secretHeader || !safeEqual(secretHeader, env.koboSecret)) throw new ApiError(401, 'bad_secret', 'Secret check failed');
  if (!body || typeof body !== 'object') throw new ApiError(400, 'bad_request', 'Expected a JSON submission');
  return ingestKobo(ctx, body as Record<string, any>);
}

/** Pull recent submissions when the webhook cannot be used. Verified against the documented v2 API shape only. */
export async function koboPull(fetchImpl: typeof fetch = fetch) {
  if (!env.koboToken || !env.koboAsset) return { skipped: 'not configured' };
  const res = await fetchImpl(`${env.koboServer}/api/v2/assets/${encodeURIComponent(env.koboAsset)}/data/?format=json&limit=200`, { headers: { authorization: `Token ${env.koboToken}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`KoboToolbox answered ${res.status}`);
  const j: any = await res.json();
  let accepted = 0, rejected = 0, duplicates = 0;
  for (const sub of j.results ?? []) {
    const r: any = await db().transaction(async (t) => ingestKobo({ user: null, ip: 'kobo-pull', requestId: 'kobo-pull', db: t, after: () => {} }, sub));
    if (r.duplicate) duplicates++; else if (r.accepted) accepted++; else rejected++;
  }
  return { accepted, rejected, duplicates };
}
