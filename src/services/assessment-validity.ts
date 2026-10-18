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
