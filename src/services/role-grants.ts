/**
 * Additional roles: a person's own users.role always stands and never needs a grant. This is
 * only for someone authorised to ALSO act as a different role -- a consultant who is also a
 * trained Reviewer, say -- and who switches between them one session at a time, never both
 * at once. Granting one is kept separate from approving the account itself: an administrator
 * decides each request on its own evidence, the same way evidence or document approval works
 * elsewhere, not folded into account approval.
 */
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import type { Role } from '@/db/schema';
import { audit } from '@/lib/audit';
import { conflict, fieldError, forbidden, notFound } from '@/lib/errors';
import { setActiveRole } from '@/lib/session';
import { allow, need } from './common';

const g = schema.roleGrants;

/** The roles this session's own person may currently act as: their primary role plus every approved grant. */
export async function myRoles(ctx: Ctx) {
  const u = need(ctx).user;
  const rows = await ctx.db.select({ role: g.role }).from(g).where(and(eq(g.userId, u.id), eq(g.status, 'approved')));
  return { primaryRole: u.primaryRole, activeRole: u.role, additionalRoles: rows.map((r) => r.role) };
}

/** Ask an administrator to authorise this person to also act as `role`. Their own primary role needs no request. */
export async function requestRole(ctx: Ctx, role: Role, note?: string) {
  const u = need(ctx).user;
  if (role === u.primaryRole) throw fieldError({ role: 'This is already your primary role' });
  const [existing] = await ctx.db.select().from(g).where(and(eq(g.userId, u.id), eq(g.role, role))).limit(1);
  if (existing?.status === 'approved') throw conflict('You already hold this role');
  if (existing?.status === 'pending') throw conflict('A request for this role is already pending');
  if (existing) { // previously rejected: let them ask again, fresh
    await ctx.db.update(g).set({ status: 'pending', note: note ?? null, decidedBy: null, decidedAt: null, updatedAt: new Date() }).where(eq(g.id, existing.id));
    await audit(ctx, 'role_grant.requested', 'user', u.id, undefined, { role });
    return { id: existing.id, status: 'pending' as const };
  }
  const [row] = await ctx.db.insert(g).values({ userId: u.id, role, note: note ?? null }).returning({ id: g.id });
  await audit(ctx, 'role_grant.requested', 'user', u.id, undefined, { role });
  return { id: row.id, status: 'pending' as const };
}

/** Pending requests, newest first. An administrator's own queue -- same bar as evidence verification: look at it, decide. */
export async function listPendingRoleGrants(ctx: Ctx) {
  allow(ctx, 'users', 'edit');
  return ctx.db.select({ id: g.id, userId: g.userId, userName: schema.users.name, userEmail: schema.users.email, primaryRole: schema.users.role, role: g.role, note: g.note, createdAt: g.createdAt })
    .from(g).innerJoin(schema.users, eq(schema.users.id, g.userId)).where(eq(g.status, 'pending')).orderBy(desc(g.createdAt));
}

export async function decideRoleGrant(ctx: Ctx, id: string, approve: boolean) {
  allow(ctx, 'users', 'edit');
  const admin = need(ctx).user;
  const [row] = await ctx.db.select().from(g).where(eq(g.id, id)).limit(1);
  if (!row) throw notFound('Request not found');
  if (row.status !== 'pending') throw conflict('This request was already decided');
  // Four-eyes: an administrator may not decide their own additional-role request. Without this,
  // anyone holding users:edit could request a role for themselves (POST /me/roles/request) and
  // immediately approve it (POST /role-grants/:id/approve), self-granting an elevated role with
  // no independent review -- the same self-approval gap approveDiscountRule() already guards
  // against for discount rules.
  if (row.userId === admin.id) throw forbidden('You cannot decide your own additional-role request');
  await ctx.db.update(g).set({ status: approve ? 'approved' : 'rejected', decidedBy: admin.id, decidedAt: new Date(), updatedAt: new Date() }).where(eq(g.id, id));
  await audit(ctx, approve ? 'role_grant.approved' : 'role_grant.rejected', 'user', row.userId, undefined, { role: row.role });
  return { ok: true };
}

/** Switch this session to act as `role`, or pass null to switch back to the person's own primary role. */
export async function switchRole(ctx: Ctx, role: Role | null) {
  const u = need(ctx).user;
  if (role !== null && role !== u.primaryRole) {
    const [grant] = await ctx.db.select().from(g).where(and(eq(g.userId, u.id), eq(g.role, role), eq(g.status, 'approved'))).limit(1);
    if (!grant) throw forbidden('You are not authorised to act as this role');
  }
  await setActiveRole(u.sessionId, role === u.primaryRole ? null : role);
  await audit(ctx, 'role_grant.switched', 'user', u.id, undefined, { to: role ?? u.primaryRole });
  return { role: role ?? u.primaryRole };
}
