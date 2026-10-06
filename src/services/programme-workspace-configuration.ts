import { and, desc, eq, max } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { forbidden, notFound, unprocessable } from '@/lib/errors';
import { need } from './common';
import { assertWorkspaceManager } from './programme-workspaces';
import {
  assertConfigurationTransition,
  validateConfigurationForSubmission,
  type ProgrammeWorkspaceConfigurationInput,
} from '@/domain/programme-workspace-configuration';
import type { ProgrammeWorkspaceConfigurationStatus } from '@/db/programme-workspace-configuration-schema';

const c = schema.programmeWorkspaceConfigurations;
const w = schema.programmeWorkspaces;
const m = schema.programmeWorkspaceMembers;

async function getConfiguration(ctx: Ctx, workspaceId: string, version?: number) {
  const query = ctx.db.select().from(c).where(
    version === undefined ? eq(c.workspaceId, workspaceId) : and(eq(c.workspaceId, workspaceId), eq(c.version, version)),
  ).orderBy(desc(c.version)).limit(1);
  const [row] = await query;
  if (!row) throw notFound('Programme workspace configuration not found');
  return row;
}

async function assertApprover(ctx: Ctx, workspaceId: string) {
  const user = need(ctx).user;
  if (['ADMIN', 'EXECUTIVE'].includes(user.role)) return;
  const [membership] = await ctx.db.select().from(m).where(and(eq(m.workspaceId, workspaceId), eq(m.userId, user.id), eq(m.role, 'REVIEWER'), eq(m.active, true))).limit(1);
  if (!membership) throw forbidden('Only an authorised reviewer or administrator can approve workspace configuration');
}

export async function listConfigurations(ctx: Ctx, workspaceId: string) {
  await assertWorkspaceManager(ctx, workspaceId);
  return ctx.db.select().from(c).where(eq(c.workspaceId, workspaceId)).orderBy(desc(c.version));
}

export async function getCurrentConfiguration(ctx: Ctx, workspaceId: string) {
  const { workspace } = await assertWorkspaceManager(ctx, workspaceId);
  const current = await getConfiguration(ctx, workspaceId, workspace.configurationVersion);
  return { workspaceId, configurationVersion: workspace.configurationVersion, configuration: current };
}

export async function createConfigurationDraft(ctx: Ctx, workspaceId: string, input: ProgrammeWorkspaceConfigurationInput) {
  const { workspace } = await assertWorkspaceManager(ctx, workspaceId);
  if (['ACTIVE', 'COMPLETING', 'COMPLETED', 'CLOSED', 'ARCHIVED'].includes(workspace.status)) {
    throw unprocessable('Active or closed workspaces cannot create a new configuration draft through this operation');
  }
  const [latestVersionRow] = await ctx.db.select({ latest: max(c.version) }).from(c).where(eq(c.workspaceId, workspaceId));
  const version = Number(latestVersionRow?.latest ?? 0) + 1;
  const [draft] = await ctx.db.insert(c).values({
    workspaceId,
    version,
    status: 'DRAFT',
    configuration: input.configuration ?? workspace.configuration ?? {},
    objectives: input.objectives ?? [],
    eligibilityRules: input.eligibilityRules ?? {},
    deliveryModel: input.deliveryModel ?? {},
    reporting: input.reporting ?? {},
    entitlements: input.entitlements ?? [],
    frameworkVersionId: input.frameworkVersionId ?? workspace.frameworkVersionId,
    participantConsentRequired: input.participantConsentRequired ?? workspace.participantConsentRequired,
    funderReportingEnabled: input.funderReportingEnabled ?? workspace.funderReportingEnabled,
    changeReason: input.changeReason ?? null,
    createdBy: need(ctx).user.id,
  }).returning();
  await audit(ctx, 'programme_workspace.configuration_draft_created', 'programme_workspace_configuration', draft.id, undefined, { workspaceId, version });
  return draft;
}

export async function submitConfiguration(ctx: Ctx, workspaceId: string, version: number) {
  const { workspace } = await assertWorkspaceManager(ctx, workspaceId);
  const draft = await getConfiguration(ctx, workspaceId, version);
  assertConfigurationTransition(draft.status as ProgrammeWorkspaceConfigurationStatus, 'SUBMITTED');
  const errors = validateConfigurationForSubmission({
    configuration: draft.configuration as Record<string, unknown>,
    objectives: draft.objectives as unknown[],
    eligibilityRules: draft.eligibilityRules as Record<string, unknown>,
    deliveryModel: draft.deliveryModel as Record<string, unknown>,
    reporting: draft.reporting as Record<string, unknown>,
    entitlements: draft.entitlements as unknown[],
    frameworkVersionId: draft.frameworkVersionId,
    participantConsentRequired: draft.participantConsentRequired,
    funderReportingEnabled: draft.funderReportingEnabled,
  });
  if (errors.length) throw unprocessable(`Configuration is not ready for approval: ${errors.join('; ')}`);
  const [row] = await ctx.db.update(c).set({ status: 'SUBMITTED', rejectionReason: null, updatedAt: new Date() }).where(eq(c.id, draft.id)).returning();
  if (workspace.status === 'APPROVED') {
    await ctx.db.update(w).set({ status: 'CONFIGURING', updatedAt: new Date() }).where(eq(w.id, workspaceId));
  }
  await audit(ctx, 'programme_workspace.configuration_submitted', 'programme_workspace_configuration', draft.id, draft, row);
  return row;
}

export async function approveConfiguration(ctx: Ctx, workspaceId: string, version: number) {
  await assertApprover(ctx, workspaceId);
  const draft = await getConfiguration(ctx, workspaceId, version);
  assertConfigurationTransition(draft.status as ProgrammeWorkspaceConfigurationStatus, 'APPROVED');
  const [row] = await ctx.db.update(c).set({ status: 'APPROVED', approvedBy: need(ctx).user.id, approvedAt: new Date(), rejectionReason: null, updatedAt: new Date() }).where(eq(c.id, draft.id)).returning();
  await ctx.db.update(c).set({ status: 'SUPERSEDED', updatedAt: new Date() }).where(and(eq(c.workspaceId, workspaceId), eq(c.status, 'APPROVED')));
  await ctx.db.update(w).set({
    configuration: row.configuration,
    configurationVersion: row.version,
    frameworkVersionId: row.frameworkVersionId,
    participantConsentRequired: row.participantConsentRequired,
    funderReportingEnabled: row.funderReportingEnabled,
    updatedAt: new Date(),
  }).where(eq(w.id, workspaceId));
  await audit(ctx, 'programme_workspace.configuration_approved', 'programme_workspace_configuration', row.id, draft, row);
  return row;
}

export async function rejectConfiguration(ctx: Ctx, workspaceId: string, version: number, reason: string) {
  await assertApprover(ctx, workspaceId);
  if (!reason.trim()) throw unprocessable('A rejection reason is required');
  const draft = await getConfiguration(ctx, workspaceId, version);
  assertConfigurationTransition(draft.status as ProgrammeWorkspaceConfigurationStatus, 'REJECTED');
  const [row] = await ctx.db.update(c).set({ status: 'REJECTED', rejectionReason: reason.trim(), updatedAt: new Date() }).where(eq(c.id, draft.id)).returning();
  await audit(ctx, 'programme_workspace.configuration_rejected', 'programme_workspace_configuration', row.id, draft, row);
  return row;
}

export async function reviseRejectedConfiguration(ctx: Ctx, workspaceId: string, version: number, changeReason?: string) {
  const rejected = await getConfiguration(ctx, workspaceId, version);
  assertConfigurationTransition(rejected.status as ProgrammeWorkspaceConfigurationStatus, 'DRAFT');
  return createConfigurationDraft(ctx, workspaceId, {
    configuration: rejected.configuration as Record<string, unknown>,
    objectives: rejected.objectives as unknown[],
    eligibilityRules: rejected.eligibilityRules as Record<string, unknown>,
    deliveryModel: rejected.deliveryModel as Record<string, unknown>,
    reporting: rejected.reporting as Record<string, unknown>,
    entitlements: rejected.entitlements as unknown[],
    frameworkVersionId: rejected.frameworkVersionId,
    participantConsentRequired: rejected.participantConsentRequired,
    funderReportingEnabled: rejected.funderReportingEnabled,
    changeReason: changeReason ?? rejected.rejectionReason,
  });
}
