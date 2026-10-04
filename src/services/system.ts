import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError } from '@/lib/errors';
import { env } from '@/lib/env';
import { sendMail, mailConfigured } from '@/lib/mail';
import { storage as fileStorage } from '@/lib/storage';
import { SWITCHES } from '@/domain/switches';
import { TEMPLATE_BY_KEY, templateProblems } from '@/domain/email-templates';
import { KIND_BY_ID } from '@/domain/content-kinds';
import { allow, need } from './common';
import { bust, createDoc, listDocs, saveDraft } from './content';
import { allSwitches, getReportText, REPORT_TEXT } from './switches';

/* ------------------------------ maintenance ------------------------------ */
const MKEYS = ['switch.maintenance', 'switch.maintenance_block_signin', 'text.maintenance_message'];
export async function getMaintenance(db: Ctx['db']) {
  const rows = await db.select().from(schema.rules).where(inArray(schema.rules.key, MKEYS));
  const m = new Map(rows.map((r) => [r.key, r]));
  return { on: m.get('switch.maintenance')?.value === '1', blockSignin: m.get('switch.maintenance_block_signin')?.value === '1', message: m.get('text.maintenance_message')?.value ?? '', updatedAt: m.get('switch.maintenance')?.updatedAt ?? null };
}
export async function readMaintenance(ctx: Ctx) { allow(ctx, 'settings', 'read'); return getMaintenance(ctx.db); }
export async function setMaintenance(ctx: Ctx, b: { on: boolean; blockSignin: boolean; message: string }) {
  allow(ctx, 'settings', 'edit');
  const message = b.message.trim();
  if (message.length > 400) throw fieldError({ message: 'Keep the message under 400 characters' });
  const before = await getMaintenance(ctx.db);
  const uid = need(ctx).user.id;
  const put = (key: string, value: string) => ctx.db.insert(schema.rules).values({ key, value, updatedBy: uid }).onConflictDoUpdate({ target: schema.rules.key, set: { value, updatedBy: uid, updatedAt: new Date() } });
  await put('switch.maintenance', b.on ? '1' : '0'); await put('switch.maintenance_block_signin', b.blockSignin ? '1' : '0'); await put('text.maintenance_message', message);
  await audit(ctx, 'settings.maintenance_changed', 'maintenance', null, { on: before.on, blockSignin: before.blockSignin }, { on: b.on, blockSignin: b.blockSignin, message });
  bust();
  return getMaintenance(ctx.db);
}

/* --------------------------- integration tests/logs --------------------------- */
export async function testIntegration(ctx: Ctx, what: string) {
  allow(ctx, 'integrations', 'edit');
  const me = need(ctx).user;
  let result: { ok: boolean; message: string };
  if (what === 'email') {
    try {
      const r = await sendMail(me.email, 'Samakose test email', 'This is a test email from the System page. If you can read it, outgoing email works.');
      result = r.logOnly ? { ok: false, message: 'Email is in log-only mode, so nothing was delivered. Set the mail server on the host to send real email.' } : { ok: true, message: `A test email was sent to ${me.email}. Check the inbox, and the spam folder if it does not arrive.` };
    } catch (e) { result = { ok: false, message: `The mail server refused the message: ${(e as Error).message.slice(0, 200)}` }; }
  } else if (what === 'storage') {
    const s = await fileStorage().health();
    result = s === 'ok' ? { ok: true, message: 'File storage is reachable and writable.' } : { ok: false, message: `File storage problem: ${s}` };
  } else if (what === 'database') {
    const t0 = Date.now(); await ctx.db.execute(sql`select 1`);
    result = { ok: true, message: `Database answered in ${Date.now() - t0} ms.` };
  } else throw fieldError({ what: 'Unknown test' });
  await audit(ctx, 'system.test_run', 'integration', null, undefined, { what, ok: result.ok });
  return result;
}
export async function emailLog(ctx: Ctx, status?: string) {
  allow(ctx, 'integrations', 'read');
  const t = schema.outboxEmails;
  const rows = await ctx.db.select({ id: t.id, to: t.to, subject: t.subject, status: t.status, attempts: t.attempts, lastError: t.lastError, sentAt: t.sentAt, createdAt: t.createdAt }).from(t)
    .where(status && ['Pending', 'Sent', 'Failed'].includes(status) ? eq(t.status, status) : undefined).orderBy(desc(t.createdAt)).limit(50);
  return { configured: mailConfigured(), items: rows };
}
export async function retryEmail(ctx: Ctx, id: string) {
  allow(ctx, 'integrations', 'edit');
  const r = await ctx.db.update(schema.outboxEmails).set({ status: 'Pending', attempts: 0, lastError: null }).where(and(eq(schema.outboxEmails.id, id), eq(schema.outboxEmails.status, 'Failed'))).returning({ id: schema.outboxEmails.id });
  if (!r.length) throw conflict('Only a failed email can be sent again');
  const { enqueue } = await import('@/domain/jobs');
  await enqueue(ctx, 'send_emails', {});
  await audit(ctx, 'email.retried', 'email', id);
  return { ok: true };
}

/* -------------------------------- security -------------------------------- */
export async function securityOverview(ctx: Ctx) {
  allow(ctx, 'settings', 'read');
  const q = async (text: ReturnType<typeof sql>) => Number(((await ctx.db.execute(text)).rows[0] as { n: number }).n);
  const staff = "('ADMIN','EXECUTIVE','PROGRAMME_MANAGER','EXPERT','REVIEWER','FINANCE','CONTENT_EDITOR','SITE_MANAGER')";
  const [staffNoMfa, adminsNoMfa, locked, failed24, dormant, activeAdmins] = await Promise.all([
    q(sql.raw(`select count(*)::int n from users where active and mfa_enabled=false and role in ${staff}`)),
    q(sql.raw(`select count(*)::int n from users where active and mfa_enabled=false and role='ADMIN'`)),
    q(sql.raw(`select count(*)::int n from users where locked_until > now()`)),
    q(sql.raw(`select count(*)::int n from audit_log where action in ('auth.login_failed','auth.locked') and at > now() - interval '24 hours'`)),
    q(sql.raw(`select count(*)::int n from users where active and role in ${staff} and (last_login_at is null or last_login_at < now() - interval '90 days')`)),
    q(sql.raw(`select count(*)::int n from users where active and role='ADMIN'`))
  ]);
  return {
    enforced: [
      { label: 'Secure connection (https)', ok: env.appUrl.startsWith('https://') },
      { label: 'Two-step sign-in required for', ok: env.mfaRequiredRoles.length > 0, detail: env.mfaRequiredRoles.join(', ') || 'No roles' },
      { label: 'Passwords stored as one-way hashes, with lockout after repeated failures', ok: true },
      { label: 'Every change by an administrator recorded in the audit trail', ok: true }
    ],
    counts: { staffNoMfa, adminsNoMfa, locked, failed24, dormant, activeAdmins },
    note: 'Password length, two-step rules and session length are set on the server, not here. Changing them from inside the platform could lock every administrator out, so they stay a deliberate deployment change.'
  };
}

/* ----------------------------- configuration transfer ----------------------------- */
type Bundle = { format: 'samakose-config'; version: 1; exportedAt: string; content: { kind: string; title: string; status: string; sortOrder: number; data: Record<string, unknown> }[]; switches: Record<string, boolean>; emailTemplates: { key: string; subject: string; body: string }[]; reportText: Record<string, string> };

export async function exportConfig(ctx: Ctx): Promise<Bundle> {
  allow(ctx, 'settings', 'edit');
  const docs = await ctx.db.select().from(schema.contentDocs);
  const tpl = await ctx.db.select().from(schema.emailTemplates);
  const content = docs.filter((d) => KIND_BY_ID[d.kind]).map((d) => ({ kind: d.kind, title: d.title, status: d.status, sortOrder: d.sortOrder, data: ((d.live ?? d.draft) as Record<string, unknown>) }));
  await audit(ctx, 'settings.config_exported', 'config', null, undefined, { items: content.length });
  return { format: 'samakose-config', version: 1, exportedAt: new Date().toISOString(), content, switches: await allSwitches(ctx.db), emailTemplates: tpl.map((x) => ({ key: x.key, subject: x.subject, body: x.body })), reportText: await getReportText(ctx.db) };
}

/** Checks a bundle and, unless dryRun, applies it. Content always arrives as drafts: nothing goes live until someone publishes it. */
export async function importConfig(ctx: Ctx, raw: unknown, dryRun: boolean) {
  allow(ctx, 'settings', 'edit');
  const b = raw as Partial<Bundle>;
  if (!b || b.format !== 'samakose-config' || b.version !== 1) throw fieldError({ file: 'This is not a Samakose configuration file, or it is from a newer version.' });
  const problems: string[] = []; const plan = { drafts: 0, switches: 0, templates: 0, reportText: 0 };
  const content = Array.isArray(b.content) ? b.content : [];
  if (content.length > 500) problems.push('The file holds more than 500 content items');
  const { validateData } = await import('@/domain/content-kinds');
  for (const [i, c] of content.entries()) {
    const k = KIND_BY_ID[String(c?.kind)];
    if (!k) { problems.push(`Item ${i + 1}: unknown content type "${String(c?.kind).slice(0, 30)}"`); continue; }
    const v = validateData(k, c.data);
    if (!v.ok) problems.push(`Item ${i + 1} (${k.label}): ${Object.values(v.fields)[0]}`); else plan.drafts++;
  }
  const sw = (b.switches && typeof b.switches === 'object' ? b.switches : {}) as Record<string, unknown>;
  const swKeys = Object.keys(sw).filter((k) => SWITCHES.some((s) => s.key === k));
  for (const k of swKeys) if (typeof sw[k] !== 'boolean') problems.push(`Switch ${k} must be true or false`);
  // A protected safety rule is never switched off by an import. That needs a reason on the Workflow tab.
  const protectedOff = swKeys.filter((k) => sw[k] === false && SWITCHES.find((s) => s.key === k)?.protected);
  if (protectedOff.length) problems.push('The file turns off a safety rule. Turn those off on the Workflow tab, where a reason is recorded.');
  plan.switches = swKeys.length;
  const tpls = Array.isArray(b.emailTemplates) ? b.emailTemplates : [];
  for (const x of tpls) { const t = TEMPLATE_BY_KEY[String(x?.key)]; if (!t) { problems.push(`Unknown email template "${String(x?.key).slice(0, 30)}"`); continue; } const e = templateProblems(t, String(x.subject ?? ''), String(x.body ?? '')); if (Object.keys(e).length) problems.push(`Email "${t.label}": ${Object.values(e)[0]}`); else plan.templates++; }
  const rt = (b.reportText && typeof b.reportText === 'object' ? b.reportText : {}) as Record<string, unknown>;
  const rtKeys = Object.keys(rt).filter((k) => REPORT_TEXT.some((r) => r.key === k));
  for (const k of rtKeys) if (typeof rt[k] !== 'string' || (rt[k] as string).length > 2000) problems.push(`Report wording "${k}" is not valid`);
  plan.reportText = rtKeys.length;
  if (problems.length) throw fieldError({ file: problems.slice(0, 8).join(' | ') + (problems.length > 8 ? ` | and ${problems.length - 8} more` : '') });
  if (dryRun) return { dryRun: true, ...plan };

  const uid = need(ctx).user.id;
  for (const c of content) {
    const k = KIND_BY_ID[c.kind];
    if (k.singleton) { const cur = (await listDocs(ctx, k.id)).items[0]; if (cur.status !== 'Archived') await saveDraft(ctx, cur.id, { data: c.data }); }
    else await createDoc(ctx, k.id, { data: c.data, sortOrder: c.sortOrder });
  }
  for (const k of swKeys) await ctx.db.insert(schema.rules).values({ key: k, value: sw[k] ? '1' : '0', updatedBy: uid }).onConflictDoUpdate({ target: schema.rules.key, set: { value: sw[k] ? '1' : '0', updatedBy: uid, updatedAt: new Date() } });
  for (const x of tpls) await ctx.db.insert(schema.emailTemplates).values({ key: x.key, subject: x.subject.trim(), body: x.body, updatedBy: uid }).onConflictDoUpdate({ target: schema.emailTemplates.key, set: { subject: x.subject.trim(), body: x.body, updatedBy: uid, updatedAt: new Date() } });
  for (const k of rtKeys) await ctx.db.insert(schema.rules).values({ key: k, value: rt[k] as string, updatedBy: uid }).onConflictDoUpdate({ target: schema.rules.key, set: { value: rt[k] as string, updatedBy: uid, updatedAt: new Date() } });
  await audit(ctx, 'settings.config_imported', 'config', null, undefined, plan);
  return { dryRun: false, ...plan };
}
