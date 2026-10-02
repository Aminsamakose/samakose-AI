/**
 * Business Health Record: one read-only view of an organisation's history across all its cases.
 * It reads what is already stored and invents nothing. Scope follows the same case rules as the rest of the platform.
 * Owners see their own organisation but not internal coaching notes or unreleased reports.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { forbidden } from '@/lib/errors';
import { assertOrg, caseScope, isInternal } from '@/domain/scope';
import { allow, need } from './common';

type Dim = { dimension: string; value: number };

/** Plain-language reason a score moved. Facts only: the framework version and the dimension deltas. */
export function explainChange(prev: { overall: number; dimensions: Dim[]; versionId: string | null; versionLabel: string } | null, cur: { overall: number; dimensions: Dim[]; versionId: string | null; versionLabel: string }) {
  if (!prev) return { delta: null as number | null, dimensions: [] as { dimension: string; delta: number }[], reason: 'First score for this case.' };
  const pm = new Map(prev.dimensions.map((d) => [d.dimension, d.value]));
  const dims = cur.dimensions.map((d) => ({ dimension: d.dimension, delta: Math.round((d.value - (pm.get(d.dimension) ?? d.value)) * 10) / 10 })).filter((d) => d.delta !== 0);
  const delta = Math.round((cur.overall - prev.overall) * 10) / 10;
  const parts: string[] = [];
  if (prev.versionId !== cur.versionId) parts.push(`Scored under a different framework version (${prev.versionLabel} to ${cur.versionLabel}), so part of the change may come from the framework and not the business.`);
  if (!dims.length) parts.push('No dimension moved.');
  else {
    const top = [...dims].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2).map((d) => `${d.dimension} ${d.delta > 0 ? '+' : ''}${d.delta}`);
    parts.push(`Largest movement: ${top.join(', ')}.`);
  }
  return { delta, dimensions: dims, reason: parts.join(' ') };
}

export async function healthRecord(ctx: Ctx, orgId: string) {
  allow(ctx, 'scores', 'read');
  const u = need(ctx).user;
  if (u.role === 'FUNDER') throw forbidden('Funders see aggregated results only');
  const org = await assertOrg(ctx, orgId);
  const internal = isInternal(u);
  const cases = await ctx.db.select().from(schema.cases).where(and(eq(schema.cases.orgId, orgId), caseScope(u))).orderBy(asc(schema.cases.createdAt));
  const ids = cases.map((c) => c.id);
  const empty = { organisation: { id: org.id, code: org.code, name: org.name, type: org.type }, cases: [] as unknown[], timeline: [] as unknown[] };
  if (!ids.length) return empty;

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
    ctx.db.select({ id: schema.frameworkVersions.id, version: schema.frameworkVersions.version, code: schema.frameworks.code, status: schema.frameworkVersions.status })
      .from(schema.frameworkVersions).innerJoin(schema.frameworks, eq(schema.frameworks.id, schema.frameworkVersions.frameworkId))
  ]);
  const label = (id: string | null) => { const v = versions.find((x) => x.id === id); return v ? `${v.code} v${v.version}` : 'unversioned'; };

  const out = cases.map((c) => {
    const cs = scores.filter((s) => s.caseId === c.id);
    let prev: Parameters<typeof explainChange>[0] = null;
    const scoreRuns = cs.map((s) => {
      const cur = { overall: Number(s.overall), dimensions: s.dimensions, versionId: s.frameworkVersionId, versionLabel: label(s.frameworkVersionId) };
      const why = explainChange(prev, cur); prev = cur;
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
  return { organisation: { id: org.id, code: org.code, name: org.name, type: org.type }, cases: out };
}
