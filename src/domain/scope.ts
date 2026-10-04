/**
 * Row-level scoping. Every read of client data goes through these conditions,
 * so a person only ever reaches the records their role and assignments allow.
 * A record outside the scope is reported as not found, never as forbidden.
 */
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { AuthUser, Ctx } from '@/lib/context';
import { forbidden, notFound } from '@/lib/errors';

const { cases, organisations } = schema;
const NONE = sql`false`;

/** Condition on the cases table for what this user may see. */
export function caseScope(u: AuthUser): SQL {
  switch (u.role) {
    case 'ADMIN': case 'EXECUTIVE': return sql`true`;
    case 'PROGRAMME_MANAGER': return u.programmeIds.length ? inArray(cases.programmeId, u.programmeIds) : NONE;
    // Lead and coach through the pointers; a specialist through an active assignment.
    case 'EXPERT': return or(eq(cases.consultantId, u.id), eq(cases.coachId, u.id), inArray(cases.id, sql`(select case_id from case_assignments where user_id = ${u.id} and status = 'Active' and function = 'specialist')`))!;
    case 'REVIEWER': return eq(cases.reviewerId, u.id);
    case 'OWNER': return u.orgId ? eq(cases.orgId, u.orgId) : NONE;
    default: return NONE;
  }
}

/** Condition on the organisations table. */
export function orgScope(u: AuthUser): SQL {
  switch (u.role) {
    case 'ADMIN': case 'EXECUTIVE': case 'FINANCE': return sql`true`;
    case 'OWNER': return u.orgId ? eq(organisations.id, u.orgId) : NONE;
    case 'FUNDER': return NONE;
    case 'PROGRAMME_MANAGER': case 'EXPERT':
      // Their own registrations, organisations on their cases, and registry entries no case has claimed yet.
      return or(eq(organisations.createdBy, u.id), inArray(organisations.id, sql`(select org_id from cases where ${caseScope(u)})`),
        sql`not exists (select 1 from cases x where x.org_id = ${organisations.id})`)!;
    default:
      return inArray(organisations.id, sql`(select org_id from cases where ${caseScope(u)})`);
  }
}

/** Programmes the user can see. */
export function programmeScope(u: AuthUser): SQL {
  const p = schema.programmes;
  if (['ADMIN', 'EXECUTIVE'].includes(u.role)) return sql`true`;
  if (['PROGRAMME_MANAGER', 'FUNDER'].includes(u.role)) return u.programmeIds.length ? inArray(p.id, u.programmeIds) : NONE;
  return NONE;
}

export async function assertCase(ctx: Ctx, caseId: string) {
  if (!ctx.user) throw notFound('Case not found');
  const [c] = await ctx.db.select().from(cases).where(and(eq(cases.id, caseId), caseScope(ctx.user))).limit(1);
  if (!c) throw notFound('Case not found');
  return c;
}
export async function assertOrg(ctx: Ctx, orgId: string) {
  if (!ctx.user) throw notFound('Organisation not found');
  const [o] = await ctx.db.select().from(organisations).where(and(eq(organisations.id, orgId), orgScope(ctx.user), sql`${organisations.deletedAt} is null`)).limit(1);
  if (!o) throw notFound('Organisation not found');
  return o;
}
export async function assertProgramme(ctx: Ctx, id: string) {
  if (!ctx.user) throw notFound('Programme not found');
  const [p] = await ctx.db.select().from(schema.programmes).where(and(eq(schema.programmes.id, id), programmeScope(ctx.user))).limit(1);
  if (!p) throw notFound('Programme not found');
  return p;
}

/** Staff are the people who see internal workings. Owners and funders never see AI drafts, evidence internals or risks. */
export const isInternal = (u: AuthUser) => !['OWNER', 'FUNDER'].includes(u.role);

/** On a case an expert is the lead (consultantId) or the coach (coachId), or both. */
export const expertKinds = (u: AuthUser, cs: { consultantId: string | null; coachId: string | null }) => ({ lead: cs.consultantId === u.id, coach: cs.coachId === u.id });
/** Diagnosis, prescription, evidence and diagnostic work is for the lead expert only. A coaching expert keeps read and coaching access. */
export function leadOnly(u: AuthUser | undefined, cs: { consultantId: string | null; coachId: string | null }) {
  if (u?.role === 'EXPERT' && !expertKinds(u, cs).lead) throw forbidden('Only the lead expert on this case can do this');
}
export async function assertLeadCase(ctx: Ctx, id: string) {
  const cs = await assertCase(ctx, id);
  leadOnly(ctx.user ?? undefined, cs);
  return cs;
}
