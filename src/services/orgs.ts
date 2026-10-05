import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, forbidden, notFound } from '@/lib/errors';
import { assertOrg, caseScope, orgScope } from '@/domain/scope';
import type { AuthUser } from '@/lib/context';
import { completeness, findDuplicates } from '@/domain/org-registry';
import { orderBy, search, countOf, type ListQuery } from '@/api/list';
import { allow, need, respondList } from './common';
import type { ORG_TYPES } from '@/db/schema';

const o = schema.organisations;
type OrgType = (typeof ORG_TYPES)[number];
const cols = {
  id: o.id, code: o.code, name: o.name, type: o.type, sector: o.sector, region: o.region, district: o.district, size: o.size,
  registrationNumber: o.registrationNumber, tin: o.tin, yearsOperating: o.yearsOperating, ownershipStructure: o.ownershipStructure, geoUnitId: o.geoUnitId, mergedInto: o.mergedInto,
  contactName: o.contactName, contactEmail: o.contactEmail, contactPhone: o.contactPhone, status: o.status, consentAt: o.consentAt, createdAt: o.createdAt,
  caseCount: sql<number>`(select count(*)::int from cases c where c.org_id = ${o.id})`
};
const colsFor = (u: AuthUser) => (restricted(u) ? { ...cols, mine: mineExpr(u) } : cols);

const withCompleteness = <T extends Record<string, any>>(r: T) => ({ ...r, completeness: completeness(r as any) });

/** Programme managers and experts see an organisation's tax number and contact details only when it is on one of their cases or they registered it themselves. Everyone else in the registry sees the name and place, so they can find it and ask for a case. */
const RESTRICTED_ROLES = ['PROGRAMME_MANAGER', 'EXPERT'];
const restricted = (u: { role: string }) => RESTRICTED_ROLES.includes(u.role);
const mineExpr = (u: AuthUser) => sql<boolean>`(${o.createdBy} = ${u.id} or ${o.id} in (select org_id from cases where ${caseScope(u)}))`;
const HIDDEN = ['registrationNumber', 'tin', 'contactName', 'contactEmail', 'contactPhone'] as const;
function mask<T extends Record<string, any>>(r: T): T {
  const { mine, ...rest } = r as any;
  if (mine !== false) return rest;
  const out: any = { ...rest, contactHidden: true };
  for (const k of HIDDEN) out[k] = null;
  return out;
}

export async function listOrgs(ctx: Ctx, q: ListQuery & { region?: string; type?: string; status?: string }) {
  allow(ctx, 'organisations', 'read');
  const archived = q.status === 'Archived' && need(ctx).user.role === 'ADMIN';
  const where = and(orgScope(need(ctx).user), archived ? sql`${o.deletedAt} is not null and ${o.status} = 'Archived'` : isNull(o.deletedAt), search(q.q, restricted(need(ctx).user) ? [o.name, o.code, o.district] : [o.name, o.code, o.contactName, o.district]),
    q.region ? eq(o.region, q.region) : undefined, q.type ? eq(o.type, q.type as OrgType) : undefined, q.status && !archived ? eq(o.status, q.status) : undefined);
  return respondList(ctx, 'organisations', q,
    async (limit, off) => (await ctx.db.select(colsFor(need(ctx).user)).from(o).where(where).orderBy(orderBy(q, { name: o.name, code: o.code, region: o.region, type: o.type, created: o.createdAt }, o.createdAt)).limit(limit).offset(off)).map((r) => mask(withCompleteness(r))),
    async () => Number((await ctx.db.select({ n: countOf }).from(o).where(where))[0].n),
    { filename: 'organisations.csv', columns: [['code', 'Code'], ['name', 'Name'], ['type', 'Type'], ['sector', 'Sector'], ['region', 'Region'], ['district', 'District'], ['size', 'Size'], ['contactName', 'Contact'], ['contactEmail', 'Email'], ['status', 'Status'], ['caseCount', 'Cases']].map(([key, label]) => ({ key, label })) });
}

export async function getOrg(ctx: Ctx, id: string) {
  await assertOrg(ctx, id);
  const [row] = await ctx.db.select(colsFor(need(ctx).user)).from(o).where(eq(o.id, id)).limit(1);
  const cs = await ctx.db.select({ id: schema.cases.id, code: schema.cases.code, status: schema.cases.status, programmeId: schema.cases.programmeId }).from(schema.cases).where(and(eq(schema.cases.orgId, id), caseScope(ctx.user!))).orderBy(schema.cases.createdAt);
  const users = ctx.user!.role === 'ADMIN' ? await ctx.db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, active: schema.users.active }).from(schema.users).where(eq(schema.users.orgId, id)) : [];
  return { ...mask(withCompleteness(row)), cases: cs, users };
}

type OrgInput = { name: string; type?: OrgType; sector?: string | null; region?: string | null; district?: string | null; size?: string | null; contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null; registrationNumber?: string | null; tin?: string | null; yearsOperating?: number | null; ownershipStructure?: string | null };
async function checkTin(ctx: Ctx, tin: string | null | undefined, exceptId?: string) {
  if (!tin) return;
  const t = await ctx.db.select({ id: o.id }).from(o).where(and(sql`lower(${o.tin}) = ${tin.toLowerCase()}`, isNull(o.deletedAt), exceptId ? sql`${o.id} <> ${exceptId}` : sql`true`)).limit(1);
  if (t.length) throw fieldError({ tin: 'Another organisation already uses this tax identification number. Check for a duplicate.' });
}
const cleanTin = (v: string | null | undefined) => (v ? v.replace(/\s+/g, '').toUpperCase() : v);

export async function createOrg(ctx: Ctx, b: OrgInput & { consent: boolean; consentBy: string }) {
  allow(ctx, 'organisations', 'create');
  const c = need(ctx);
  if (!b.consent) throw fieldError({ consent: 'Consent to process the organisation’s data must be recorded' });
  const dupe = await ctx.db.select({ id: o.id }).from(o).where(and(sql`lower(${o.name}) = ${b.name.trim().toLowerCase()}`, isNull(o.deletedAt), b.region ? eq(o.region, b.region) : sql`true`)).limit(1);
  if (dupe.length) throw fieldError({ name: 'An organisation with this name already exists in this region' });
  b.tin = cleanTin(b.tin); await checkTin(ctx, b.tin);
  const [row] = await ctx.db.insert(o).values({ ...b, name: b.name.trim(), consentAt: new Date(), consentBy: b.consentBy.trim(), createdBy: c.user.id }).returning({ id: o.id, code: o.code });
  await audit(ctx, 'organisation.created', 'organisation', row.id, undefined, { ...b });
  return row;
}

export async function updateOrg(ctx: Ctx, id: string, b: Partial<OrgInput> & { status?: string }) {
  allow(ctx, 'organisations', 'edit');
  const before = await assertOrg(ctx, id);
  if (restricted(ctx.user!) && before.createdBy !== ctx.user!.id && HIDDEN.some((k) => (b as any)[k] !== undefined)) {
    const onMine = await ctx.db.select({ id: schema.cases.id }).from(schema.cases).where(and(eq(schema.cases.orgId, id), caseScope(ctx.user!))).limit(1);
    if (!onMine.length) throw forbidden('Contact details, tax number and registration number can be changed only when the organisation is on one of your cases or you registered it');
  }
  const patch: Record<string, unknown> = {};
  const ownerFields = ['contactName', 'contactEmail', 'contactPhone'] as const;
  // Name, type, registration number and TIN identify the business for everyone who works with it. Past registration, only an administrator changes them.
  const identity = ['name', 'type', 'registrationNumber', 'tin'] as const;
  const touchesIdentity = identity.some((k) => (b as any)[k] !== undefined && String((b as any)[k] ?? '').trim() !== String((before as any)[k] ?? '').trim());
  if (touchesIdentity && ctx.user!.role !== 'ADMIN' && ctx.user!.role !== 'OWNER') {
    const mine = before.createdBy === ctx.user!.id;
    const cs = await ctx.db.select({ n: countOf }).from(schema.cases).where(eq(schema.cases.orgId, id));
    if (!mine || Number(cs[0].n) > 0) throw forbidden('Only an administrator can change the name, type, registration number or TIN once the organisation has cases or was registered by someone else. Ask an administrator.');
  }
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    if (ctx.user!.role === 'OWNER' && !(ownerFields as readonly string[]).includes(k)) throw forbidden('Owners can update contact details only');
    patch[k] = typeof v === 'string' ? v.trim() : v;
  }
  if ('tin' in patch) { patch.tin = cleanTin(patch.tin as string | null) || null; await checkTin(ctx, patch.tin as string | null, id); }
  if (patch.name && String(patch.name).toLowerCase() !== before.name.toLowerCase()) {
    const dupe = await ctx.db.select({ id: o.id }).from(o).where(and(sql`lower(${o.name}) = ${String(patch.name).toLowerCase()}`, isNull(o.deletedAt), sql`${o.id} <> ${id}`, (patch.region ?? before.region) ? eq(o.region, String(patch.region ?? before.region)) : sql`true`)).limit(1);
    if (dupe.length) throw fieldError({ name: 'An organisation with this name already exists in this region' });
  }
  await ctx.db.update(o).set({ ...patch, updatedAt: new Date() }).where(eq(o.id, id));
  await audit(ctx, 'organisation.updated', 'organisation', id, before, patch);
  return { ok: true };
}

export async function archiveOrg(ctx: Ctx, id: string) {
  allow(ctx, 'organisations', 'delete');
  const before = await assertOrg(ctx, id);
  const open = await ctx.db.select({ n: countOf }).from(schema.cases).where(and(eq(schema.cases.orgId, id), sql`${schema.cases.status} <> 'GRADUATED'`));
  if (Number(open[0].n) > 0) throw conflict('This organisation has cases that are not graduated. Close or graduate them first.');
  await ctx.db.update(o).set({ deletedAt: new Date(), status: 'Archived', updatedAt: new Date() }).where(eq(o.id, id));
  await audit(ctx, 'organisation.archived', 'organisation', id, before);
  return { ok: true };
}

/* ---------------------------- registry: duplicates, merge, unarchive ---------------------------- */

/** Tables whose rows follow the business when two records are merged. */
export const MOVES_ON_MERGE = ['area_assignments', 'assessment_rounds', 'cases', 'contracts', 'documents', 'feedback', 'invoices', 'opportunity_referrals', 'org_members', 'practitioner_conflicts', 'registration_answers', 'users'] as const;
/** Append-only history. These rows keep the organisation they were written for, and the archived record points to the survivor through merged_into. */
export const STAYS_ON_MERGE = ['consents', 'events', 'certificates'] as const;

export async function findOrgDuplicates(ctx: Ctx) {
  allow(ctx, 'organisations', 'delete');
  const rows = (await ctx.db.execute(sql`select o.id, o.code, o.name, o.region, o.tin, o.registration_number as "registrationNumber", o.contact_email as "contactEmail", o.contact_phone as "contactPhone",
      (select count(*)::int from cases c where c.org_id = o.id) as "caseCount" from organisations o where o.deleted_at is null and o.country_code = 'GH' order by o.created_at`)).rows as any[];
  return { groups: findDuplicates(rows) };
}

const isUnique = (e: any) => (e?.code ?? e?.cause?.code) === '23505';

/** Folds a duplicate into the record that stays. Everything live moves; append-only history stays put; the source is archived with a pointer. All or nothing. */
export async function mergeOrgs(ctx: Ctx, sourceId: string, b: { intoId: string; reason: string }) {
  allow(ctx, 'organisations', 'delete');
  if (sourceId === b.intoId) throw fieldError({ intoId: 'Choose a different organisation to merge into' });
  const src = await assertOrg(ctx, sourceId); const dst = await assertOrg(ctx, b.intoId);
  if (src.countryCode !== dst.countryCode) throw conflict('Organisations in different countries cannot be merged');
  const moved: Record<string, number> = {};
  try {
    await ctx.db.transaction(async (tx) => {
      for (const t of MOVES_ON_MERGE) {
        const r: any = await tx.execute(sql`update ${sql.identifier(t)} set org_id = ${dst.id} where org_id = ${src.id}`);
        moved[t] = Number(r.rowCount ?? 0);
      }
      // Free the unique identifiers on the source first, then fill any gaps on the survivor from it.
      const fill: Record<string, unknown> = {};
      for (const k of ['sector', 'region', 'district', 'size', 'registrationNumber', 'tin', 'contactName', 'contactEmail', 'contactPhone', 'yearsOperating', 'ownershipStructure', 'geoUnitId', 'community', 'urbanRural'] as const) {
        const have = (dst as any)[k]; const other = (src as any)[k];
        if ((have === null || have === undefined || have === '') && other !== null && other !== undefined && other !== '') fill[k] = other;
      }
      await tx.update(o).set({ tin: null, deletedAt: new Date(), status: 'Merged', mergedInto: dst.id, updatedAt: new Date() }).where(eq(o.id, src.id));
      if (Object.keys(fill).length) await tx.update(o).set({ ...fill, updatedAt: new Date() }).where(eq(o.id, dst.id));
      moved['_filled_fields'] = Object.keys(fill).length;
    });
  } catch (e) {
    if (isUnique(e)) throw conflict('These two records cannot be merged automatically: both have a membership, assignment or referral that would collide. Resolve those first.');
    throw e;
  }
  await audit(ctx, 'organisation.merged', 'organisation', src.id, { name: src.name, code: src.code }, { into: dst.id, intoCode: dst.code, reason: b.reason, moved });
  return { ok: true, into: dst.id, moved };
}

/** Brings an archived organisation back. Merged records stay merged: their business now lives in the survivor. */
export async function unarchiveOrg(ctx: Ctx, id: string) {
  allow(ctx, 'organisations', 'delete');
  const [row] = await ctx.db.select().from(o).where(eq(o.id, id)).limit(1);
  if (!row) throw notFound('Organisation not found');
  if (row.status === 'Merged') throw conflict('This record was merged into another organisation and cannot be restored');
  if (!row.deletedAt) throw conflict('This organisation is not archived');
  const dupe = await ctx.db.select({ id: o.id }).from(o).where(and(sql`lower(${o.name}) = ${row.name.toLowerCase()}`, isNull(o.deletedAt), row.region ? eq(o.region, row.region) : sql`true`)).limit(1);
  if (dupe.length) throw conflict('Another live organisation already uses this name in this region. Rename one of them first.');
  try { await ctx.db.update(o).set({ deletedAt: null, status: 'Active', updatedAt: new Date() }).where(eq(o.id, id)); }
  catch (e) { if (isUnique(e)) throw conflict('Its tax identification number is now used by another live organisation'); throw e; }
  await audit(ctx, 'organisation.unarchived', 'organisation', id, { status: row.status });
  return { ok: true };
}
