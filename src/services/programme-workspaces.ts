import { and, count, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertOrg, assertProgramme } from '@/domain/scope';
import { assertProgrammeTransition, type ProgrammeLifecycle, type ProviderSource } from '@/domain/programme-operating-model';
import { canManageWorkspace, canDeliverInWorkspace, type WorkspaceRole } from '@/domain/programme-workspace';
import { assertCapacity, getParticipantCapacity, getRoleCapacity, readWorkspaceEntitlements } from '@/domain/programme-entitlements';
import { allow, need } from './common';

const w = schema.programmeWorkspaces;
const m = schema.programmeWorkspaceMembers;
const pt = schema.programmeParticipants;
const p = schema.programmes;
const u = schema.users;

async function getWorkspace(ctx: Ctx, workspaceId: string) {
  const [row] = await ctx.db.select().from(w).where(eq(w.id, workspaceId)).limit(1);
  if (!row) throw notFound('Programme workspace not found');
  return row;
}

async function getMembership(ctx: Ctx, workspaceId: string, userId: string, role?: WorkspaceRole) {
  const conditions = [eq(m.workspaceId, workspaceId), eq(m.userId, userId), eq(m.active, true)];
  if (role) conditions.push(eq(m.role, role));
  const [row] = await ctx.db.select().from(m).where(and(...conditions)).limit(1);
  return row ?? null;
}

async function assertWorkspaceAccess(ctx: Ctx, workspaceId: string) {
  const workspace = await getWorkspace(ctx, workspaceId);
  const user = need(ctx).user;
  if (['ADMIN', 'EXECUTIVE'].includes(user.role)) return { workspace, membership: null };
  if (user.programmeIds.includes(workspace.programmeId)) return { workspace, membership: null };
  const membership = await getMembership(ctx, workspaceId, user.id);
  if (!membership || !canDeliverInWorkspace(membership.role as WorkspaceRole)) throw notFound('Programme workspace not found');
  return { workspace, membership };
}

async function assertWorkspaceManager(ctx: Ctx, workspaceId: string) {
  const { workspace, membership } = await assertWorkspaceAccess(ctx, workspaceId);
  const user = need(ctx).user;
  if (user.role === 'ADMIN') return { workspace, membership };
  if (!membership || !canManageWorkspace(membership.role as WorkspaceRole)) throw forbidden('Only the programme manager can manage this workspace');
  return { workspace, membership };
}

export async function listWorkspaces(ctx: Ctx) {
  allow(ctx, 'programme_workspaces', 'read');
  const user = need(ctx).user;
  if (['ADMIN', 'EXECUTIVE'].includes(user.role)) return ctx.db.select().from(w).orderBy(w.createdAt);
  const assigned = user.programmeIds.length
    ? await ctx.db.select().from(w).where(inArray(w.programmeId, user.programmeIds)).orderBy(w.createdAt)
    : [];
  const memberRows = await ctx.db.select({ workspace: w }).from(w).innerJoin(m, eq(m.workspaceId, w.id)).where(and(eq(m.userId, user.id), eq(m.active, true))).orderBy(w.createdAt);
  const seen = new Set<string>();
  return [...assigned, ...memberRows.map((r) => r.workspace)].filter((row) => !seen.has(row.id) && !!seen.add(row.id));
}

export async function getWorkspaceByProgramme(ctx: Ctx, programmeId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  const user = need(ctx).user;
  const [workspace] = await ctx.db.select().from(w).where(eq(w.programmeId, programmeId)).limit(1);
  if (!workspace) throw notFound('Programme workspace not found');
  if (!['ADMIN', 'EXECUTIVE'].includes(user.role) && !user.programmeIds.includes(programmeId)) {
    const membership = await getMembership(ctx, workspace.id, user.id);
    if (!membership) throw notFound('Programme workspace not found');
  }
  return workspace;
}

export async function createWorkspace(ctx: Ctx, programmeId: string, input: {
  name?: string;
  providerSource?: ProviderSource;
  frameworkVersionId?: string | null;
  participantConsentRequired?: boolean;
  funderReportingEnabled?: boolean;
  configuration?: Record<string, unknown>;
}) {
  allow(ctx, 'programme_workspaces', 'create');
  const programme = await assertProgramme(ctx, programmeId);
  const existing = await ctx.db.select({ id: w.id }).from(w).where(eq(w.programmeId, programmeId)).limit(1);
  if (existing.length) throw conflict('This programme already has a workspace');
  const [workspace] = await ctx.db.insert(w).values({
    programmeId,
    name: input.name?.trim() || programme.name,
    providerSource: input.providerSource ?? 'SAMAKOSE_NETWORK',
    frameworkVersionId: input.frameworkVersionId ?? null,
    participantConsentRequired: input.participantConsentRequired ?? true,
    funderReportingEnabled: input.funderReportingEnabled ?? false,
    configuration: input.configuration ?? {},
  }).returning();
  await ctx.db.insert(m).values({ workspaceId: workspace.id, userId: need(ctx).user.id, role: 'PROGRAMME_MANAGER' });
  await audit(ctx, 'programme_workspace.created', 'programme_workspace', workspace.id, undefined, { programmeId, providerSource: workspace.providerSource });
  return workspace;
}

export async function updateWorkspace(ctx: Ctx, workspaceId: string, input: {
  name?: string;
  status?: ProgrammeLifecycle;
  providerSource?: ProviderSource;
  frameworkVersionId?: string | null;
  participantConsentRequired?: boolean;
  funderReportingEnabled?: boolean;
  configuration?: Record<string, unknown>;
}) {
  allow(ctx, 'programme_workspaces', 'edit');
  const { workspace } = await assertWorkspaceManager(ctx, workspaceId);
  if (input.status && input.status !== workspace.status) assertProgrammeTransition(workspace.status as ProgrammeLifecycle, input.status);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of ['name', 'status', 'providerSource', 'frameworkVersionId', 'participantConsentRequired', 'funderReportingEnabled'] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (input.configuration !== undefined) {
    patch.configuration = input.configuration;
    patch.configurationVersion = workspace.configurationVersion + 1;
  }
  await ctx.db.update(w).set(patch).where(eq(w.id, workspaceId));
  await audit(ctx, 'programme_workspace.updated', 'programme_workspace', workspaceId, workspace, patch);
  return getWorkspace(ctx, workspaceId);
}

export async function listMembers(ctx: Ctx, workspaceId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await assertWorkspaceAccess(ctx, workspaceId);
  return ctx.db.select({ workspaceId: m.workspaceId, userId: m.userId, role: m.role, active: m.active, joinedAt: m.joinedAt, name: u.name, email: u.email })
    .from(m).innerJoin(u, eq(u.id, m.userId)).where(eq(m.workspaceId, workspaceId)).orderBy(m.joinedAt);
}

export async function addMember(ctx: Ctx, workspaceId: string, input: { userId: string; role: WorkspaceRole }) {
  allow(ctx, 'programme_workspaces', 'edit');
  const { workspace } = await assertWorkspaceManager(ctx, workspaceId);
  if (!canDeliverInWorkspace(input.role)) throw unprocessable('Unsupported workspace role');
  const [user] = await ctx.db.select({ id: u.id }).from(u).where(eq(u.id, input.userId)).limit(1);
  if (!user) throw notFound('User not found');

  const entitlements = readWorkspaceEntitlements(workspace.configuration);
  const roleCapacity = getRoleCapacity(entitlements, input.role);
  const [{ n: activeRoleUsage }] = await ctx.db.select({ n: count() }).from(m).where(and(eq(m.workspaceId, workspaceId), eq(m.role, input.role), eq(m.active, true)));
  assertCapacity(roleCapacity, Number(activeRoleUsage), `${input.role} team`);

  const [existing] = await ctx.db.select().from(m).where(and(eq(m.workspaceId, workspaceId), eq(m.userId, input.userId), eq(m.role, input.role))).limit(1);
  if (existing) {
    if (existing.active) throw conflict('User is already an active member with this role');
    const [reactivated] = await ctx.db.update(m).set({ active: true }).where(and(eq(m.workspaceId, workspaceId), eq(m.userId, input.userId), eq(m.role, input.role))).returning();
    await audit(ctx, 'programme_workspace.member_activated', 'programme_workspace_member', `${workspaceId}:${input.userId}:${input.role}`, existing, reactivated);
    return reactivated;
  }

  const [row] = await ctx.db.insert(m).values({ workspaceId, userId: input.userId, role: input.role }).returning();
  await audit(ctx, 'programme_workspace.member_added', 'programme_workspace_member', `${workspaceId}:${input.userId}:${input.role}`, undefined, { workspaceId, userId: input.userId, role: input.role });
  return row;
}

export async function setMemberActive(ctx: Ctx, workspaceId: string, userId: string, role: WorkspaceRole, active: boolean) {
  allow(ctx, 'programme_workspaces', 'edit');
  await assertWorkspaceManager(ctx, workspaceId);
  const [row] = await ctx.db.update(m).set({ active }).where(and(eq(m.workspaceId, workspaceId), eq(m.userId, userId), eq(m.role, role))).returning();
  if (!row) throw notFound('Workspace membership not found');
  await audit(ctx, active ? 'programme_workspace.member_activated' : 'programme_workspace.member_deactivated', 'programme_workspace_member', `${workspaceId}:${userId}:${role}`);
  return row;
}

export async function getTeamEntitlementUsage(ctx: Ctx, workspaceId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  const { workspace } = await assertWorkspaceAccess(ctx, workspaceId);
  const entitlements = readWorkspaceEntitlements(workspace.configuration);
  const members = await ctx.db.select({ role: m.role, active: m.active }).from(m).where(eq(m.workspaceId, workspaceId));
  const usage = Object.fromEntries(WORKSPACE_ROLES.map((role) => [role, members.filter((row) => row.role === role && row.active).length]));
  const limits = Object.fromEntries(WORKSPACE_ROLES.map((role) => [role, getRoleCapacity(entitlements, role)]));
  return { workspaceId, usage, limits, entitlements };
}

export async function listParticipants(ctx: Ctx, workspaceId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  const { workspace } = await assertWorkspaceAccess(ctx, workspaceId);
  return ctx.db.select().from(pt).where(eq(pt.workspaceId, workspace.id)).orderBy(pt.createdAt);
}

export async function addParticipant(ctx: Ctx, workspaceId: string, input: { organisationId: string; cohortId?: string | null; status?: string; metadata?: Record<string, unknown> }) {
  allow(ctx, 'programme_workspaces', 'edit');
  const { workspace } = await assertWorkspaceManager(ctx, workspaceId);
  await assertOrg(ctx, input.organisationId);
  const [programme] = await ctx.db.select({ id: p.id }).from(p).where(eq(p.id, workspace.programmeId)).limit(1);
  if (!programme) throw notFound('Programme not found');
  const existing = await ctx.db.select({ id: pt.id }).from(pt).where(and(eq(pt.programmeId, workspace.programmeId), eq(pt.organisationId, input.organisationId))).limit(1);
  if (existing.length) throw conflict('This organisation is already a participant in the programme');
  const entitlements = readWorkspaceEntitlements(workspace.configuration);
  const capacity = getParticipantCapacity(entitlements);
  if (capacity !== null) {
    const [{ n }] = await ctx.db.select({ n: count() }).from(pt).where(eq(pt.workspaceId, workspaceId));
    assertCapacity(capacity, Number(n), 'Participant');
  }
  const status = input.status ?? 'APPLICATION';
  if (!['APPLICATION','ELIGIBILITY','SELECTED','INVITED','CONSENTED','ONBOARDED','COHORT_ASSIGNED','ACTIVE','COMPLETING','COMPLETED','WITHDRAWN','REJECTED'].includes(status)) throw unprocessable('Invalid participant status');
  const [row] = await ctx.db.insert(pt).values({ programmeId: workspace.programmeId, workspaceId, organisationId: input.organisationId, cohortId: input.cohortId ?? null, status, metadata: input.metadata ?? {} }).returning();
  await audit(ctx, 'programme_participant.created', 'programme_participant', row.id, undefined, { workspaceId, organisationId: input.organisationId, status });
  return row;
}

const PARTICIPANT_MOVES: Record<string, string[]> = {
  APPLICATION: ['ELIGIBILITY', 'REJECTED'], ELIGIBILITY: ['SELECTED', 'REJECTED'], SELECTED: ['INVITED', 'REJECTED'],
  INVITED: ['CONSENTED', 'WITHDRAWN', 'REJECTED'], CONSENTED: ['ONBOARDED', 'WITHDRAWN'], ONBOARDED: ['COHORT_ASSIGNED', 'WITHDRAWN'],
  COHORT_ASSIGNED: ['ACTIVE', 'WITHDRAWN'], ACTIVE: ['COMPLETING', 'WITHDRAWN'], COMPLETING: ['COMPLETED', 'WITHDRAWN'],
  COMPLETED: [], WITHDRAWN: [], REJECTED: [],
};

export async function transitionParticipant(ctx: Ctx, workspaceId: string, participantId: string, status: string) {
  allow(ctx, 'programme_workspaces', 'edit');
  await assertWorkspaceManager(ctx, workspaceId);
  const [before] = await ctx.db.select().from(pt).where(and(eq(pt.id, participantId), eq(pt.workspaceId, workspaceId))).limit(1);
  if (!before) throw notFound('Programme participant not found');
  if (before.status === status) return before;
  if (!PARTICIPANT_MOVES[before.status]?.includes(status)) throw unprocessable(`Invalid participant lifecycle transition: ${before.status} -> ${status}`);
  const now = new Date();
  const patch: Record<string, unknown> = { status, updatedAt: now };
  if (status === 'INVITED') patch.invitedAt = now;
  if (status === 'CONSENTED') { patch.consentAt = now; patch.consentBy = need(ctx).user.id; }
  if (status === 'ONBOARDED') patch.onboardedAt = now;
  if (status === 'COMPLETED') patch.completedAt = now;
  if (status === 'WITHDRAWN') patch.withdrawnAt = now;
  const [row] = await ctx.db.update(pt).set(patch).where(eq(pt.id, participantId)).returning();
  await audit(ctx, 'programme_participant.status_changed', 'programme_participant', participantId, before, patch);
  return row;
}
