/**
 * Business Health Record: one read-only view of an organisation's history across all its cases.
 * It reads what is already stored and invents nothing. Scope follows the same case rules as the rest of the platform.
 * Owners see their own organisation but not internal coaching notes or unreleased reports.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { forbidden } from '@/lib/errors';
import { assertOrg, caseScope, isInternal } from '@/domain/scope';
import { comparability, type Comparability } from '@/domain/bank';
import type { QuestionLite, Rules } from '@/domain/logic';
import { allow, need, loadRules } from './common';
import { questionsOf } from './frameworks';

type Dim = { dimension: string; value: number };
type Side = { overall: number; dimensions: Dim[]; versionId: string | null; versionLabel: string; questions?: QuestionLite[] };

/** Plain-language reason a score moved. Facts only: the framework version and the dimension deltas. */
export function explainChange(prev: Side | null, cur: Side, rules: Rules = {}) {
  type Out = { delta: number | null; dimensions: { dimension: string; delta: number }[]; reason: string; comparable: boolean; comparability: Comparability | null };
  if (!prev) return { delta: null, dimensions: [], reason: 'First score for this case.', comparable: true, comparability: null } as Out;
  const differs = prev.versionId !== cur.versionId;
  const cmp = differs && prev.questions && cur.questions ? comparability(prev.questions, cur.questions, rules) : null;
  if (cmp && !cmp.comparable) {
    const low = cmp.domains.filter((d) => !d.comparable).map((d) => d.dimension);
    return { delta: null, dimensions: [], comparable: false, comparability: cmp,
      reason: `Not compared. ${prev.versionLabel} and ${cur.versionLabel} differ too much: ${Math.round(cmp.share * 100)}% of the weight is in unchanged questions, and at least ${Math.round(cmp.threshold * 100)}% is needed${low.length ? ` (below the line: ${low.join(', ')})` : ''}. Re-score the earlier answers under the new version to compare.` } as Out;
  }
  const pm = new Map(prev.dimensions.map((d) => [d.dimension, d.value]));
  const skip = new Set((cmp?.domains ?? []).filter((d) => !d.comparable).map((d) => d.dimension));
  const dims = cur.dimensions.filter((d) => !skip.has(d.dimension)).map((d) => ({ dimension: d.dimension, delta: Math.round((d.value - (pm.get(d.dimension) ?? d.value)) * 10) / 10 })).filter((d) => d.delta !== 0);
  const delta = Math.round((cur.overall - prev.overall) * 10) / 10;
  const parts: string[] = [];
  if (differs) parts.push(`Scored under a different framework version (${prev.versionLabel} to ${cur.versionLabel})${cmp ? `, with ${Math.round(cmp.share * 100)}% of the weight in unchanged questions` : ''}, so part of the change may come from the framework and not the business.`);
  if (!dims.length) parts.push('No dimension moved.');
  else {
    const top = [...dims].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2).map((d) => `${d.dimension} ${d.delta > 0 ? '+' : ''}${d.delta}`);
    parts.push(`Largest movement: ${top.join(', ')}.`);
  }
  return { delta, dimensions: dims, reason: parts.join(' '), comparable: true, comparability: cmp } as Out;
}

export async function healthRecord(ctx: Ctx, orgId: string) {
  allow(ctx, 'scores', 'read');
  const u = need(ctx).user;
  if (u.role === 'FUNDER') throw forbidden('Funders see aggregated results only');
  const org = await assertOrg(ctx, orgId);
  const internal = isInternal(u);
  const cases = await ctx.db.select().from(schema.cases).where(and(eq(schema.cases.orgId, orgId), caseScope(u))).orderBy(asc(schema.cases.createdAt));
  const ids = cases.map((c) => c.id);
  const [record] = await ctx.db.select().from(schema.businessHealthRecords)
    .where(eq(schema.businessHealthRecords.orgId, orgId)).limit(1);
  if (!record) throw new Error('Business Health Record anchor is missing for this organisation');

  const eventScope = ids.length
    ? or(isNull(schema.businessHealthRecordEvents.caseId), inArray(schema.businessHealthRecordEvents.caseId, ids))
    : isNull(schema.businessHealthRecordEvents.caseId);
  const eventRows = await ctx.db.select().from(schema.businessHealthRecordEvents)
    .where(and(eq(schema.businessHealthRecordEvents.recordId, record.id), eventScope))
    .orderBy(desc(schema.businessHealthRecordEvents.occurredAt)).limit(100);
  const clientVisibleEventTypes = new Set([
    'ORGANISATION_CREATED', 'ORGANISATION_UPDATED', 'CASE_OPENED', 'CASE_STATUS_CHANGED',
    'DIAGNOSTIC_SUBMITTED', 'DIAGNOSTIC_UPDATED', 'SCORE_COMPUTED', 'DIAGNOSIS_CREATED',
    'DIAGNOSIS_UPDATED', 'PRESCRIPTION_CREATED', 'PRESCRIPTION_UPDATED', 'INTERVENTION_CREATED',
    'INTERVENTION_UPDATED', 'ACTION_CREATED', 'ACTION_UPDATED', 'EVIDENCE_ADDED',
    'EVIDENCE_VERIFIED', 'DOCUMENT_UPLOADED', 'DOCUMENT_STATUS_CHANGED', 'KPI_CREATED',
    'KPI_UPDATED', 'OUTCOME_READING_RECORDED', 'CERTIFICATE_PROPOSED',
    'CERTIFICATE_STATUS_CHANGED', 'OPPORTUNITY_REFERRAL_STATUS_CHANGED', 'REPORT_RELEASED'
  ]);
  const timeline = eventRows.reverse()
    .filter((e) => internal || clientVisibleEventTypes.has(e.eventType))
    .map((e) => ({
      id: e.id, eventType: e.eventType, sourceType: e.sourceType, sourceId: e.sourceId,
      caseId: e.caseId, summary: e.summary, occurredAt: e.occurredAt, details: e.details
    }));
  const recordView = {
    id: record.id, status: record.status, version: record.recordVersion, latestCaseId: record.latestCaseId,
    firstAssessedAt: record.firstAssessedAt, lastActivityAt: record.lastActivityAt,
    createdAt: record.createdAt, updatedAt: record.updatedAt
  };
  if (!ids.length) return { organisation: { id: org.id, code: org.code, name: org.name, type: org.type }, record: recordView, cases: [], timeline };

  const [diagnostics, scores, diagnoses, rxs, ivs, kpis, sessions, approvals, reports, versions] = await Promise.all([
    ctx.db.select().from(schema.diagnostics).where(inArray(schema.diagnostics.caseId, ids)).orderBy(asc(schema.diagnostics.createdAt)),
    ctx.db.select().from(schema.healthScores).where(inArray(schema.healthScores.caseId, ids)).orderBy(asc(schema.healthScores.createdAt)),
    ctx.db.select().from(schema.diagnoses).where(inArray(schema.diagnoses.caseId, ids)).orderBy(asc(schema.diagnoses.createdAt)),
    ctx.db.select().from(schema.prescriptions).where(inArray(schema.prescriptions.caseId, ids)).orderBy(asc(schema.prescriptions.createdAt)),
    ctx.db.select().from(schema.interventions).where(inArray(schema.interventions.caseId, ids)),
    ctx.db.select().from(schema.kpis).where(inArray(schema.kpis.caseId, ids)),
    internal ? ctx.db.select().from(schema.coachingSessions).where(inArray(schema.coachingSessions.caseId, ids)).orderBy(asc(schema.coachingSessions.scheduledAt)) : Promise.resolve([]),
    internal ? ctx.db.select().from(schema.approvals).where(inArray(schema.approvals.caseId, ids)).orderBy(asc(schema.approvals.createdAt)) : Promise.resolve([]),
    ctx.db.select().from(schema.reports).where(and(inArray(schema.reports.caseId, ids), internal ? sql`true` : eq(schema.reports.status, 'Released'))).orderBy(asc(schema.reports.createdAt)),
    ctx.db.select({ id: schema.frameworkVersions.id, questions: schema.frameworkVersions.questions, version: schema.frameworkVersions.version, code: schema.frameworks.code, status: schema.frameworkVersions.status })
      .from(schema.frameworkVersions).innerJoin(schema.frameworks, eq(schema.frameworks.id, schema.frameworkVersions.frameworkId))
  ]);
  const label = (id: string | null) => { const v = versions.find((x) => x.id === id); return v ? `${v.code} v${v.version}` : 'unversioned'; };

  const rules = await loadRules(ctx.db);
  const qCache = new Map<string, QuestionLite[]>();
  const qsOf = (id: string | null) => { if (!id) return undefined; if (!qCache.has(id)) { const v = versions.find((x) => x.id === id); if (v) qCache.set(id, questionsOf(v as any)); } return qCache.get(id); };
  const out = cases.map((c) => {
    const cs = scores.filter((s) => s.caseId === c.id);
    let prev: Side | null = null;
    const scoreRuns = cs.map((s) => {
      const cur: Side = { overall: Number(s.overall), dimensions: s.dimensions, versionId: s.frameworkVersionId, versionLabel: label(s.frameworkVersionId), questions: qsOf(s.frameworkVersionId) };
      const why = explainChange(prev, cur, rules); prev = cur;
      return { id: s.id, run: s.run, at: s.createdAt, overall: cur.overall, maturity: s.maturity, confidence: s.confidenceClass, framework: cur.versionLabel, dimensions: s.dimensions, change: why };
    });
    return {
      id: c.id, code: c.code, status: c.status, openedAt: c.createdAt,
      diagnostics: diagnostics.filter((d) => d.caseId === c.id).map((d) => ({ id: d.id, code: d.code, at: d.createdAt, status: d.status, version: d.version, completion: Number(d.completion), framework: label(d.frameworkVersionId) })),
      scores: scoreRuns,
      diagnoses: diagnoses.filter((d) => d.caseId === c.id).map((d) => ({ id: d.id, code: d.code, at: d.createdAt, status: d.status, priority: d.priority, summary: d.summary })),
      prescriptions: rxs.filter((r) => r.caseId === c.id).map((r) => ({ id: r.id, code: r.code, at: r.createdAt, status: r.status, items: Array.isArray(r.items) ? r.items.length : 0 })),
      interventions: ivs.filter((i) => i.caseId === c.id).map((i) => ({ id: i.id, code: i.code, library: i.libraryCode, status: i.status })),
      kpis: kpis.filter((k) => k.caseId === c.id).map((k) => ({ id: k.id, name: k.name, unit: k.unit, baseline: k.baseline === null ? null : Number(k.baseline), target: k.target === null ? null : Number(k.target) })),
      sessions: sessions.filter((s) => s.caseId === c.id).map((s) => ({ id: s.id, at: s.scheduledAt, status: s.status })),
      approvals: approvals.filter((a) => a.caseId === c.id).map((a) => ({ id: a.id, at: a.createdAt, type: a.recordType, decision: a.decision, reason: a.reason })),
      reports: reports.filter((r) => r.caseId === c.id).map((r) => ({ id: r.id, code: r.code, title: r.title, status: r.status, releasedAt: r.releasedAt }))
    };
  });
  return { organisation: { id: org.id, code: org.code, name: org.name, type: org.type }, record: recordView, cases: out, timeline };
}
