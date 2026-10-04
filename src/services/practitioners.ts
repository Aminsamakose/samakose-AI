/**
 * The practitioner network: one profile per expert or coach, vetting, conflicts and capacity.
 * The profile hangs off the user identity. Fees and vetting notes are visible to administrators only.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { notifyUsers } from '@/domain/notify';
import { assertOrg } from '@/domain/scope';
import { canMoveVetting, CONDUCT_TEXT, CONDUCT_VERSION, cleanList, completeness, DELIVERY_MODES, PLATFORM_CODES, SPECIALISATION_SUGGESTIONS, type VettingStatus } from '@/domain/practitioners';
import { allow, need } from './common';
import { photoUrl } from './auth';

const pp = schema.practitionerProfiles;
const u = schema.users;
export type Profile = typeof pp.$inferSelect;
export type ProfileInput = Partial<{
  functions: string[]; headline: string | null; bio: string | null; specialisations: string[]; strengths: string[]; sectors: string[]; platforms: string[]; businessSizes: string[];
  languages: string[]; regions: string[]; deliveryModes: string[]; yearsExperience: number | null; credentials: { type: string; title: string; issuer?: string; year?: number }[];
  maxActive: number; availability: string; rateNote: string | null; acceptConduct: boolean;
}>;

/** Every expert has a profile row. Created on first need, so people invited or registered before this existed are covered. */
export async function ensureProfiles(ctx: Ctx) {
  await ctx.db.execute(sql`insert into practitioner_profiles (user_id) select id from users where role = 'EXPERT' on conflict do nothing`);
}
async function profileRow(ctx: Ctx, userId: string): Promise<{ user: typeof u.$inferSelect; profile: Profile } | null> {
  const [user] = await ctx.db.select().from(u).where(eq(u.id, userId)).limit(1);
  if (!user || user.role !== 'EXPERT') return null;
  await ctx.db.insert(pp).values({ userId }).onConflictDoNothing();
  const [profile] = await ctx.db.select().from(pp).where(eq(pp.userId, userId)).limit(1);
  return { user, profile };
}
const resolveId = (ctx: Ctx, id: string) => (id === 'me' ? need(ctx).user.id : id);
const isAdmin = (ctx: Ctx) => ctx.user?.role === 'ADMIN';

/** Active workload: cases where the person is lead, specialist or coach and the case is not finished. */
export async function loadFor(ctx: Ctx, userIds: string[]): Promise<Record<string, number>> {
  if (!userIds.length) return {};
  const r = await ctx.db.execute(sql`select a.user_id, count(distinct a.case_id)::int n from case_assignments a join cases c on c.id = a.case_id
    where a.status = 'Active' and a.function in ('lead','specialist','coach') and c.status <> 'GRADUATED' and a.user_id in (${sql.join(userIds.map((i) => sql`${i}`), sql`, `)}) group by a.user_id`);
  const out: Record<string, number> = {};
  for (const row of r.rows as { user_id: string; n: number }[]) out[row.user_id] = row.n;
  return out;
}

const shapeProfile = (p: Profile, user: typeof u.$inferSelect, o: { full: boolean }) => {
  const done = completeness(p, !!user.photoKey);
  const base = {
    userId: user.id, name: user.name, photoUrl: photoUrl(user), functions: p.functions, headline: p.headline, bio: p.bio, specialisations: p.specialisations, strengths: p.strengths, sectors: p.sectors,
    platforms: p.platforms, businessSizes: p.businessSizes, languages: p.languages, regions: p.regions, deliveryModes: p.deliveryModes, yearsExperience: p.yearsExperience, credentials: p.credentials,
    availability: p.availability, vettingStatus: p.vettingStatus
  };
  if (!o.full) return base;
  return { ...base, email: user.email, maxActive: p.maxActive, conductAcceptedAt: p.conductAcceptedAt, conductVersion: p.conductVersion, submittedAt: p.submittedAt, decidedAt: p.decidedAt, completeness: done };
};

export async function getProfile(ctx: Ctx, rawId: string) {
  const c = need(ctx); allow(ctx, 'practitioners', 'read');
  const id = resolveId(ctx, rawId);
  const row = await profileRow(ctx, id);
  if (!row) throw notFound('Practitioner not found');
  const self = c.user.id === id;
  const full = self || isAdmin(ctx);
  const staffView = ['EXECUTIVE', 'PROGRAMME_MANAGER', 'EXPERT', 'REVIEWER'].includes(c.user.role);
  if (!full && !staffView) throw notFound('Practitioner not found');
  // A different expert sees the public card of an approved colleague only.
  if (!full && row.profile.vettingStatus !== 'Approved' && c.user.role !== 'PROGRAMME_MANAGER' && c.user.role !== 'EXECUTIVE') throw notFound('Practitioner not found');
  const out: Record<string, unknown> = { ...shapeProfile(row.profile, row.user, { full: full || ['PROGRAMME_MANAGER', 'EXECUTIVE'].includes(c.user.role) }) };
  if (full) { out.vettingNote = row.profile.vettingNote; if (isAdmin(ctx)) out.rateNote = row.profile.rateNote; else if (self) out.rateNote = row.profile.rateNote; }
  out.load = (await loadFor(ctx, [id]))[id] ?? 0;
  out.maxActive = row.profile.maxActive;
  return out;
}

export async function listPractitioners(ctx: Ctx, q: { status?: string; platform?: string; availability?: string; q?: string }) {
  allow(ctx, 'practitioners', 'read');
  const c = need(ctx);
  const staff = ['ADMIN', 'EXECUTIVE', 'PROGRAMME_MANAGER'].includes(c.user.role);
  if (!staff && c.user.role !== 'EXPERT') throw forbidden();
  await ensureProfiles(ctx);
  const rows = await ctx.db.select({ p: pp, user: u }).from(pp).innerJoin(u, eq(u.id, pp.userId)).where(and(eq(u.role, 'EXPERT'), eq(u.active, true))).orderBy(u.name);
  const load = await loadFor(ctx, rows.map((r) => r.user.id));
  const needle = (q.q ?? '').trim().toLowerCase();
  const items = rows.filter((r) => (staff || r.p.vettingStatus === 'Approved') && (!q.status || r.p.vettingStatus === q.status) && (!q.platform || r.p.platforms.includes(q.platform)) && (!q.availability || r.p.availability === q.availability)
    && (!needle || r.user.name.toLowerCase().includes(needle) || r.p.specialisations.some((s) => s.toLowerCase().includes(needle))))
    // A colleague sees the public card of approved practitioners. Staff see vetting, load and completeness.
    .map((r) => (staff ? { ...shapeProfile(r.p, r.user, { full: true }), load: load[r.user.id] ?? 0, maxActive: r.p.maxActive } : shapeProfile(r.p, r.user, { full: false })));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.p.vettingStatus] = (counts[r.p.vettingStatus] ?? 0) + 1;
  return { items, counts, options: { platforms: PLATFORM_CODES, deliveryModes: DELIVERY_MODES, specialisations: SPECIALISATION_SUGGESTIONS }, conduct: { version: CONDUCT_VERSION, text: CONDUCT_TEXT } };
}

export async function updateProfile(ctx: Ctx, rawId: string, b: ProfileInput) {
  const c = need(ctx); allow(ctx, 'practitioners', 'edit');
  const id = resolveId(ctx, rawId);
  if (c.user.id !== id && !isAdmin(ctx)) throw forbidden('You can edit only your own profile');
  const row = await profileRow(ctx, id);
  if (!row) throw notFound('Practitioner not found');
  const before = row.profile;
  const errs: Record<string, string> = {};
  if (b.headline != null && b.headline.length > 140) errs.headline = 'Keep the headline under 140 characters';
  if (b.bio != null && b.bio.length > 2000) errs.bio = 'Keep the biography under 2000 characters';
  if (b.functions && (!b.functions.length || b.functions.some((f) => !['expert', 'coach'].includes(f)))) errs.functions = 'Choose expert, coach or both';
  if (b.platforms && b.platforms.some((p) => !(PLATFORM_CODES as readonly string[]).includes(p))) errs.platforms = 'Choose from SME360, AGRIFOOD360 and ESO360';
  if (b.availability && !['Available', 'Limited', 'Unavailable'].includes(b.availability)) errs.availability = 'Choose Available, Limited or Unavailable';
  if (b.maxActive != null && (!Number.isInteger(b.maxActive) || b.maxActive < 1 || b.maxActive > 50)) errs.maxActive = 'Enter a whole number from 1 to 50';
  if (b.yearsExperience != null && (!Number.isInteger(b.yearsExperience) || b.yearsExperience < 0 || b.yearsExperience > 70)) errs.yearsExperience = 'Enter a whole number from 0 to 70';
  if (Object.keys(errs).length) throw fieldError(errs);
  const set: Partial<typeof pp.$inferInsert> = { updatedAt: new Date() };
  if (b.functions) set.functions = cleanList(b.functions, 2);
  if (b.headline !== undefined) set.headline = b.headline?.trim() || null;
  if (b.bio !== undefined) set.bio = b.bio?.trim() || null;
  for (const k of ['specialisations', 'strengths', 'sectors', 'platforms', 'businessSizes', 'languages', 'regions', 'deliveryModes'] as const) if (b[k]) (set as any)[k] = cleanList(b[k]);
  if (b.yearsExperience !== undefined) set.yearsExperience = b.yearsExperience;
  if (b.credentials) set.credentials = b.credentials.slice(0, 20).map((x) => ({ type: String(x.type ?? '').slice(0, 40), title: String(x.title ?? '').slice(0, 160), issuer: x.issuer ? String(x.issuer).slice(0, 120) : undefined, year: x.year && Number.isInteger(x.year) ? x.year : undefined })).filter((x) => x.title);
  if (b.maxActive != null) set.maxActive = b.maxActive;
  if (b.availability) set.availability = b.availability;
  if (b.rateNote !== undefined) set.rateNote = b.rateNote?.trim().slice(0, 500) || null;
  if (b.acceptConduct) { set.conductAcceptedAt = new Date(); set.conductVersion = CONDUCT_VERSION; }
  // Changing what was vetted (credentials or the role the person holds) sends an approved profile back for review.
  const material = before.vettingStatus === 'Approved' && ((b.credentials && JSON.stringify(set.credentials) !== JSON.stringify(before.credentials)) || (b.functions && JSON.stringify(set.functions) !== JSON.stringify(before.functions)));
  if (material) { set.vettingStatus = 'Submitted'; set.submittedAt = new Date(); set.vettingNote = 'Returned for review because credentials or role changed after approval.'; }
  await ctx.db.update(pp).set(set).where(eq(pp.userId, id));
  await audit(ctx, 'practitioner.profile_updated', 'user', id, { vettingStatus: before.vettingStatus, availability: before.availability, maxActive: before.maxActive }, { fields: Object.keys(set).filter((k) => k !== 'updatedAt' && k !== 'rateNote'), vettingStatus: set.vettingStatus ?? before.vettingStatus });
  if (material) await notifyAdmins(ctx, 'Profile returned for review', `${row.user.name} changed credentials or role after approval.`);
  return getProfile(ctx, id);
}

async function notifyAdmins(ctx: Ctx, title: string, body: string) {
  const a = await ctx.db.select({ id: u.id }).from(u).where(and(eq(u.role, 'ADMIN'), eq(u.active, true)));
  await notifyUsers(ctx, a.map((x) => x.id), { kind: 'PractitionerVetting', title, body, link: '/admin/practitioners' });
}

export async function submitProfile(ctx: Ctx, rawId: string) {
  const c = need(ctx); allow(ctx, 'practitioners', 'edit');
  const id = resolveId(ctx, rawId);
  if (c.user.id !== id) throw forbidden('Only you can submit your own profile');
  const row = await profileRow(ctx, id);
  if (!row) throw notFound('Practitioner not found');
  const from = row.profile.vettingStatus as VettingStatus;
  if (!canMoveVetting(from, 'Submitted')) throw unprocessable(`A ${from.toLowerCase()} profile cannot be submitted`);
  const done = completeness(row.profile, !!row.user.photoKey);
  if (!done.canSubmit) throw unprocessable('Complete these before submitting: ' + done.missing.join('; '));
  await ctx.db.update(pp).set({ vettingStatus: 'Submitted', submittedAt: new Date(), updatedAt: new Date() }).where(eq(pp.userId, id));
  await audit(ctx, 'practitioner.submitted', 'user', id, { vettingStatus: from }, { vettingStatus: 'Submitted' });
  await notifyAdmins(ctx, 'A practitioner profile is waiting for review', `${row.user.name} submitted a profile.`);
  return getProfile(ctx, id);
}

export async function decideVetting(ctx: Ctx, rawId: string, b: { decision: VettingStatus; note?: string | null }) {
  const c = need(ctx); allow(ctx, 'practitioners', 'approve');
  const id = resolveId(ctx, rawId);
  const row = await profileRow(ctx, id);
  if (!row) throw notFound('Practitioner not found');
  const from = row.profile.vettingStatus as VettingStatus;
  if (c.user.id === id) throw forbidden('You cannot decide your own vetting');
  if (!canMoveVetting(from, b.decision)) throw unprocessable(`A ${from.toLowerCase()} profile cannot move to ${b.decision.toLowerCase()}`);
  if (['Rejected', 'Suspended'].includes(b.decision) && (b.note ?? '').trim().length < 5) throw fieldError({ note: 'Give the reason, so the person knows what to change' });
  await ctx.db.update(pp).set({ vettingStatus: b.decision, vettingNote: b.note?.trim() || null, decidedBy: c.user.id, decidedAt: new Date(), updatedAt: new Date() }).where(eq(pp.userId, id));
  await ctx.db.insert(schema.approvals).values({ recordType: 'practitioner_profile', recordId: id, userId: c.user.id, decision: b.decision, reason: b.note?.trim() || null });
  await audit(ctx, 'practitioner.vetting', 'user', id, { vettingStatus: from }, { vettingStatus: b.decision, note: b.note ?? null });
  await notifyUsers(ctx, [id], { kind: 'PractitionerVetting', title: `Your profile was ${b.decision.toLowerCase()}`, body: b.note ?? undefined, link: '/profile', email: true });
  return getProfile(ctx, id);
}

/* ------------------------------ conflicts ------------------------------ */
export async function listConflicts(ctx: Ctx, rawId: string) {
  const c = need(ctx); allow(ctx, 'practitioners', 'read');
  const id = resolveId(ctx, rawId);
  if (c.user.id !== id && !['ADMIN', 'EXECUTIVE', 'PROGRAMME_MANAGER'].includes(c.user.role)) throw forbidden();
  const rows = await ctx.db.select({ id: schema.practitionerConflicts.id, orgId: schema.practitionerConflicts.orgId, reason: schema.practitionerConflicts.reason, createdAt: schema.practitionerConflicts.createdAt, org: schema.organisations.name })
    .from(schema.practitionerConflicts).innerJoin(schema.organisations, eq(schema.organisations.id, schema.practitionerConflicts.orgId)).where(eq(schema.practitionerConflicts.userId, id)).orderBy(desc(schema.practitionerConflicts.createdAt));
  return { items: rows };
}
export async function addConflict(ctx: Ctx, rawId: string, b: { orgId: string; reason: string }) {
  const c = need(ctx); allow(ctx, 'practitioners', 'edit');
  const id = resolveId(ctx, rawId);
  if (c.user.id !== id && !isAdmin(ctx)) throw forbidden();
  const row = await profileRow(ctx, id);
  if (!row) throw notFound('Practitioner not found');
  if (!isAdmin(ctx)) await assertOrg(ctx, b.orgId);
  if ((b.reason ?? '').trim().length < 5) throw fieldError({ reason: 'Say briefly what the conflict is' });
  await ctx.db.insert(schema.practitionerConflicts).values({ userId: id, orgId: b.orgId, reason: b.reason.trim().slice(0, 500), declaredBy: c.user.id }).onConflictDoUpdate({ target: [schema.practitionerConflicts.userId, schema.practitionerConflicts.orgId], set: { reason: b.reason.trim().slice(0, 500), declaredBy: c.user.id } });
  await audit(ctx, 'practitioner.conflict_declared', 'user', id, undefined, { orgId: b.orgId });
  // An active assignment with that business needs a person to look at it.
  const live = await ctx.db.execute(sql`select a.id from case_assignments a join cases c on c.id = a.case_id where a.user_id = ${id} and a.status = 'Active' and c.org_id = ${b.orgId} limit 1`);
  if (live.rows.length) await notifyAdmins(ctx, 'A conflict was declared on a live case', `${row.user.name} declared a conflict with a business they are currently assigned to.`);
  return listConflicts(ctx, id);
}
/** Only an administrator removes a conflict, so a person cannot quietly clear one. */
export async function removeConflict(ctx: Ctx, rawId: string, conflictId: string) {
  allow(ctx, 'practitioners', 'approve');
  const id = resolveId(ctx, rawId);
  const r = await ctx.db.delete(schema.practitionerConflicts).where(and(eq(schema.practitionerConflicts.id, conflictId), eq(schema.practitionerConflicts.userId, id))).returning({ orgId: schema.practitionerConflicts.orgId });
  if (!r.length) throw notFound('Conflict not found');
  await audit(ctx, 'practitioner.conflict_removed', 'user', id, { orgId: r[0].orgId }, undefined);
  return listConflicts(ctx, id);
}

/** People who can take a given kind of work: used by the assignment screen and by matching. */
export async function approvedPractitioners(ctx: Ctx) {
  await ensureProfiles(ctx);
  return ctx.db.select({ p: pp, user: u }).from(pp).innerJoin(u, eq(u.id, pp.userId)).where(and(eq(u.role, 'EXPERT'), eq(u.active, true), eq(pp.vettingStatus, 'Approved')));
}
