/**
 * Business Health frameworks and their versions.
 * A framework version is a frozen copy of the questions, dimensions and rule overrides that a diagnostic was scored under.
 * Published versions never change (a database trigger enforces it), so history is explained by the version it points at.
 * Specialised frameworks (AgriFood360, ESO360) cannot be published until every source in their evidence trail is approved.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, notFound, unprocessable } from '@/lib/errors';
import { DEFAULT_RULES, type QuestionLite, type Rules } from '@/domain/logic';
import type { FrameworkMeta, FrameworkQuestion, FrameworkSource } from '@/db/schema';
import { parseCondition } from '@/domain/bank';
import { can } from '@/lib/rbac';
import { allow, need } from './common';
import eso360BankV1 from '../../docs/frameworks/drafts/eso360-bank-v1-loadable.json';

export type VersionRow = typeof schema.frameworkVersions.$inferSelect;
type Db = Ctx['db'];

export const questionsOf = (v: Pick<VersionRow, 'questions'>): QuestionLite[] => v.questions.map((q) => {
  const l: QuestionLite = { code: q.code, dimension: q.dimension, text: q.text, weight: q.weight };
  // Version 1 questions stay exactly four fields. v2 metadata is copied only when present.
  if (q.subDimension) l.subDimension = q.subDimension;
  if (q.criticality) l.criticality = q.criticality;
  if (q.readiness?.length) l.readiness = q.readiness;
  if (q.applies) l.applies = q.applies;
  if (q.riskTag) l.riskTag = q.riskTag;
  return l;
});
/** What a form needs: the scoring fields plus the guidance a person answers from. Version 1 questions stay four fields. */
export const formQuestionsOf = (v: Pick<VersionRow, 'questions'>) => v.questions.map((q) => {
  const o: Record<string, unknown> = { code: q.code, dimension: q.dimension, text: q.text, weight: q.weight };
  for (const k of ['subDimension', 'responseType', 'anchors', 'evidence', 'criticality', 'applies'] as const) if (q[k] !== undefined) o[k] = q[k];
  return o as { code: string; dimension: string; text: string; weight: number; subDimension?: string; responseType?: string; anchors?: (string | null)[]; evidence?: { requirement: string; method: string; examples?: string[] }; criticality?: string; applies?: string };
});
/** Global rules with the version's own overrides on top. The merged set is stored with every score. */
export const rulesFor = (v: Pick<VersionRow, 'rules'>, global: Rules): Rules => ({ ...global, ...(v.rules ?? {}) });

/**
 * The version a new PAID diagnostic for this kind of organisation is taken under.
 *
 * Filters on purpose: 'full' (#133): without it, a free-preliminary framework published for a non-SME
 * orgType (AgriFood360, ESO360) with no isDefault:true anchor of its own could be picked up here and
 * score a real paying client's diagnostic against the free 25-question bank. SME360 was never at risk
 * of this specific collision (its paid framework is the one isDefault:true framework), but every other
 * platform was, so the filter is applied unconditionally rather than only where a collision is known.
 */
export async function resolveVersion(db: Db, orgType?: string | null): Promise<VersionRow> {
  if (orgType) {
    const [s] = await db.select({ v: schema.frameworkVersions }).from(schema.frameworkVersions)
      .innerJoin(schema.frameworks, eq(schema.frameworks.id, schema.frameworkVersions.frameworkId))
      .where(and(eq(schema.frameworks.orgType, orgType as 'SME'), eq(schema.frameworks.isDefault, false), eq(schema.frameworks.purpose, 'full'), eq(schema.frameworkVersions.status, 'Published')))
      .orderBy(desc(schema.frameworkVersions.version)).limit(1);
    if (s) return s.v;
  }
  const [d] = await db.select({ v: schema.frameworkVersions }).from(schema.frameworkVersions)
    .innerJoin(schema.frameworks, eq(schema.frameworks.id, schema.frameworkVersions.frameworkId))
    .where(and(eq(schema.frameworks.isDefault, true), eq(schema.frameworks.purpose, 'full'), eq(schema.frameworkVersions.status, 'Published')))
    .orderBy(desc(schema.frameworkVersions.version)).limit(1);
  if (!d) throw unprocessable('No published Business Health framework is available');
  return d.v;
}

/**
 * The version the FREE preliminary assessment for this kind of organisation is taken under (#133).
 *
 * Mirrors resolveVersion()'s shape but filters purpose: 'free_preliminary' instead of 'full', and has
 * no isDefault:true fallback -- a free assessment with no matching free framework for its orgType should
 * fail loudly (no published free preliminary assessment is available) rather than silently fall through
 * to a paid framework's question bank, which is the exact conflation #133 exists to prevent.
 */
export async function resolveFreeAssessmentVersion(db: Db, orgType?: string | null): Promise<VersionRow> {
  if (orgType) {
    const [s] = await db.select({ v: schema.frameworkVersions }).from(schema.frameworkVersions)
      .innerJoin(schema.frameworks, eq(schema.frameworks.id, schema.frameworkVersions.frameworkId))
      .where(and(eq(schema.frameworks.orgType, orgType as 'SME'), eq(schema.frameworks.purpose, 'free_preliminary'), eq(schema.frameworkVersions.status, 'Published')))
      .orderBy(desc(schema.frameworkVersions.version)).limit(1);
    if (s) return s.v;
  }
  throw unprocessable('No published free preliminary assessment is available for this kind of organisation');
}
export async function versionById(db: Db, id: string): Promise<VersionRow | null> {
  const [v] = await db.select().from(schema.frameworkVersions).where(eq(schema.frameworkVersions.id, id)).limit(1);
  return v ?? null;
}
/** The version a stored diagnostic or score was produced under. Falls back to the current default for rows that predate versioning. */
export async function versionForRow(db: Db, versionId: string | null | undefined, orgType?: string | null): Promise<VersionRow> {
  if (versionId) { const v = await versionById(db, versionId); if (v) return v; }
  return resolveVersion(db, orgType);
}

/* ----------------------------- the working question bank ---------------------------- */
export async function bankSnapshot(db: Db): Promise<{ questions: FrameworkQuestion[]; dimensions: string[] }> {
  const rows = await db.select().from(schema.questions).where(eq(schema.questions.active, true)).orderBy(asc(schema.questions.sort), asc(schema.questions.code));
  const dims: string[] = [];
  for (const r of rows) if (!dims.includes(r.dimension)) dims.push(r.dimension);
  return { questions: rows.map((r) => ({ code: r.code, dimension: r.dimension, text: r.text, weight: r.weight })), dimensions: dims };
}
const sameQuestions = (a: FrameworkQuestion[], b: FrameworkQuestion[]) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------ validation ------------------------------------ */
export function validateContent(c: { questions: FrameworkQuestion[]; dimensions: string[]; rules?: Record<string, string | number> | null; meta?: FrameworkMeta | null }) {
  const e: Record<string, string> = {};
  if (!c.dimensions.length) e.dimensions = 'Add at least one dimension';
  if (new Set(c.dimensions).size !== c.dimensions.length) e.dimensions = 'Dimension names must be unique';
  if (!c.questions.length) e.questions = 'Add at least one question';
  const seen = new Set<string>();
  for (const q of c.questions) {
    if (!/^[A-Z0-9][A-Z0-9_-]{1,15}$/.test(q.code)) { e.questions = `Question code ${q.code} is not valid. Use capital letters, digits, dash or underscore`; break; }
    if (seen.has(q.code)) { e.questions = `Question code ${q.code} is used twice`; break; }
    seen.add(q.code);
    if (q.text.trim().length < 5 || q.text.length > 300) { e.questions = `Question ${q.code} needs 5 to 300 characters`; break; }
    if (!Number.isInteger(q.weight) || q.weight < 1 || q.weight > 5) { e.questions = `Question ${q.code} needs a whole weight from 1 to 5`; break; }
    if (!c.dimensions.includes(q.dimension)) { e.questions = `Question ${q.code} uses a dimension that is not in the list`; break; }
    if (q.anchors && (q.anchors.length !== 5 || q.anchors.some((a) => a !== null && (typeof a !== 'string' || !a.trim())))) { e.questions = `Question ${q.code} needs five anchors for the values 0 to 4`; break; }
    if (q.criticality === 'Gate' && q.weight < 4) { e.questions = `Question ${q.code} is a gate and needs a weight of 4 or 5`; break; }
  }
  const m = c.meta;
  if (m && !e.questions) {
    const subs = new Set((m.subDimensions ?? []).map((s) => s.code)), reds = new Set((m.readiness ?? []).map((r) => r.code));
    for (const q of c.questions) {
      if (q.subDimension && m.subDimensions && !subs.has(q.subDimension)) { e.questions = `Question ${q.code} uses sub-dimension ${q.subDimension} that is not defined`; break; }
      const bad = (q.readiness ?? []).find((r) => !reds.has(r));
      if (bad) { e.questions = `Question ${q.code} feeds readiness index ${bad} that is not defined`; break; }
    }
    for (const s of m.subDimensions ?? []) if (!c.dimensions.includes(s.dimension)) { e.meta = `Sub-dimension ${s.code} points to a dimension that is not in the list`; break; }
    const codes = new Set(c.questions.map((q) => q.code));
    for (const k of m.consistencyChecks ?? []) {
      if (!codes.has(k.itemA) || !codes.has(k.itemB)) { e.meta = `Consistency check ${k.id} names a question that does not exist`; break; }
      if (!parseCondition(k.condition)) { e.meta = `Consistency check ${k.id} has a condition that cannot be read. Use the form A>=3 and B<=1`; break; }
    }
  }
  if (!e.questions && !e.dimensions) for (const d of c.dimensions) if (!c.questions.some((q) => q.dimension === d)) { e.dimensions = `Dimension ${d} has no questions`; break; }
  for (const k of Object.keys(c.rules ?? {})) if (!(k in DEFAULT_RULES)) { e.rules = `Unknown rule ${k}`; break; }
  if (Object.keys(e).length) throw fieldError(e);
}

/** Approval of a source is a sign-off: only holders of the approve permission can grant it, and editing an approved source withdraws the approval. */
export function mergeSources(prev: FrameworkSource[], next: FrameworkSource[], canApprove: boolean, userId: string): FrameworkSource[] {
  return next.map((n, i) => {
    const p = prev[i];
    const changedText = !p || p.component !== n.component || p.source !== n.source || p.rationale !== n.rationale || p.adaptation !== n.adaptation;
    if (n.approval === 'Approved') {
      if (p?.approval === 'Approved' && !changedText) return p;
      if (!canApprove) return { ...n, approval: 'Proposed', approvedBy: null, approvedAt: null };
      return { ...n, approval: 'Approved', approvedBy: userId, approvedAt: new Date().toISOString() };
    }
    return { ...n, approvedBy: null, approvedAt: null };
  });
}

/* ------------------------------------- reading ------------------------------------- */
export async function listFrameworks(ctx: Ctx) {
  allow(ctx, 'frameworks', 'read');
  const fws = await ctx.db.select().from(schema.frameworks).orderBy(desc(schema.frameworks.isDefault), asc(schema.frameworks.code));
  const vs = await ctx.db.select().from(schema.frameworkVersions).orderBy(desc(schema.frameworkVersions.version));
  const bank = await bankSnapshot(ctx.db);
  return fws.map((f) => {
    const mine = vs.filter((v) => v.frameworkId === f.id);
    const current = mine.find((v) => v.status === 'Published') ?? null;
    return {
      id: f.id, code: f.code, name: f.name, orgType: f.orgType, description: f.description, isDefault: f.isDefault,
      currentVersion: current ? current.version : null,
      // The working question bank edits the default framework. Drift means edits are waiting to be published.
      unpublishedBankChanges: f.isDefault && current ? !sameQuestions(current.questions, bank.questions) : false,
      versions: mine.map((v) => ({
        id: v.id, version: v.version, status: v.status, questions: v.questions.length, dimensions: v.dimensions.length,
        sources: v.sources.length, sourcesApproved: v.sources.filter((s) => s.approval === 'Approved').length,
        note: v.note, approvedAt: v.approvedAt, publishedAt: v.publishedAt, createdAt: v.createdAt
      }))
    };
  });
}
export async function structuredArchitecture(db: Db, versionId: string) {
  const dimensions = await db.select().from(schema.frameworkDimensions)
    .where(eq(schema.frameworkDimensions.frameworkVersionId, versionId))
    .orderBy(asc(schema.frameworkDimensions.sortOrder));
  const subDimensions = dimensions.length
    ? await db.select().from(schema.frameworkSubDimensions)
        .where(sql`${schema.frameworkSubDimensions.dimensionId} in (${sql.join(dimensions.map((d) => sql`${d.id}`), sql`,`)})`)
        .orderBy(asc(schema.frameworkSubDimensions.sortOrder))
    : [];
  const questions = await db.select().from(schema.frameworkQuestions)
    .where(eq(schema.frameworkQuestions.frameworkVersionId, versionId))
    .orderBy(asc(schema.frameworkQuestions.sortOrder), asc(schema.frameworkQuestions.code));
  const evidence = questions.length
    ? await db.select().from(schema.frameworkEvidenceRequirements)
        .where(sql`${schema.frameworkEvidenceRequirements.questionId} in (${sql.join(questions.map((q) => sql`${q.id}`), sql`,`)})`)
    : [];
  const scoringRules = await db.select().from(schema.frameworkScoringRules)
    .where(eq(schema.frameworkScoringRules.frameworkVersionId, versionId))
    .orderBy(asc(schema.frameworkScoringRules.priority));
  const readinessRules = await db.select().from(schema.frameworkReadinessRules)
    .where(eq(schema.frameworkReadinessRules.frameworkVersionId, versionId))
    .orderBy(asc(schema.frameworkReadinessRules.priority));
  const sources = await db.select().from(schema.frameworkSourceRecords)
    .where(eq(schema.frameworkSourceRecords.frameworkVersionId, versionId));
  return { dimensions, subDimensions, questions, evidence, scoringRules, readinessRules, sources };
}


/**
 * Maintain a normalized representation of a draft while retaining framework_versions
 * as the compatibility snapshot consumed by existing diagnostics and scoring.
 * Only draft versions may be rebuilt; publication freezes both representations.
 */
export async function syncStructuredDraft(db: Db, version: VersionRow): Promise<void> {
  if (version.status !== 'Draft') throw unprocessable('Only framework drafts can update normalized framework content');

  const oldQuestions = await db.select({ id: schema.frameworkQuestions.id })
    .from(schema.frameworkQuestions).where(eq(schema.frameworkQuestions.frameworkVersionId, version.id));
  if (oldQuestions.length) {
    await db.delete(schema.frameworkEvidenceRequirements)
      .where(inArray(schema.frameworkEvidenceRequirements.questionId, oldQuestions.map((q) => q.id)));
  }
  await db.delete(schema.frameworkQuestions).where(eq(schema.frameworkQuestions.frameworkVersionId, version.id));

  const oldDimensions = await db.select({ id: schema.frameworkDimensions.id })
    .from(schema.frameworkDimensions).where(eq(schema.frameworkDimensions.frameworkVersionId, version.id));
  if (oldDimensions.length) {
    await db.delete(schema.frameworkSubDimensions)
      .where(inArray(schema.frameworkSubDimensions.dimensionId, oldDimensions.map((d) => d.id)));
  }
  await db.delete(schema.frameworkDimensions).where(eq(schema.frameworkDimensions.frameworkVersionId, version.id));
  await db.delete(schema.frameworkScoringRules).where(eq(schema.frameworkScoringRules.frameworkVersionId, version.id));
  await db.delete(schema.frameworkReadinessRules).where(eq(schema.frameworkReadinessRules.frameworkVersionId, version.id));
  await db.delete(schema.frameworkSourceRecords).where(eq(schema.frameworkSourceRecords.frameworkVersionId, version.id));

  const dimensionIds = new Map<string, string>();
  for (const [index, name] of version.dimensions.entries()) {
    const [row] = await db.insert(schema.frameworkDimensions).values({
      frameworkVersionId: version.id, code: `DIM_${String(index + 1).padStart(3, '0')}`,
      name, weight: 1, sortOrder: index
    }).returning({ id: schema.frameworkDimensions.id });
    dimensionIds.set(name, row.id);
  }

  const subDimensionIds = new Map<string, string>();
  for (const [index, sub] of (version.meta?.subDimensions ?? []).entries()) {
    const dimensionId = dimensionIds.get(sub.dimension);
    if (!dimensionId) continue;
    const [row] = await db.insert(schema.frameworkSubDimensions).values({
      dimensionId, code: sub.code, name: sub.name, description: null, weight: 1, sortOrder: index
    }).returning({ id: schema.frameworkSubDimensions.id });
    subDimensionIds.set(`${sub.dimension}::${sub.code}`, row.id);
  }

  for (const [index, question] of version.questions.entries()) {
    const dimensionId = dimensionIds.get(question.dimension);
    if (!dimensionId) throw unprocessable(`Question ${question.code} references a missing dimension`);
    const [row] = await db.insert(schema.frameworkQuestions).values({
      frameworkVersionId: version.id, dimensionId,
      subDimensionId: question.subDimension ? subDimensionIds.get(`${question.dimension}::${question.subDimension}`) ?? null : null,
      code: question.code, text: question.text, responseType: question.responseType ?? 'ANCHORED',
      weight: question.weight, criticality: question.criticality ?? 'Standard', sortOrder: index,
      appliesWhen: question.applies ?? null, riskTag: question.riskTag ?? null,
      consistencyGroup: question.consistencyGroup ?? null, anchors: question.anchors ?? [],
      readinessCodes: question.readiness ?? [], status: 'Draft', createdBy: version.createdBy ?? null
    }).returning({ id: schema.frameworkQuestions.id });
    if (question.evidence) {
      await db.insert(schema.frameworkEvidenceRequirements).values({
        questionId: row.id, requirement: question.evidence.requirement, method: question.evidence.method,
        examples: question.evidence.examples ?? [], minimumEvidenceClass: 'Self-reported', required: false
      });
    }
  }

  for (const [index, [code, value]] of Object.entries(version.rules ?? {}).entries()) {
    await db.insert(schema.frameworkScoringRules).values({
      frameworkVersionId: version.id, code, ruleType: 'LEGACY_OVERRIDE', expression: String(value),
      parameters: { compatibilitySource: 'framework_versions.rules', value }, priority: index
    });
  }
  for (const [index, rule] of (version.meta?.readiness ?? []).entries()) {
    await db.insert(schema.frameworkReadinessRules).values({
      frameworkVersionId: version.id, code: rule.code, name: rule.name, purpose: rule.purpose ?? null,
      expression: rule.purpose ?? rule.name, unlocks: (rule.unlocks ?? '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
      priority: index
    });
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const source of version.sources) {
    const approvedAt = source.approvedAt ? new Date(source.approvedAt) : null;
    await db.insert(schema.frameworkSourceRecords).values({
      frameworkVersionId: version.id, componentType: source.component, componentCode: null,
      source: source.source, rationale: source.rationale, adaptation: source.adaptation,
      approvalStatus: source.approval, approvedBy: source.approvedBy && uuidPattern.test(source.approvedBy) ? source.approvedBy : null,
      approvedAt: approvedAt && !Number.isNaN(approvedAt.getTime()) ? approvedAt : null
    });
  }
}

export async function getVersion(ctx: Ctx, id: string) {
  allow(ctx, 'frameworks', 'read');
  const v = await versionById(ctx.db, id);
  if (!v) throw notFound('Framework version not found');
  const [f] = await ctx.db.select().from(schema.frameworks).where(eq(schema.frameworks.id, v.frameworkId));
  let structured: Awaited<ReturnType<typeof structuredArchitecture>> | null = null;
  try { structured = await structuredArchitecture(ctx.db, id); } catch (error) {
    // A rolling deployment may start before migration 0048 is applied.
    const e = error as { code?: string; cause?: { code?: string } };
    if (e.code !== '42P01' && e.cause?.code !== '42P01') throw error;
  }
  return { ...v, framework: { code: f.code, name: f.name, isDefault: f.isDefault }, structured, structuredAvailable: structured !== null };
}

/* ------------------------------------- writing ------------------------------------- */
type DraftInput = { fromBank?: boolean; questions?: FrameworkQuestion[]; dimensions?: string[]; rules?: Record<string, string | number> | null; sources?: FrameworkSource[]; meta?: FrameworkMeta | null; note?: string | null };
export async function createDraft(ctx: Ctx, code: string, b: DraftInput) {
  allow(ctx, 'frameworks', 'create');
  const u = need(ctx).user;
  const [f] = await ctx.db.select().from(schema.frameworks).where(eq(schema.frameworks.code, code)).limit(1);
  if (!f) throw notFound('Framework not found');
  const open = await ctx.db.select({ id: schema.frameworkVersions.id }).from(schema.frameworkVersions).where(and(eq(schema.frameworkVersions.frameworkId, f.id), eq(schema.frameworkVersions.status, 'Draft'))).limit(1);
  if (open.length) throw unprocessable('This framework already has an open draft. Edit or discard it first');
  let content: { questions: FrameworkQuestion[]; dimensions: string[] };
  if (b.fromBank) {
    if (!f.isDefault) throw unprocessable('Only the baseline framework is built from the working question bank');
    content = await bankSnapshot(ctx.db);
  } else {
    if (!b.questions || !b.dimensions) throw fieldError({ questions: 'Send the questions and dimensions, or build the draft from the question bank' });
    content = { questions: b.questions, dimensions: b.dimensions };
  }
  validateContent({ ...content, rules: b.rules, meta: b.meta });
  const [{ n }] = await ctx.db.select({ n: sql<number>`coalesce(max(${schema.frameworkVersions.version}), 0)::int` }).from(schema.frameworkVersions).where(eq(schema.frameworkVersions.frameworkId, f.id));
  const sources = mergeSources([], b.sources ?? [], false, u.id);
  const [row] = await ctx.db.insert(schema.frameworkVersions).values({
    frameworkId: f.id, version: Number(n) + 1, status: 'Draft', questions: content.questions, dimensions: content.dimensions,
    rules: b.rules ?? null, sources, meta: b.meta ?? null, note: b.note ?? null, createdBy: u.id
  }).returning();
  await syncStructuredDraft(ctx.db, row);
  await audit(ctx, 'framework.draft_created', 'framework_version', row.id, undefined, { framework: code, version: row.version, questions: content.questions.length });
  return row;
}

export async function updateDraft(ctx: Ctx, id: string, b: Omit<DraftInput, 'fromBank'>) {
  allow(ctx, 'frameworks', 'edit');
  const u = need(ctx).user;
  const v = await versionById(ctx.db, id);
  if (!v) throw notFound('Framework version not found');
  if (v.status !== 'Draft') throw unprocessable('Only a draft can be edited. Published versions are permanent; create a new version instead');
  const next = {
    questions: b.questions ?? v.questions, dimensions: b.dimensions ?? v.dimensions,
    rules: b.rules === undefined ? v.rules : b.rules, meta: b.meta === undefined ? v.meta : b.meta, note: b.note === undefined ? v.note : b.note
  };
  validateContent(next);
  const canApprove = !!ctx.user && can(ctx.user.role, 'frameworks', 'approve');
  const sources = b.sources ? mergeSources(v.sources, b.sources, canApprove, u.id) : v.sources;
  await ctx.db.update(schema.frameworkVersions).set({ ...next, sources }).where(eq(schema.frameworkVersions.id, id));
  await syncStructuredDraft(ctx.db, { ...v, ...next, sources });
  await audit(ctx, 'framework.draft_updated', 'framework_version', id, { questions: v.questions.length, sources: v.sources.length }, { questions: next.questions.length, sources: sources.length });
  return { ok: true };
}

export async function discardDraft(ctx: Ctx, id: string) {
  allow(ctx, 'frameworks', 'edit');
  const v = await versionById(ctx.db, id);
  if (!v) throw notFound('Framework version not found');
  if (v.status !== 'Draft') throw unprocessable('Only a draft can be discarded');
  await ctx.db.delete(schema.frameworkVersions).where(eq(schema.frameworkVersions.id, id));
  await audit(ctx, 'framework.draft_discarded', 'framework_version', id, { version: v.version });
  return { ok: true };
}

/** The product sign-off. Makes a draft the version new diagnostics use, and retires the previous one (it stays readable for old scores). */
export async function publishVersion(ctx: Ctx, id: string, note: string) {
  allow(ctx, 'frameworks', 'approve');
  const u = need(ctx).user;
  const v = await versionById(ctx.db, id);
  if (!v) throw notFound('Framework version not found');
  if (v.status !== 'Draft') throw unprocessable('This version is already published');
  const [f] = await ctx.db.select().from(schema.frameworks).where(eq(schema.frameworks.id, v.frameworkId));
  validateContent({ questions: v.questions, dimensions: v.dimensions, rules: v.rules, meta: v.meta });
  if (!f.isDefault) {
    if (!v.sources.length) throw unprocessable('A specialised framework needs an evidence trail. Add the sources behind each component before publishing');
    const open = v.sources.filter((s) => s.approval !== 'Approved');
    if (open.length) throw unprocessable(`${open.length} source${open.length === 1 ? '' : 's'} in the evidence trail not yet approved`, { components: open.map((s) => s.component) });
  }
  const [prev] = await ctx.db.select().from(schema.frameworkVersions).where(and(eq(schema.frameworkVersions.frameworkId, v.frameworkId), eq(schema.frameworkVersions.status, 'Published'))).limit(1);
  if (prev) await ctx.db.update(schema.frameworkVersions).set({ status: 'Retired' }).where(eq(schema.frameworkVersions.id, prev.id));
  const now = new Date();
  // Mark question records published while the parent is still a mutable draft.
  await ctx.db.update(schema.frameworkQuestions).set({ status: 'Published' })
    .where(eq(schema.frameworkQuestions.frameworkVersionId, id));
  await ctx.db.update(schema.frameworkVersions).set({ status: 'Published', approvedBy: u.id, approvedAt: now, publishedAt: now, note: note.trim() }).where(eq(schema.frameworkVersions.id, id));
  await audit(ctx, 'framework.published', 'framework_version', id, { status: 'Draft', previous: prev ? prev.version : null }, { status: 'Published', framework: f.code, version: v.version, approvedBy: u.email, note: note.trim() });
  return { id, version: v.version, framework: f.code };
}

/** Fresh installations have no versions yet. Builds and publishes the baseline from the working question bank. Used by the seed. */
export async function ensureBaseline(db: Db) {
  const [f] = await db.select().from(schema.frameworks).where(eq(schema.frameworks.isDefault, true)).limit(1);
  if (!f) return;
  const [have] = await db.select({ id: schema.frameworkVersions.id })
    .from(schema.frameworkVersions)
    .where(and(eq(schema.frameworkVersions.frameworkId, f.id), eq(schema.frameworkVersions.status, 'Published')))
    .limit(1);
  if (have) return;

  const bank = await bankSnapshot(db);
  if (!bank.questions.length) return;
  const [{ n }] = await db.select({
    n: sql<number>`coalesce(max(${schema.frameworkVersions.version}), 0)::int`
  }).from(schema.frameworkVersions).where(eq(schema.frameworkVersions.frameworkId, f.id));
  const now = new Date();
  const [draft] = await db.insert(schema.frameworkVersions).values({
    frameworkId: f.id, version: Number(n) + 1, status: 'Draft',
    questions: bank.questions, dimensions: bank.dimensions,
    sources: [{
      component: 'Question bank and weights',
      source: 'Samakose working question bank',
      rationale: 'Baseline created from the working question bank on a new installation',
      adaptation: 'None', approval: 'Approved'
    }],
    note: 'Baseline created from the question bank', createdBy: null
  }).onConflictDoNothing().returning();
  if (!draft) return;

  await syncStructuredDraft(db, draft);
  await db.update(schema.frameworkQuestions).set({ status: 'Published' })
    .where(eq(schema.frameworkQuestions.frameworkVersionId, draft.id));
  await db.update(schema.frameworkVersions).set({
    status: 'Published', approvedAt: now, publishedAt: now
  }).where(eq(schema.frameworkVersions.id, draft.id));
}

/**
 * SME360's 25-question free preliminary assessment bank, approved verbatim by Amin (see the
 * "MASTER DEVELOPMENT PROMPT: BUSINESS DOCTOR FREE 25-QUESTION ASSESSMENT" spec). Equal weight (1)
 * per question throughout: the free assessment's scorer (scoreFreeAssessment in domain/logic.ts) is
 * a plain percentage-of-maximum model with no weighting and no evidence discount, matching the
 * spec's own worked example exactly. AgriFood360 and ESO360 are deliberately not seeded here -- their
 * dimension-appropriate question banks still need to be drafted and approved before those platforms
 * can be offered; serving them the SME360 questions under a different name was explicitly rejected.
 */
const SME360_QUESTIONS: FrameworkQuestion[] = [
  { code: 'SME_Q01', dimension: 'Strategy and Leadership', text: 'Does your business have clearly defined goals?', weight: 1 },
  { code: 'SME_Q02', dimension: 'Strategy and Leadership', text: 'Do you have a documented business plan or action plan?', weight: 1 },
  { code: 'SME_Q03', dimension: 'Strategy and Leadership', text: 'How do you make important business decisions?', weight: 1 },
  { code: 'SME_Q04', dimension: 'Strategy and Leadership', text: 'How regularly do you review your business performance?', weight: 1 },
  { code: 'SME_Q05', dimension: 'Financial Health', text: 'How consistently do you record business income and expenses?', weight: 1 },
  { code: 'SME_Q06', dimension: 'Financial Health', text: 'Do you regularly separate personal money from business money?', weight: 1 },
  { code: 'SME_Q07', dimension: 'Financial Health', text: "How well do you understand your business's profitability?", weight: 1 },
  { code: 'SME_Q08', dimension: 'Financial Health', text: 'How do you manage your business cash flow?', weight: 1 },
  { code: 'SME_Q09', dimension: 'Financial Health', text: 'How do you plan for major business expenses and financial obligations?', weight: 1 },
  { code: 'SME_Q10', dimension: 'Marketing and Sales', text: 'How well do you understand your target customers?', weight: 1 },
  { code: 'SME_Q11', dimension: 'Marketing and Sales', text: 'How do you attract new customers?', weight: 1 },
  { code: 'SME_Q12', dimension: 'Marketing and Sales', text: 'How consistently do you track sales performance?', weight: 1 },
  { code: 'SME_Q13', dimension: 'Marketing and Sales', text: 'How do you respond to customer feedback and complaints?', weight: 1 },
  { code: 'SME_Q14', dimension: 'Operations and Productivity', text: 'How clearly are your daily business activities organised?', weight: 1 },
  { code: 'SME_Q15', dimension: 'Operations and Productivity', text: 'How do you manage stock, materials or business resources?', weight: 1 },
  { code: 'SME_Q16', dimension: 'Operations and Productivity', text: 'How consistently do you maintain the quality of your products or services?', weight: 1 },
  { code: 'SME_Q17', dimension: 'Operations and Productivity', text: 'How effectively does your business use technology or digital tools?', weight: 1 },
  { code: 'SME_Q18', dimension: 'Human Resources and Organisation', text: 'Are responsibilities clearly defined for the people working in your business?', weight: 1 },
  { code: 'SME_Q19', dimension: 'Human Resources and Organisation', text: 'How do you monitor employee or team performance?', weight: 1 },
  { code: 'SME_Q20', dimension: 'Human Resources and Organisation', text: 'How do you identify and address skills gaps in your business?', weight: 1 },
  { code: 'SME_Q21', dimension: 'Human Resources and Organisation', text: 'How well can your business operate when you, the owner, are unavailable?', weight: 1 },
  { code: 'SME_Q22', dimension: 'Risk, Resilience and Growth', text: 'How do you identify and manage business risks?', weight: 1 },
  { code: 'SME_Q23', dimension: 'Risk, Resilience and Growth', text: 'What happens when your business experiences an unexpected disruption?', weight: 1 },
  { code: 'SME_Q24', dimension: 'Risk, Resilience and Growth', text: 'How prepared is your business to grow?', weight: 1 },
  { code: 'SME_Q25', dimension: 'Risk, Resilience and Growth', text: 'How do you measure progress towards your business goals?', weight: 1 }
];
const SME360_DIMENSIONS = ['Strategy and Leadership', 'Financial Health', 'Marketing and Sales', 'Operations and Productivity', 'Human Resources and Organisation', 'Risk, Resilience and Growth'];
/** Answer options, A-D, the same four per question throughout the bank -- kept here for the frontend/API to render, not used in scoring. */
export const SME360_ANSWER_OPTIONS: Record<string, { A: string; B: string; C: string; D: string }> = {
  SME_Q01: { A: 'Yes, with measurable targets.', B: 'Yes, but the goals are not measurable.', C: 'We have general ideas about what we want to achieve.', D: 'We have no clearly defined business goals.' },
  SME_Q02: { A: 'Yes, and we review it regularly.', B: 'Yes, but we rarely review it.', C: 'We have an informal plan.', D: 'We do not have a business plan or action plan.' },
  SME_Q03: { A: 'Using business records, market information and analysis.', B: 'Using some information alongside experience.', C: 'Mainly using experience and intuition.', D: 'Without a consistent decision-making process.' },
  SME_Q04: { A: 'Monthly or more frequently, using records and targets.', B: 'Every few months.', C: 'Occasionally, when problems arise.', D: 'We do not regularly review performance.' },
  SME_Q05: { A: 'Consistently, with organised records.', B: 'Most of the time, but some transactions are missed.', C: 'Occasionally, without a consistent system.', D: 'We do not maintain proper records.' },
  SME_Q06: { A: 'Yes, completely.', B: 'Mostly, with occasional mixing.', C: 'We separate them sometimes.', D: 'We regularly mix personal and business money.' },
  SME_Q07: { A: 'We regularly calculate revenue, costs and profit.', B: 'We estimate profit using some records.', C: 'We mainly judge profit by the money remaining.', D: 'We do not know whether the business is profitable.' },
  SME_Q08: { A: 'We forecast cash inflows and outflows and plan ahead.', B: 'We monitor cash regularly but rarely forecast it.', C: 'We check cash when payments are due.', D: 'We frequently struggle to understand or manage our cash position.' },
  SME_Q09: { A: 'We budget and plan for them in advance.', B: 'We plan for some major expenses.', C: 'We usually respond when expenses arise.', D: 'We have no consistent financial planning process.' },
  SME_Q10: { A: 'We have clearly identified customer groups and understand their needs.', B: 'We understand our main customers but have limited information.', C: 'We mainly rely on our existing customer relationships.', D: 'We have not clearly identified our target customers.' },
  SME_Q11: { A: 'Through a consistent marketing and customer acquisition strategy.', B: 'Through several methods, but without a consistent plan.', C: 'Mainly through referrals and occasional promotion.', D: 'We do not have a clear way of attracting new customers.' },
  SME_Q12: { A: 'We record and review sales regularly against targets.', B: 'We record most sales but rarely analyse performance.', C: 'We estimate sales from memory or incomplete records.', D: 'We do not systematically track sales.' },
  SME_Q13: { A: 'We collect feedback, record complaints and act on the findings.', B: 'We respond to most complaints but do not track patterns.', C: 'We respond only when a problem becomes serious.', D: 'We have no consistent process for handling feedback.' },
  SME_Q14: { A: 'We have documented processes and clear responsibilities.', B: 'Most activities are organised, but some processes are undocumented.', C: 'Activities depend largely on individual experience.', D: 'We frequently experience confusion about what needs to be done.' },
  SME_Q15: { A: 'We maintain accurate records and review stock regularly.', B: 'We keep records but sometimes experience discrepancies.', C: 'We estimate available stock or resources.', D: 'We do not have a consistent tracking system.' },
  SME_Q16: { A: 'We use clear quality standards and check performance regularly.', B: 'We check quality but do not document the process consistently.', C: 'We mainly rely on customer complaints to identify problems.', D: 'We do not have a consistent quality-control process.' },
  SME_Q17: { A: 'We use suitable tools to improve operations and decision-making.', B: 'We use some digital tools, but important processes remain manual.', C: 'We use technology mainly for basic communication.', D: 'We rarely use technology to support business operations.' },
  SME_Q18: { A: 'Yes, responsibilities and reporting arrangements are clear.', B: 'Most responsibilities are clear, but some overlap.', C: 'Responsibilities are mainly communicated informally.', D: 'Responsibilities are unclear or frequently disputed.' },
  SME_Q19: { A: 'We use clear expectations and regular performance reviews.', B: 'We monitor performance informally and provide feedback.', C: 'We intervene mainly when problems occur.', D: 'We do not have a consistent way of monitoring performance.' },
  SME_Q20: { A: 'We regularly identify skills gaps and organise appropriate learning.', B: 'We address skills gaps when we notice them.', C: 'We provide training occasionally.', D: 'We do not have a clear approach to skills development.' },
  SME_Q21: { A: 'The team can handle most operations using established processes.', B: 'Some activities continue, but important decisions depend on me.', C: 'Most activities slow down when I am unavailable.', D: 'The business largely stops operating without me.' },
  SME_Q22: { A: 'We regularly identify risks and implement mitigation measures.', B: 'We recognise major risks but manage them informally.', C: 'We usually address risks after problems occur.', D: 'We do not systematically identify business risks.' },
  SME_Q23: { A: 'We have a documented continuity or recovery plan.', B: 'We have informal arrangements for major disruptions.', C: 'We try to resolve disruptions as they occur.', D: 'We have no clear approach to business disruptions.' },
  SME_Q24: { A: 'We have a realistic growth plan supported by resources and targets.', B: 'We have identified growth opportunities but need stronger planning.', C: 'We want to grow but have not identified clear steps.', D: 'We have not assessed our readiness for growth.' },
  SME_Q25: { A: 'We track clear performance indicators and review them regularly.', B: 'We monitor some indicators but not consistently.', C: 'We mainly judge progress by general business activity.', D: 'We do not have a consistent way to measure progress.' }
};

/**
 * Creates (if missing) and publishes the SME360 free-assessment framework. Idempotent; safe to call on
 * every boot/seed, matching ensureBaseline's pattern.
 *
 * Deliberately uses the code 'SME360_FREE', not 'SME360': the code 'SME360' is already taken by the
 * pre-existing, isDefault:true, 100-question paid/registration SME360 framework. Reusing that code here
 * would make this function find that framework (it already has a Published version) and silently no-op,
 * leaving the free assessment with no question bank of its own -- resolveVersion() would then fall
 * through to the isDefault:true framework and serve the paid 100-question bank as the "free assessment",
 * which is exactly the question-bank conflation the governing spec prohibits. Caught and fixed before
 * this ever reached a real user: discovered by checking production data directly, not by inspection
 * alone. orgType 'SME' + isDefault:false is what makes resolveVersion(db, 'SME') select this framework
 * over the paid one (its first branch filters on exactly that combination).
 */
export async function ensureSme360FreeAssessmentFramework(db: Db) {
  let [f] = await db.select().from(schema.frameworks).where(eq(schema.frameworks.code, 'SME360_FREE')).limit(1);
  if (!f) {
    [f] = await db.insert(schema.frameworks).values({
      code: 'SME360_FREE', name: 'SME360 Free Business Health Assessment', orgType: 'SME', isDefault: false, purpose: 'free_preliminary',
      description: 'Free, 25-question preliminary Business Health assessment for micro and small businesses, SMEs, startups, traders, manufacturers and service providers.'
    }).onConflictDoNothing().returning();
    if (!f) [f] = await db.select().from(schema.frameworks).where(eq(schema.frameworks.code, 'SME360_FREE')).limit(1);
  }
  const [have] = await db.select({ id: schema.frameworkVersions.id }).from(schema.frameworkVersions)
    .where(and(eq(schema.frameworkVersions.frameworkId, f.id), eq(schema.frameworkVersions.status, 'Published'))).limit(1);
  if (have) return;

  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${schema.frameworkVersions.version}), 0)::int` })
    .from(schema.frameworkVersions).where(eq(schema.frameworkVersions.frameworkId, f.id));
  const now = new Date();
  const [draft] = await db.insert(schema.frameworkVersions).values({
    frameworkId: f.id, version: Number(n) + 1, status: 'Draft', questions: SME360_QUESTIONS, dimensions: SME360_DIMENSIONS,
    sources: [{
      component: 'Question bank, weights and scoring model', source: 'Approved "MASTER DEVELOPMENT PROMPT: BUSINESS DOCTOR FREE 25-QUESTION ASSESSMENT" specification',
      rationale: 'Authored and approved by Samakose leadership for the free preliminary assessment', adaptation: 'None, used verbatim', approval: 'Approved'
    }],
    note: 'SME360 free preliminary assessment, 25 questions across 6 dimensions', createdBy: null
  }).onConflictDoNothing().returning();
  if (!draft) return;

  await syncStructuredDraft(db, draft);
  await db.update(schema.frameworkQuestions).set({ status: 'Published' }).where(eq(schema.frameworkQuestions.frameworkVersionId, draft.id));
  await db.update(schema.frameworkVersions).set({ status: 'Published', approvedAt: now, publishedAt: now }).where(eq(schema.frameworkVersions.id, draft.id));
}

/* ------------------------- AgriFood360 free preliminary assessment (#125) ------------------------- */
/**
 * 25 questions across 6 dimensions, agricultural/agribusiness context, same A-D / 4-3-2-1 scoring model
 * as SME360. Drafted to fill #125 ("Build AgriFood360 question bank"); the dimensions follow the issue's
 * own brief (climate/seasonal exposure, input access, storage/cold chain, market access, value-chain
 * position), plus a sixth dimension carrying the business/financial-management content that the other
 * five intentionally leave out, so the assessment still reads as a *business health* check, not an
 * agronomy quiz. This is content, not engineering, and Samakose leadership has not reviewed it -- see
 * ensureAgriFood360FreeAssessmentFramework's own comment for why it is seeded as Draft, never published.
 */
const AGRIFOOD360_QUESTIONS: FrameworkQuestion[] = [
  { code: 'AGR_Q01', dimension: 'Production and Agronomic Practices', text: 'Do you keep records of planting dates, inputs used and yields each season?', weight: 1 },
  { code: 'AGR_Q02', dimension: 'Production and Agronomic Practices', text: 'How do you decide which crop varieties, breeds or farming methods to use?', weight: 1 },
  { code: 'AGR_Q03', dimension: 'Production and Agronomic Practices', text: 'How do you manage soil fertility, pest and disease control on your farm or in your operation?', weight: 1 },
  { code: 'AGR_Q04', dimension: 'Production and Agronomic Practices', text: 'How do you monitor and improve productivity (yield per acre, output per animal, or production efficiency) over time?', weight: 1 },
  { code: 'AGR_Q05', dimension: 'Climate and Seasonal Resilience', text: 'How exposed is your production to seasonal and climate-related disruption, such as erratic rainfall, drought or flooding?', weight: 1 },
  { code: 'AGR_Q06', dimension: 'Climate and Seasonal Resilience', text: 'Do you have access to reliable water for irrigation or livestock, independent of rainfall?', weight: 1 },
  { code: 'AGR_Q07', dimension: 'Climate and Seasonal Resilience', text: 'How do you plan your production calendar around seasonal risk, such as planting and harvest timing or off-season activities?', weight: 1 },
  { code: 'AGR_Q08', dimension: 'Climate and Seasonal Resilience', text: 'What would happen to your business if this season’s harvest or production failed significantly?', weight: 1 },
  { code: 'AGR_Q09', dimension: 'Input Access and Supply Reliability', text: 'How reliably can you access the seeds, feed, fertiliser or other inputs you need, when you need them?', weight: 1 },
  { code: 'AGR_Q10', dimension: 'Input Access and Supply Reliability', text: 'How do you finance the purchase of inputs each season?', weight: 1 },
  { code: 'AGR_Q11', dimension: 'Input Access and Supply Reliability', text: 'How confident are you in the quality of the inputs, such as seeds, feed or agrochemicals, that you currently use?', weight: 1 },
  { code: 'AGR_Q12', dimension: 'Input Access and Supply Reliability', text: 'Do you have more than one reliable source for your most critical input?', weight: 1 },
  { code: 'AGR_Q13', dimension: 'Storage, Post-Harvest Handling and Cold Chain', text: 'What share of your harvest or production is typically lost between production and sale, due to spoilage, pests or poor handling?', weight: 1 },
  { code: 'AGR_Q14', dimension: 'Storage, Post-Harvest Handling and Cold Chain', text: 'What storage facilities do you use for your product between production and sale?', weight: 1 },
  { code: 'AGR_Q15', dimension: 'Storage, Post-Harvest Handling and Cold Chain', text: 'If your product needs a cold chain to maintain quality, how reliable is it?', weight: 1 },
  { code: 'AGR_Q16', dimension: 'Storage, Post-Harvest Handling and Cold Chain', text: 'How do you handle grading, cleaning, packaging or basic processing before sale?', weight: 1 },
  { code: 'AGR_Q17', dimension: 'Market Access and Value Chain Position', text: 'How do you currently sell your produce or products?', weight: 1 },
  { code: 'AGR_Q18', dimension: 'Market Access and Value Chain Position', text: 'How well do you understand current prices and demand for your product before you sell?', weight: 1 },
  { code: 'AGR_Q19', dimension: 'Market Access and Value Chain Position', text: 'Where does your business sit in the value chain: raw production only, or also grading, processing, branding or direct sale?', weight: 1 },
  { code: 'AGR_Q20', dimension: 'Market Access and Value Chain Position', text: 'How dependent is your business on a single buyer or a single market?', weight: 1 },
  { code: 'AGR_Q21', dimension: 'Market Access and Value Chain Position', text: 'Are you part of, or do you have access to, a cooperative, farmer group, aggregator or association that strengthens your market position?', weight: 1 },
  { code: 'AGR_Q22', dimension: 'Business and Financial Management', text: 'How do you record and track the income and costs of your agricultural business?', weight: 1 },
  { code: 'AGR_Q23', dimension: 'Business and Financial Management', text: 'Do you know your actual cost of production per unit, such as per bag, per acre, per animal or per batch?', weight: 1 },
  { code: 'AGR_Q24', dimension: 'Business and Financial Management', text: 'How do you manage risks such as crop or livestock loss, price swings or input cost increases?', weight: 1 },
  { code: 'AGR_Q25', dimension: 'Business and Financial Management', text: 'How ready is this agribusiness to grow, whether by expanding production, adding buyers, accessing larger finance or moving into new markets?', weight: 1 }
];
const AGRIFOOD360_DIMENSIONS = ['Production and Agronomic Practices', 'Climate and Seasonal Resilience', 'Input Access and Supply Reliability', 'Storage, Post-Harvest Handling and Cold Chain', 'Market Access and Value Chain Position', 'Business and Financial Management'];
/** Answer options, A-D, the same four per question throughout the bank -- kept here for the frontend/API to render, not used in scoring. */
export const AGRIFOOD360_ANSWER_OPTIONS: Record<string, { A: string; B: string; C: string; D: string }> = {
  AGR_Q01: { A: 'Yes, detailed records for every season, used to plan input needs.', B: 'Yes, basic records, but not consistently reviewed.', C: 'We keep informal notes or rely on memory.', D: 'We do not keep any production records.' },
  AGR_Q02: { A: 'Based on documented performance data, soil or agro-ecological testing and extension advice.', B: 'Based on some testing or advice, combined with past experience.', C: 'Mainly based on what neighbours or family have always used.', D: 'Without a consistent method; decisions change year to year.' },
  AGR_Q03: { A: 'We follow a planned programme, such as soil testing, integrated pest management or certified inputs.', B: 'We apply inputs regularly but without a documented plan.', C: 'We react only when problems appear.', D: 'We have no regular soil, pest or disease management practice.' },
  AGR_Q04: { A: 'We track productivity each season and use it to adjust practices.', B: 'We have a general sense of whether productivity is improving.', C: 'We rarely compare productivity across seasons.', D: 'We do not track productivity at all.' },
  AGR_Q05: { A: 'We have specific measures, such as irrigation, drought-tolerant varieties or a diversified calendar, that substantially reduce this exposure.', B: 'We have some measures in place, but they only partly reduce exposure.', C: 'We are aware of the exposure but have taken little action.', D: 'Our production depends almost entirely on favourable weather, with no mitigation.' },
  AGR_Q06: { A: 'Yes, a reliable year-round water source and irrigation system.', B: 'Yes, but access is inconsistent or seasonal.', C: 'Limited access, mostly dependent on rain.', D: 'No reliable water access beyond rainfall.' },
  AGR_Q07: { A: 'We actively plan and adjust the calendar each season based on forecasts and past experience.', B: 'We follow a general seasonal pattern with occasional adjustments.', C: 'We follow the same calendar every year regardless of conditions.', D: 'We have no deliberate seasonal planning.' },
  AGR_Q08: { A: 'We have savings, insurance or alternative income that would absorb the loss.', B: 'We would be under pressure but could recover within a season or two.', C: 'It would set the business back significantly, with no clear recovery plan.', D: 'It would likely end the business or force us to stop operating.' },
  AGR_Q09: { A: 'Reliable access through established, trusted suppliers, planned in advance.', B: 'Generally accessible but with occasional delays or shortages.', C: 'Frequently difficult to access on time.', D: 'Access is a persistent problem that regularly disrupts production.' },
  AGR_Q10: { A: 'Through planned working capital, savings or affordable credit secured in advance.', B: 'A mix of own funds and informal borrowing, arranged as the season approaches.', C: 'Mostly informal, high-cost borrowing or delayed purchases.', D: 'We often cannot afford the inputs we need.' },
  AGR_Q11: { A: 'High confidence; inputs are from certified or verified sources.', B: 'Reasonably confident, though sources are not always verified.', C: 'Uncertain; we use whatever is available or affordable.', D: 'We have had repeated problems with poor-quality inputs.' },
  AGR_Q12: { A: 'Yes, at least two reliable alternative suppliers.', B: 'One main supplier, with an occasional backup.', C: 'Only one supplier, with no real alternative.', D: 'We do not have a consistent supplier at all.' },
  AGR_Q13: { A: 'Very low losses, under about 5 percent, with measures in place to keep it that way.', B: 'Moderate losses, roughly 5 to 15 percent.', C: 'Significant losses, roughly 15 to 30 percent.', D: 'High losses, over about 30 percent, with no real control over it.' },
  AGR_Q14: { A: 'Proper, purpose-built storage, such as warehousing, cold storage or controlled-atmosphere storage, appropriate to the product.', B: 'Basic but adequate storage, with some protection from pests and moisture.', C: 'Informal or improvised storage with limited protection.', D: 'No dedicated storage; products are kept however is available.' },
  AGR_Q15: { A: 'Reliable, consistent cold chain from production through to sale (or the product does not require one).', B: 'Partially reliable, with occasional breaks or gaps.', C: 'Frequently breaks down or is unavailable when needed.', D: 'No cold chain exists, even though the product needs one.' },
  AGR_Q16: { A: 'We consistently grade, clean and package to meet buyer or market standards.', B: 'We do this sometimes, depending on the buyer or market.', C: 'We do minimal grading or packaging, mostly selling as harvested.', D: 'We do not grade, clean or package our product at all.' },
  AGR_Q17: { A: 'Through stable off-take agreements, contracts or established buyers at agreed prices.', B: 'Mainly to known traders or markets, without formal agreements.', C: 'Mostly at the farm gate, to whoever is available, at prevailing prices.', D: 'We regularly struggle to find a buyer at all.' },
  AGR_Q18: { A: 'We actively track prices and demand across more than one market or buyer.', B: 'We have a general sense of prices from one main source.', C: 'We mostly rely on what the first buyer offers.', D: 'We have little or no information on prices before selling.' },
  AGR_Q19: { A: 'We add meaningful value, such as processing, grading, branding or direct sale to end buyers, beyond raw production.', B: 'We do some basic value addition some of the time.', C: 'We sell raw, unprocessed product almost exclusively.', D: 'We have no involvement beyond production and no plan to add value.' },
  AGR_Q20: { A: 'We sell to several buyers or markets, so losing one would not seriously harm the business.', B: 'We have more than one buyer, but one accounts for most of our sales.', C: 'We depend almost entirely on a single buyer or market.', D: 'We have one buyer and no realistic alternative if that relationship ended.' },
  AGR_Q21: { A: 'Yes, active membership that provides real benefits, such as bulk input or sale prices, market information or training.', B: 'Yes, membership exists, but we make limited use of it.', C: 'We know of such groups but are not part of one.', D: 'No such group is accessible to us.' },
  AGR_Q22: { A: 'Consistent, season-by-season financial records covering all major costs and income.', B: 'Basic records that cover some, but not all, costs and income.', C: 'Informal tracking, mostly from memory.', D: 'We keep no financial records at all.' },
  AGR_Q23: { A: 'Yes, calculated and used to set prices or decide what to produce.', B: 'We have a rough estimate, but it is not regularly updated.', C: 'We do not calculate this; we judge profitability by feel.', D: 'We have no idea what our production actually costs.' },
  AGR_Q24: { A: 'Through specific measures, such as insurance, diversification, contracts or reserves, matched to our main risks.', B: 'We are aware of the main risks but only manage some of them.', C: 'We deal with problems only as they happen, without a plan.', D: 'We have no way of managing these risks and absorb whatever happens.' },
  AGR_Q25: { A: 'We have a clear growth plan and the records, systems or finance needed to pursue it.', B: 'We want to grow and have some of what is needed, but gaps remain.', C: 'We would like to grow but do not have a plan or the basics in place.', D: 'Growth is not something we have been able to consider; we are focused on surviving each season.' }
};

/**
 * Creates (if missing) a Draft AgriFood360 free-assessment version and leaves it there -- unlike
 * ensureSme360FreeAssessmentFramework, this never auto-publishes.
 *
 * The SME360 free-assessment content came from an already-approved specification ("MASTER DEVELOPMENT
 * PROMPT"), so publishing it on every boot was safe. This AgriFood360 content has no such approval: it
 * was drafted by Claude per #125's brief, not reviewed by Samakose leadership or anyone with agribusiness
 * domain authority. Marking its one source 'Proposed' (not 'Approved') is deliberate, not an oversight --
 * validateContent's own publish gate ("will not publish a specialised framework until every source is
 * approved", exercised by the existing frameworks.test.ts case) means an admin publish attempt is refused
 * with a 422 until Amin reviews the question/option text and approves the source through the normal
 * /settings/frameworks UI (PATCH the version's sources to 'Approved', then POST .../publish). Code
 * '<AGRIFOOD360_FREE' is used rather than reusing the pre-seeded paid 'AGRIFOOD360' framework for the same
 * reason SME360_FREE exists: see that function's own comment.
 */
export async function ensureAgriFood360FreeAssessmentFramework(db: Db) {
  let [f] = await db.select().from(schema.frameworks).where(eq(schema.frameworks.code, 'AGRIFOOD360_FREE')).limit(1);
  if (!f) {
    [f] = await db.insert(schema.frameworks).values({
      code: 'AGRIFOOD360_FREE', name: 'AgriFood360 Free Business Health Assessment', orgType: 'AGRIFOOD', isDefault: false, purpose: 'free_preliminary',
      description: 'Free, 25-question preliminary Business Health assessment for farms, agribusinesses, cooperatives and agricultural traders, processors and input/output market actors.'
    }).onConflictDoNothing().returning();
    if (!f) [f] = await db.select().from(schema.frameworks).where(eq(schema.frameworks.code, 'AGRIFOOD360_FREE')).limit(1);
  }
  const [haveAny] = await db.select({ id: schema.frameworkVersions.id }).from(schema.frameworkVersions)
    .where(eq(schema.frameworkVersions.frameworkId, f.id)).limit(1);
  if (haveAny) return; // A draft (or published) version already exists; never overwrite content an admin may be editing.

  await db.insert(schema.frameworkVersions).values({
    frameworkId: f.id, version: 1, status: 'Draft', questions: AGRIFOOD360_QUESTIONS, dimensions: AGRIFOOD360_DIMENSIONS,
    sources: [{
      component: 'Question bank, weights and scoring model', source: 'Drafted by Claude per issue #125’s brief (climate/seasonal exposure, input access, storage/cold chain, market access, value-chain position)',
      rationale: 'No AgriFood360 question bank existed yet; drafted to the same 25-question, 4/3/2/1-scored, A-D format as SME360 so it is ready for domain review rather than left as "Coming soon"',
      adaptation: 'Not adapted from an external source; written for this assessment', approval: 'Proposed'
    }],
    note: 'AgriFood360 free preliminary assessment, 25 questions across 6 dimensions -- Draft, pending Amin’s content review and approval (#125)', createdBy: null
  }).onConflictDoNothing();
}

/* ------------------------------ ESO360 free preliminary assessment (#126) ------------------------------ */
/**
 * 25 questions across 6 dimensions for enterprise support organisations (ESOs): accelerators, incubators,
 * mentorship and business-development programmes. Drafted to fill #126, mirroring #125's AgriFood360
 * approach: the dimensions assess the ESO's own organisational and programme health (not the enterprises
 * it supports), following the shape of established accelerator/incubator benchmarking practice (ANDE's
 * and GALI's own frameworks look at programme design, selection, delivery capacity, M&E and
 * sustainability in broadly this way). Same A-D / 4-3-2-1 scoring model as SME360 and AgriFood360.
 */
const ESO360_QUESTIONS: FrameworkQuestion[] = [
  { code: 'ESO_Q01', dimension: 'Programme Design and Curriculum', text: 'How is the content and structure of your programme (curriculum, milestones, support services) decided?', weight: 1 },
  { code: 'ESO_Q02', dimension: 'Programme Design and Curriculum', text: 'How well does your programme design match the stage and needs of the enterprises you support, such as pre-seed, early growth or scale-up?', weight: 1 },
  { code: 'ESO_Q03', dimension: 'Programme Design and Curriculum', text: 'How do you keep programme content and delivery methods current, based on market trends, new tools or participant feedback?', weight: 1 },
  { code: 'ESO_Q04', dimension: 'Programme Design and Curriculum', text: 'How clearly are the expected outcomes of your programme, for participants and for your organisation, defined and communicated?', weight: 1 },
  { code: 'ESO_Q05', dimension: 'Cohort Recruitment and Selection', text: 'How do you attract applicants for each cohort or intake?', weight: 1 },
  { code: 'ESO_Q06', dimension: 'Cohort Recruitment and Selection', text: 'How do you select participants or enterprises to support?', weight: 1 },
  { code: 'ESO_Q07', dimension: 'Cohort Recruitment and Selection', text: 'How well do you track and understand the diversity, such as gender, geography, sector or business stage, of your applicant pool and selected cohorts?', weight: 1 },
  { code: 'ESO_Q08', dimension: 'Cohort Recruitment and Selection', text: 'How confident are you that the enterprises you select are a good fit for what your programme can actually deliver?', weight: 1 },
  { code: 'ESO_Q09', dimension: 'Mentorship, Advisory and Delivery Capacity', text: 'How do you recruit, vet and match mentors, coaches or advisors to participants?', weight: 1 },
  { code: 'ESO_Q10', dimension: 'Mentorship, Advisory and Delivery Capacity', text: 'How do you monitor and support the quality of mentorship or advisory sessions actually delivered?', weight: 1 },
  { code: 'ESO_Q11', dimension: 'Mentorship, Advisory and Delivery Capacity', text: 'Do you have enough qualified staff, facilitators, mentors or advisors to deliver your current programme commitments?', weight: 1 },
  { code: 'ESO_Q12', dimension: 'Mentorship, Advisory and Delivery Capacity', text: 'How do you build the skills and performance of your own facilitators, mentors and programme staff over time?', weight: 1 },
  { code: 'ESO_Q13', dimension: 'Monitoring, Evaluation and Impact Tracking', text: 'What data do you collect on participants during and after the programme, such as revenue, jobs, investment raised or survival?', weight: 1 },
  { code: 'ESO_Q14', dimension: 'Monitoring, Evaluation and Impact Tracking', text: 'How do you know whether your programme is actually achieving its intended outcomes?', weight: 1 },
  { code: 'ESO_Q15', dimension: 'Monitoring, Evaluation and Impact Tracking', text: 'How do you use monitoring and evaluation findings to improve the programme?', weight: 1 },
  { code: 'ESO_Q16', dimension: 'Monitoring, Evaluation and Impact Tracking', text: 'How do you maintain contact with and track alumni after they exit the programme?', weight: 1 },
  { code: 'ESO_Q17', dimension: 'Funding, Sustainability and Partnerships', text: 'How diversified are your organisation’s funding sources, such as donors, fees, corporate partners, government or earned revenue?', weight: 1 },
  { code: 'ESO_Q18', dimension: 'Funding, Sustainability and Partnerships', text: 'How far in advance is your funding or revenue secured relative to your programme delivery commitments?', weight: 1 },
  { code: 'ESO_Q19', dimension: 'Funding, Sustainability and Partnerships', text: 'Do you have a plan or model for how your organisation sustains itself, or becomes self-sustaining, beyond grant funding?', weight: 1 },
  { code: 'ESO_Q20', dimension: 'Funding, Sustainability and Partnerships', text: 'How do you build and manage relationships with partner organisations, such as investors, corporates, government or other ESOs?', weight: 1 },
  { code: 'ESO_Q21', dimension: 'Funding, Sustainability and Partnerships', text: 'How do you report your results and impact to funders, partners and the public?', weight: 1 },
  { code: 'ESO_Q22', dimension: 'Organisational Capacity and Governance', text: 'Does your organisation have a documented strategy or business plan guiding its own direction?', weight: 1 },
  { code: 'ESO_Q23', dimension: 'Organisational Capacity and Governance', text: 'How are governance and oversight of your organisation structured, such as a board, advisory committee or management team?', weight: 1 },
  { code: 'ESO_Q24', dimension: 'Organisational Capacity and Governance', text: 'How well can your organisation continue operating if a key staff member, such as the director, were unavailable?', weight: 1 },
  { code: 'ESO_Q25', dimension: 'Organisational Capacity and Governance', text: 'How do you identify and manage organisational risks, such as financial, reputational, compliance or staff-turnover risks?', weight: 1 }
];
const ESO360_DIMENSIONS = ['Programme Design and Curriculum', 'Cohort Recruitment and Selection', 'Mentorship, Advisory and Delivery Capacity', 'Monitoring, Evaluation and Impact Tracking', 'Funding, Sustainability and Partnerships', 'Organisational Capacity and Governance'];
/** Answer options, A-D, the same four per question throughout the bank -- kept here for the frontend/API to render, not used in scoring. */
export const ESO360_ANSWER_OPTIONS: Record<string, { A: string; B: string; C: string; D: string }> = {
  ESO_Q01: { A: 'Based on documented needs assessments, evidence of what works, and regular curriculum review.', B: 'Based on some needs assessment or benchmarking, updated occasionally.', C: 'Mainly based on what previous cohorts or staff experience suggest.', D: 'We do not have a defined curriculum or programme structure.' },
  ESO_Q02: { A: 'Programme tracks are tailored to specific stages or needs, with clear entry and exit criteria.', B: 'Some differentiation by stage, but most support is generic.', C: 'One-size-fits-all programme regardless of enterprise stage.', D: 'We have not assessed whether our programme matches participants’ needs.' },
  ESO_Q03: { A: 'We review and update content systematically each cycle, using feedback and external input.', B: 'We make occasional updates when something clearly needs fixing.', C: 'Content has stayed largely the same for several cycles.', D: 'We have no process for reviewing or updating programme content.' },
  ESO_Q04: { A: 'Clear, specific outcomes are defined, documented and shared with participants and stakeholders.', B: 'General outcomes are understood internally but not clearly documented or communicated.', C: 'Outcomes are vague or differ depending on who you ask.', D: 'We have not defined what success looks like for this programme.' },
  ESO_Q05: { A: 'Through a planned, multi-channel outreach strategy reaching beyond our existing network.', B: 'Mainly through our existing network and occasional targeted outreach.', C: 'Largely passive; we rely on word of mouth or inbound interest.', D: 'We struggle to attract enough applicants to fill a cohort.' },
  ESO_Q06: { A: 'Using documented, consistent selection criteria and a structured review process.', B: 'Using general criteria, but the process varies between cohorts or reviewers.', C: 'Mostly informal judgement calls with little documentation.', D: 'We accept most applicants with no real selection process.' },
  ESO_Q07: { A: 'We track this systematically and use it to guide outreach and selection.', B: 'We have some data on this but do not act on it consistently.', C: 'We have a general impression but no real data.', D: 'We do not track this at all.' },
  ESO_Q08: { A: 'High confidence, supported by clear fit criteria applied consistently.', B: 'Reasonably confident, though mismatches happen occasionally.', C: 'Mismatches between participant needs and programme offer are common.', D: 'We have no way of assessing fit before selection.' },
  ESO_Q09: { A: 'A documented process for recruitment, vetting and matching based on participant needs.', B: 'Some process exists, but matching is often ad hoc.', C: 'We use whichever mentors are available, with little matching.', D: 'We do not have a structured mentor or advisor network.' },
  ESO_Q10: { A: 'We track session delivery and quality, and act on participant or mentor feedback.', B: 'We get occasional feedback but do not systematically monitor quality.', C: 'We assume sessions happen but rarely verify quality or completion.', D: 'We have no visibility into whether mentorship sessions actually happen or help.' },
  ESO_Q11: { A: 'Yes, sufficient capacity with some ability to flex for growth.', B: 'Generally sufficient, but it is a regular stretch.', C: 'Frequently under-resourced, affecting delivery quality.', D: 'We consistently lack the people needed to deliver what we have promised.' },
  ESO_Q12: { A: 'Through a deliberate development plan, such as training, feedback or performance review, for programme delivery staff.', B: 'Occasional training or feedback, but no consistent plan.', C: 'Staff mostly develop skills informally, on the job.', D: 'We have no process for developing programme delivery capacity.' },
  ESO_Q13: { A: 'We systematically collect defined outcome metrics during the programme and track them afterward.', B: 'We collect some data during the programme, but tracking after it ends is limited.', C: 'We collect anecdotal success stories, not structured data.', D: 'We do not collect outcome data on participants.' },
  ESO_Q14: { A: 'We analyse outcome data against defined targets or a theory of change, regularly.', B: 'We review outcomes informally, without a clear benchmark.', C: 'We assume the programme works because participants complete it.', D: 'We have no way of knowing whether the programme achieves its outcomes.' },
  ESO_Q15: { A: 'Findings directly inform changes to curriculum, selection or delivery each cycle.', B: 'Findings are reviewed but changes happen only occasionally.', C: 'Findings are collected but rarely acted on.', D: 'We do not generate findings that could inform improvement.' },
  ESO_Q16: { A: 'Structured alumni engagement and tracking, with defined check-in points.', B: 'Some informal contact with alumni, but not systematic.', C: 'Contact with alumni mostly ends once the programme is over.', D: 'We lose touch with almost all participants after exit.' },
  ESO_Q17: { A: 'Multiple diversified sources, with no single source representing most of our funding.', B: 'A few sources, but one or two account for most of our funding.', C: 'Heavily dependent on a single donor or funding source.', D: 'We have no secured funding beyond the current cycle.' },
  ESO_Q18: { A: 'Funding is secured well beyond the current cycle, supporting multi-year planning.', B: 'Funding covers the current cycle, with some visibility beyond it.', C: 'Funding is usually secured only just in time for the current cycle.', D: 'We frequently deliver programmes without confirmed funding in place.' },
  ESO_Q19: { A: 'Yes, a documented plan with a credible path toward diversified or earned revenue.', B: 'We have ideas about sustainability but no documented plan.', C: 'We rely entirely on securing the next grant, with no sustainability plan.', D: 'We have not considered how the organisation sustains itself long term.' },
  ESO_Q20: { A: 'Deliberate partnership strategy with defined roles, managed relationships and mutual value.', B: 'Several partnerships exist, but they are managed informally.', C: 'Partnerships are occasional and largely reactive.', D: 'We have few or no active partnerships.' },
  ESO_Q21: { A: 'Clear, evidence-based reporting aligned to agreed indicators, on a regular schedule.', B: 'We report when required, using whatever data is readily available.', C: 'Reporting is inconsistent and often reconstructed after the fact.', D: 'We have no regular reporting process.' },
  ESO_Q22: { A: 'Yes, a current strategy with clear priorities, reviewed regularly.', B: 'Yes, but it is outdated or rarely referenced.', C: 'We have general direction but nothing documented.', D: 'We have no strategic plan for the organisation itself.' },
  ESO_Q23: { A: 'Active governance body with clear oversight, meeting regularly and holding management accountable.', B: 'A governance body exists but meets infrequently or has limited influence.', C: 'Governance exists mostly on paper.', D: 'We have no formal governance structure.' },
  ESO_Q24: { A: 'Documented systems, succession plans and shared knowledge mean the organisation would continue smoothly.', B: 'Some continuity exists, but key knowledge sits with one or two people.', C: 'Most critical functions would stall without that person.', D: 'The organisation would likely stop functioning without that person.' },
  ESO_Q25: { A: 'Through a documented risk management approach reviewed regularly.', B: 'We recognise major risks but manage them informally.', C: 'We deal with risks only as they arise.', D: 'We have no process for identifying or managing organisational risks.' }
};

/**
 * Creates (if missing) a Draft ESO360 free-assessment version and leaves it there, for the same reason
 * ensureAgriFood360FreeAssessmentFramework does (#125's comment): this content was drafted by Claude per
 * #126's brief, not reviewed by Samakose leadership or anyone with ESO/accelerator domain authority. Its
 * one source is marked 'Proposed', so validateContent's publish gate refuses it with a 422 until Amin
 * reviews the question/option text and approves the source through the normal /settings/frameworks UI.
 */
export async function ensureEso360FreeAssessmentFramework(db: Db) {
  let [f] = await db.select().from(schema.frameworks).where(eq(schema.frameworks.code, 'ESO360_FREE')).limit(1);
  if (!f) {
    [f] = await db.insert(schema.frameworks).values({
      code: 'ESO360_FREE', name: 'ESO360 Free Business Health Assessment', orgType: 'ESO', isDefault: false, purpose: 'free_preliminary',
      description: 'Free, 25-question preliminary Business Health assessment for enterprise support organisations: accelerators, incubators, mentorship programmes and business-development providers.'
    }).onConflictDoNothing().returning();
    if (!f) [f] = await db.select().from(schema.frameworks).where(eq(schema.frameworks.code, 'ESO360_FREE')).limit(1);
  }
  const [haveAny] = await db.select({ id: schema.frameworkVersions.id }).from(schema.frameworkVersions)
    .where(eq(schema.frameworkVersions.frameworkId, f.id)).limit(1);
  if (haveAny) return; // A draft (or published) version already exists; never overwrite content an admin may be editing.

  await db.insert(schema.frameworkVersions).values({
    frameworkId: f.id, version: 1, status: 'Draft', questions: ESO360_QUESTIONS, dimensions: ESO360_DIMENSIONS,
    sources: [{
      component: 'Question bank, weights and scoring model', source: 'Drafted by Claude per issue #126’s brief, following established accelerator/incubator benchmarking practice (programme design, selection, delivery capacity, M&E, sustainability)',
      rationale: 'No ESO360 question bank existed yet; drafted to the same 25-question, 4/3/2/1-scored, A-D format as SME360 and AgriFood360 so it is ready for domain review rather than left as "Coming soon"',
      adaptation: 'Not adapted from an external source; written for this assessment', approval: 'Proposed'
    }],
    note: 'ESO360 free preliminary assessment, 25 questions across 6 dimensions -- Draft, pending Amin’s content review and approval (#126)', createdBy: null
  }).onConflictDoNothing();
}

/**
 * Lands the Business Health Architecture v2 content bank (100 questions, 8 dimensions, full sub-dimension
 * and readiness metadata, 32-item evidence trail) as version 1 of the paid/full ESO360 framework (code
 * 'ESO360', orgType 'ESO', isDefault:false) -- the assessment ESOs actually register and pay for, distinct
 * from the free 25-question ESO360_FREE preliminary bank above.
 *
 * Deliberately mirrors the paid SME360 framework, whose own Business Health Architecture v2 bank (code
 * 'SME360', 100 questions SM-001..SM-100) is already Published in production -- discovered by checking
 * production data directly while building the free assessment (see ensureSme360FreeAssessmentFramework's
 * comment). ESO360's paid framework has no Published version yet, so unlike that one this function leaves
 * its content as a Draft: pending Amin Yahaya's own domain-expert review and sign-off before anyone
 * publishes it from the admin Settings screen, exactly as AgriFood360's and ESO360's free-assessment banks
 * were left as Drafts above until reviewed.
 *
 * Idempotent and content-insensitive by design: if ESO360 already has any version at all -- Draft or
 * Published, this seed's or an admin's own -- this is a no-op, so a reviewer's in-progress edits are never
 * silently overwritten by a re-run of the seed.
 */
export async function ensureEso360FullAssessmentDraft(db: Db) {
  const [f] = await db.select().from(schema.frameworks).where(eq(schema.frameworks.code, 'ESO360')).limit(1);
  if (!f) return; // Seeded by migration 0011; absent only on an incompletely migrated database.
  const [haveAny] = await db.select({ id: schema.frameworkVersions.id }).from(schema.frameworkVersions)
    .where(eq(schema.frameworkVersions.frameworkId, f.id)).limit(1);
  if (haveAny) return;

  const bank = eso360BankV1 as unknown as {
    questions: FrameworkQuestion[]; dimensions: string[]; rules: Record<string, string | number> | null;
    sources: FrameworkSource[]; meta: FrameworkMeta; note: string;
  };
  validateContent({ questions: bank.questions, dimensions: bank.dimensions, rules: bank.rules, meta: bank.meta });
  const [draft] = await db.insert(schema.frameworkVersions).values({
    frameworkId: f.id, version: 1, status: 'Draft', questions: bank.questions, dimensions: bank.dimensions,
    rules: bank.rules, meta: bank.meta, sources: bank.sources, note: bank.note, createdBy: null
  }).onConflictDoNothing().returning();
  if (!draft) return;
  await syncStructuredDraft(db, draft);
}
