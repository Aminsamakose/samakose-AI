import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, forbidden, notFound, unprocessable } from '@/lib/errors';
import { assertCase, assertOrg, caseScope, isInternal, assertLeadCase } from '@/domain/scope';
import { CASE_TRANSITIONS, canTransitionCase } from '@/domain/logic';
import { notifyUsers } from '@/domain/notify';
import { orderBy, search, countOf, type ListQuery } from '@/api/list';
import { place, completeForCase } from './assignments';
import { advanceCase, allow, caseFacts, latestScore, need, respondList } from './common';
import { platformForOrgType } from '@/domain/routing';
import { CASE_STATES, type CaseState } from '@/db/schema';

const c = schema.cases, o = schema.organisations;
const consultant = schema.users;

const cols = {
  id: c.id, code: c.code, status: c.status, orgId: c.orgId, orgName: o.name, orgCode: o.code, orgType: o.type, region: o.region, programmeId: c.programmeId, cohortId: c.cohortId,
  consultantId: c.consultantId, coachId: c.coachId, reviewerId: c.reviewerId, createdAt: c.createdAt, updatedAt: c.updatedAt,
  consultantName: sql<string | null>`(select name from users where id = ${c.consultantId})`,
  programmeName: sql<string | null>`(select name from programmes where id = ${c.programmeId})`,
  score: sql<number | null>`(select overall::float from health_scores h where h.case_id = ${c.id} order by h.created_at desc limit 1)`,
  maturity: sql<string | null>`(select maturity from health_scores h where h.case_id = ${c.id} order by h.created_at desc limit 1)`
};

export async function listCases(ctx: Ctx, q: ListQuery & { status?: string; programmeId?: string; cohortId?: string; consultantId?: string; mine?: string }) {
  allow(ctx, 'cases', 'read');
  const u = need(ctx).user;
  const where = and(caseScope(u), search(q.q, [c.code, o.name, o.code]),
    q.status && (CASE_STATES as readonly string[]).includes(q.status) ? eq(c.status, q.status as CaseState) : undefined,
    q.programmeId ? eq(c.programmeId, q.programmeId) : undefined, q.cohortId ? eq(c.cohortId, q.cohortId) : undefined,
    q.consultantId ? eq(c.consultantId, q.consultantId) : undefined);
  const from = (b: any) => b.from(c).innerJoin(o, eq(o.id, c.orgId));
  return respondList(ctx, 'cases', q,
    (limit, off) => from(ctx.db.select(cols)).where(where).orderBy(orderBy(q, { code: c.code, status: c.status, org: o.name, region: o.region, updated: c.updatedAt, created: c.createdAt, score: sql`score` as any }, c.updatedAt)).limit(limit).offset(off),
    async () => Number((await from(ctx.db.select({ n: countOf })).where(where))[0].n),
    { filename: 'cases.csv', columns: [['code', 'Case'], ['orgName', 'Organisation'], ['region', 'Region'], ['status', 'State'], ['programmeName', 'Programme'], ['consultantName', 'Consultant'], ['score', 'Score'], ['maturity', 'Maturity'], ['updatedAt', 'Updated']].map(([key, label]) => ({ key, label })) });
}

export async function getCase(ctx: Ctx, id: string) {
  allow(ctx, 'cases', 'read');
  await assertCase(ctx, id);
  const [row] = await ctx.db.select(cols).from(c).innerJoin(o, eq(o.id, c.orgId)).where(eq(c.id, id)).limit(1);
  const facts = await caseFacts(ctx, id);
  const score = await latestScore(ctx, id);
  const u = need(ctx).user;
  const manual = CASE_TRANSITIONS.filter((t) => t.from === row.status && t.manual).map((t) => ({ to: t.to, trigger: t.trigger }));
  const people = await ctx.db.select({ id: consultant.id, name: consultant.name, role: consultant.role }).from(consultant)
    .where(inArray(consultant.id, [row.consultantId, row.coachId, row.reviewerId].filter(Boolean) as string[]));
  return {
    ...row,
    platform: platformForOrgType(row.orgType),
    people,
    score: score ? { overall: Number(score.overall), maturity: score.maturity, confidenceClass: score.confidenceClass, dimensions: score.dimensions, at: score.createdAt } : null,
    // Owners and funders see progress, not internal workings.
    facts: isInternal(u) ? facts : undefined,
    nextManualSteps: u.role === 'OWNER' ? [] : manual,
    automaticNext: isInternal(u) ? CASE_TRANSITIONS.filter((t) => t.from === row.status && !t.manual).map((t) => ({ to: t.to, trigger: t.trigger, needs: t.needs, missing: t.needs.filter((n) => !facts[n]) })) : []
  };
}

export async function createCase(ctx: Ctx, b: { orgId: string; programmeId?: string | null; cohortId?: string | null; startState?: 'PROSPECT' | 'ONBOARDING' | 'PROFILED' }) {
  allow(ctx, 'cases', 'create');
  const u = need(ctx).user;
  const org = await assertOrg(ctx, b.orgId);
  if (!org.consentAt) throw unprocessable('Record the organisation’s consent before opening a case');
  let programmeId = b.programmeId ?? null;
  if (b.cohortId) {
    const [co] = await ctx.db.select().from(schema.cohorts).where(eq(schema.cohorts.id, b.cohortId)).limit(1);
    if (!co) throw fieldError({ cohortId: 'Cohort not found' });
    if (programmeId && co.programmeId !== programmeId) throw fieldError({ cohortId: 'This cohort belongs to a different programme' });
    programmeId = co.programmeId;
    if (co.status === 'Closed') throw fieldError({ cohortId: 'This cohort is closed' });
    if (co.status === 'Draft') throw fieldError({ cohortId: 'This cohort is still a draft. Open it before enrolling businesses' });
    const n = Number((await ctx.db.select({ n: countOf }).from(c).where(and(eq(c.cohortId, co.id), sql`${c.status} <> 'GRADUATED'`)))[0].n);
    if (n >= co.capacity) throw conflict('This cohort is full');
  }
  if (programmeId) {
    const [pr] = await ctx.db.select().from(schema.programmes).where(eq(schema.programmes.id, programmeId)).limit(1);
    if (!pr) throw fieldError({ programmeId: 'Programme not found' });
    if (u.role === 'PROGRAMME_MANAGER' && !u.programmeIds.includes(programmeId)) throw forbidden('You are not assigned to this programme');
    if (['Completed', 'Cancelled'].includes(pr.status)) throw unprocessable('This programme is closed');
    const dupe = await ctx.db.select({ id: c.id }).from(c).where(and(eq(c.orgId, b.orgId), eq(c.programmeId, programmeId), sql`${c.status} <> 'GRADUATED'`)).limit(1);
    if (dupe.length) throw conflict('This organisation already has an open case in this programme');
  } else if (u.role === 'PROGRAMME_MANAGER') throw fieldError({ programmeId: 'Choose one of your programmes' });
  const [row] = await ctx.db.insert(c).values({
    orgId: b.orgId, programmeId, cohortId: b.cohortId ?? null, status: b.startState ?? 'PROFILED', createdBy: u.id
  }).returning({ id: c.id, code: c.code, status: c.status });
  // An expert who opens a case becomes its lead through the same checks as any other assignment (approved profile, no declared conflict).
  if (u.role === 'EXPERT') await place(ctx, row.id, { fn: 'lead', userId: u.id, reason: 'Opened the case' });
  await audit(ctx, 'case.created', 'case', row.id, undefined, { orgId: b.orgId, programmeId, cohortId: b.cohortId ?? null, status: row.status }, row.id);
  return row;
}

export async function transitionCase(ctx: Ctx, id: string, to: CaseState, reason?: string) {
  allow(ctx, 'cases', 'edit');
  const u = need(ctx).user;
  if (u.role === 'OWNER') throw forbidden();
  const cs = await assertLeadCase(ctx, id);
  const t = CASE_TRANSITIONS.find((x) => x.from === cs.status && x.to === to);
  if (!t) throw unprocessable(`No transition from ${cs.status} to ${to}`);
  if (!t.manual) throw unprocessable('This step happens automatically when its conditions are met');
  const facts = await caseFacts(ctx, id, true);
  const r = canTransitionCase(cs.status, to, facts);
  if (!r.ok) throw unprocessable(r.reason);
  if (cs.status === 'ENDLINE' && !['ADMIN', 'PROGRAMME_MANAGER'].includes(u.role)) throw forbidden('Endline is approved by a programme manager or administrator');
  await ctx.db.update(c).set({ status: to, updatedAt: new Date() }).where(eq(c.id, id));
  await audit(ctx, 'case.state', 'case', id, { status: cs.status }, { status: to, trigger: t.trigger, reason: reason ?? null, automatic: false }, id);
  await advanceCase(ctx, id);
  if (to === 'GRADUATED') await completeForCase(ctx, id);
  return { status: to };
}

export async function caseActivity(ctx: Ctx, id: string, limit = 100) {
  allow(ctx, 'cases', 'read');
  await assertCase(ctx, id);
  const u = need(ctx).user;
  const a = await ctx.db.select({ at: schema.auditLog.at, actor: schema.auditLog.actorEmail, action: schema.auditLog.action, entity: schema.auditLog.entity, entityId: schema.auditLog.entityId, after: schema.auditLog.after })
    .from(schema.auditLog).where(eq(schema.auditLog.caseId, id)).orderBy(desc(schema.auditLog.at)).limit(limit);
  // Owners see plain milestones only. Payloads with internal detail stay staff-only.
  return a.map((r) => ({ at: r.at, actor: u.role === 'OWNER' ? null : r.actor, action: r.action, entity: r.entity, entityId: r.entityId, detail: isInternal(u) ? r.after : null }))
    .filter((r) => isInternal(u) || ['case.state', 'diagnostic.submitted', 'prescription.approved', 'report.released', 'action.updated', 'case.created'].includes(r.action));
}
export { notFound };
