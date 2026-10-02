import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { caseScope, orgScope, programmeScope, assertProgramme } from '@/domain/scope';
import { suppress } from '@/domain/logic';
import { allow, loadRules, need, respondList } from './common';
import { forbidden } from '@/lib/errors';
import { ROLE_LABEL } from '@/lib/rbac';
import type { ListQuery } from '@/api/list';
import { csvResponse } from '@/api/framework';
import { toCsv } from '@/lib/csv';
import { audit } from '@/lib/audit';

type Row = Record<string, any>;
const rows = async (ctx: Ctx, q: ReturnType<typeof sql>) => (await ctx.db.execute(q)).rows as Row[];
const one = async (ctx: Ctx, q: ReturnType<typeof sql>) => (await rows(ctx, q))[0] ?? {};

const NEXT_STEP: Record<string, string> = {
  PROSPECT: 'Confirm registration', ONBOARDING: 'Complete the business profile', PROFILED: 'Send the diagnostic', DIAGNOSTIC: 'Complete scoring',
  DIAGNOSED: 'Draft and review the diagnosis', PRESCRIBED: 'Draft and submit the prescription', APPROVAL: 'Waiting for the reviewer',
  'IN EXECUTION': 'Owner starts the first action', COACHING: 'Hold coaching sessions', MONITORING: 'Track indicators', MIDLINE: 'Run the midline diagnostic',
  ENDLINE: 'Endline approval', 'FOLLOW-UP': 'Follow-up visit', GRADUATED: 'Graduated', 'RE-ENTRY': 'Re-entry review'
};

const scopeC = (u: Parameters<typeof caseScope>[0]) => sql`c.id in (select id from cases where ${caseScope(u)})`;
const latestScores = (u: Parameters<typeof caseScope>[0]) => sql`(select distinct on (h.case_id) h.case_id, h.overall::float overall, h.maturity, h.created_at
  from health_scores h where h.case_id in (select id from cases where ${caseScope(u)}) order by h.case_id, h.created_at desc)`;

export async function dashboard(ctx: Ctx) {
  allow(ctx, 'dashboard', 'read');
  const u = need(ctx).user;
  const base = { role: u.role, roleLabel: ROLE_LABEL[u.role], generatedAt: new Date().toISOString() };
  switch (u.role) {
    case 'ADMIN': case 'EXECUTIVE': case 'PROGRAMME_MANAGER': return { ...base, kind: 'management', ...(await management(ctx)) };
    case 'EXPERT': return { ...base, kind: 'expert', lead: await consultant(ctx, 'lead'), coach: await coach(ctx, 'coach') };
    case 'REVIEWER': return { ...base, kind: 'reviewer', ...(await reviewer(ctx)) };
    case 'FINANCE': return { ...base, kind: 'finance', ...(await finance(ctx)) };
    case 'OWNER': return { ...base, kind: 'owner', ...(await owner(ctx)) };
    case 'FUNDER': return { ...base, kind: 'funder', ...(await funder(ctx)) };
    case 'CONTENT_EDITOR': case 'SITE_MANAGER': return { ...base, kind: 'website', ...(await website(ctx)) };
  }
}

/** Website roles see only the state of the website content. No client, case or finance figures. */
async function website(ctx: Ctx) {
  const u = need(ctx).user;
  const c = await one(ctx, sql`select
    (select count(*)::int from content_docs where status='In review') in_review,
    (select count(*)::int from content_docs where status='Draft' and kind not in ('brand','contact','social','announcement','seo','home')) drafts,
    (select count(*)::int from content_docs where status='Scheduled') scheduled,
    (select count(*)::int from content_docs where status='Published') published`);
  const enquiries = u.role === 'SITE_MANAGER' ? await one(ctx, sql`select count(*)::int new_enquiries from inquiries where status='New'`) : {};
  const recent = await rows(ctx, sql`select id, kind, title, status, updated_at from content_docs order by updated_at desc limit 8`);
  return { content: c, ...enquiries, recent };
}

async function management(ctx: Ctx) {
  const u = need(ctx).user;
  const sc = caseScope(u);
  const totals = await one(ctx, sql`select
    (select count(*)::int from organisations where ${orgScope(u)} and organisations.deleted_at is null) organisations,
    (select count(*)::int from cases where ${sc}) cases,
    (select count(*)::int from cases where ${sc} and status not in ('GRADUATED')) active_cases,
    (select round(avg(overall)::numeric,1)::float from ${latestScores(u)} s) avg_score,
    (select count(*)::int from actions a where a.status <> 'Done' and a.due_date < current_date and a.case_id in (select id from cases where ${sc})) overdue_actions,
    (select count(*)::int from prescriptions p where p.status='IN REVIEW' and p.case_id in (select id from cases where ${sc}) and not exists (select 1 from prescriptions x where x.supersedes_id=p.id)) pending_reviews`);
  const byState = await rows(ctx, sql`select status, count(*)::int n from cases where ${sc} group by status`);
  const maturity = await rows(ctx, sql`select maturity, count(*)::int n from ${latestScores(u)} s group by maturity`);
  const byProgramme = await rows(ctx, sql`select p.id, p.name, count(c.id)::int cases, round(avg(s.overall)::numeric,1)::float avg_score
    from programmes p join cases c on c.programme_id = p.id left join ${latestScores(u)} s on s.case_id = c.id where ${scopeC(u)} group by p.id, p.name order by count(c.id) desc limit 8`);
  const trend = await rows(ctx, sql`select to_char(date_trunc('month', h.created_at), 'YYYY-MM') as month, round(avg(h.overall)::numeric,1)::float avg_score, count(*)::int n
    from health_scores h where h.case_id in (select id from cases where ${sc}) and h.created_at > now() - interval '12 months' group by 1 order by 1`);
  const finance = ['ADMIN', 'EXECUTIVE'].includes(u.role) ? await one(ctx, sql`select
    coalesce(sum(amount_ghs) filter (where status in ('Sent','Overdue')),0)::float outstanding,
    coalesce(sum(amount_ghs) filter (where status='Overdue'),0)::float overdue,
    coalesce(sum(amount_ghs) filter (where status='Paid' and paid_at > now() - interval '30 days'),0)::float paid_30d from invoices`) : null;
  const recent = await rows(ctx, sql`select e.id, e.type, e.created_at, c.code case_code from events e left join cases c on c.id = e.case_id
    where (e.case_id is null and ${u.role === 'ADMIN' ? sql`true` : sql`false`}) or e.case_id in (select id from cases where ${sc}) order by e.id desc limit 10`);
  return { totals, byState, maturity, byProgramme, trend, finance, recent };
}

async function consultant(ctx: Ctx, only?: 'lead') {
  const u = need(ctx).user;
  const mine = only ? sql`and c.consultant_id = ${u.id}` : sql``;
  const cases = await rows(ctx, sql`select c.id, c.code, c.status, o.name org, s.overall, s.maturity, c.updated_at,
      (select count(*)::int from actions a where a.case_id=c.id and a.status<>'Done' and a.due_date<current_date) overdue
    from cases c join organisations o on o.id=c.org_id left join ${latestScores(u)} s on s.case_id=c.id where ${scopeC(u)} ${mine} order by c.updated_at desc limit 50`);
  const returned = await rows(ctx, sql`select p.id, p.code, p.case_id, c.code case_code, p.reviewer_note reason from prescriptions p join cases c on c.id=p.case_id
    where ${scopeC(u)} ${mine} and p.status='RETURNED' and not exists (select 1 from prescriptions x where x.supersedes_id=p.id)`);
  const sessions = await rows(ctx, sql`select s.id, s.scheduled_at, c.code case_code, o.name org from coaching_sessions s join cases c on c.id=s.case_id join organisations o on o.id=c.org_id
    where ${scopeC(u)} ${mine} and s.status='Scheduled' and s.scheduled_at >= now() order by s.scheduled_at limit 5`);
  return { cases: cases.map((c) => ({ ...c, nextStep: NEXT_STEP[c.status] })), returned, sessions,
    counts: { open: cases.filter((c) => c.status !== 'GRADUATED').length, overdue: cases.reduce((n, c) => n + Number(c.overdue), 0), returned: returned.length } };
}

async function reviewer(ctx: Ctx) {
  const u = need(ctx).user;
  const queue = await rows(ctx, sql`select p.id, p.code, p.case_id, c.code case_code, o.name org, p.created_at from prescriptions p join cases c on c.id=p.case_id join organisations o on o.id=c.org_id
    where ${scopeC(u)} and p.status='IN REVIEW' and not exists (select 1 from prescriptions x where x.supersedes_id=p.id) order by p.created_at`);
  const reports = await rows(ctx, sql`select r.id, r.code, r.case_id, c.code case_code, o.name org, r.title from reports r join cases c on c.id=r.case_id join organisations o on o.id=c.org_id where ${scopeC(u)} and r.status='Draft' order by r.created_at`);
  const decided = await one(ctx, sql`select count(*) filter (where decision='APPROVED')::int approved, count(*) filter (where decision='RETURNED')::int returned from approvals where user_id=${u.id} and created_at > now() - interval '30 days'`);
  return { queue, reports, decided };
}

async function coach(ctx: Ctx, only?: 'coach') {
  const u = need(ctx).user;
  const mine = only ? sql`and c.coach_id = ${u.id}` : sql``;
  const sessions = await rows(ctx, sql`select s.id, s.scheduled_at, s.case_id, c.code case_code, o.name org, s.brief is not null has_brief from coaching_sessions s join cases c on c.id=s.case_id join organisations o on o.id=c.org_id
    where ${scopeC(u)} ${mine} and s.status='Scheduled' order by s.scheduled_at limit 20`);
  const actions = await rows(ctx, sql`select a.id, a.code, a.text, a.due_date, a.status, c.code case_code, (a.due_date < current_date) overdue from actions a join cases c on c.id=a.case_id
    where ${scopeC(u)} ${mine} and a.assignee_id=${u.id} and a.status<>'Done' order by a.due_date limit 20`);
  const cases = await rows(ctx, sql`select c.id, c.code, c.status, o.name org, s.overall, s.maturity from cases c join organisations o on o.id=c.org_id left join ${latestScores(u)} s on s.case_id=c.id where ${scopeC(u)} ${mine} order by c.updated_at desc limit 30`);
  return { sessions, actions, cases };
}

async function finance(ctx: Ctx) {
  const byStatus = await rows(ctx, sql`select status, count(*)::int n, coalesce(sum(amount_ghs),0)::float total from invoices group by status`);
  const totals = await one(ctx, sql`select coalesce(sum(amount_ghs) filter (where status in ('Sent','Overdue')),0)::float receivable,
    coalesce(sum(amount_ghs) filter (where status='Overdue'),0)::float overdue, coalesce(sum(amount_ghs) filter (where status='Paid' and paid_at > now() - interval '30 days'),0)::float paid_30d from invoices`);
  const recent = await rows(ctx, sql`select p.id, p.code, i.code invoice, o.name org, p.amount_ghs::float amount, p.status, p.created_at from payments p join invoices i on i.id=p.invoice_id join organisations o on o.id=i.org_id order by p.created_at desc limit 8`);
  const expiring = await rows(ctx, sql`select c.id, c.code, o.name org, c.end_date from contracts c join organisations o on o.id=c.org_id where c.status='Active' and c.end_date <= current_date + 30 order by c.end_date limit 10`);
  const overdue = await rows(ctx, sql`select i.id, i.code, o.name org, i.amount_ghs::float amount, (current_date - i.due_date)::int days from invoices i join organisations o on o.id=i.org_id where i.status='Overdue' order by i.due_date limit 10`);
  return { byStatus, totals, recent, expiring, overdue };
}

async function owner(ctx: Ctx) {
  const u = need(ctx).user;
  const [cs] = await rows(ctx, sql`select id, code, status from cases where ${caseScope(u)} order by created_at desc limit 1`);
  if (!cs) return { case: null };
  const history = await rows(ctx, sql`select overall::float overall, maturity, confidence_class, created_at from health_scores where case_id=${cs.id} order by created_at`);
  const last = await one(ctx, sql`select dimensions, confidence_class from health_scores where case_id=${cs.id} order by created_at desc limit 1`);
  const actions = await rows(ctx, sql`select id, text, due_date, status, owner_role, (due_date < current_date and status<>'Done') overdue from actions where case_id=${cs.id} order by status='Done', due_date limit 30`);
  const reports = await rows(ctx, sql`select id, code, title, released_at from reports where case_id=${cs.id} and status='Released' order by released_at desc limit 5`);
  const invoices = await rows(ctx, sql`select id, code, amount_ghs::float amount, due_date, status from invoices where org_id=${u.orgId} and status in ('Sent','Overdue') order by due_date`);
  const sessions = await rows(ctx, sql`select id, scheduled_at from coaching_sessions where case_id=${cs.id} and status='Scheduled' and scheduled_at >= now() order by scheduled_at limit 3`);
  return { case: { ...cs, nextStep: NEXT_STEP[cs.status] }, history, dimensions: last.dimensions ?? [], confidenceClass: last.confidence_class ?? null, actions, reports, invoices, sessions };
}

/* ----------------------------- funder view ----------------------------- */
type Group = { key: string; n: number | null };
/** Hide small groups, and hide the next smallest when a single hidden group could be worked out by subtraction. */
export function suppressGroups(groups: { key: string; n: number }[], total: number, min: number): Group[] {
  const out: Group[] = groups.map((g) => ({ key: g.key, n: g.n >= min ? g.n : null }));
  const hidden = out.filter((g) => g.n === null);
  if (hidden.length === 1) {
    const visible = out.filter((g) => g.n !== null).sort((a, b) => (a.n! - b.n!));
    if (visible[0]) visible[0].n = null;
  }
  void total;
  return out;
}

export async function programmeDashboard(ctx: Ctx, id: string) {
  allow(ctx, 'dashboard', 'read');
  const prog = await assertProgramme(ctx, id);
  const u = need(ctx).user;
  const rules = await loadRules(ctx.db);
  const min = Number(rules['privacy.min_cell_size']);
  const isFunder = u.role === 'FUNDER';
  const total = Number((await one(ctx, sql`select count(*)::int n from cases where programme_id=${id}`)).n);
  const byState = await rows(ctx, sql`select status key, count(*)::int n from cases where programme_id=${id} group by status`);
  const maturity = await rows(ctx, sql`select s.maturity key, count(*)::int n from (select distinct on (h.case_id) h.case_id, h.maturity from health_scores h join cases c on c.id=h.case_id where c.programme_id=${id} order by h.case_id, h.created_at desc) s group by s.maturity`);
  const change = await one(ctx, sql`select count(*)::int n, round(avg(last - first)::numeric,1)::float avg_change from (
      select h.case_id, (array_agg(h.overall order by h.created_at))[1]::float as first, (array_agg(h.overall order by h.created_at desc))[1]::float as last, count(*) c
      from health_scores h join cases c on c.id=h.case_id where c.programme_id=${id} group by h.case_id having count(*) >= 2) x`);
  const dims = await rows(ctx, sql`select d->>'dimension' dimension, round(avg((d->>'value')::numeric),1)::float avg_value, count(*)::int n from
      (select distinct on (h.case_id) h.dimensions from health_scores h join cases c on c.id=h.case_id where c.programme_id=${id} order by h.case_id, h.created_at desc) s, jsonb_array_elements(s.dimensions) d group by 1 order by 1`);
  const cohorts = await rows(ctx, sql`select ch.id, ch.name, ch.capacity, count(c.id)::int enrolled from cohorts ch left join cases c on c.cohort_id=ch.id where ch.programme_id=${id} group by ch.id order by ch.created_at`);
  const gender = null; void gender;
  const shared = {
    programme: { id: prog.id, code: prog.code, name: prog.name, funder: prog.funder, status: prog.status, startDate: prog.startDate, endDate: prog.endDate },
    minGroupSize: min
  };
  if (!isFunder) return { ...shared, total, byState: byState.map((g) => ({ key: g.key, n: g.n })), maturity: maturity.map((g) => ({ key: g.key, n: g.n })), scoreChange: { n: change.n ?? 0, average: change.avg_change ?? null }, dimensions: dims, cohorts, suppressed: false };
  // Funders see aggregates only. Any group smaller than the minimum is hidden.
  const dimsOut = dims.map((d) => ({ dimension: d.dimension, avgValue: suppress(Number(d.n), rules) === null ? null : d.avg_value }));
  return {
    ...shared, total: total >= min ? total : null,
    byState: total >= min ? suppressGroups(byState.map((g) => ({ key: g.key, n: g.n })), total, min) : [],
    maturity: total >= min ? suppressGroups(maturity.map((g) => ({ key: g.key, n: g.n })), total, min) : [],
    scoreChange: { n: suppress(Number(change.n ?? 0), rules), average: suppress(Number(change.n ?? 0), rules) === null ? null : change.avg_change },
    dimensions: total >= min ? dimsOut : [],
    cohorts: cohorts.map((c) => ({ id: c.id, name: c.name, capacity: c.capacity, enrolled: suppress(Number(c.enrolled), rules) })),
    suppressed: true
  };
}

async function funder(ctx: Ctx) {
  const u = need(ctx).user;
  const ps = await ctx.db.select({ id: schema.programmes.id }).from(schema.programmes).where(programmeScope(u));
  const list = [];
  for (const p of ps) list.push(await programmeDashboard(ctx, p.id));
  return { programmes: list };
}

export async function exportProgramme(ctx: Ctx, id: string) {
  allow(ctx, 'dashboard', 'export');
  const d: any = await programmeDashboard(ctx, id);
  const lines: Record<string, unknown>[] = [
    ...d.byState.map((g: Group) => ({ section: 'Cases by state', item: g.key, value: g.n === null ? `fewer than ${d.minGroupSize}` : g.n })),
    ...d.maturity.map((g: Group) => ({ section: 'Maturity', item: g.key, value: g.n === null ? `fewer than ${d.minGroupSize}` : g.n })),
    ...d.dimensions.map((x: any) => ({ section: 'Average dimension score', item: x.dimension, value: x.avgValue ?? `fewer than ${d.minGroupSize}` }))
  ];
  await audit(ctx, 'export.csv', 'programme_dashboard', id, undefined, { rows: lines.length });
  return csvResponse(`${d.programme.code}-summary.csv`, toCsv([{ key: 'section', label: 'Section' }, { key: 'item', label: 'Item' }, { key: 'value', label: 'Value' }], lines));
}
export { forbidden, eq, and, respondList };
export type { ListQuery };
