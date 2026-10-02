/**
 * Seeds the reference data every installation needs (questions, intervention library, plans, first administrator).
 * With SEED_DEMO=1 it also creates a demo programme with one user per role. Demo data is refused in production.
 * Safe to run more than once.
 */
import { eq, sql } from 'drizzle-orm';
import { db, closeDb, schema } from './client';
import { SEED_LIBRARY, SEED_QUESTIONS } from '@/domain/logic';
import { hashPassword, randomToken } from '@/lib/crypto';
import { ensureBaseline } from '@/services/frameworks';

export async function seedReference() {
  const d = db();
  for (const [i, [code, dimension, text, weight]] of SEED_QUESTIONS.entries())
    await d.insert(schema.questions).values({ code, dimension, text, weight, sort: i + 1 }).onConflictDoNothing();
  for (const [code, title, dimension, description, typicalDays, kpiHint] of SEED_LIBRARY)
    await d.insert(schema.libraryItems).values({ code, title, dimension, description, typicalDays, kpiHint }).onConflictDoNothing();
  await ensureBaseline(d);
  const plans = await d.select({ n: sql<number>`count(*)::int` }).from(schema.plans);
  if (!Number(plans[0].n)) await d.insert(schema.plans).values([
    { name: 'SME Diagnostic', description: 'Diagnostic, health score and a written prescription', priceGhs: '1500.00', intervalMonths: 12 },
    { name: 'SME Coaching', description: 'Diagnostic plus monthly coaching for a year', priceGhs: '6000.00', intervalMonths: 12 }
  ]);
}

export async function seedAdmin(email: string, password?: string) {
  const d = db();
  const [have] = await d.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`).limit(1);
  if (have) return { created: false as const };
  const pw = password ?? randomToken(12) + 'aA1';
  await d.insert(schema.users).values({ email: email.toLowerCase(), name: 'Administrator', role: 'ADMIN', passwordHash: await hashPassword(pw), mustChangePassword: !password ? true : false });
  return { created: true as const, password: password ? undefined : pw };
}

export const DEMO_PASSWORD = 'Demo-Passw0rd-2026';
async function seedDemo() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo data is not allowed in production');
  const d = db();
  const hash = await hashPassword(DEMO_PASSWORD);
  const mk = async (email: string, name: string, role: (typeof schema.users.$inferInsert)['role'], orgId?: string) => {
    const [ex] = await d.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (ex) return ex.id;
    return (await d.insert(schema.users).values({ email, name, role, orgId: orgId ?? null, passwordHash: hash }).returning({ id: schema.users.id }))[0].id;
  };
  let [prog] = await d.select().from(schema.programmes).where(eq(schema.programmes.name, 'Northern Agribusiness Growth')).limit(1);
  prog ??= (await d.insert(schema.programmes).values({ name: 'Northern Agribusiness Growth', funder: 'Demo Development Partner', startDate: '2026-01-01', endDate: '2027-12-31', budgetGhs: '850000.00', status: 'Active' }).returning())[0];
  let [cohort] = await d.select().from(schema.cohorts).where(eq(schema.cohorts.programmeId, prog.id)).limit(1);
  cohort ??= (await d.insert(schema.cohorts).values({ programmeId: prog.id, name: 'Cohort 1 Tamale', startDate: '2026-02-01', endDate: '2026-12-31', capacity: 30, status: 'Open' }).returning())[0];
  const admin = await mk('admin@demo.samakose.test', 'Ama Admin', 'ADMIN');
  await mk('exec@demo.samakose.test', 'Kofi Executive', 'EXECUTIVE');
  const pm = await mk('pm@demo.samakose.test', 'Abena Manager', 'PROGRAMME_MANAGER');
  await mk('consultant@demo.samakose.test', 'Yaw Consultant', 'CONSULTANT');
  await mk('reviewer@demo.samakose.test', 'Efua Reviewer', 'REVIEWER');
  await mk('coach@demo.samakose.test', 'Musah Coach', 'COACH');
  await mk('finance@demo.samakose.test', 'Adwoa Finance', 'FINANCE');
  await mk('funder@demo.samakose.test', 'Funder Contact', 'FUNDER');
  await d.insert(schema.userProgrammes).values([{ userId: pm, programmeId: prog.id }]).onConflictDoNothing();
  const funderId = (await d.select().from(schema.users).where(eq(schema.users.email, 'funder@demo.samakose.test')))[0].id;
  await d.insert(schema.userProgrammes).values([{ userId: funderId, programmeId: prog.id }]).onConflictDoNothing();
  let [org] = await d.select().from(schema.organisations).where(eq(schema.organisations.name, 'Bagabaga Shea Cooperative')).limit(1);
  org ??= (await d.insert(schema.organisations).values({ name: 'Bagabaga Shea Cooperative', type: 'AGRIFOOD', sector: 'Shea processing', region: 'Northern', district: 'Tamale', size: '11-50', contactName: 'Fatima Abdul', contactEmail: 'fatima@demo.samakose.test', consentAt: new Date(), consentBy: 'Fatima Abdul', createdBy: admin }).returning())[0];
  await mk('owner@demo.samakose.test', 'Fatima Abdul', 'OWNER', org.id);
  return { password: DEMO_PASSWORD };
}

if (process.argv[1]?.endsWith('seed.ts')) {
  (async () => {
    await seedReference();
    const email = process.env.SEED_ADMIN_EMAIL;
    if (email) {
      const r = await seedAdmin(email, process.env.SEED_ADMIN_PASSWORD);
      if (r.created) console.log(r.password ? `Administrator ${email} created. One-time password: ${r.password} (you must change it at first sign-in)` : `Administrator ${email} created.`);
      else console.log(`Administrator ${email} already exists.`);
    } else console.log('Reference data seeded. Set SEED_ADMIN_EMAIL to create the first administrator.');
    if (process.env.SEED_DEMO === '1') console.log('Demo data ready. All demo users share the password', (await seedDemo()).password);
    await closeDb();
  })().catch((e) => { console.error(e); process.exit(1); });
}
