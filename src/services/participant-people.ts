/** The people behind a programme's enterprise enrolments (GAP 02). Scoped through the same
 *  workspace access/manager checks as the rest of programme-workspaces.ts, since a
 *  programme_participant row (the enrolment) always belongs to exactly one workspace. */
import { and, count, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, notFound } from '@/lib/errors';
import { allow, need } from '@/services/common';
import { assertWorkspaceAccess, assertWorkspaceManager } from '@/services/programme-workspaces';

const pp = schema.programmeParticipantPeople;
const person = schema.participants;
const enrolment = schema.programmeParticipants;

async function loadEnrolment(ctx: Ctx, programmeParticipantId: string) {
  const [row] = await ctx.db.select().from(enrolment).where(eq(enrolment.id, programmeParticipantId)).limit(1);
  if (!row) throw notFound('Programme participant (enrolment) not found');
  return row;
}

export async function listPeople(ctx: Ctx, programmeParticipantId: string) {
  allow(ctx, 'programme_workspaces', 'read');
  const row = await loadEnrolment(ctx, programmeParticipantId);
  await assertWorkspaceAccess(ctx, row.workspaceId);
  return ctx.db.select({
    id: pp.id, role: pp.role, isPrimary: pp.isPrimary, createdAt: pp.createdAt,
    participantId: person.id, fullName: person.fullName, phone: person.phone, email: person.email
  }).from(pp).innerJoin(person, eq(person.id, pp.participantId)).where(eq(pp.programmeParticipantId, programmeParticipantId)).orderBy(pp.createdAt);
}

/** Adds a person to this enrolment. `participantId` reuses an existing person (the same owner
 *  across a second enterprise, say); otherwise a new person is created from `fullName`/`phone`/`email`.
 *  No fuzzy matching is attempted here -- that is the separate, larger duplicate-detection
 *  problem (GAP 01's enterprise merge workflow is the precedent for how that gets built, once
 *  there is real usage data to design matching rules against), so the caller is responsible for
 *  picking an existing participantId when they know one. */
export async function addPerson(ctx: Ctx, programmeParticipantId: string, input: { participantId?: string; fullName?: string; phone?: string | null; email?: string | null; role?: string; isPrimary?: boolean }) {
  allow(ctx, 'programme_workspaces', 'edit');
  const row = await loadEnrolment(ctx, programmeParticipantId);
  await assertWorkspaceManager(ctx, row.workspaceId);

  let participantId = input.participantId;
  if (!participantId) {
    if (!input.fullName?.trim()) throw fieldError({ fullName: 'Give the person’s name, or pick an existing participant' });
    const [created] = await ctx.db.insert(person).values({
      fullName: input.fullName.trim(), phone: input.phone?.trim() || null, email: input.email?.trim()?.toLowerCase() || null, createdBy: need(ctx).user.id
    }).returning({ id: person.id });
    participantId = created.id;
  } else {
    const [existing] = await ctx.db.select({ id: person.id }).from(person).where(eq(person.id, participantId)).limit(1);
    if (!existing) throw notFound('Participant not found');
  }

  const [existingLink] = await ctx.db.select({ id: pp.id }).from(pp).where(and(eq(pp.programmeParticipantId, programmeParticipantId), eq(pp.participantId, participantId))).limit(1);
  if (existingLink) throw fieldError({ participantId: 'This person is already linked to this enrolment' });

  const [{ n: existingCount }] = await ctx.db.select({ n: count() }).from(pp).where(eq(pp.programmeParticipantId, programmeParticipantId));
  const isPrimary = input.isPrimary ?? Number(existingCount) === 0;
  if (isPrimary) await ctx.db.update(pp).set({ isPrimary: false }).where(eq(pp.programmeParticipantId, programmeParticipantId));

  const [link] = await ctx.db.insert(pp).values({
    programmeParticipantId, participantId, role: input.role ?? 'OWNER', isPrimary
  }).returning();
  await audit(ctx, 'programme_participant.person_added', 'programme_participant', programmeParticipantId, undefined, { participantId, role: link.role, isPrimary });
  return link;
}

export async function removePerson(ctx: Ctx, programmeParticipantId: string, linkId: string) {
  allow(ctx, 'programme_workspaces', 'edit');
  const row = await loadEnrolment(ctx, programmeParticipantId);
  await assertWorkspaceManager(ctx, row.workspaceId);
  const [link] = await ctx.db.select().from(pp).where(and(eq(pp.id, linkId), eq(pp.programmeParticipantId, programmeParticipantId))).limit(1);
  if (!link) throw notFound('This person is not linked to this enrolment');
  await ctx.db.delete(pp).where(eq(pp.id, linkId));
  await audit(ctx, 'programme_participant.person_removed', 'programme_participant', programmeParticipantId, { participantId: link.participantId, role: link.role });
  return { ok: true };
}
