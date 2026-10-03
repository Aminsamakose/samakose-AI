/**
 * Administration of the registration settings: consent wording and the role-to-assessment-area mapping.
 * Both are versioned. A version is edited only while it is a Draft. Publishing retires the one that was live,
 * and every change is written to the audit trail.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, notFound, unprocessable } from '@/lib/errors';
import { DRAFT_MAPPING, PLATFORMS, type Platform, type RoleMapping } from '@/domain/routing';
import { allow, need } from './common';

export const NOTICE_PURPOSES = ['account', 'assessment', 'team_invites', 'demographics', 'disability', 'funder_aggregate'] as const;

/* ------------------------------- consent notices ------------------------------- */
export async function listNotices(ctx: Ctx, country = 'GH') {
  allow(ctx, 'consent', 'read');
  const rows = await ctx.db.execute(sql`
    select n.id, n.purpose, n.country_code, n.version, n.text, n.status, n.effective_from, n.created_at,
      (select count(*)::int from consents c where c.notice_id = n.id and c.action = 'granted') as grants
    from consent_notices n where n.country_code = ${country.toUpperCase()} order by n.purpose, n.version desc`);
  return { purposes: NOTICE_PURPOSES, items: rows.rows };
}

async function noticeRow(ctx: Ctx, id: string) {
  const [n] = await ctx.db.select().from(schema.consentNotices).where(eq(schema.consentNotices.id, id)).limit(1);
  if (!n) throw notFound('Notice not found');
  return n;
}
const checkText = (t: string) => { const s = t.trim(); if (s.length < 40 || s.length > 2500) throw fieldError({ text: 'Write the wording the person will see, between 40 and 2,500 characters' }); return s; };

/** A new version for a purpose starts as a Draft. The live version keeps running until the draft is published. */
export async function createNotice(ctx: Ctx, b: { purpose: string; countryCode?: string; text: string }) {
  allow(ctx, 'consent', 'create'); const me = need(ctx).user;
  if (!(NOTICE_PURPOSES as readonly string[]).includes(b.purpose)) throw fieldError({ purpose: 'Choose one of the listed purposes' });
  const country = (b.countryCode ?? 'GH').toUpperCase();
  const [c] = await ctx.db.select({ c: schema.countrySettings.countryCode }).from(schema.countrySettings).where(and(eq(schema.countrySettings.countryCode, country), eq(schema.countrySettings.active, true))).limit(1);
  if (!c) throw fieldError({ countryCode: 'This country is not open' });
  const text = checkText(b.text);
  const [{ v }] = (await ctx.db.execute(sql`select coalesce(max(version),0)::int + 1 as v from consent_notices where purpose = ${b.purpose} and country_code = ${country}`)).rows as { v: number }[];
  const [row] = await ctx.db.insert(schema.consentNotices).values({ purpose: b.purpose, countryCode: country, version: v, text, status: 'Draft', createdBy: me.id }).returning();
  await audit(ctx, 'consent_notice.created', 'consent_notice', row.id, undefined, { purpose: b.purpose, country, version: v });
  return row;
}

export async function updateNotice(ctx: Ctx, id: string, text: string) {
  allow(ctx, 'consent', 'edit');
  const n = await noticeRow(ctx, id);
  if (n.status !== 'Draft') throw unprocessable('Only a draft can be edited. Create a new version instead, so the wording people agreed to stays on record.');
  const [row] = await ctx.db.update(schema.consentNotices).set({ text: checkText(text) }).where(eq(schema.consentNotices.id, id)).returning();
  await audit(ctx, 'consent_notice.edited', 'consent_notice', id, { text: n.text }, { text: row.text });
  return row;
}

/** Publishing makes this the wording shown at registration and retires the previous version. People who agreed to the old
 *  wording keep their consent on record against that version. */
export async function publishNotice(ctx: Ctx, id: string) {
  allow(ctx, 'consent', 'approve');
  const n = await noticeRow(ctx, id);
  if (n.status !== 'Draft') throw unprocessable('Only a draft can be published');
  await ctx.db.update(schema.consentNotices).set({ status: 'Retired' }).where(and(eq(schema.consentNotices.purpose, n.purpose), eq(schema.consentNotices.countryCode, n.countryCode), eq(schema.consentNotices.status, 'Published')));
  const [row] = await ctx.db.update(schema.consentNotices).set({ status: 'Published', effectiveFrom: new Date() }).where(eq(schema.consentNotices.id, id)).returning();
  await audit(ctx, 'consent_notice.published', 'consent_notice', id, { status: 'Draft' }, { status: 'Published', purpose: n.purpose, version: n.version });
  return row;
}

/* -------------------------------- role mapping --------------------------------- */
type StoredMapping = { fallback: string; roles: Record<string, string>; map: Record<string, { primary: string[]; contributor: string[] }> };

export function validateMapping(d: unknown): StoredMapping {
  const m = d as StoredMapping;
  const bad = (msg: string): never => { throw fieldError({ data: msg }); };
  if (!m || typeof m !== 'object' || !m.roles || !m.map || typeof m.fallback !== 'string') return bad('The mapping needs a fallback role, a list of roles and a map of assessment areas');
  const roles = Object.keys(m.roles);
  if (!roles.length) bad('Add at least one role');
  if (!roles.includes(m.fallback)) bad('The fallback role must be one of the roles');
  const areas = Object.entries(m.map);
  if (!areas.length) bad('Add at least one assessment area');
  for (const [area, e] of areas) {
    if (!Array.isArray(e?.primary) || e.primary.length === 0) bad(`Area ${area} needs at least one primary role`);
    for (const r of [...e.primary, ...(e.contributor ?? [])]) if (!roles.includes(r)) bad(`Area ${area} names an unknown role: ${r}`);
  }
  return { fallback: m.fallback, roles: m.roles, map: Object.fromEntries(areas.map(([a, e]) => [a, { primary: e.primary, contributor: e.contributor ?? [] }])) };
}

const isPlatform = (p: string): p is Platform => (PLATFORMS as string[]).includes(p);

export async function listMappings(ctx: Ctx) {
  allow(ctx, 'role_mapping', 'read');
  const rows = await ctx.db.select({ id: schema.roleMappings.id, frameworkCode: schema.roleMappings.frameworkCode, version: schema.roleMappings.version, status: schema.roleMappings.status, note: schema.roleMappings.note, approvedAt: schema.roleMappings.approvedAt, createdAt: schema.roleMappings.createdAt }).from(schema.roleMappings).orderBy(schema.roleMappings.frameworkCode, desc(schema.roleMappings.version));
  return { frameworks: PLATFORMS, items: rows };
}

export async function getMapping(ctx: Ctx, id: string) {
  allow(ctx, 'role_mapping', 'read');
  const [m] = await ctx.db.select().from(schema.roleMappings).where(eq(schema.roleMappings.id, id)).limit(1);
  if (!m) throw notFound('Mapping not found');
  return m;
}

/** The starting point is the reviewed draft that ships with the platform, or the data you send. */
export async function createMapping(ctx: Ctx, b: { frameworkCode: string; note?: string; data?: unknown }) {
  allow(ctx, 'role_mapping', 'create'); const me = need(ctx).user;
  if (!isPlatform(b.frameworkCode)) throw fieldError({ frameworkCode: 'Choose SME360, AGRIFOOD360 or ESO360' });
  const p = b.frameworkCode;
  const data = validateMapping(b.data ?? { fallback: DRAFT_MAPPING.fallback[p], roles: DRAFT_MAPPING.roles[p], map: DRAFT_MAPPING.map[p] });
  const [{ v }] = (await ctx.db.execute(sql`select coalesce(max(version),0)::int + 1 as v from role_mappings where framework_code = ${p}`)).rows as { v: number }[];
  const [row] = await ctx.db.insert(schema.roleMappings).values({ frameworkCode: p, version: v, status: 'Draft', data, note: b.note?.trim().slice(0, 500) || null, createdBy: me.id }).returning();
  await audit(ctx, 'role_mapping.created', 'role_mapping', row.id, undefined, { framework: p, version: v });
  return row;
}

export async function updateMapping(ctx: Ctx, id: string, b: { data?: unknown; note?: string }) {
  allow(ctx, 'role_mapping', 'edit');
  const m = await getMapping(ctx, id);
  if (m.status !== 'Draft') throw unprocessable('Only a draft can be edited. Create a new version instead.');
  const set: Record<string, unknown> = {};
  if (b.data !== undefined) set.data = validateMapping(b.data);
  if (b.note !== undefined) set.note = b.note.trim().slice(0, 500) || null;
  const [row] = await ctx.db.update(schema.roleMappings).set(set).where(eq(schema.roleMappings.id, id)).returning();
  await audit(ctx, 'role_mapping.edited', 'role_mapping', id, { data: m.data }, { data: row.data });
  return row;
}

export async function publishMapping(ctx: Ctx, id: string) {
  allow(ctx, 'role_mapping', 'approve'); const me = need(ctx).user;
  const m = await getMapping(ctx, id);
  if (m.status !== 'Draft') throw unprocessable('Only a draft can be published');
  validateMapping(m.data);
  await ctx.db.update(schema.roleMappings).set({ status: 'Retired' }).where(and(eq(schema.roleMappings.frameworkCode, m.frameworkCode), eq(schema.roleMappings.status, 'Published')));
  const now = new Date();
  const [row] = await ctx.db.update(schema.roleMappings).set({ status: 'Published', approvedBy: me.id, approvedAt: now, publishedAt: now }).where(eq(schema.roleMappings.id, id)).returning();
  await audit(ctx, 'role_mapping.published', 'role_mapping', id, { status: 'Draft' }, { status: 'Published', framework: m.frameworkCode, version: m.version });
  return row;
}

/** The mapping in force: each platform uses its Published version, and the reviewed draft until one is published. */
export async function loadMapping(db: Ctx['db']): Promise<RoleMapping> {
  const rows = await db.select().from(schema.roleMappings).where(eq(schema.roleMappings.status, 'Published'));
  const out: RoleMapping = { fallback: { ...DRAFT_MAPPING.fallback }, roles: { ...DRAFT_MAPPING.roles }, map: { ...DRAFT_MAPPING.map } };
  for (const r of rows) { const d = r.data as StoredMapping; out.fallback[r.frameworkCode] = d.fallback; out.roles[r.frameworkCode] = d.roles; out.map[r.frameworkCode] = d.map; }
  return out;
}
