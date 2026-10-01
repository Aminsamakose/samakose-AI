import { eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError } from '@/lib/errors';
import { SWITCHES, SWITCH_BY_KEY } from '@/domain/switches';
import { TEMPLATES, TEMPLATE_BY_KEY, templateProblems } from '@/domain/email-templates';
import { allow, need } from './common';

type Db = Ctx['db'];

/** Current state of one switch. Falls back to the built-in default, so a missing row never changes behaviour. */
export async function switchOn(db: Db, key: string): Promise<boolean> {
  const [row] = await db.select({ value: schema.rules.value }).from(schema.rules).where(eq(schema.rules.key, key)).limit(1);
  const def = SWITCH_BY_KEY[key]?.default ?? 1;
  return row ? row.value === '1' : def === 1;
}
export async function allSwitches(db: Db): Promise<Record<string, boolean>> {
  const rows = await db.select().from(schema.rules);
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(SWITCHES.map((s) => [s.key, m.has(s.key) ? m.get(s.key) === '1' : s.default === 1]));
}

export async function listSwitches(ctx: Ctx) {
  allow(ctx, 'settings', 'read');
  const state = await allSwitches(ctx.db);
  const rows = await ctx.db.select().from(schema.rules);
  const meta = new Map(rows.map((r) => [r.key, r.updatedAt]));
  return SWITCHES.map((s) => ({ ...s, on: state[s.key], changed: meta.has(s.key), updatedAt: meta.get(s.key) ?? null }));
}

export async function setSwitch(ctx: Ctx, key: string, on: boolean, reason?: string) {
  allow(ctx, 'settings', 'edit');
  const s = SWITCH_BY_KEY[key];
  if (!s) throw fieldError({ key: 'Unknown switch' });
  const before = await switchOn(ctx.db, key);
  if (before === on) return { changed: false, on };
  if (s.protected && !on && (reason ?? '').trim().length < 10) throw fieldError({ reason: 'Give a reason of at least 10 characters. It is recorded in the audit trail.' });
  await ctx.db.insert(schema.rules).values({ key, value: on ? '1' : '0', note: s.label, updatedBy: need(ctx).user.id })
    .onConflictDoUpdate({ target: schema.rules.key, set: { value: on ? '1' : '0', updatedBy: need(ctx).user.id, updatedAt: new Date() } });
  await audit(ctx, 'settings.switch_changed', 'switch', null, { [key]: before }, { [key]: on, reason: reason?.trim() || undefined });
  return { changed: true, on };
}

/* ---------------------------- email templates ---------------------------- */
export async function listTemplates(ctx: Ctx) {
  allow(ctx, 'settings', 'read');
  const rows = await ctx.db.select().from(schema.emailTemplates);
  const m = new Map(rows.map((r) => [r.key, r]));
  return TEMPLATES.map((t) => { const o = m.get(t.key); return { ...t, subjectNow: o?.subject ?? t.subject, bodyNow: o?.body ?? t.body, customised: !!o, updatedAt: o?.updatedAt ?? null }; });
}
export async function saveTemplate(ctx: Ctx, key: string, b: { subject: string; body: string }) {
  allow(ctx, 'settings', 'edit');
  const t = TEMPLATE_BY_KEY[key];
  if (!t) throw fieldError({ key: 'Unknown template' });
  const errs = templateProblems(t, b.subject, b.body);
  if (Object.keys(errs).length) throw fieldError(errs);
  const uid = need(ctx).user.id;
  await ctx.db.insert(schema.emailTemplates).values({ key, subject: b.subject.trim(), body: b.body, updatedBy: uid })
    .onConflictDoUpdate({ target: schema.emailTemplates.key, set: { subject: b.subject.trim(), body: b.body, updatedBy: uid, updatedAt: new Date() } });
  await audit(ctx, 'settings.email_template_saved', 'email_template', null, undefined, { key });
  return { ok: true };
}
export async function resetTemplate(ctx: Ctx, key: string) {
  allow(ctx, 'settings', 'edit');
  if (!TEMPLATE_BY_KEY[key]) throw fieldError({ key: 'Unknown template' });
  await ctx.db.delete(schema.emailTemplates).where(eq(schema.emailTemplates.key, key));
  await audit(ctx, 'settings.email_template_reset', 'email_template', null, undefined, { key });
  return { ok: true };
}

/* ------------------------------ report wording ---------------------------- */
export const REPORT_TEXT = [
  { key: 'text.report_title', label: 'Report title', help: 'Use {{organisation}} for the business name.', default: 'Progress report for {{organisation}}', max: 160 },
  { key: 'text.report_closing', label: 'Closing note added to every new report', help: 'Optional. Appears as a final section, for example a reminder that the report rests on self-reported data.', default: '', max: 1500 }
] as const;
export async function getReportText(db: Db) {
  const rows = await db.select().from(schema.rules);
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(REPORT_TEXT.map((t) => [t.key, m.has(t.key) ? m.get(t.key)! : t.default])) as Record<string, string>;
}
export async function listReportText(ctx: Ctx) {
  allow(ctx, 'settings', 'read');
  const v = await getReportText(ctx.db);
  return REPORT_TEXT.map((t) => ({ ...t, value: v[t.key] }));
}
export async function saveReportText(ctx: Ctx, values: Record<string, string>) {
  allow(ctx, 'settings', 'edit');
  const errs: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const t = REPORT_TEXT.find((x) => x.key === k);
    if (!t) { errs[k] = 'Unknown setting'; continue; }
    if (v.length > t.max) errs[k] = `Keep this under ${t.max} characters`;
    if (k === 'text.report_title' && v.trim().length < 3) errs[k] = 'Write a title of at least 3 characters';
    if (/\{\{(?!\s*organisation\s*\}\})/.test(v)) errs[k] = 'Only {{organisation}} can be used here';
  }
  if (Object.keys(errs).length) throw fieldError(errs);
  const before = await getReportText(ctx.db);
  const uid = need(ctx).user.id;
  for (const [k, v] of Object.entries(values)) {
    if (before[k] === v) continue;
    await ctx.db.insert(schema.rules).values({ key: k, value: v, updatedBy: uid }).onConflictDoUpdate({ target: schema.rules.key, set: { value: v, updatedBy: uid, updatedAt: new Date() } });
  }
  await audit(ctx, 'settings.report_text_changed', 'rules', null, undefined, { keys: Object.keys(values) });
  return { ok: true };
}
