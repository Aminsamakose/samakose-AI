import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { ApiError, conflict, fieldError, notFound, unprocessable } from '@/lib/errors';
import { randomToken, sha256 } from '@/lib/crypto';
import { destroyUserSessions } from '@/lib/session';
import { env } from '@/lib/env';
import { queueTemplate } from '@/domain/notify';
import { ROLE_LABEL, STAFF_ROLES } from '@/lib/rbac';
import { ROLES, type Role } from '@/db/schema';
import { orderBy, search, type ListQuery, countOf } from '@/api/list';
import { allow, need, respondList } from './common';
import { isWithdrawnInvitee, withdrawInviteLinks } from './invites';

const u = schema.users;
const safe = { id: u.id, code: u.code, email: u.email, name: u.name, role: u.role, orgId: u.orgId, active: u.active, mfaEnabled: u.mfaEnabled, lockedUntil: u.lockedUntil, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, approvalStatus: u.approvalStatus, emailVerified: u.emailVerified, signupOrgName: u.signupOrgName, signupNote: u.signupNote, invited: sql<boolean>`${u.passwordHash} is null` };

export async function listUsers(ctx: Ctx, q: ListQuery & { role?: string; active?: string; approval?: string }) {
  allow(ctx, 'users', 'read');
  const c = need(ctx);
  const where = and(
    search(q.q, [u.name, u.email, u.code]),
    q.role && (ROLES as readonly string[]).includes(q.role) ? eq(u.role, q.role as Role) : undefined,
    q.approval === 'pending' ? and(eq(u.approvalStatus, 'pending'), eq(u.emailVerified, true)) : undefined,
    q.active === 'true' ? eq(u.active, true) : q.active === 'false' ? eq(u.active, false) : undefined,
    // Only administrators see clients and funders. Other staff see staff (to assign work).
    c.user.role === 'ADMIN' ? undefined : inArray(u.role, STAFF_ROLES)
  );
  const sortable = { name: u.name, email: u.email, role: u.role, created: u.createdAt, lastLogin: u.lastLoginAt };
  return respondList(ctx, 'users', q,
    (limit, off) => ctx.db.select(safe).from(u).where(where).orderBy(orderBy(q, sortable, u.name)).limit(limit).offset(off),
    async () => Number((await ctx.db.select({ n: countOf }).from(u).where(where))[0].n),
    { filename: 'users.csv', columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role' }, { key: 'active', label: 'Active' }, { key: 'lastLoginAt', label: 'Last sign-in' }] });
}

export async function getUser(ctx: Ctx, id: string) {
  allow(ctx, 'users', 'read');
  const [row] = await ctx.db.select(safe).from(u).where(eq(u.id, id)).limit(1);
  if (!row) throw notFound('User not found');
  if (need(ctx).user.role !== 'ADMIN' && !STAFF_ROLES.includes(row.role)) throw notFound('User not found');
  const progs = await ctx.db.select({ id: schema.programmes.id, code: schema.programmes.code, name: schema.programmes.name }).from(schema.userProgrammes)
    .innerJoin(schema.programmes, eq(schema.programmes.id, schema.userProgrammes.programmeId)).where(eq(schema.userProgrammes.userId, id));
  return { ...row, roleLabel: ROLE_LABEL[row.role], programmes: progs };
}

async function issueInvite(ctx: Ctx, userId: string, email: string, name: string) {
  const token = randomToken(32);
  await ctx.db.insert(schema.userTokens).values({ userId, kind: 'invite', tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86400_000) });
  await queueTemplate(ctx, email, 'invite', { user_name: name, link: `${env.appUrl}/accept-invite?token=${token}` });
}

export async function inviteUser(ctx: Ctx, b: { email: string; name: string; role: Role; orgId?: string | null; programmeIds?: string[] }) {
  allow(ctx, 'users', 'create');
  const email = b.email.trim().toLowerCase();
  if (b.role === 'OWNER' && !b.orgId) throw fieldError({ orgId: 'Business owners must belong to an organisation' });
  if (b.role !== 'OWNER' && b.orgId) throw fieldError({ orgId: 'Only business owners belong to an organisation' });
  if (b.orgId) { const [o] = await ctx.db.select({ id: schema.organisations.id }).from(schema.organisations).where(eq(schema.organisations.id, b.orgId)).limit(1); if (!o) throw fieldError({ orgId: 'Organisation not found' }); }
  const [dupe] = await ctx.db.select().from(u).where(sql`lower(${u.email}) = ${email}`).limit(1);
  if (dupe && !isWithdrawnInvitee(dupe)) throw fieldError({ email: 'A user with this email already exists' });
  let row: { id: string; code: string };
  if (dupe) {
    // Inviting again after a withdrawn invitation reuses the same record, so the history stays in one place.
    [row] = await ctx.db.update(u).set({ name: b.name.trim(), role: b.role, orgId: b.orgId ?? null, active: true, mustChangePassword: false, updatedAt: new Date() }).where(eq(u.id, dupe.id)).returning({ id: u.id, code: u.code });
    await ctx.db.delete(schema.userProgrammes).where(eq(schema.userProgrammes.userId, row.id));
  } else {
    [row] = await ctx.db.insert(u).values({ email, name: b.name.trim(), role: b.role, orgId: b.orgId ?? null, mustChangePassword: false }).returning({ id: u.id, code: u.code });
  }
  if (b.programmeIds?.length) await setProgrammesRaw(ctx, row.id, b.programmeIds);
  await issueInvite(ctx, row.id, email, b.name.trim());
  await audit(ctx, dupe ? 'user.invite_reissued' : 'user.invited', 'user', row.id, undefined, { email, role: b.role, orgId: b.orgId ?? null });
  return { id: row.id, code: row.code };
}

export async function resendInvite(ctx: Ctx, id: string) {
  allow(ctx, 'users', 'edit');
  const [row] = await ctx.db.select().from(u).where(eq(u.id, id)).limit(1);
  if (!row) throw notFound('User not found');
  if (row.passwordHash) throw unprocessable('This user has already set a password');
  await issueInvite(ctx, row.id, row.email, row.name);
  await audit(ctx, 'user.invite_resent', 'user', id);
  return { ok: true };
}

/** Unsend: the links in any invitation already sent stop working and the pending account is closed. Only for someone who has not set a password yet; anyone else is deactivated from their profile. */
export async function cancelInvite(ctx: Ctx, id: string) {
  allow(ctx, 'users', 'edit');
  const [row] = await ctx.db.select().from(u).where(eq(u.id, id)).for('update').limit(1);
  if (!row) throw notFound('User not found');
  if (row.passwordHash) throw unprocessable('This person has already accepted. Deactivate the account instead.');
  if (!row.active) throw unprocessable('This invitation is already cancelled');
  await withdrawInviteLinks(ctx.db, row.id);
  await ctx.db.update(u).set({ active: false, updatedAt: new Date() }).where(eq(u.id, row.id));
  await destroyUserSessions(row.id);
  await audit(ctx, 'user.invite_cancelled', 'user', row.id, undefined, { email: row.email, role: row.role });
  return { ok: true };
}

/** Delete a cancelled invitation for good. Only someone who never set a password, whose invitation was cancelled first, and who has no records of their own. The audit trail keeps the fact that it happened. */
export async function deleteInvitee(ctx: Ctx, id: string) {
  allow(ctx, 'users', 'delete');
  const c = need(ctx);
  const [row] = await ctx.db.select().from(u).where(eq(u.id, id)).for('update').limit(1);
  if (!row) throw notFound('User not found');
  if (row.id === c.user.id) throw conflict('You cannot delete yourself');
  if (row.passwordHash) throw unprocessable('This person has an account. Deactivate it instead; deleting would erase their history.');
  if (row.active) throw unprocessable('Cancel the invitation first, then delete it');
  try {
    await ctx.db.transaction(async (tx) => {
      const mems = await tx.select({ id: schema.orgMembers.id }).from(schema.orgMembers).where(eq(schema.orgMembers.userId, row.id));
      if (mems.length) await tx.delete(schema.areaAssignments).where(inArray(schema.areaAssignments.memberId, mems.map((m) => m.id)));
      await tx.delete(schema.orgMembers).where(eq(schema.orgMembers.userId, row.id));
      await tx.delete(u).where(eq(u.id, row.id)); // sessions, tokens, programmes and notifications go with the record
    });
  } catch (e: any) {
    if ((e?.cause?.code ?? e?.code) === '23503') throw conflict('This record is linked to other work and cannot be deleted. It stays deactivated instead.');
    throw e;
  }
  await audit(ctx, 'user.invite_deleted', 'user', row.id, undefined, { email: row.email, role: row.role });
  return { ok: true };
}

async function activeAdmins(ctx: Ctx) {
  return Number(((await ctx.db.select({ n: countOf }).from(u).where(and(eq(u.role, 'ADMIN'), eq(u.active, true))))[0]).n);
}

export async function updateUser(ctx: Ctx, id: string, b: { name?: string; role?: Role; active?: boolean; orgId?: string | null }) {
  allow(ctx, 'users', 'edit');
  const c = need(ctx);
  const [row] = await ctx.db.select().from(u).where(eq(u.id, id)).for('update').limit(1);
  if (!row) throw notFound('User not found');
  const role = b.role ?? row.role;
  const orgId = b.orgId === undefined ? row.orgId : b.orgId;
  if (id === c.user.id && (b.role && b.role !== row.role)) throw conflict('You cannot change your own role');
  if (id === c.user.id && b.active === false) throw conflict('You cannot deactivate yourself');
  if (role === 'OWNER' && !orgId) throw fieldError({ orgId: 'Business owners must belong to an organisation' });
  if (role !== 'OWNER' && orgId) throw fieldError({ orgId: 'Only business owners belong to an organisation' });
  const losesAdmin = row.role === 'ADMIN' && row.active && (role !== 'ADMIN' || b.active === false);
  if (losesAdmin && (await activeAdmins(ctx)) <= 1) throw conflict('At least one active administrator is required');
  const patch: Partial<typeof u.$inferInsert> = { updatedAt: new Date() };
  if (b.name !== undefined) patch.name = b.name.trim();
  if (b.role !== undefined) patch.role = b.role;
  if (b.active !== undefined) patch.active = b.active;
  if (b.orgId !== undefined) patch.orgId = b.orgId;
  await ctx.db.update(u).set(patch).where(eq(u.id, id));
  if (b.role !== undefined && b.role !== row.role || b.active === false) await destroyUserSessions(id);
  await audit(ctx, b.role && b.role !== row.role ? 'user.role_changed' : b.active === false ? 'user.deactivated' : b.active === true && !row.active ? 'user.reactivated' : 'user.updated',
    'user', id, { name: row.name, role: row.role, active: row.active, orgId: row.orgId }, { name: patch.name ?? row.name, role, active: patch.active ?? row.active, orgId });
  return { ok: true };
}

export async function unlockUser(ctx: Ctx, id: string) {
  allow(ctx, 'users', 'edit');
  const r = await ctx.db.update(u).set({ failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(u.id, id)).returning({ id: u.id });
  if (!r.length) throw notFound('User not found');
  await audit(ctx, 'user.unlocked', 'user', id);
  return { ok: true };
}
export async function resetUserMfa(ctx: Ctx, id: string) {
  allow(ctx, 'users', 'edit');
  const r = await ctx.db.update(u).set({ mfaEnabled: false, mfaSecret: null, mfaRecovery: [], updatedAt: new Date() }).where(eq(u.id, id)).returning({ id: u.id });
  if (!r.length) throw notFound('User not found');
  await destroyUserSessions(id);
  await audit(ctx, 'user.mfa_reset', 'user', id);
  return { ok: true };
}

async function setProgrammesRaw(ctx: Ctx, userId: string, ids: string[]) {
  const uniq = [...new Set(ids)];
  if (uniq.length) {
    const found = await ctx.db.select({ id: schema.programmes.id }).from(schema.programmes).where(inArray(schema.programmes.id, uniq));
    if (found.length !== uniq.length) throw fieldError({ programmeIds: 'One or more programmes do not exist' });
  }
  await ctx.db.delete(schema.userProgrammes).where(eq(schema.userProgrammes.userId, userId));
  if (uniq.length) await ctx.db.insert(schema.userProgrammes).values(uniq.map((programmeId) => ({ userId, programmeId })));
}
export async function setUserProgrammes(ctx: Ctx, id: string, ids: string[]) {
  allow(ctx, 'users', 'edit');
  const [row] = await ctx.db.select().from(u).where(eq(u.id, id)).limit(1);
  if (!row) throw notFound('User not found');
  if (!['PROGRAMME_MANAGER', 'FUNDER', 'EXPERT'].includes(row.role)) throw unprocessable('Only programme managers, funders and experts are assigned to programmes');
  await setProgrammesRaw(ctx, id, ids);
  await audit(ctx, 'user.programmes_set', 'user', id, undefined, { programmeIds: ids });
  return { ok: true };
}

/** People who can be assigned to work on cases. */
export async function assignable(ctx: Ctx) {
  allow(ctx, 'users', 'read');
  return ctx.db.select({ id: u.id, name: u.name, role: u.role }).from(u).where(and(eq(u.active, true), inArray(u.role, ['EXPERT', 'REVIEWER']))).orderBy(u.name);
}
export { ApiError };

/* ---------------- approvals of self-registered users ---------------- */
async function pendingUser(ctx: Ctx, id: string) {
  const [row] = await ctx.db.select().from(u).where(eq(u.id, id)).limit(1);
  if (!row) throw notFound('User not found');
  if (row.approvalStatus !== 'pending') throw unprocessable('This registration has already been decided');
  if (!row.emailVerified) throw unprocessable('This person has not confirmed their email yet');
  return row;
}
export async function approveRegistration(ctx: Ctx, id: string, b: { role?: Role; orgId?: string | null }) {
  allow(ctx, 'users', 'edit');
  if (need(ctx).user.role !== 'ADMIN') throw new ApiError(403, 'forbidden', 'Only administrators approve registrations');
  const row = await pendingUser(ctx, id);
  const role = b.role ?? row.role;
  if (role === 'ADMIN' || role === 'EXECUTIVE') throw fieldError({ role: 'Administrator and executive accounts are invite-only' });
  const orgId = role === 'OWNER' ? (row.orgId ?? b.orgId ?? null) : null;
  if (role === 'OWNER' && !orgId) throw fieldError({ orgId: 'Link a business owner to an organisation first' });
  await ctx.db.update(u).set({ approvalStatus: 'approved', role, orgId, updatedAt: new Date() }).where(eq(u.id, id));
  if (role === 'OWNER' && orgId) await ctx.db.update(schema.organisations).set({ status: 'Active', updatedAt: new Date() }).where(and(eq(schema.organisations.id, orgId), eq(schema.organisations.status, 'Pending verification')));
  await audit(ctx, 'user.registration_approved', 'user', id, { role: row.role }, { role, orgId });
  await queueTemplate(ctx, row.email, 'registration_approved', { user_name: row.name, link: `${env.appUrl}/login` });
  return { ok: true };
}
export async function rejectRegistration(ctx: Ctx, id: string, reason?: string) {
  allow(ctx, 'users', 'edit');
  if (need(ctx).user.role !== 'ADMIN') throw new ApiError(403, 'forbidden', 'Only administrators decide registrations');
  const row = await pendingUser(ctx, id);
  await ctx.db.update(u).set({ approvalStatus: 'rejected', active: false, updatedAt: new Date() }).where(eq(u.id, id));
  await destroyUserSessions(id);
  await audit(ctx, 'user.registration_rejected', 'user', id, undefined, { reason: reason?.slice(0, 300) ?? null });
  return { ok: true };
}
