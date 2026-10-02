/**
 * Business Health frameworks and their versions.
 * A framework version is a frozen copy of the questions, dimensions and rule overrides that a diagnostic was scored under.
 * Published versions never change (a database trigger enforces it), so history is explained by the version it points at.
 * Specialised frameworks (AgriFood360, ESO360) cannot be published until every source in their evidence trail is approved.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, notFound, unprocessable } from '@/lib/errors';
import { DEFAULT_RULES, type QuestionLite, type Rules } from '@/domain/logic';
import type { FrameworkMeta, FrameworkQuestion, FrameworkSource } from '@/db/schema';
import { parseCondition } from '@/domain/bank';
import { can } from '@/lib/rbac';
import { allow, need } from './common';

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
/** Global rules with the version's own overrides on top. The merged set is stored with every score. */
export const rulesFor = (v: Pick<VersionRow, 'rules'>, global: Rules): Rules => ({ ...global, ...(v.rules ?? {}) });

/** The version a new diagnostic for this kind of organisation is taken under. */
export async function resolveVersion(db: Db, orgType?: string | null): Promise<VersionRow> {
  if (orgType) {
    const [s] = await db.select({ v: schema.frameworkVersions }).from(schema.frameworkVersions)
      .innerJoin(schema.frameworks, eq(schema.frameworks.id, schema.frameworkVersions.frameworkId))
      .where(and(eq(schema.frameworks.orgType, orgType as 'SME'), eq(schema.frameworks.isDefault, false), eq(schema.frameworkVersions.status, 'Published')))
      .orderBy(desc(schema.frameworkVersions.version)).limit(1);
    if (s) return s.v;
  }
  const [d] = await db.select({ v: schema.frameworkVersions }).from(schema.frameworkVersions)
    .innerJoin(schema.frameworks, eq(schema.frameworks.id, schema.frameworkVersions.frameworkId))
    .where(and(eq(schema.frameworks.isDefault, true), eq(schema.frameworkVersions.status, 'Published')))
    .orderBy(desc(schema.frameworkVersions.version)).limit(1);
  if (!d) throw unprocessable('No published Business Health framework is available');
  return d.v;
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
export async function getVersion(ctx: Ctx, id: string) {
  allow(ctx, 'frameworks', 'read');
  const v = await versionById(ctx.db, id);
  if (!v) throw notFound('Framework version not found');
  const [f] = await ctx.db.select().from(schema.frameworks).where(eq(schema.frameworks.id, v.frameworkId));
  return { ...v, framework: { code: f.code, name: f.name, isDefault: f.isDefault } };
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
  await ctx.db.update(schema.frameworkVersions).set({ status: 'Published', approvedBy: u.id, approvedAt: now, publishedAt: now, note: note.trim() }).where(eq(schema.frameworkVersions.id, id));
  await audit(ctx, 'framework.published', 'framework_version', id, { status: 'Draft', previous: prev ? prev.version : null }, { status: 'Published', framework: f.code, version: v.version, approvedBy: u.email, note: note.trim() });
  return { id, version: v.version, framework: f.code };
}

/** Fresh installations have no versions yet. Builds and publishes the baseline from the working question bank. Used by the seed. */
export async function ensureBaseline(db: Db) {
  const [f] = await db.select().from(schema.frameworks).where(eq(schema.frameworks.isDefault, true)).limit(1);
  if (!f) return;
  const [have] = await db.select({ id: schema.frameworkVersions.id }).from(schema.frameworkVersions).where(and(eq(schema.frameworkVersions.frameworkId, f.id), eq(schema.frameworkVersions.status, 'Published'))).limit(1);
  if (have) return;
  const bank = await bankSnapshot(db);
  if (!bank.questions.length) return;
  const now = new Date();
  await db.insert(schema.frameworkVersions).values({
    frameworkId: f.id, version: 1, status: 'Published', questions: bank.questions, dimensions: bank.dimensions,
    sources: [{ component: 'Question bank and weights', source: 'Samakose working question bank', rationale: 'Baseline for a new installation', adaptation: 'None', approval: 'Approved' }],
    note: 'Baseline created from the question bank', approvedAt: now, publishedAt: now
  }).onConflictDoNothing();
}
