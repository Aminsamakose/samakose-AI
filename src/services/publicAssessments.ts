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

export async function completeFreeAssessment(ctx: Ctx, input: { email: string; fullName: string; platform: FreeAssessmentPlatform; result: FreeAssessmentResult }) {
  if (!FREE_ASSESSMENT_PLATFORMS.includes(input.platform)) throw fieldError({ platform: 'Unknown platform' });
  const email = normaliseEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fieldError({ email: 'Enter a valid email address' });
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
    const e = error as { code?: string; constraint?: string };
    if (e.code === '23505' && e.constraint === 'free_assessment_results_email_platform_uq') {
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
  if (action === 'email') {
    await sendMail(row.email, `Your free ${result.platform} Business Health result`, [
      `Hello ${result.fullName},`, '', `Your preliminary ${result.platform} result: ${result.overallScore}/100 (${result.classification}).`,
      '', ...result.dimensionScores.map((d) => `${d.dimension}: ${d.score}/100`), '',
      'This is a preliminary assessment, not a certified diagnosis or investment-readiness determination.'
    ].join('\n'));
    return { ok: true };
  }
  const pdf = await buildFreeAssessmentPdf({
    id: result.id, platform: result.platform, fullName: result.fullName, email: row.email, businessName: null,
    overallScore: result.overallScore, classification: result.classification, dimensionScores: result.dimensionScores, completedAt: result.completedAt
  });
  return fileResponse(`${result.platform}-result.pdf`, 'application/pdf', pdf);
}
