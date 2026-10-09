import { and, count, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { notFound, unprocessable } from '@/lib/errors';
import { lockCapacityScope, need } from '@/services/common';
import { assertWorkspaceManager } from '@/services/programme-workspaces';

const pt = schema.programmeParticipants;
const w = schema.programmeWorkspaces;
const c = schema.cohorts;

export const PARTICIPANT_LIFECYCLE = ['APPLICATION','ELIGIBILITY','SELECTED','INVITED','CONSENTED','ONBOARDED','COHORT_ASSIGNED','ACTIVE','COMPLETING','COMPLETED','WITHDRAWN','REJECTED'] as const;
export type ParticipantLifecycle = typeof PARTICIPANT_LIFECYCLE[number];

const transitions: Record<ParticipantLifecycle, ParticipantLifecycle[]> = {
  APPLICATION: ['ELIGIBILITY', 'REJECTED'],
  ELIGIBILITY: ['SELECTED', 'REJECTED'],
  SELECTED: ['INVITED', 'REJECTED'],
  INVITED: ['CONSENTED', 'WITHDRAWN', 'REJECTED'],
  CONSENTED: ['ONBOARDED', 'WITHDRAWN'],
  ONBOARDED: ['COHORT_ASSIGNED', 'WITHDRAWN'],
  COHORT_ASSIGNED: ['ACTIVE', 'WITHDRAWN'],
  ACTIVE: ['COMPLETING', 'WITHDRAWN'],
  COMPLETING: ['COMPLETED', 'WITHDRAWN'],
  COMPLETED: [],
  WITHDRAWN: [],
  REJECTED: [],
};

async function participant(ctx: Ctx, workspaceId: string, participantId: string) {
  const [row] = await ctx.db.select().from(pt).where(and(eq(pt.id, participantId), eq(pt.workspaceId, workspaceId))).limit(1);
  if (!row) throw notFound('Programme participant not found');
  return row;
}

async function workspace(ctx: Ctx, workspaceId: string) {
  const [row] = await ctx.db.select().from(w).where(eq(w.id, workspaceId)).limit(1);
  if (!row) throw notFound('Programme workspace not found');
  return row;
}

async function assertCohort(ctx: Ctx, workspaceId: string, cohortId: string) {
  const ws = await workspace(ctx, workspaceId);
  const [row] = await ctx.db.select().from(c).where(and(eq(c.id, cohortId), eq(c.programmeId, ws.programmeId))).limit(1);
  if (!row) throw notFound('Cohort not found for this programme');
  if (row.status === 'Closed') throw unprocessable('Cannot assign a participant to a closed cohort');
  // Serialize against any other check-then-act cohort-capacity write (case creation, capacity edits)
  // so two concurrent assignments can't both pass this count before either commits.
  await lockCapacityScope(ctx, `cohort:${cohortId}`);
  const [{ n }] = await ctx.db.select({ n: count() }).from(pt).where(eq(pt.cohortId, cohortId));
  if (Number(n) >= row.capacity) throw unprocessable('Cohort capacity has been reached');
  return { ws, cohort: row };
}

export async function getParticipant(ctx: Ctx, workspaceId: string, participantId: string) {
  return participant(ctx, workspaceId, participantId);
}

export async function assignCohort(ctx: Ctx, workspaceId: string, participantId: string, cohortId: string) {
  const { workspace } = await assertWorkspaceManager(ctx, workspaceId);
  const before = await participant(ctx, workspaceId, participantId);
  if (before.status !== 'ONBOARDED') throw unprocessable('Only onboarded participants can be assigned to a cohort');
  await assertCohort(ctx, workspaceId, cohortId);
  const [row] = await ctx.db.update(pt).set({ cohortId, status: 'COHORT_ASSIGNED', updatedAt: new Date() }).where(eq(pt.id, participantId)).returning();
  await audit(ctx, 'programme_participant.cohort_assigned', 'programme_participant', participantId, before, { cohortId, status: row.status, programmeId: workspace.programmeId });
  return row;
}

export async function recordConsent(ctx: Ctx, workspaceId: string, participantId: string) {
  const { workspace } = await assertWorkspaceManager(ctx, workspaceId);
  const before = await participant(ctx, workspaceId, participantId);
  if (before.status !== 'INVITED') throw unprocessable('Consent can only be recorded for an invited participant');
  const now = new Date();
  const [row] = await ctx.db.update(pt).set({ status: 'CONSENTED', consentAt: now, consentBy: need(ctx).user.id, updatedAt: now }).where(eq(pt.id, participantId)).returning();
  await audit(ctx, 'programme_participant.consent_recorded', 'programme_participant', participantId, before, { consentAt: now, consentBy: need(ctx).user.id, programmeId: workspace.programmeId });
  return row;
}

export async function onboard(ctx: Ctx, workspaceId: string, participantId: string) {
  const { workspace } = await assertWorkspaceManager(ctx, workspaceId);
  const before = await participant(ctx, workspaceId, participantId);
  const consentSatisfied = before.status === 'CONSENTED' || (before.status === 'INVITED' && !workspace.participantConsentRequired);
  if (!consentSatisfied) throw unprocessable('Only consented participants can be onboarded');
  const now = new Date();
  const [row] = await ctx.db.update(pt).set({ status: 'ONBOARDED', onboardedAt: now, updatedAt: now }).where(eq(pt.id, participantId)).returning();
  await audit(ctx, 'programme_participant.onboarded', 'programme_participant', participantId, before, { onboardedAt: now, programmeId: workspace.programmeId });
  return row;
}

export async function activate(ctx: Ctx, workspaceId: string, participantId: string) {
  const { workspace } = await assertWorkspaceManager(ctx, workspaceId);
  const before = await participant(ctx, workspaceId, participantId);
  if (before.status !== 'COHORT_ASSIGNED') throw unprocessable('Only cohort-assigned participants can become active');
  const [row] = await ctx.db.update(pt).set({ status: 'ACTIVE', updatedAt: new Date() }).where(eq(pt.id, participantId)).returning();
  await audit(ctx, 'programme_participant.activated', 'programme_participant', participantId, before, { programmeId: workspace.programmeId });
  return row;
}

export function canTransitionParticipant(from: ParticipantLifecycle, to: ParticipantLifecycle) {
  return transitions[from]?.includes(to) ?? false;
}
