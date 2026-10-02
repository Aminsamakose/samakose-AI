/**
 * Business health certification: eligibility from evidence, a proposal by the lead expert, a decision by a different person,
 * expiry and revocation. Every step is audited. Nothing here changes a score.
 */
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { forbidden, unprocessable } from '@/lib/errors';
import { assertCase, isInternal, leadOnly } from '@/domain/scope';
import { effectiveStatus, evaluateCertification, validUntil, type CertFacts } from '@/domain/certification';
import { allow, loadRules, need } from './common';

async function facts(ctx: Ctx, caseId: string) {
  const [s] = await ctx.db.select().from(schema.healthScores).where(eq(schema.healthScores.caseId, caseId)).orderBy(desc(schema.healthScores.createdAt)).limit(1);
  const [fv] = s?.frameworkVersionId ? await ctx.db.select({ status: schema.frameworkVersions.status }).from(schema.frameworkVersions).where(eq(schema.frameworkVersions.id, s.frameworkVersionId)) : [];
  const [dgn] = await ctx.db.select({ id: schema.diagnoses.id }).from(schema.diagnoses).where(and(eq(schema.diagnoses.caseId, caseId), eq(schema.diagnoses.status, 'Reviewed'))).limit(1);
  const [rx] = await ctx.db.select({ id: schema.prescriptions.id }).from(schema.prescriptions).where(and(eq(schema.prescriptions.caseId, caseId), eq(schema.prescriptions.status, 'APPROVED'))).limit(1);
  const extras = (s?.extras ?? null) as { readiness?: CertFacts['readiness'] } | null;
  const f: CertFacts = {
    hasScore: !!s, overall: s ? Number(s.overall) : 0, confidence: (s?.confidenceClass ?? 'Low') as CertFacts['confidence'], frameworkPublished: fv?.status === 'Published',
    dimensions: (s?.dimensions ?? []) as CertFacts['dimensions'], evidenceShare: (s?.evidenceShare ?? {}) as Record<string, number>,
    readiness: extras?.readiness && extras.readiness.length ? extras.readiness : null, diagnosisReviewed: !!dgn, prescriptionApproved: !!rx
  };
  return { score: s ?? null, f };
}

export async function eligibility(ctx: Ctx, caseId: string) {
  const { score, f } = await facts(ctx, caseId);
  const rules = await loadRules(ctx.db);
  return { score, ...evaluateCertification(f, rules), validMonths: Number(rules['cert.valid_months']) };
}

const present = (c: typeof schema.certificates.$inferSelect) => ({ ...c, status: effectiveStatus(c.status, c.expiresAt) });

/** What the case page and the organisation see. Owners see only a certificate that was actually issued. */
export async function certification(ctx: Ctx, caseId: string) {
  allow(ctx, 'cases', 'read');
  const cs = await assertCase(ctx, caseId);
  const all = (await ctx.db.select().from(schema.certificates).where(eq(schema.certificates.caseId, caseId)).orderBy(desc(schema.certificates.proposedAt))).map(present);
  const internal = isInternal(need(ctx).user);
  const current = all.find((c) => c.status === 'Certified') ?? null;
  const pub = (c: (typeof all)[number]) => ({ id: c.id, level: c.level, status: c.status, overall: c.overall, decidedAt: c.decidedAt, expiresAt: c.expiresAt, unlocks: c.unlocks });
  if (!internal) return { current: current ? pub(current) : null, history: [], eligibility: null, canPropose: false, canDecide: false, canRevoke: false };
  const el = await eligibility(ctx, caseId);
  const u = need(ctx).user;
  const open = all.find((c) => c.status === 'Proposed');
  const involved = u.id === cs.consultantId || u.id === cs.coachId;
  return {
    current, history: all, eligibility: el,
    canPropose: ['ADMIN', 'EXPERT'].includes(u.role) && (u.role === 'ADMIN' || u.id === cs.consultantId) && !open,
    canRevoke: ['ADMIN', 'REVIEWER'].includes(u.role) && !involved,
    canDecide: !!open && ['ADMIN', 'REVIEWER'].includes(u.role) && u.id !== open.proposedBy && !involved
  };
}

export async function propose(ctx: Ctx, caseId: string, rationale: string) {
  allow(ctx, 'cases', 'edit');
  const u = need(ctx).user;
  const cs = await assertCase(ctx, caseId);
  leadOnly(u, cs);
  if (!['ADMIN', 'EXPERT'].includes(u.role)) throw forbidden('Only the lead expert or an administrator can propose a certificate');
  const el = await eligibility(ctx, caseId);
  if (!el.eligible || !el.level || !el.score) throw unprocessable(`This business is not eligible yet. ${el.criteria.filter((c) => !c.met).map((c) => c.label).concat(el.scoreNote ? [el.scoreNote] : []).join('. ')}`);
  const [open] = await ctx.db.select({ id: schema.certificates.id }).from(schema.certificates).where(and(eq(schema.certificates.caseId, caseId), eq(schema.certificates.status, 'Proposed'))).limit(1);
  if (open) throw unprocessable('A proposal for this case is already waiting for a decision');
  const [row] = await ctx.db.insert(schema.certificates).values({
    caseId, orgId: cs.orgId, scoreId: el.score.id, frameworkVersionId: el.score.frameworkVersionId, level: el.level, overall: String(el.score.overall),
    criteria: el.criteria as any, unlocks: el.unlocks as any, rationale, proposedBy: u.id
  }).returning();
  await audit(ctx, 'certificate.proposed', 'certificate', row.id, undefined, { level: el.level, overall: Number(el.score.overall), scoreId: el.score.id }, caseId);
  return present(row);
}

/** The decider is a different person from the proposer and is not the lead or coaching expert on the case. Eligibility is checked again at decision time. */
export async function decide(ctx: Ctx, certId: string, b: { decision: 'Certify' | 'Decline'; note: string }) {
  allow(ctx, 'cases', 'certify');
  const u = need(ctx).user;
  const [c] = await ctx.db.select().from(schema.certificates).where(eq(schema.certificates.id, certId)).limit(1);
  if (!c) throw (await import('@/lib/errors')).notFound('Certificate not found');
  const cs = await assertCase(ctx, c.caseId);
  if (c.status !== 'Proposed') throw unprocessable('This proposal has already been decided');
  if (u.id === c.proposedBy) throw forbidden('You proposed this certificate. A different person must decide it');
  if (u.id === cs.consultantId || u.id === cs.coachId) throw forbidden('You work on this case, so you cannot decide its certificate');
  if (b.decision === 'Decline') {
    await ctx.db.update(schema.certificates).set({ status: 'Declined', decidedBy: u.id, decidedAt: new Date(), decisionNote: b.note }).where(eq(schema.certificates.id, certId));
    await audit(ctx, 'certificate.declined', 'certificate', certId, { status: 'Proposed' }, { status: 'Declined', note: b.note }, c.caseId);
    return getOne(ctx, certId);
  }
  const el = await eligibility(ctx, c.caseId);
  if (!el.eligible || !el.level || !el.score) throw unprocessable('The evidence no longer meets the criteria, so it cannot be certified. Decline it or ask the expert to update the case');
  const now = new Date();
  await ctx.db.update(schema.certificates).set({
    status: 'Certified', decidedBy: u.id, decidedAt: now, decisionNote: b.note, expiresAt: validUntil(now, el.validMonths),
    level: el.level, scoreId: el.score.id, overall: String(el.score.overall), criteria: el.criteria as any, unlocks: el.unlocks as any
  }).where(eq(schema.certificates.id, certId));
  await audit(ctx, 'certificate.certified', 'certificate', certId, { status: 'Proposed', level: c.level }, { status: 'Certified', level: el.level, overall: Number(el.score.overall), validMonths: el.validMonths, note: b.note }, c.caseId);
  return getOne(ctx, certId);
}

export async function revoke(ctx: Ctx, certId: string, reason: string) {
  allow(ctx, 'cases', 'certify');
  const u = need(ctx).user;
  const [c] = await ctx.db.select().from(schema.certificates).where(eq(schema.certificates.id, certId)).limit(1);
  if (!c) throw (await import('@/lib/errors')).notFound('Certificate not found');
  await assertCase(ctx, c.caseId);
  if (c.status !== 'Certified') throw unprocessable('Only a certified certificate can be revoked');
  await ctx.db.update(schema.certificates).set({ status: 'Revoked', revokedBy: u.id, revokedAt: new Date(), revokeReason: reason }).where(eq(schema.certificates.id, certId));
  await audit(ctx, 'certificate.revoked', 'certificate', certId, { status: 'Certified', level: c.level }, { status: 'Revoked', reason }, c.caseId);
  return getOne(ctx, certId);
}

async function getOne(ctx: Ctx, id: string) {
  const [c] = await ctx.db.select().from(schema.certificates).where(eq(schema.certificates.id, id));
  return present(c);
}
