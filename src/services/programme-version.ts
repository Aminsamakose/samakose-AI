import { and, desc, eq, max, ne } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertProgramme } from '@/domain/scope';
import { allow, lockCapacityScope, need } from './common';
import { assertProgrammeVersionTransition, validateProgrammeVersionForSubmission, type ProgrammeVersionInput } from '@/domain/programme-version';
import type { ProgrammeVersionStatus } from '@/db/programme-version-schema';

const v = schema.programmeVersions, p = schema.programmes;

async function getVersion(ctx: Ctx, programmeId: string, version?: number) {
  const query = ctx.db.select().from(v).where(
    version === undefined ? eq(v.programmeId, programmeId) : and(eq(v.programmeId, programmeId), eq(v.version, version)),
  ).orderBy(desc(v.version)).limit(1);
  const [row] = await query;
  if (!row) throw notFound('Programme version not found');
  return row;
}

/** Budget and funder commitments are an organisation-leadership decision, not a workspace
 *  reviewer's -- unlike workspace configuration, there is no programme-scoped REVIEWER membership
 *  to delegate to, so approval stays with ADMIN/EXECUTIVE only. */
function assertApprover(ctx: Ctx) {
  const user = need(ctx).user;
  if (!['ADMIN', 'EXECUTIVE'].includes(user.role)) throw forbidden('Only an administrator or executive can approve a programme version');
}

export async function listVersions(ctx: Ctx, programmeId: string) {
  allow(ctx, 'programmes', 'read');
  await assertProgramme(ctx, programmeId);
  return ctx.db.select().from(v).where(eq(v.programmeId, programmeId)).orderBy(desc(v.version));
}

export async function getCurrentVersion(ctx: Ctx, programmeId: string) {
  allow(ctx, 'programmes', 'read');
  await assertProgramme(ctx, programmeId);
  const [current] = await ctx.db.select().from(v).where(and(eq(v.programmeId, programmeId), eq(v.status, 'APPROVED'))).orderBy(desc(v.version)).limit(1);
  return { programmeId, version: current ?? null, governanceStatus: current?.status ?? 'UNVERSIONED' };
}

export async function createVersionDraft(ctx: Ctx, programmeId: string, input: ProgrammeVersionInput) {
  allow(ctx, 'programmes', 'edit');
  const programme = await assertProgramme(ctx, programmeId);
  if (['Completed', 'Cancelled'].includes(programme.status)) throw unprocessable('A closed programme cannot take a new version draft');
  const [latestVersionRow] = await ctx.db.select({ latest: max(v.version) }).from(v).where(eq(v.programmeId, programmeId));
  const version = Number(latestVersionRow?.latest ?? 0) + 1;
  const [draft] = await ctx.db.insert(v).values({
    programmeId, version, status: 'DRAFT',
    name: input.name ?? programme.name, funder: input.funder !== undefined ? input.funder : programme.funder,
    startDate: input.startDate !== undefined ? input.startDate : programme.startDate,
    endDate: input.endDate !== undefined ? input.endDate : programme.endDate,
    budgetGhs: input.budgetGhs !== undefined ? (input.budgetGhs != null ? String(input.budgetGhs) : null) : programme.budgetGhs,
    changeReason: input.changeReason ?? null, createdBy: need(ctx).user.id,
  }).returning();
  await audit(ctx, 'programme.version_draft_created', 'programme_version', draft.id, undefined, { programmeId, version });
  return draft;
}

export async function submitVersion(ctx: Ctx, programmeId: string, version: number) {
  allow(ctx, 'programmes', 'edit');
  await assertProgramme(ctx, programmeId);
  const draft = await getVersion(ctx, programmeId, version);
  assertProgrammeVersionTransition(draft.status as ProgrammeVersionStatus, 'SUBMITTED');
  const errors = validateProgrammeVersionForSubmission({ name: draft.name, funder: draft.funder, startDate: draft.startDate, endDate: draft.endDate, budgetGhs: draft.budgetGhs != null ? Number(draft.budgetGhs) : null });
  if (errors.length) throw unprocessable(`Version is not ready for approval: ${errors.join('; ')}`);
  const [row] = await ctx.db.update(v).set({ status: 'SUBMITTED', rejectionReason: null, updatedAt: new Date() }).where(eq(v.id, draft.id)).returning();
  await audit(ctx, 'programme.version_submitted', 'programme_version', draft.id, draft, row);
  return row;
}

/**
 * On approval, this becomes the programme's live definition: writes name/funder/dates/budget back
 * onto the programmes row, exactly as programme-workspace-configuration.approveConfiguration writes
 * back onto the workspace. Known limitation (left for a follow-up, not silently expanded beyond this
 * build's scope): approving a lower budget here does not re-check it against already-allocated
 * budget lines the way addLine's own ceiling check does going forward -- a programme with budget
 * lines close to its current ceiling could end up over-allocated relative to a newly approved,
 * smaller budget until someone notices on the next budget-lines read.
 */
export async function approveVersion(ctx: Ctx, programmeId: string, version: number) {
  assertApprover(ctx);
  await assertProgramme(ctx, programmeId);
  // Two submitted versions of the same programme could otherwise both be read as SUBMITTED and
  // both approved concurrently, leaving two APPROVED rows (the same check-then-act race
  // lockCapacityScope closes elsewhere -- see cohort-capacity-race.test.ts). Serialize approval
  // per programme before re-reading the draft's status.
  await lockCapacityScope(ctx, `programme-version-approval:${programmeId}`);
  const draft = await getVersion(ctx, programmeId, version);
  assertProgrammeVersionTransition(draft.status as ProgrammeVersionStatus, 'APPROVED');
  // Four-eyes: an ADMIN holds both programmes:edit (to draft a version) and the approver role
  // checked above, so without this, the same person could draft a programme version and approve
  // their own change to budget/funder/dates.
  if (draft.createdBy === need(ctx).user.id) throw forbidden('You cannot approve a programme version you drafted yourself');
  const approvedAt = new Date();
  const [row] = await ctx.db.update(v).set({ status: 'APPROVED', approvedBy: need(ctx).user.id, approvedAt, rejectionReason: null, updatedAt: approvedAt }).where(eq(v.id, draft.id)).returning();
  await ctx.db.update(v).set({ status: 'SUPERSEDED', updatedAt: approvedAt }).where(and(eq(v.programmeId, programmeId), eq(v.status, 'APPROVED'), ne(v.id, row.id)));
  await ctx.db.update(p).set({ name: row.name, funder: row.funder, startDate: row.startDate, endDate: row.endDate, budgetGhs: row.budgetGhs, updatedAt: approvedAt }).where(eq(p.id, programmeId));
  await audit(ctx, 'programme.version_approved', 'programme_version', row.id, draft, row);
  return row;
}

export async function rejectVersion(ctx: Ctx, programmeId: string, version: number, reason: string) {
  assertApprover(ctx);
  await assertProgramme(ctx, programmeId);
  if (!reason.trim()) throw unprocessable('A rejection reason is required');
  const draft = await getVersion(ctx, programmeId, version);
  assertProgrammeVersionTransition(draft.status as ProgrammeVersionStatus, 'REJECTED');
  const [row] = await ctx.db.update(v).set({ status: 'REJECTED', rejectionReason: reason.trim(), updatedAt: new Date() }).where(eq(v.id, draft.id)).returning();
  await audit(ctx, 'programme.version_rejected', 'programme_version', row.id, draft, row);
  return row;
}

export async function reviseRejectedVersion(ctx: Ctx, programmeId: string, version: number, changeReason?: string) {
  allow(ctx, 'programmes', 'edit');
  await assertProgramme(ctx, programmeId);
  const rejected = await getVersion(ctx, programmeId, version);
  assertProgrammeVersionTransition(rejected.status as ProgrammeVersionStatus, 'DRAFT');
  return createVersionDraft(ctx, programmeId, {
    name: rejected.name, funder: rejected.funder, startDate: rejected.startDate, endDate: rejected.endDate,
    budgetGhs: rejected.budgetGhs != null ? Number(rejected.budgetGhs) : null, changeReason: changeReason ?? rejected.rejectionReason,
  });
}
