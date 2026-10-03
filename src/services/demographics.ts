import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { fieldError, unprocessable } from '@/lib/errors';
import { suppress } from '@/domain/logic';
import { allow, loadRules, need } from './common';
import { nextStep, type AssessmentMode } from '@/domain/routing';

/** Optional demographics and disability. Each has its own consent, is never part of a score, and can be removed at any time.
 *  Rows belong to the person who gave consent (subject_type 'user'). */
export const CATEGORIES = ['demographics', 'disability'] as const;
export type Category = (typeof CATEGORIES)[number];
export const GENDERS = ['Female', 'Male', 'Prefer not to say'] as const;
/** Youth in Ghana is 15 to 35. Registration is for adults, so the first band starts at 18. */
export const AGE_BANDS = ['18-24', '25-35', '36-45', '46-55', '56+', 'Prefer not to say'] as const;
export const DISABILITY = ['Yes', 'No', 'Prefer not to say'] as const;

async function notice(ctx: Ctx, category: Category, country: string) {
  const [n] = await ctx.db.select().from(schema.consentNotices).where(and(eq(schema.consentNotices.purpose, category), eq(schema.consentNotices.countryCode, country), eq(schema.consentNotices.status, 'Published'))).limit(1);
  return n ?? null;
}
async function countryOf(ctx: Ctx) {
  const u = need(ctx).user;
  if (!u.orgId) return 'GH';
  const [o] = await ctx.db.select({ c: schema.organisations.countryCode }).from(schema.organisations).where(eq(schema.organisations.id, u.orgId)).limit(1);
  return o?.c ?? 'GH';
}
/** The latest consent row for this person and purpose decides: grants and withdrawals are append-only. */
async function latestConsent(ctx: Ctx, userId: string, category: Category) {
  const [c] = await ctx.db.select({ id: schema.consents.id, action: schema.consents.action, noticeId: schema.consents.noticeId }).from(schema.consents)
    .innerJoin(schema.consentNotices, eq(schema.consentNotices.id, schema.consents.noticeId))
    .where(and(eq(schema.consents.userId, userId), eq(schema.consentNotices.purpose, category))).orderBy(desc(schema.consents.at), desc(schema.consents.id)).limit(1);
  return c ?? null;
}

function clean(category: Category, f: Record<string, unknown>) {
  const errs: Record<string, string> = {};
  const out: Record<string, string> = {};
  if (category === 'demographics') {
    if (!(GENDERS as readonly string[]).includes(String(f.gender))) errs.gender = 'Choose one of the options';
    if (!(AGE_BANDS as readonly string[]).includes(String(f.ageBand))) errs.ageBand = 'Choose one of the options';
    out.gender = String(f.gender); out.ageBand = String(f.ageBand);
  } else {
    if (!(DISABILITY as readonly string[]).includes(String(f.status))) errs.status = 'Choose one of the options';
    out.status = String(f.status);
  }
  if (Object.keys(errs).length) throw fieldError(errs);
  return out;
}

export async function getMine(ctx: Ctx) {
  const u = need(ctx).user; const country = await countryOf(ctx);
  const out: Record<string, unknown> = {};
  for (const category of CATEGORIES) {
    const n = await notice(ctx, category, country);
    const c = await latestConsent(ctx, u.id, category);
    const [row] = await ctx.db.select().from(schema.demographicProfiles).where(and(eq(schema.demographicProfiles.subjectType, 'user'), eq(schema.demographicProfiles.subjectId, u.id), eq(schema.demographicProfiles.category, category))).limit(1);
    out[category] = { available: !!n, notice: n ? { id: n.id, version: n.version, text: n.text } : null, granted: c?.action === 'granted' && !!row, fields: c?.action === 'granted' && row ? row.fields : null };
  }
  return out;
}

export async function save(ctx: Ctx, category: Category, fields: Record<string, unknown>) {
  const u = need(ctx).user; const country = await countryOf(ctx);
  const values = clean(category, fields);
  const n = await notice(ctx, category, country);
  if (!n) throw unprocessable('This question is not open yet.');
  const prev = await latestConsent(ctx, u.id, category);
  let consentId = prev?.id;
  // Agreeing is recorded against the exact wording on screen. A new grant row is written when there is none, when the last one was a withdrawal, or when the wording has moved on.
  if (!prev || prev.action !== 'granted' || prev.noticeId !== n.id) {
    const [c] = await ctx.db.insert(schema.consents).values({ userId: u.id, orgId: u.orgId ?? null, noticeId: n.id, action: 'granted', source: 'profile' }).returning({ id: schema.consents.id });
    consentId = c.id;
  }
  await ctx.db.insert(schema.demographicProfiles).values({ subjectType: 'user', subjectId: u.id, category, fields: values, consentId: consentId! })
    .onConflictDoUpdate({ target: [schema.demographicProfiles.subjectType, schema.demographicProfiles.subjectId, schema.demographicProfiles.category], set: { fields: values, consentId: consentId!, updatedAt: new Date() } });
  // The audit entry records that a choice was made, never the answer itself.
  await audit(ctx, `demographics.${category}_saved`, 'user', u.id);
  return { ok: true };
}

/** Withdrawing writes a withdrawal row and deletes the answers. The consent history stays. */
export async function withdraw(ctx: Ctx, category: Category) {
  const u = need(ctx).user;
  const prev = await latestConsent(ctx, u.id, category);
  if (prev && prev.action === 'granted') await ctx.db.insert(schema.consents).values({ userId: u.id, orgId: u.orgId ?? null, noticeId: prev.noticeId, action: 'withdrawn', source: 'profile' });
  await ctx.db.delete(schema.demographicProfiles).where(and(eq(schema.demographicProfiles.subjectType, 'user'), eq(schema.demographicProfiles.subjectId, u.id), eq(schema.demographicProfiles.category, category)));
  await audit(ctx, `demographics.${category}_withdrawn`, 'user', u.id);
  return { ok: true };
}

/** Totals only, for the Administrator and Executive. Any group below the privacy minimum is hidden. Nothing here joins to a score. */
export async function aggregate(ctx: Ctx) {
  allow(ctx, 'consent', 'read');
  const rules = await loadRules(ctx.db);
  const rowsOf = async (category: Category, key: string) => (await ctx.db.execute(sql`select fields->>${key} as k, count(*)::int n from demographic_profiles where category=${category} and subject_type='user' group by 1 order by 1`)).rows as { k: string; n: number }[];
  const shape = (rs: { k: string; n: number }[]) => rs.map((r) => ({ key: r.k, n: suppress(r.n, rules) }));
  const total = async (category: Category) => suppress(Number(((await ctx.db.execute(sql`select count(*)::int n from demographic_profiles where category=${category} and subject_type='user'`)).rows[0] as any).n), rules);
  return {
    minGroupSize: Number(rules['privacy.min_cell_size']),
    demographics: { total: await total('demographics'), gender: shape(await rowsOf('demographics', 'gender')), ageBand: shape(await rowsOf('demographics', 'ageBand')) },
    disability: { total: await total('disability'), status: shape(await rowsOf('disability', 'status')) }
  };
}

/** What to do next, from the routing answers captured at registration. Deterministic: no AI, no promise of features that are not live. */
export async function nextBestAction(ctx: Ctx) {
  const u = need(ctx).user;
  const [a] = await ctx.db.select().from(schema.registrationAnswers).where(eq(schema.registrationAnswers.userId, u.id)).limit(1);
  return nextStep((a?.assessmentMode as AssessmentMode) ?? 'self', a?.jobRole === 'OTHER');
}
