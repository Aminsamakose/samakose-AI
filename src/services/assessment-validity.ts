/**
 * #128: joins the free preliminary assessment (free_assessment_results) to the paid full diagnostic
 * (organisations/cases/health_scores) for the same business, so #127's convergent-validity check --
 * whether the free assessment's provisional classification bands agree with the full diagnostic's own
 * outcome for the same business -- has something to run against.
 *
 * The join itself (matching by normalised email, written once to free_assessment_results.matchedOrgId)
 * lives in migration 0070's match_public_assessments_to_organisations() SQL function; this service
 * triggers that function and reads back the matched pairs with both sides' scores attached. It does not
 * decide HOW convergent validity should be judged (threshold, statistic, sample size) -- that is #127's
 * own decision once there is enough matched data to look at.
 */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { allow } from './common';
import { audit } from '@/lib/audit';

/**
 * Runs the matching function and reports how many new matches it made. Safe to re-run any time -- it
 * only ever fills in rows that are still unmatched. Called both from the admin API route (permission
 * enforced there, by the route framework, before this runs) and from the assessment_match_scan job on a
 * system ctx with no user, so this function itself does not gate on a role -- matching assignments's
 * own scanUnacknowledged, which follows the same split.
 */
export async function matchPublicAssessmentsToOrganisations(ctx: Ctx) {
  const rows = (await ctx.db.execute(sql`select match_public_assessments_to_organisations() as matched`)).rows as { matched: number }[];
  const matched = Number(rows[0]?.matched ?? 0);
  await audit(ctx, 'assessment.matched_to_organisations', 'free_assessment_result', null, undefined, { matched });
  return { matched };
}

/**
 * Every matched pair: the free assessment's own classification/score alongside the matched organisation's
 * most recent health score (if any diagnostic has been scored for it yet). A pair with no health score yet
 * means the business matched by email but has not had a diagnostic scored -- not yet usable for comparison,
 * but kept in the list so the backlog of "matched, awaiting a diagnostic" is visible too.
 */
export async function convergentValidityPairs(ctx: Ctx) {
  allow(ctx, 'frameworks', 'read');
  const far = schema.freeAssessmentResults, org = schema.organisations, hs = schema.healthScores, cs = schema.cases;
  const rows = await ctx.db.select({
    resultId: far.id, platform: far.platform, result: far.result, freeCompletedAt: far.createdAt,
    orgId: org.id, orgCode: org.code, orgName: org.name,
    caseId: cs.id, paidOverall: hs.overall, paidMaturity: hs.maturity, paidScoredAt: hs.createdAt
  })
    .from(far)
    .innerJoin(org, eq(far.matchedOrgId, org.id))
    .leftJoin(cs, eq(cs.orgId, org.id))
    .leftJoin(hs, eq(hs.caseId, cs.id))
    .where(isNotNull(far.matchedOrgId))
    .orderBy(desc(far.createdAt));

  // One business can have several cases/scores; keep only the latest score per free-assessment row.
  const byResult = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    const existing = byResult.get(r.resultId);
    if (!existing || (r.paidScoredAt && (!existing.paidScoredAt || r.paidScoredAt > existing.paidScoredAt))) byResult.set(r.resultId, r);
  }
  const pairs = [...byResult.values()].map((r) => ({
    resultId: r.resultId, platform: r.platform, freeScore: r.result.overallScore, freeClassification: r.result.classification,
    freeCompletedAt: r.freeCompletedAt, orgId: r.orgId, orgCode: r.orgCode, orgName: r.orgName,
    caseId: r.caseId, paidOverall: r.paidOverall, paidMaturity: r.paidMaturity, paidScoredAt: r.paidScoredAt
  }));
  return {
    pairs,
    summary: {
      matched: pairs.length,
      withPaidScore: pairs.filter((p) => p.paidOverall !== null).length,
      awaitingDiagnostic: pairs.filter((p) => p.paidOverall === null).length
    }
  };
}

/** Below this many completions, a distribution or correlation is too noisy to say anything -- #127's own suggested threshold. */
const MIN_COMPLETIONS_FOR_INTERNAL_CONSISTENCY = 50;
/** If one classification band holds this share of respondents or more, the cut-points are probably miscalibrated for the actual population, not just a skewed-but-plausible sample. */
const DOMINANT_BAND_SHARE_FLAG = 0.8;

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

/**
 * #127 step 1 ("internal consistency", the cheapest validation step, run first): for each platform with
 * enough completions, checks that (a) the band distribution isn't absurd -- one band holding the great
 * majority of respondents would suggest the 0-39/40-59/60-79/80-100 cut-points are miscalibrated for the
 * actual population, not that the sample is genuinely that skewed -- and (b) the six dimension scores
 * correlate sensibly with each other (an average pairwise correlation near zero or negative would suggest
 * the dimensions aren't measuring a coherent underlying "business health" construct at all; the paid
 * diagnostic's Cronbach's-alpha-style reliability work can go further once there's a reason to invest in
 * it, but a plain average pairwise Pearson correlation is enough to catch a badly broken bank early).
 *
 * This does not decide what to DO about a bad result (that's still #127's and Amin's judgment call) --
 * it only ever reports what the data looks like, below the threshold where that's sayable at all.
 */
export async function internalConsistency(ctx: Ctx) {
  allow(ctx, 'frameworks', 'read');
  const rows = await ctx.db.select({ platform: schema.freeAssessmentResults.platform, result: schema.freeAssessmentResults.result })
    .from(schema.freeAssessmentResults);

  const byPlatform = new Map<string, typeof rows>();
  for (const r of rows) { const list = byPlatform.get(r.platform) ?? []; list.push(r); byPlatform.set(r.platform, list); }

  const platforms = ['SME360', 'AGRIFOOD360', 'ESO360'];
  return platforms.map((platform) => {
    const list = byPlatform.get(platform) ?? [];
    const completions = list.length;
    if (completions < MIN_COMPLETIONS_FOR_INTERNAL_CONSISTENCY) {
      return { platform, completions, insufficientData: true as const, minRequired: MIN_COMPLETIONS_FOR_INTERNAL_CONSISTENCY };
    }

    const byBand = new Map<string, number>();
    for (const r of list) byBand.set(r.result.classification, (byBand.get(r.result.classification) ?? 0) + 1);
    const bandDistribution = [...byBand.entries()].map(([classification, count]) => ({ classification, count, share: count / completions }));
    const dominantBand = bandDistribution.find((b) => b.share >= DOMINANT_BAND_SHARE_FLAG);

    const dimensionNames = [...new Set(list.flatMap((r) => r.result.dimensionScores.map((d) => d.dimension)))];
    const byDimension = new Map<string, number[]>(dimensionNames.map((d) => [d, []]));
    for (const r of list) {
      const scoreByDim = new Map(r.result.dimensionScores.map((d) => [d.dimension, d.score]));
      for (const d of dimensionNames) byDimension.get(d)!.push(scoreByDim.get(d) ?? NaN);
    }
    const correlations: { a: string; b: string; r: number | null }[] = [];
    for (let i = 0; i < dimensionNames.length; i++) {
      for (let j = i + 1; j < dimensionNames.length; j++) {
        correlations.push({ a: dimensionNames[i], b: dimensionNames[j], r: pearson(byDimension.get(dimensionNames[i])!, byDimension.get(dimensionNames[j])!) });
      }
    }
    const validCorrelations = correlations.map((c) => c.r).filter((r): r is number => r !== null);
    const averagePairwiseCorrelation = validCorrelations.length ? validCorrelations.reduce((a, b) => a + b, 0) / validCorrelations.length : null;

    return {
      platform, completions, insufficientData: false as const,
      bandDistribution, dominantBandFlag: dominantBand ? { classification: dominantBand.classification, share: dominantBand.share } : null,
      averagePairwiseCorrelation, correlations,
      // A rough, explainable read: strongly negative or near-zero average correlation means the dimensions
      // may not be measuring a coherent construct; a dominant band means the cut-points may be miscalibrated.
      // Either flag is a reason to look closer before calling the bands validated -- not proof they're wrong.
      looksConsistent: !dominantBand && (averagePairwiseCorrelation === null || averagePairwiseCorrelation > 0.1)
    };
  });
}
