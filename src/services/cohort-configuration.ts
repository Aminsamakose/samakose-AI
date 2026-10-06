import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { allow, need } from './common';

const cc = schema.cohortConfigurations;
const cohorts = schema.cohorts;

function assertApprover(ctx: Ctx) {
  const role = need(ctx).user.role;
  if (!['ADMIN', 'REVIEWER'].includes(role)) throw forbidden('Only an authorised reviewer or administrator can approve cohort delivery configuration');
}

async function getCohort(ctx: Ctx, cohortId: string) {
  const [cohort] = await ctx.db.select().from(cohorts).where(eq(cohorts.id, cohortId)).limit(1);
  if (!cohort) throw notFound('Cohort not found');
  await assertProgramme(ctx, cohort.programmeId);
  return cohort;
}

export async function listCohortConfigurations(ctx: Ctx, cohortId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getCohort(ctx, cohortId);
  return ctx.db.select().from(cc).where(eq(cc.cohortId, cohortId)).orderBy(desc(cc.version));
}

export async function getCurrentCohortConfiguration(ctx: Ctx, cohortId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getCohort(ctx, cohortId);
  const [row] = await ctx.db.select().from(cc).where(and(eq(cc.cohortId, cohortId), eq(cc.status, 'APPROVED'))).orderBy(desc(cc.version)).limit(1);
  if (!row) throw notFound('No approved cohort delivery configuration exists');
  return row;
}

type Input = {
  deliveryMode?: 'IN_PERSON' | 'REMOTE' | 'HYBRID' | 'SELF_PACED';
  schedule?: unknown;
  milestones?: unknown;
  serviceLevels?: unknown;
  providerPlan?: unknown;
  sessionPlan?: unknown;
  changeReason?: string | null;
};

export async function createCohortConfigurationDraft(ctx: Ctx, cohortId: string, input: Input) {
  allow(ctx, 'programme_workspaces', 'edit');
  const cohort = await getCohort(ctx, cohortId);
  if (cohort.status === 'Closed') throw unprocessable('A closed cohort cannot be reconfigured');
  const latest = await ctx.db.select({ version: cc.version }).from(cc).where(eq(cc.cohortId, cohortId)).orderBy(desc(cc.version)).limit(1);
  const version = (latest[0]?.version ?? 0) + 1;
  const [row] = await ctx.db.insert(cc).values({
    cohortId,
    version,
    deliveryMode: input.deliveryMode ?? 'HYBRID',
    schedule: input.schedule ?? {},
    milestones: input.milestones ?? [],
    serviceLevels: input.serviceLevels ?? {},
    providerPlan: input.providerPlan ?? {},
    sessionPlan: input.sessionPlan ?? {},
    changeReason: input.changeReason ?? null,
    createdBy: need(ctx).user.id,
  }).returning();
  await audit(ctx, 'cohort.configuration.created', 'cohort_configuration', row.id, undefined, { cohortId, version });
  return row;
}

export async function submitCohortConfiguration(ctx: Ctx, cohortId: string, version: number) {
  allow(ctx, 'programme_workspaces', 'edit');
  await getCohort(ctx, cohortId);
  const [row] = await ctx.db.select().from(cc).where(and(eq(cc.cohortId, cohortId), eq(cc.version, version))).limit(1);
  if (!row) throw notFound('Cohort configuration not found');
  if (row.status !== 'DRAFT') throw conflict(`Only a draft configuration can be submitted; current status is ${row.status}`);
  await ctx.db.update(cc).set({ status: 'SUBMITTED', updatedAt: new Date() }).where(eq(cc.id, row.id));
  await audit(ctx, 'cohort.configuration.submitted', 'cohort_configuration', row.id, row, { status: 'SUBMITTED' });
  return { ok: true };
}

export async function approveCohortConfiguration(ctx: Ctx, cohortId: string, version: number) {
  allow(ctx, 'programme_workspaces', 'edit');
  assertApprover(ctx);
  await getCohort(ctx, cohortId);
  const [row] = await ctx.db.select().from(cc).where(and(eq(cc.cohortId, cohortId), eq(cc.version, version))).limit(1);
  if (!row) throw notFound('Cohort configuration not found');
  if (row.status !== 'SUBMITTED') throw conflict(`Only a submitted configuration can be approved; current status is ${row.status}`);
  await ctx.db.transaction(async (tx) => {
    await tx.update(cc).set({ status: 'SUPERSEDED', updatedAt: new Date() }).where(and(eq(cc.cohortId, cohortId), eq(cc.status, 'APPROVED')));
    await tx.update(cc).set({ status: 'APPROVED', approvedBy: need(ctx).user.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(cc.id, row.id));
  });
  await audit(ctx, 'cohort.configuration.approved', 'cohort_configuration', row.id, row, { status: 'APPROVED', approvedBy: need(ctx).user.id });
  return { ok: true };
}

export async function rejectCohortConfiguration(ctx: Ctx, cohortId: string, version: number, reason: string) {
  allow(ctx, 'programme_workspaces', 'edit');
  assertApprover(ctx);
  await getCohort(ctx, cohortId);
  const [row] = await ctx.db.select().from(cc).where(and(eq(cc.cohortId, cohortId), eq(cc.version, version))).limit(1);
  if (!row) throw notFound('Cohort configuration not found');
  if (row.status !== 'SUBMITTED') throw conflict(`Only a submitted configuration can be rejected; current status is ${row.status}`);
  const clean = reason.trim();
  if (clean.length < 3) throw unprocessable('A rejection reason is required');
  await ctx.db.update(cc).set({ status: 'REJECTED', rejectionReason: clean, updatedAt: new Date() }).where(eq(cc.id, row.id));
  await audit(ctx, 'cohort.configuration.rejected', 'cohort_configuration', row.id, row, { status: 'REJECTED', rejectionReason: clean });
  return { ok: true };
}

export async function reviseRejectedCohortConfiguration(ctx: Ctx, cohortId: string, version: number, changeReason?: string | null) {
  allow(ctx, 'programme_workspaces', 'edit');
  const [row] = await ctx.db.select().from(cc).where(and(eq(cc.cohortId, cohortId), eq(cc.version, version))).limit(1);
  if (!row) throw notFound('Cohort configuration not found');
  if (row.status !== 'REJECTED') throw conflict(`Only a rejected configuration can be revised; current status is ${row.status}`);
  return createCohortConfigurationDraft(ctx, cohortId, {
    deliveryMode: row.deliveryMode as Input['deliveryMode'],
    schedule: row.schedule,
    milestones: row.milestones,
    serviceLevels: row.serviceLevels,
    providerPlan: row.providerPlan,
    sessionPlan: row.sessionPlan,
    changeReason: changeReason ?? row.changeReason,
  });
}
