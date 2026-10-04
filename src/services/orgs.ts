import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, forbidden } from '@/lib/errors';
import { assertOrg, caseScope, orgScope } from '@/domain/scope';
import { orderBy, search, countOf, type ListQuery } from '@/api/list';
import { allow, need, respondList } from './common';
import type { ORG_TYPES } from '@/db/schema';

const o = schema.organisations;
type OrgType = (typeof ORG_TYPES)[number];
const cols = {
  id: o.id, code: o.code, name: o.name, type: o.type, sector: o.sector, region: o.region, district: o.district, size: o.size,
  contactName: o.contactName, contactEmail: o.contactEmail, contactPhone: o.contactPhone, status: o.status, consentAt: o.consentAt, createdAt: o.createdAt,
  caseCount: sql<number>`(select count(*)::int from cases c where c.org_id = ${o.id})`
};

export async function listOrgs(ctx: Ctx, q: ListQuery & { region?: string; type?: string; status?: string }) {
  allow(ctx, 'organisations', 'read');
  const where = and(orgScope(need(ctx).user), isNull(o.deletedAt), search(q.q, [o.name, o.code, o.contactName, o.district]),
    q.region ? eq(o.region, q.region) : undefined, q.type ? eq(o.type, q.type as OrgType) : undefined, q.status ? eq(o.status, q.status) : undefined);
  return respondList(ctx, 'organisations', q,
    (limit, off) => ctx.db.select(cols).from(o).where(where).orderBy(orderBy(q, { name: o.name, code: o.code, region: o.region, type: o.type, created: o.createdAt }, o.createdAt)).limit(limit).offset(off),
    async () => Number((await ctx.db.select({ n: countOf }).from(o).where(where))[0].n),
    { filename: 'organisations.csv', columns: [['code', 'Code'], ['name', 'Name'], ['type', 'Type'], ['sector', 'Sector'], ['region', 'Region'], ['district', 'District'], ['size', 'Size'], ['contactName', 'Contact'], ['contactEmail', 'Email'], ['status', 'Status'], ['caseCount', 'Cases']].map(([key, label]) => ({ key, label })) });
}

export async function getOrg(ctx: Ctx, id: string) {
  await assertOrg(ctx, id);
  const [row] = await ctx.db.select(cols).from(o).where(eq(o.id, id)).limit(1);
  const cs = await ctx.db.select({ id: schema.cases.id, code: schema.cases.code, status: schema.cases.status, programmeId: schema.cases.programmeId }).from(schema.cases).where(and(eq(schema.cases.orgId, id), caseScope(ctx.user!))).orderBy(schema.cases.createdAt);
  const users = ctx.user!.role === 'ADMIN' ? await ctx.db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, active: schema.users.active }).from(schema.users).where(eq(schema.users.orgId, id)) : [];
  return { ...row, cases: cs, users };
}

type OrgInput = { name: string; type?: OrgType; sector?: string | null; region?: string | null; district?: string | null; size?: string | null; contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null };
export async function createOrg(ctx: Ctx, b: OrgInput & { consent: boolean; consentBy: string }) {
  allow(ctx, 'organisations', 'create');
  const c = need(ctx);
  if (!b.consent) throw fieldError({ consent: 'Consent to process the organisation’s data must be recorded' });
  const dupe = await ctx.db.select({ id: o.id }).from(o).where(and(sql`lower(${o.name}) = ${b.name.trim().toLowerCase()}`, isNull(o.deletedAt), b.region ? eq(o.region, b.region) : sql`true`)).limit(1);
  if (dupe.length) throw fieldError({ name: 'An organisation with this name already exists in this region' });
  const [row] = await ctx.db.insert(o).values({ ...b, name: b.name.trim(), consentAt: new Date(), consentBy: b.consentBy.trim(), createdBy: c.user.id }).returning({ id: o.id, code: o.code });
  await audit(ctx, 'organisation.created', 'organisation', row.id, undefined, { ...b });
  return row;
}

export async function updateOrg(ctx: Ctx, id: string, b: Partial<OrgInput> & { status?: string }) {
  allow(ctx, 'organisations', 'edit');
  const before = await assertOrg(ctx, id);
  const patch: Record<string, unknown> = {};
  const ownerFields = ['contactName', 'contactEmail', 'contactPhone'] as const;
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    if (ctx.user!.role === 'OWNER' && !(ownerFields as readonly string[]).includes(k)) throw forbidden('Owners can update contact details only');
    patch[k] = typeof v === 'string' ? v.trim() : v;
  }
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
