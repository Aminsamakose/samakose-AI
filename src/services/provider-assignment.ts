import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { allow, need } from './common';

const workspaces = schema.programmeWorkspaces;
const members = schema.programmeWorkspaceMembers;
const users = schema.users;
const profiles = schema.practitionerProfiles;
const assignments = schema.providerAssignments;
const capacities = schema.providerCapacities;
const cohorts = schema.cohorts;
const activities = schema.deliveryActivities;
const sessions = schema.deliverySessions;

export type ProviderRole = 'EXPERT' | 'COACH';
export type AssignmentStatus = 'PROPOSED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'DECLINED';

async function getWorkspace(ctx: Ctx, workspaceId: string) {
  const [workspace] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) throw notFound('Programme workspace not found');
  await assertProgramme(ctx, workspace.programmeId);
  return workspace;
}

async function getAssignment(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(assignments).where(eq(assignments.id, id)).limit(1);
  if (!row) throw notFound('Provider assignment not found');
  await getWorkspace(ctx, row.workspaceId);
  return row;
}

async function ensureProvider(ctx: Ctx, workspaceId: string, providerUserId: string, providerRole: ProviderRole) {
  const workspace = await getWorkspace(ctx, workspaceId);
  const [user] = await ctx.db.select().from(users).where(and(eq(users.id, providerUserId), eq(users.active, true))).limit(1);
  if (!user || user.role !== 'EXPERT') throw fieldError({ providerUserId: 'Choose an active Expert/Coach provider' });
  const [profile] = await ctx.db.select().from(profiles).where(eq(profiles.userId, providerUserId)).limit(1);
  if (!profile || profile.vettingStatus !== 'Approved') throw fieldError({ providerUserId: 'The provider must have an approved practitioner profile' });
  const functionName = providerRole === 'EXPERT' ? 'expert' : 'coach';
  if (!profile.functions.includes(functionName)) throw fieldError({ providerUserId: `This provider is not approved for the ${functionName} function` });
  const [member] = await ctx.db.select().from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.userId, providerUserId), eq(members.role, providerRole), eq(members.active, true))).limit(1);
  if (!member) throw fieldError({ providerUserId: 'Add the provider to this Programme Workspace team before assigning programme work' });
  return { workspace, user, profile };
}

async function load(ctx: Ctx, workspaceId: string, providerUserId: string, providerRole: ProviderRole) {
  const [active] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(assignments).where(and(eq(assignments.workspaceId, workspaceId), eq(assignments.providerUserId, providerUserId), eq(assignments.providerRole, providerRole), eq(assignments.status, 'ACTIVE')));
  const [cap] = await ctx.db.select().from(capacities).where(and(eq(capacities.workspaceId, workspaceId), eq(capacities.providerUserId, providerUserId), eq(capacities.providerRole, providerRole))).limit(1);
  return { activeAssignments: Number(active?.count ?? 0), capacity: cap ?? null };
}

async function sessionLoad(ctx: Ctx, workspaceId: string, providerUserId: string) {
  const [workspace] = await ctx.db.select({ programmeId: workspaces.programmeId }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return 0;
  const [row] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(sessions).innerJoin(activities, eq(activities.id, sessions.activityId)).innerJoin(cohorts, eq(cohorts.id, activities.cohortId)).where(and(eq(cohorts.programmeId, workspace.programmeId), eq(sessions.facilitatorUserId, providerUserId), sql`${sessions.startsAt} >= date_trunc('week', now())`, sql`${sessions.startsAt} < date_trunc('week', now()) + interval '7 days'`, inArray(sessions.status, ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'])));
  return Number(row?.count ?? 0);
}

export async function listEligibleProviders(ctx: Ctx, workspaceId: string, providerRole: ProviderRole) {
  allow(ctx, 'programme_workspaces', 'read');
  await getWorkspace(ctx, workspaceId);
  const functionName = providerRole === 'EXPERT' ? 'expert' : 'coach';
  const rows = await ctx.db.select({ user: users, profile: profiles }).from(profiles).innerJoin(users, eq(users.id, profiles.userId)).innerJoin(members, and(eq(members.userId, users.id), eq(members.workspaceId, workspaceId), eq(members.role, providerRole), eq(members.active, true))).where(and(eq(users.active, true), eq(users.role, 'EXPERT'), eq(profiles.vettingStatus, 'Approved'))).orderBy(asc(users.name));
  const filtered = rows.filter((r) => r.profile.functions.includes(functionName));
  const items = [];
  for (const row of filtered) {
    const l = await load(ctx, workspaceId, row.user.id, providerRole);
    const weeklySessions = await sessionLoad(ctx, workspaceId, row.user.id);
    items.push({ userId: row.user.id, name: row.user.name, availability: row.profile.availability, activeAssignments: l.activeAssignments, capacity: l.capacity, weeklySessions });
  }
  return { items };
}

export async function listAssignments(ctx: Ctx, workspaceId: string, filters: { providerRole?: ProviderRole; status?: AssignmentStatus } = {}) {
  allow(ctx, 'programme_workspaces', 'read');
  await getWorkspace(ctx, workspaceId);
  const conditions = [eq(assignments.workspaceId, workspaceId)];
  if (filters.providerRole) conditions.push(eq(assignments.providerRole, filters.providerRole));
  if (filters.status) conditions.push(eq(assignments.status, filters.status));
  const rows = await ctx.db.select({ assignment: assignments, user: users }).from(assignments).innerJoin(users, eq(users.id, assignments.providerUserId)).where(and(...conditions)).orderBy(asc(assignments.status), asc(assignments.startsAt));
  const items = [];
  for (const row of rows) {
    const l = await load(ctx, workspaceId, row.user.id, row.assignment.providerRole as ProviderRole);
    items.push({ ...row.assignment, provider: { id: row.user.id, name: row.user.name }, activeLoad: l.activeAssignments, capacity: l.capacity });
  }
  return items;
}

export async function setCapacity(ctx: Ctx, workspaceId: string, input: { providerUserId: string; providerRole: ProviderRole; maxActiveAssignments: number; maxSessionsPerWeek?: number | null; weeklyHours?: number | null; availability?: 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE'; effectiveFrom?: string; effectiveTo?: string | null; metadata?: unknown }) {
  allow(ctx, 'programme_workspaces', 'edit');
  await ensureProvider(ctx, workspaceId, input.providerUserId, input.providerRole);
  if (!Number.isInteger(input.maxActiveAssignments) || input.maxActiveAssignments < 1) throw fieldError({ maxActiveAssignments: 'Capacity must be at least 1' });
  if (input.maxSessionsPerWeek != null && (!Number.isInteger(input.maxSessionsPerWeek) || input.maxSessionsPerWeek < 1)) throw fieldError({ maxSessionsPerWeek: 'Weekly session capacity must be at least 1' });
  if (input.weeklyHours != null && (!Number.isInteger(input.weeklyHours) || input.weeklyHours < 1)) throw fieldError({ weeklyHours: 'Weekly hours must be at least 1' });
  const [existing] = await ctx.db.select().from(capacities).where(and(eq(capacities.workspaceId, workspaceId), eq(capacities.providerUserId, input.providerUserId), eq(capacities.providerRole, input.providerRole))).limit(1);
  const values = { maxActiveAssignments: input.maxActiveAssignments, maxSessionsPerWeek: input.maxSessionsPerWeek ?? null, weeklyHours: input.weeklyHours ?? null, availability: input.availability ?? 'AVAILABLE', effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(), effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null, metadata: input.metadata ?? {}, updatedAt: new Date() };
  if (existing) await ctx.db.update(capacities).set(values).where(eq(capacities.id, existing.id));
  else await ctx.db.insert(capacities).values({ workspaceId, providerUserId: input.providerUserId, providerRole: input.providerRole, ...values, createdBy: need(ctx).user.id });
  await audit(ctx, 'provider.capacity.changed', 'provider_capacity', existing?.id ?? input.providerUserId, existing ? { maxActiveAssignments: existing.maxActiveAssignments } : undefined, values, workspaceId);
  return ctx.db.select().from(capacities).where(and(eq(capacities.workspaceId, workspaceId), eq(capacities.providerUserId, input.providerUserId), eq(capacities.providerRole, input.providerRole))).limit(1).then((r) => r[0]);
}

async function assertCapacity(ctx: Ctx, workspaceId: string, providerUserId: string, providerRole: ProviderRole) {
  const { profile } = await ensureProvider(ctx, workspaceId, providerUserId, providerRole);
  const l = await load(ctx, workspaceId, providerUserId, providerRole);
  const max = l.capacity?.maxActiveAssignments ?? profile.maxActive;
  if (l.capacity?.availability === 'UNAVAILABLE' || profile.availability === 'Unavailable') throw conflict('This provider is currently unavailable');
  if (l.activeAssignments >= max) throw conflict(`Provider capacity reached (${l.activeAssignments} of ${max} active assignments)`);
  if (l.capacity?.availability === 'LIMITED' && l.activeAssignments >= Math.max(1, Math.ceil(max * 0.8))) throw conflict('Provider is marked limited and has reached the safe allocation threshold');
  return { load: l.activeAssignments, max };
}

export async function createAssignment(ctx: Ctx, workspaceId: string, input: { providerUserId: string; providerRole: ProviderRole; cohortId?: string | null; allocationPercent?: number; maxParticipants?: number | null; startsAt?: string | null; endsAt?: string | null; reason?: string | null; metadata?: unknown }) {
  allow(ctx, 'programme_workspaces', 'assign');
  const workspace = await getWorkspace(ctx, workspaceId);
  if (!['ACTIVE', 'READY', 'CONFIGURING'].includes(workspace.status)) throw unprocessable('Provider assignments can only be created for a configured or active workspace');
  if (input.cohortId) {
    const [cohort] = await ctx.db.select().from(cohorts).where(eq(cohorts.id, input.cohortId)).limit(1);
    if (!cohort || cohort.programmeId !== workspace.programmeId) throw fieldError({ cohortId: 'Cohort does not belong to this Programme Workspace' });
  }
  if ((input.allocationPercent ?? 100) < 1 || (input.allocationPercent ?? 100) > 100) throw fieldError({ allocationPercent: 'Allocation must be between 1 and 100 percent' });
  await ensureProvider(ctx, workspaceId, input.providerUserId, input.providerRole);
  await assertCapacity(ctx, workspaceId, input.providerUserId, input.providerRole);
  const [row] = await ctx.db.insert(assignments).values({ workspaceId, cohortId: input.cohortId ?? null, providerUserId: input.providerUserId, providerRole: input.providerRole, status: 'PROPOSED', allocationPercent: input.allocationPercent ?? 100, maxParticipants: input.maxParticipants ?? null, startsAt: input.startsAt ? new Date(input.startsAt) : new Date(), endsAt: input.endsAt ? new Date(input.endsAt) : null, reason: input.reason?.trim() || null, metadata: input.metadata ?? {}, createdBy: need(ctx).user.id }).returning();
  await audit(ctx, 'provider.assignment.created', 'provider_assignment', row.id, undefined, { workspaceId, providerUserId: row.providerUserId, providerRole: row.providerRole, status: row.status }, workspaceId);
  return row;
}

export async function updateAssignmentStatus(ctx: Ctx, id: string, status: AssignmentStatus, reason?: string | null) {
  allow(ctx, 'programme_workspaces', 'edit');
  const row = await getAssignment(ctx, id);
  const allowed: Record<AssignmentStatus, AssignmentStatus[]> = {
    PROPOSED: ['PROPOSED', 'ACTIVE', 'DECLINED'], ACTIVE: ['ACTIVE', 'PAUSED', 'ENDED'], PAUSED: ['PAUSED', 'ACTIVE', 'ENDED'], ENDED: ['ENDED'], DECLINED: ['DECLINED'],
  };
  if (!allowed[row.status as AssignmentStatus].includes(status)) throw conflict(`Cannot move provider assignment from ${row.status} to ${status}`);
  if (status === 'ACTIVE' && row.status !== 'ACTIVE') await assertCapacity(ctx, row.workspaceId, row.providerUserId, row.providerRole as ProviderRole);
  if (status === 'DECLINED' && (reason ?? '').trim().length < 5) throw fieldError({ reason: 'Give a reason for declining the provider assignment' });
  if (status === 'ENDED' && (reason ?? '').trim().length < 5) throw fieldError({ reason: 'Give a reason for ending the provider assignment' });
  const now = new Date();
  await ctx.db.update(assignments).set({ status, reason: reason?.trim() || row.reason, endsAt: status === 'ENDED' || status === 'DECLINED' ? row.endsAt ?? now : row.endsAt, updatedAt: now }).where(eq(assignments.id, id));
  await audit(ctx, 'provider.assignment.status', 'provider_assignment', id, { status: row.status }, { status, reason: reason ?? null }, row.workspaceId);
  return getAssignment(ctx, id);
}

export async function capacitySummary(ctx: Ctx, workspaceId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  await getWorkspace(ctx, workspaceId);
  const rows = await ctx.db.select({ c: capacities, u: users }).from(capacities).innerJoin(users, eq(users.id, capacities.providerUserId)).where(eq(capacities.workspaceId, workspaceId)).orderBy(asc(users.name));
  const items = [];
  for (const row of rows) {
    const l = await load(ctx, workspaceId, row.u.id, row.c.providerRole as ProviderRole);
    const weeklySessions = await sessionLoad(ctx, workspaceId, row.u.id);
    items.push({ ...row.c, provider: { id: row.u.id, name: row.u.name }, activeAssignments: l.activeAssignments, weeklySessions, assignmentUtilisation: Number((l.activeAssignments / row.c.maxActiveAssignments).toFixed(3)), sessionUtilisation: row.c.maxSessionsPerWeek ? Number((weeklySessions / row.c.maxSessionsPerWeek).toFixed(3)) : null });
  }
  return items;
}
