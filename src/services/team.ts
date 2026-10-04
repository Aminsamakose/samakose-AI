import { and, eq, ne, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, notFound, unprocessable } from '@/lib/errors';
import { randomToken, sha256 } from '@/lib/crypto';
import { destroyUserSessions } from '@/lib/session';
import { env } from '@/lib/env';
import { queueTemplate } from '@/domain/notify';
import { defaultRespondent, isKnownRole, OTHER_ROLE, platformForOrgType } from '@/domain/routing';
import { allow, need } from './common';
import { loadMapping } from './registration-config';
import { resolveVersion } from './frameworks';
import { isWithdrawnInvitee, withdrawInviteLinks } from './invites';

/** The owner's team. A colleague has an account of their own so that their consent and their answers are theirs. Job role is never permission:
 *  what a respondent can see comes only from the areas the owner assigns. */
const INVITE_DAYS = 7;

async function orgOf(ctx: Ctx) {
  const c = need(ctx);
  if (c.user.role !== 'OWNER' || !c.user.orgId) throw unprocessable('Only a business owner can manage a team');
  const [o] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, c.user.orgId)).limit(1);
  return o;
}
async function ownerRole(ctx: Ctx, userId: string) {
  const [a] = await ctx.db.select({ r: schema.registrationAnswers.jobRole }).from(schema.registrationAnswers).where(eq(schema.registrationAnswers.userId, userId)).limit(1);
  return a?.r ?? 'OWNER';
}
async function inviteNotice(ctx: Ctx, country: string) {
  const [n] = await ctx.db.select().from(schema.consentNotices).where(and(eq(schema.consentNotices.purpose, 'team_invites'), eq(schema.consentNotices.countryCode, country), eq(schema.consentNotices.status, 'Published'))).limit(1);
  return n ?? null;
}

export async function listTeam(ctx: Ctx) {
  allow(ctx, 'team', 'read');
  const o = await orgOf(ctx); const c = need(ctx);
  const platform = platformForOrgType(o.type as any); const m = await loadMapping(ctx.db);
  const notice = await inviteNotice(ctx, o.countryCode);
  const members = await ctx.db.select({ id: schema.orgMembers.id, userId: schema.orgMembers.userId, jobRole: schema.orgMembers.jobRole, status: schema.orgMembers.status, name: schema.users.name, email: schema.users.email })
    .from(schema.orgMembers).innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId)).where(and(eq(schema.orgMembers.orgId, o.id), ne(schema.orgMembers.status, 'removed'))).orderBy(schema.users.name);
  return {
    platform, roles: m.roles[platform] ?? {}, other: OTHER_ROLE,
    notice: notice ? { id: notice.id, version: notice.version, text: notice.text } : null,
    me: { name: c.user.name, jobRole: await ownerRole(ctx, c.user.id) },
    members
  };
}

export async function inviteMember(ctx: Ctx, b: { name: string; email: string; jobRole: string; agree: boolean }) {
  allow(ctx, 'team', 'create');
  const o = await orgOf(ctx); const c = need(ctx);
  const platform = platformForOrgType(o.type as any); const m = await loadMapping(ctx.db);
  const name = b.name.trim(); const email = b.email.trim().toLowerCase();
  const errs: Record<string, string> = {};
  if (name.length < 2) errs.name = 'Enter their name';
  if (!isKnownRole(m, platform, b.jobRole)) errs.jobRole = 'Choose their role from the list';
  if (Object.keys(errs).length) throw fieldError(errs);
  // Consent comes first: the owner confirms they have told this person, against the exact wording on screen.
  const notice = await inviteNotice(ctx, o.countryCode);
  if (!notice) throw unprocessable('Team invitations are not open yet.');
  if (!b.agree) throw fieldError({ agree: 'Please confirm you have told them, so we can send the invitation' });
  const [dupe] = await ctx.db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`).limit(1);
  // A colleague whose invitation this business withdrew can be invited again; anyone else with that email already has an account.
  const again = dupe && isWithdrawnInvitee(dupe) && dupe.role === 'RESPONDENT' && dupe.orgId === o.id;
  if (dupe && !again) throw fieldError({ email: 'Someone with this email already has an account' });
  let u: { id: string }; let mem: { id: string };
  if (again) {
    u = dupe;
    await ctx.db.update(schema.users).set({ name, active: true, updatedAt: new Date() }).where(eq(schema.users.id, dupe.id));
    [mem] = await ctx.db.update(schema.orgMembers).set({ jobRole: b.jobRole, status: 'invited', invitedBy: c.user.id, updatedAt: new Date() }).where(and(eq(schema.orgMembers.orgId, o.id), eq(schema.orgMembers.userId, dupe.id))).returning({ id: schema.orgMembers.id });
  } else {
    [u] = await ctx.db.insert(schema.users).values({ email, name, role: 'RESPONDENT', orgId: o.id, mustChangePassword: false }).returning({ id: schema.users.id });
    [mem] = await ctx.db.insert(schema.orgMembers).values({ orgId: o.id, userId: u.id, jobRole: b.jobRole, status: 'invited', invitedBy: c.user.id }).returning({ id: schema.orgMembers.id });
  }
  await ctx.db.insert(schema.consents).values({ userId: c.user.id, orgId: o.id, noticeId: notice.id, action: 'granted', source: 'invitation' });
  const token = randomToken(32);
  await ctx.db.insert(schema.userTokens).values({ userId: u.id, kind: 'invite', tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) });
  await queueTemplate(ctx, email, 'team_invite', { user_name: name, inviter_name: c.user.name, business_name: o.name, link: `${env.appUrl}/accept-invite?token=${token}` });
  await audit(ctx, 'team.invited', 'user', u.id, undefined, { orgId: o.id, jobRole: b.jobRole });
  return { id: mem.id };
}

async function memberOf(ctx: Ctx, id: string) {
  const o = await orgOf(ctx);
  const [mem] = await ctx.db.select().from(schema.orgMembers).where(and(eq(schema.orgMembers.id, id), eq(schema.orgMembers.orgId, o.id))).limit(1);
  if (!mem || mem.status === 'removed') throw notFound('Team member not found');
  return { o, mem };
}

export async function resendInvite(ctx: Ctx, id: string) {
  allow(ctx, 'team', 'edit');
  const { o, mem } = await memberOf(ctx, id);
  if (mem.status !== 'invited') throw unprocessable('This person has already activated their account');
  const [u] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, mem.userId)).limit(1);
  const token = randomToken(32);
  await ctx.db.insert(schema.userTokens).values({ userId: u.id, kind: 'invite', tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) });
  await queueTemplate(ctx, u.email, 'team_invite', { user_name: u.name, inviter_name: need(ctx).user.name, business_name: o.name, link: `${env.appUrl}/accept-invite?token=${token}` });
  await audit(ctx, 'team.invite_resent', 'user', u.id);
  return { ok: true };
}

/** Unsend an invitation the colleague has not accepted: the links already sent stop working, the seat is freed and the same person can be invited again later. */
export async function cancelInvite(ctx: Ctx, id: string) {
  allow(ctx, 'team', 'delete');
  const { mem } = await memberOf(ctx, id);
  if (mem.status !== 'invited') throw unprocessable('This person has already activated their account. Remove them instead.');
  await withdrawInviteLinks(ctx.db, mem.userId);
  await ctx.db.update(schema.orgMembers).set({ status: 'removed', updatedAt: new Date() }).where(eq(schema.orgMembers.id, mem.id));
  await ctx.db.update(schema.users).set({ active: false, updatedAt: new Date() }).where(eq(schema.users.id, mem.userId));
  await ctx.db.delete(schema.areaAssignments).where(eq(schema.areaAssignments.memberId, mem.id));
  await audit(ctx, 'team.invite_cancelled', 'user', mem.userId);
  return { ok: true };
}

/** Removing a colleague closes their account and frees their areas. Anything they answered is kept in history. */
export async function removeMember(ctx: Ctx, id: string) {
  allow(ctx, 'team', 'delete');
  const { mem } = await memberOf(ctx, id);
  await ctx.db.update(schema.orgMembers).set({ status: 'removed', updatedAt: new Date() }).where(eq(schema.orgMembers.id, mem.id));
  await ctx.db.update(schema.users).set({ active: false, updatedAt: new Date() }).where(eq(schema.users.id, mem.userId));
  await ctx.db.delete(schema.areaAssignments).where(eq(schema.areaAssignments.memberId, mem.id));
  await destroyUserSessions(mem.userId);
  await audit(ctx, 'team.removed', 'user', mem.userId);
  return { ok: true };
}

/** Area names come from the published framework when it has them; otherwise the code stands in. */
export async function areaNames(ctx: Ctx, orgType: string): Promise<Record<string, { name: string; dimension?: string }>> {
  try {
    const v = await resolveVersion(ctx.db, orgType);
    const out: Record<string, { name: string; dimension?: string }> = {};
    for (const s of v.meta?.subDimensions ?? []) out[s.code] = { name: s.name, dimension: s.dimension };
    return out;
  } catch { return {}; }
}

/** The suggested split of areas, with the owner's confirmed choices on top. A suggestion is only a suggestion until the owner confirms it. */
export async function listAssignments(ctx: Ctx) {
  allow(ctx, 'team', 'read');
  const o = await orgOf(ctx); const c = need(ctx);
  const platform = platformForOrgType(o.type as any); const m = await loadMapping(ctx.db);
  const myRole = await ownerRole(ctx, c.user.id);
  const members = await ctx.db.select({ id: schema.orgMembers.id, jobRole: schema.orgMembers.jobRole, name: schema.users.name }).from(schema.orgMembers).innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId)).where(and(eq(schema.orgMembers.orgId, o.id), ne(schema.orgMembers.status, 'removed')));
  const present = Array.from(new Set([myRole, ...members.map((x) => x.jobRole)].filter((r) => r !== OTHER_ROLE)));
  const stored = await ctx.db.select().from(schema.areaAssignments).where(and(eq(schema.areaAssignments.orgId, o.id), eq(schema.areaAssignments.platform, platform)));
  const names = await areaNames(ctx, o.type);
  const areas = Object.keys(m.map[platform] ?? {}).map((code) => {
    const suggestedRole = defaultRespondent(m, platform, code, present);
    const mem = members.find((x) => x.jobRole === suggestedRole);
    const suggested = suggestedRole === myRole || !mem ? { kind: 'me' as const } : { kind: 'member' as const, memberId: mem.id, name: mem.name };
    const s = stored.find((x) => x.subDimension === code);
    const confirmed = s?.confirmedAt ? (s.memberId ? { kind: 'member' as const, memberId: s.memberId, name: members.find((x) => x.id === s.memberId)?.name ?? '' } : { kind: 'me' as const }) : null;
    return { code, name: names[code]?.name ?? code, dimension: names[code]?.dimension ?? null, suggestedRole, suggested, confirmed };
  });
  return { platform, areas, members: members.map((x) => ({ id: x.id, name: x.name, jobRole: x.jobRole })) };
}

/** Confirms who answers an area: a colleague, or the owner (memberId null). */
export async function assignArea(ctx: Ctx, code: string, memberId: string | null) {
  allow(ctx, 'team', 'edit');
  const o = await orgOf(ctx); const c = need(ctx);
  const platform = platformForOrgType(o.type as any); const m = await loadMapping(ctx.db);
  if (!m.map[platform]?.[code]) throw fieldError({ code: 'Unknown assessment area' });
  if (memberId) await memberOf(ctx, memberId);
  await ctx.db.insert(schema.areaAssignments).values({ orgId: o.id, platform, subDimension: code, memberId, suggestedBy: 'owner', confirmedBy: c.user.id, confirmedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.areaAssignments.orgId, schema.areaAssignments.platform, schema.areaAssignments.subDimension], set: { memberId, suggestedBy: 'owner', confirmedBy: c.user.id, confirmedAt: new Date(), updatedAt: new Date() } });
  await audit(ctx, 'team.area_assigned', 'organisation', o.id, undefined, { area: code, assignedToMember: !!memberId });
  return { ok: true };
}

/** What a respondent sees: only their own confirmed areas, with the business name. Nothing about other areas, scores or anyone else. */
export async function myAreas(ctx: Ctx) {
  const c = need(ctx);
  if (c.user.role !== 'RESPONDENT') return { business: null, areas: [] };
  const [mem] = await ctx.db.select().from(schema.orgMembers).where(and(eq(schema.orgMembers.userId, c.user.id), eq(schema.orgMembers.status, 'active'))).limit(1);
  if (!mem) return { business: null, areas: [] };
  const [o] = await ctx.db.select().from(schema.organisations).where(eq(schema.organisations.id, mem.orgId)).limit(1);
  const rows = await ctx.db.select({ code: schema.areaAssignments.subDimension }).from(schema.areaAssignments).where(and(eq(schema.areaAssignments.memberId, mem.id), sql`${schema.areaAssignments.confirmedAt} is not null`));
  const names = await areaNames(ctx, o.type);
  return { business: o.name, jobRole: mem.jobRole, areas: rows.map((r) => ({ code: r.code, name: names[r.code]?.name ?? r.code })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })) };
}
