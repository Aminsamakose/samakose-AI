/**
 * Free preliminary Business Health assessment (public, anonymous, no sign-in).
 *
 * Governing rules, carried over from the approved spec exactly:
 *  - One shared engine, framework per platform (frameworks/frameworkVersions) -- SME360 is the only
 *    platform with an approved, published question bank today; AgriFood360 and ESO360 are rejected
 *    with a clear "not yet available" error rather than silently served the SME360 questions.
 *  - One completed free assessment per normalised email per platform. Enforced by a database partial
 *    unique index (public_assessments_one_completed_uq), not by this code -- this code only produces
 *    the friendly, pre-flight "already used" response; the index is what actually cannot be bypassed.
 *  - Email normalisation is trim + lowercase only. Never strip dots or plus-addressing.
 *  - Result-action allowances (view/email/download/print) are independent, each set only on confirmed
 *    success, never on a failed or merely-attempted action.
 *  - Scoring is scoreFreeAssessment() in domain/logic.ts -- deliberately not scoreDiagnostic(), see
 *    that function's comment for why.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { sha256 } from '@/lib/crypto';
import { sendMail } from '@/lib/mail';
import { conflict, fieldError, notFound, unprocessable } from '@/lib/errors';
import { fileResponse } from '@/api/framework';
import { scoreFreeAssessment, type FreeAssessmentAnswer } from '@/domain/logic';
import { resolveFreeAssessmentVersion, questionsOf, SME360_ANSWER_OPTIONS } from './frameworks';
import { buildFreeAssessmentPdf } from './report-export';

/** Answer-option text by platform. Only SME360 has an approved bank today; AgriFood360/ESO360 are rejected before this is ever consulted. */
const ANSWER_OPTIONS_BY_PLATFORM: Partial<Record<FreeAssessmentPlatform, Record<string, { A: string; B: string; C: string; D: string }>>> = { SME360: SME360_ANSWER_OPTIONS };
import { loadRules } from './common';

export const FREE_ASSESSMENT_PLATFORMS = ['SME360', 'AGRIFOOD360', 'ESO360'] as const;
export type FreeAssessmentPlatform = (typeof FREE_ASSESSMENT_PLATFORMS)[number];
const PLATFORM_ORG_TYPE: Record<FreeAssessmentPlatform, 'SME' | 'AGRIFOOD' | 'ESO'> = { SME360: 'SME', AGRIFOOD360: 'AGRIFOOD', ESO360: 'ESO' };

/** Trim + lowercase only. Deliberately does not strip dots or plus-addressing (spec, Phase 6). */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const ALREADY_USED_MESSAGE = {
  title: 'Your Free Assessment Has Already Been Used',
  body: "You have already completed your free assessment for this platform using this email address. Your previous assessment remains subject to the platform's retention and access rules. You can explore the full Business Health Assessment to obtain a more comprehensive diagnosis and personalised improvement plan.",
  actions: ['Explore Full Assessment', 'Return to Home']
};

type StartInput = { email: string; fullName: string; businessName?: string | null; platform: FreeAssessmentPlatform; marketingConsent?: boolean; privacyAcknowledged: true; source?: string | null };

/** Begin (or resume) a free assessment. Does not consume the one-per-email-per-platform allowance -- only a Completed row does that. */
export async function startFreeAssessment(ctx: Ctx, input: StartInput) {
  if (!FREE_ASSESSMENT_PLATFORMS.includes(input.platform)) throw fieldError({ platform: 'Unknown platform' });
  if (input.platform !== 'SME360') {
    throw unprocessable(`${input.platform} is not yet available. Its question bank has not been developed and approved.`);
  }
  if (!input.privacyAcknowledged) throw fieldError({ privacyAcknowledged: 'You must acknowledge the privacy notice to continue' });
  const normalisedEmail = normaliseEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalisedEmail)) throw fieldError({ email: 'Enter a valid email address' });

  const t = schema.publicAssessments;
  const [already] = await ctx.db.select({ id: t.id }).from(t)
    .where(and(eq(t.normalisedEmail, normalisedEmail), eq(t.platform, input.platform), eq(t.status, 'Completed'))).limit(1);
  if (already) return { eligible: false as const, ...ALREADY_USED_MESSAGE };

  const version = await resolveFreeAssessmentVersion(ctx.db, PLATFORM_ORG_TYPE[input.platform]);
  const [row] = await ctx.db.insert(t).values({
    email: input.email.trim(), normalisedEmail, fullName: input.fullName.trim(), businessName: input.businessName?.trim() || null,
    platform: input.platform, frameworkVersionId: version.id, status: 'Started',
    marketingConsent: !!input.marketingConsent, privacyAcknowledged: true, source: input.source ?? null,
    ipHash: ctx.ip && ctx.ip !== 'direct' && ctx.ip !== 'unknown' ? sha256(ctx.ip) : null
  }).returning();
  const options = ANSWER_OPTIONS_BY_PLATFORM[input.platform];
  const questions = questionsOf(version).map((q) => ({ code: q.code, dimension: q.dimension, text: q.text, options: options?.[q.code] ?? null }));
  return { eligible: true as const, id: row.id, platform: row.platform, frameworkVersionId: version.id, questions };
}

const ANSWER_CODES = new Set(['A', 'B', 'C', 'D']);
const ANSWER_VALUE: Record<string, 1 | 2 | 3 | 4> = { A: 4, B: 3, C: 2, D: 1 };

type SubmitInput = { id: string; answers: Record<string, 'A' | 'B' | 'C' | 'D'> };

/**
 * Score and complete a Started attempt. The database partial unique index is the actual, atomic,
 * concurrency-safe enforcement of "one completed assessment per email per platform" -- a unique-
 * violation here is caught and turned into the same friendly "already used" response a pre-flight
 * check would give, so two near-simultaneous submissions for the same email+platform can race the
 * database but never both end up Completed.
 */
export async function submitFreeAssessment(ctx: Ctx, input: SubmitInput) {
  const t = schema.publicAssessments;
  const [row] = await ctx.db.select().from(t).where(eq(t.id, input.id)).limit(1);
  if (!row) throw notFound('Assessment not found');
  if (row.status === 'Completed') return resultOf(row);

  const version = await ctx.db.select().from(schema.frameworkVersions).where(eq(schema.frameworkVersions.id, row.frameworkVersionId)).limit(1).then((r) => r[0]);
  if (!version) throw unprocessable('The framework version for this assessment is no longer available');
  const questions = questionsOf(version);

  const missing = questions.filter((q) => !input.answers[q.code]).map((q) => q.code);
  if (missing.length) throw fieldError({ answers: `Missing answer for: ${missing.join(', ')}` });
  for (const [code, letter] of Object.entries(input.answers)) {
    if (!ANSWER_CODES.has(letter)) throw fieldError({ answers: `Invalid answer for ${code}` });
  }
  const answerValues: Record<string, 1 | 2 | 3 | 4> = {};
  const scoreInput: FreeAssessmentAnswer[] = questions.map((q) => {
    const v = ANSWER_VALUE[input.answers[q.code]];
    answerValues[q.code] = v;
    return { questionCode: q.code, value: v };
  });

  const rules = await loadRules(ctx.db);
  const result = scoreFreeAssessment(scoreInput, questions, rules);

  try {
    const [updated] = await ctx.db.update(t).set({
      status: 'Completed', answers: answerValues, dimensionScores: result.dimensions.map((d) => ({ dimension: d.dimension, score: d.score })),
      overallScore: Math.round(result.overall), classification: result.classification, completedAt: new Date()
    }).where(and(eq(t.id, input.id), eq(t.status, 'Started'))).returning();
    if (!updated) {
      // Lost a race with another completion of the same row (e.g. a duplicate double-submit click).
      const [fresh] = await ctx.db.select().from(t).where(eq(t.id, input.id)).limit(1);
      return resultOf(fresh!);
    }
    await recordCrmLead(ctx, updated);
    await audit(ctx, 'free_assessment.completed', 'public_assessment', updated.id, undefined, { platform: updated.platform, overallScore: updated.overallScore });
    return resultOf(updated);
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint === 'public_assessments_one_completed_uq') {
      return { eligible: false as const, ...ALREADY_USED_MESSAGE };
    }
    throw e;
  }
}

function resultOf(row: typeof schema.publicAssessments.$inferSelect) {
  return {
    eligible: true as const, id: row.id, platform: row.platform, businessName: row.businessName,
    overallScore: row.overallScore, classification: row.classification, dimensionScores: row.dimensionScores,
    completedAt: row.completedAt
  };
}

/** Lead capture into the existing CRM (inquiries), per the spec's "reuse the existing CRM, do not build a second one" instruction. */
async function recordCrmLead(ctx: Ctx, row: typeof schema.publicAssessments.$inferSelect) {
  await ctx.db.insert(schema.inquiries).values({
    kind: 'assessment', name: row.fullName, email: row.email, organisation: row.businessName,
    interest: `Free ${row.platform} assessment`, consent: row.marketingConsent, source: row.source ?? 'free_assessment',
    ipHash: row.ipHash, publicAssessmentId: row.id, platform: row.platform, overallScore: row.overallScore, classification: row.classification
  });
}

export async function getFreeAssessment(ctx: Ctx, id: string) {
  const t = schema.publicAssessments;
  const [row] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!row) throw notFound('Assessment not found');
  if (row.status !== 'Completed') throw unprocessable('This assessment has not been completed yet');
  if (!row.resultViewedAt) await ctx.db.update(t).set({ resultViewedAt: new Date() }).where(eq(t.id, id));
  return resultOf(row);
}

/**
 * Consume one of the three independently-tracked, one-time report-generation allowances. Each is an
 * atomic conditional UPDATE (... WHERE x_at IS NULL), so a double click or a retried request after a
 * dropped connection can never consume the allowance twice, and a failed action (e.g. the mail send
 * throws) never marks it used.
 */
export async function useReportAction(ctx: Ctx, id: string, action: 'email' | 'download' | 'print') {
  const t = schema.publicAssessments;
  const [row] = await ctx.db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!row) throw notFound('Assessment not found');
  if (row.status !== 'Completed') throw unprocessable('This assessment has not been completed yet');

  if (action === 'email') {
    if (row.emailSentAt) throw conflict('The result email has already been sent for this assessment');
    // Only consume the allowance once the mail service has accepted the message for sending.
    await sendMail(row.email, `Your free ${row.platform} Business Health result`,
      [`Hello ${row.fullName},`, '', `Your preliminary ${row.platform} result: ${row.overallScore}/100 (${row.classification}).`,
        '', 'This is a preliminary assessment, not a certified diagnosis or investment-readiness determination.',
        '', 'This is an automated message from Samakose Business Doctor. This mailbox is not monitored for replies. For assistance, please use our official support channels.'].join('\n'));
    const [updated] = await ctx.db.update(t).set({ emailSentAt: new Date() }).where(and(eq(t.id, id), isNull(t.emailSentAt))).returning();
    if (!updated) throw conflict('The result email has already been sent for this assessment');
    return { ok: true };
  }
  if (action === 'download') {
    if (row.downloadedAt) throw conflict('The result has already been downloaded for this assessment');
    const [updated] = await ctx.db.update(t).set({ downloadedAt: new Date() }).where(and(eq(t.id, id), isNull(t.downloadedAt))).returning();
    if (!updated) throw conflict('The result has already been downloaded for this assessment');
    // #123: a real PDF, not a client-side plain-text Blob built from JSON the browser already had.
    const pdf = await buildFreeAssessmentPdf({
      platform: updated.platform, businessName: updated.businessName, overallScore: updated.overallScore ?? 0,
      classification: updated.classification ?? '', dimensionScores: updated.dimensionScores ?? [], completedAt: updated.completedAt
    });
    return fileResponse(`${updated.platform}-result.pdf`, 'application/pdf', pdf);
  }
  if (row.printedAt) throw conflict('Print has already been authorised for this assessment');
  const [updated] = await ctx.db.update(t).set({ printedAt: new Date() }).where(and(eq(t.id, id), isNull(t.printedAt))).returning();
  if (!updated) throw conflict('Print has already been authorised for this assessment');
  return { ok: true };
}
