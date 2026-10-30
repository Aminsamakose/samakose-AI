/**
 * Contract templates (Business Doctor finance gap #4, part 1: template versioning). A template is
 * never edited in place - newTemplateVersion() always inserts a new row, so a document already
 * generated from version 3 stays provably tied to version 3's exact wording even after version 4
 * is published. At most one version per `name` is Published at a time; publishing a new version
 * automatically retires whichever version held that slot before.
 */
import { and, desc, eq, max } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, lockCapacityScope, need } from './common';
import { conflict, fieldError, notFound, unprocessable } from '@/lib/errors';

const ctp = schema.contractTemplates;

export const CONTRACT_TEMPLATE_STATUSES = ['Draft', 'Published', 'Retired'] as const;

export async function listTemplates(ctx: Ctx, filters: { name?: string; status?: string } = {}) {
  allow(ctx, 'contracts', 'read');
  const rows = await ctx.db.select().from(ctp).orderBy(desc(ctp.createdAt));
  return rows.filter((r) => (!filters.name || r.name === filters.name) && (!filters.status || r.status === filters.status));
}

export async function getTemplate(ctx: Ctx, id: string) {
  allow(ctx, 'contracts', 'read');
  const [row] = await ctx.db.select().from(ctp).where(eq(ctp.id, id)).limit(1);
  if (!row) throw notFound('Template not found');
  return row;
}

/** Starts a brand-new template family at version 1, in Draft. */
export async function createTemplate(ctx: Ctx, b: { name: string; bodyMarkdown: string }) {
  allow(ctx, 'contracts', 'create');
  const u = need(ctx).user;
  const name = b.name.trim();
  if (name.length < 3) throw fieldError({ name: 'Enter a descriptive template name' });
  if (!b.bodyMarkdown.trim()) throw fieldError({ bodyMarkdown: 'Required' });
  const [row] = await ctx.db.insert(ctp).values({ name, version: 1, status: 'Draft', bodyMarkdown: b.bodyMarkdown, createdBy: u.id }).returning();
  await audit(ctx, 'contract_template.created', 'contract_templates', row.id, undefined, { name, version: 1 });
  return row;
}

/**
 * Clones an existing version of a template family into a new Draft at version+1, for editing. The
 * source version itself (Draft, Published or Retired) is never changed - this only ever adds a row.
 */
export async function newTemplateVersion(ctx: Ctx, fromId: string, b: { bodyMarkdown?: string } = {}) {
  allow(ctx, 'contracts', 'create');
  const u = need(ctx).user;
  const [from] = await ctx.db.select().from(ctp).where(eq(ctp.id, fromId)).limit(1);
  if (!from) throw notFound('Template not found');
  const [{ v }] = await ctx.db.select({ v: max(ctp.version) }).from(ctp).where(eq(ctp.name, from.name));
  const nextVersion = (v ?? from.version) + 1;
  const [row] = await ctx.db.insert(ctp).values({ name: from.name, version: nextVersion, status: 'Draft', bodyMarkdown: b.bodyMarkdown ?? from.bodyMarkdown, createdBy: u.id }).returning();
  await audit(ctx, 'contract_template.created', 'contract_templates', row.id, undefined, { name: from.name, version: nextVersion, clonedFrom: from.id });
  return row;
}

export async function updateTemplateDraft(ctx: Ctx, id: string, b: { bodyMarkdown: string }) {
  allow(ctx, 'contracts', 'edit');
  const [row] = await ctx.db.select().from(ctp).where(eq(ctp.id, id)).limit(1);
  if (!row) throw notFound('Template not found');
  if (row.status !== 'Draft') throw unprocessable('Only a Draft version can be edited. Create a new version instead');
  if (!b.bodyMarkdown.trim()) throw fieldError({ bodyMarkdown: 'Required' });
  const [updated] = await ctx.db.update(ctp).set({ bodyMarkdown: b.bodyMarkdown }).where(eq(ctp.id, id)).returning();
  await audit(ctx, 'contract_template.updated', 'contract_templates', id, row, updated);
  return updated;
}

/**
 * Publishing a Draft retires whichever version of the same name is currently Published (there is
 * never more than one live version of a template family), then marks this one Published. A
 * document already generated from the retired version keeps its own frozen copy untouched.
 */
export async function publishTemplate(ctx: Ctx, id: string) {
  allow(ctx, 'contracts', 'edit');
  const u = need(ctx).user;
  const [row] = await ctx.db.select().from(ctp).where(eq(ctp.id, id)).limit(1);
  if (!row) throw notFound('Template not found');
  if (row.status !== 'Draft') throw unprocessable(`A ${row.status.toLowerCase()} version cannot be published`);
  // Serialize against any other concurrent publish of this same template family (schema.ts's own
  // comment on ctp_name_status_idx flags this exact race: two Draft versions published at once could
  // otherwise both read "no current Published version" and both end up Published).
  await lockCapacityScope(ctx, `template-publish:${row.name}`);
  const [current] = await ctx.db.select().from(ctp).where(and(eq(ctp.name, row.name), eq(ctp.status, 'Published'))).limit(1);
  if (current && current.id === row.id) throw conflict('This version is already published');
  if (current) await ctx.db.update(ctp).set({ status: 'Retired', retiredAt: new Date() }).where(eq(ctp.id, current.id));
  const [updated] = await ctx.db.update(ctp).set({ status: 'Published', publishedAt: new Date(), publishedBy: u.id }).where(eq(ctp.id, id)).returning();
  await audit(ctx, 'contract_template.published', 'contract_templates', id, { retired: current?.id ?? null }, updated);
  return updated;
}

export async function retireTemplate(ctx: Ctx, id: string) {
  allow(ctx, 'contracts', 'edit');
  const [row] = await ctx.db.select().from(ctp).where(eq(ctp.id, id)).limit(1);
  if (!row) throw notFound('Template not found');
  if (row.status === 'Retired') throw conflict('This version is already retired');
  const [updated] = await ctx.db.update(ctp).set({ status: 'Retired', retiredAt: new Date() }).where(eq(ctp.id, id)).returning();
  await audit(ctx, 'contract_template.retired', 'contract_templates', id, row, updated);
  return updated;
}
