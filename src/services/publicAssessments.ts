/** Public free preliminary assessments. Answers and scoring stay in the browser. */
import { eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { fieldError, notFound } from '@/lib/errors';
import { fileResponse } from '@/api/framework';
import { resolveFreeAssessmentVersion, questionsOf, SME360_ANSWER_OPTIONS, AGRIFOOD360_ANSWER_OPTIONS, ESO360_ANSWER_OPTIONS } from './frameworks';
import { buildFreeAssessmentPdf } from './report-export';
import { sendMail } from '@/lib/mail';
import { loadRules } from './common';

export const FREE_ASSESSMENT_PLATFORMS = ['SME360', 'AGRIFOOD360', 'ESO360'] as const;
export type FreeAssessmentPlatform = (typeof FREE_ASSESSMENT_PLATFORMS)[number];
const PLATFORM_ORG_TYPE: Record<FreeAssessmentPlatform, 'SME' | 'AGRIFOOD' | 'ESO'> = { SME360: 'SME', AGRIFOOD360: 'AGRIFOOD', ESO360: 'ESO' };
const ANSWER_OPTIONS_BY_PLATFORM = {
  SME360: SME360_ANSWER_OPTIONS, AGRIFOOD360: AGRIFOOD360_ANSWER_OPTIONS, ESO360: ESO360_ANSWER_OPTIONS
} as const;

export type FreeAssessmentResult = {
  overallScore: number;
  classification: 'Critical Attention' | 'Needs Improvement' | 'Developing' | 'Strong Foundation';
  dimensionScores: { dimension: string; score: number }[];
  completedAt: string;
};

export function normaliseEmail(raw: string): string { return raw.trim().toLowerCase(); }

const ALREADY_USED_MESSAGE = {
  title: 'Your Free Assessment Has Already Been Used',
  body: "You have already completed your free assessment for this platform using this email address. You can explore the full Business Health Assessment for a more comprehensive diagnosis and personalised improvement plan.",
  actions: ['Explore Full Assessment', 'Return to Home']
};

export async function checkFreeAssessmentEligibility(ctx: Ctx, email: string, platform: FreeAssessmentPlatform) {
  if (!FREE_ASSESSMENT_PLATFORMS.includes(platform)) throw fieldError({ platform: 'Unknown platform' });
  const normalised = normaliseEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) throw fieldError({ email: 'Enter a valid email address' });
  const [existing] = await ctx.db.select({ id: schema.freeAssessmentResults.id }).from(schema.freeAssessmentResults)
    .where(sql`lower(btrim(${schema.freeAssessmentResults.email})) = ${normalised} and ${schema.freeAssessmentResults.platform} = ${platform}`).limit(1);
  const [legacy] = await ctx.db.select({ id: schema.publicAssessments.id }).from(schema.publicAssessments)
    .where(sql`${schema.publicAssessments.normalisedEmail} = ${normalised} and ${schema.publicAssessments.platform} = ${platform} and ${schema.publicAssessments.status} = 'Completed'`).limit(1);
  return existing || legacy ? { eligible: false as const, ...ALREADY_USED_MESSAGE } : { eligible: true as const };
}

export async function getFreeAssessmentQuestions(ctx: Ctx, platform: FreeAssessmentPlatform) {
  if (!FREE_ASSESSMENT_PLATFORMS.includes(platform)) throw fieldError({ platform: 'Unknown platform' });
  const version = await resolveFreeAssessmentVersion(ctx.db, PLATFORM_ORG_TYPE[platform]);
  const options = ANSWER_OPTIONS_BY_PLATFORM[platform] as Record<string, { A: string; B: string; C: string; D: string }>;
  const rules = await loadRules(ctx.db);
  return {
    eligible: true as const,
    platform,
    scoringRules: {
      'freeAssessment.criticalAttention_below': rules['freeAssessment.criticalAttention_below'],
      'freeAssessment.needsImprovement_below': rules['freeAssessment.needsImprovement_below'],
      'freeAssessment.developing_below': rules['freeAssessment.developing_below']
    },
    questions: questionsOf(version).map((q) => ({ code: q.code, dimension: q.dimension, text: q.text, options: options[q.code] ?? null }))
  };
}

/**
 * Low-impact forgery resistance (audit Section B). The server never sees the raw per-question
 * answers -- that is the deliberate, approved privacy design, and this does not weaken it -- so it
 * cannot prove a submitted result was honestly computed from real answers. What it CAN cheaply catch
 * is an internally-inconsistent or framework-mismatched payload: a classification that does not match
 * the band the overall score actually falls in, dimension names that do not belong to the platform's
 * published question set, a dimension count that does not match it, or an overall score far from the
 * average of the submitted dimension scores. None of this is cryptographic proof; it only raises the
 * bar from "type any number" to "the forged number must at least be self-consistent with the published
 * framework". The result stays explicitly preliminary either way (see the UI disclaimer) and must never
 * drive eligibility, finance, certification or other high-stakes decisions on its own.
 */
async function assertResultIsConsistent(ctx: Ctx, platform: FreeAssessmentPlatform, result: FreeAssessmentResult) {
  const rules = await loadRules(ctx.db);
  const expectedClassification = (await import('@/domain/logic')).freeAssessmentClassification(result.overallScore, rules);
  if (expectedClassification !== result.classification) {
    throw fieldError({ 'result.classification': `Does not match the band for a score of ${result.overallScore}` });
  }

  const version = await resolveFreeAssessmentVersion(ctx.db, PLATFORM_ORG_TYPE[platform]);
  const validDimensions = new Set(questionsOf(version).map((q) => q.dimension));
  const submittedDimensions = result.dimensionScores.map((d) => d.dimension);
  if (new Set(submittedDimensions).size !== submittedDimensions.length) throw fieldError({ 'result.dimensionScores': 'Duplicate dimension' });
  for (const d of submittedDimensions) {
    if (!validDimensions.has(d)) throw fieldError({ 'result.dimensionScores': `Unknown dimension for ${platform}: ${d}` });
  }
  if (submittedDimensions.length !== validDimensions.size) {
    throw fieldError({ 'result.dimensionScores': `Expected ${validDimensions.size} dimensions for ${platform}, got ${submittedDimensions.length}` });
  }

  const avg = result.dimensionScores.reduce((s, d) => s + d.score, 0) / result.dimensionScores.length;
  if (Math.abs(result.overallScore - avg) > 15) {
    throw fieldError({ 'result.overallScore': 'Does not match the submitted dimension scores' });
  }
}

export async function completeFreeAssessment(ctx: Ctx, input: { email: string; fullName: string; platform: FreeAssessmentPlatform; result: FreeAssessmentResult }) {
  if (!FREE_ASSESSMENT_PLATFORMS.includes(input.platform)) throw fieldError({ platform: 'Unknown platform' });
  const email = normaliseEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fieldError({ email: 'Enter a valid email address' });
  await assertResultIsConsistent(ctx, input.platform, input.result);
  const [existing] = await ctx.db.select({ id: schema.freeAssessmentResults.id }).from(schema.freeAssessmentResults)
    .where(sql`lower(btrim(${schema.freeAssessmentResults.email})) = ${email} and ${schema.freeAssessmentResults.platform} = ${input.platform}`).limit(1);
  if (existing) return { eligible: false as const, ...ALREADY_USED_MESSAGE };
  const [legacy] = await ctx.db.select({ id: schema.publicAssessments.id }).from(schema.publicAssessments)
    .where(sql`${schema.publicAssessments.normalisedEmail} = ${email} and ${schema.publicAssessments.platform} = ${input.platform} and ${schema.publicAssessments.status} = 'Completed'`).limit(1);
  if (legacy) return { eligible: false as const, ...ALREADY_USED_MESSAGE };

  try {
    const row = await ctx.db.transaction(async (tx) => {
      const [result] = await tx.insert(schema.freeAssessmentResults).values({
        email, fullName: input.fullName.trim(), platform: input.platform, result: input.result
      }).returning({ id: schema.freeAssessmentResults.id });
      // Add the completion to the existing admin inquiry queue. Consent remains false because
      // acknowledging the privacy notice is not permission for marketing or unsolicited outreach.
      await tx.insert(schema.inquiries).values({
        kind: 'assessment', name: input.fullName.trim(), email, consent: false, source: 'free-assessment',
        publicAssessmentId: result.id, platform: input.platform,
        overallScore: input.result.overallScore, classification: input.result.classification
      });
      return result;
    });
    return { eligible: true as const, id: row.id, platform: input.platform, fullName: input.fullName.trim(), ...input.result };
  } catch (error) {
    // drizzle-orm's node-postgres driver wraps the raw pg error (DrizzleQueryError), putting the
    // original error on .cause - the real Postgres error code/constraint live there, not on the
    // top-level error directly.
    const top = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const code = top.cause?.code ?? top.code;
    const constraint = top.cause?.constraint ?? top.constraint;
    if (code === '23505' && constraint === 'free_assessment_results_email_platform_uq') {
      return { eligible: false as const, ...ALREADY_USED_MESSAGE };
    }
    throw error;
  }
}

export async function getFreeAssessment(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(schema.freeAssessmentResults).where(eq(schema.freeAssessmentResults.id, id)).limit(1);
  if (!row) throw notFound('Assessment result not found');
  return { eligible: true as const, id: row.id, platform: row.platform, fullName: row.fullName, ...row.result };
}

export async function useReportAction(ctx: Ctx, id: string, action: 'email' | 'download') {
  const result = await getFreeAssessment(ctx, id);
  const [row] = await ctx.db.select().from(schema.freeAssessmentResults).where(eq(schema.freeAssessmentResults.id, id)).limit(1);
  if (!row) throw notFound('Assessment result not found');
  // Same A4 PDF either way - "email" and "download" are two delivery routes for one document, not
  // two different results. Emailing only a plain-text score dump was a regression: the person loses
  // the formatted report (dimension chart, branding, reference number) the moment they choose email
  // over download, for no reason tied to either delivery route's actual capability.
  const pdf = await buildFreeAssessmentPdf({
    id: result.id, platform: result.platform, fullName: result.fullName, email: row.email, businessName: null,
    overallScore: result.overallScore, classification: result.classification, dimensionScores: result.dimensionScores, completedAt: result.completedAt
  });
  if (action === 'email') {
    await sendMail(row.email, `Your free ${result.platform} Business Health result`, [
      `Hello ${result.fullName},`, '', `Your preliminary ${result.platform} result: ${result.overallScore}/100 (${result.classification}).`,
      '', 'The full result, with your scores by dimension, is attached as a PDF.', '',
      'This is a preliminary assessment, not a certified diagnosis or investment-readiness determination.'
    ].join('\n'), [{ filename: `${result.platform}-result.pdf`, content: pdf, contentType: 'application/pdf' }]);
    return { ok: true };
  }
  return fileResponse(`${result.platform}-result.pdf`, 'application/pdf', pdf);
}
