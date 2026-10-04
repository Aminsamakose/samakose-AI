import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { conflict, fieldError, notFound, unprocessable } from '@/lib/errors';
import { assertOrg, caseScope } from '@/domain/scope';
import { notifyUsers } from '@/domain/notify';
import { allow, need } from './common';

const con = schema.contracts, am = schema.contractAmendments, inv = schema.invoices;
const dec = (n: number) => n.toFixed(2);
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000);

/** Who may see which contracts. A business owner sees only their own, and never a draft. A programme manager sees their programmes and the organisations on their cases. */
export function contractScope(u: NonNullable<Ctx['user']>) {
  if (u.role === 'OWNER') return u.orgId ? and(eq(con.orgId, u.orgId), ne(con.status, 'Draft')) : sql`false`;
  if (u.role === 'PROGRAMME_MANAGER') return or(u.programmeIds.length ? inArray(con.programmeId, u.programmeIds) : sql`false`, inArray(con.orgId, sql`(select org_id from cases where ${caseScope(u)})`));
  return sql`true`;
}
async function load(ctx: Ctx, id: string, lock = false) {
  const q = ctx.db.select().from(con).where(and(eq(con.id, id), contractScope(need(ctx).user)));
  const [row] = await (lock ? q.for('update') : q).limit(1);
  if (!row) throw notFound('Contract not found');
  return row;
}
const invoicedOn = async (ctx: Ctx, contractId: string) => {
  const [r] = await ctx.db.select({ billed: sql<string>`coalesce(sum(${inv.amountGhs}) filter (where ${inv.status} <> 'Void'), 0)`, paid: sql<string>`coalesce(sum(${inv.amountGhs}) filter (where ${inv.status} = 'Paid'), 0)` }).from(inv).where(eq(inv.contractId, contractId));
  return { billed: Number(r.billed), paid: Number(r.paid) };
};

/** Does the business still owe an acceptance? True when active and either never accepted or amended after the last acceptance. */
export const needsAcceptance = (c: { status: string; acceptedAt: Date | null }, lastAmendedAt: Date | null) =>
  c.status === 'Active' && (!c.acceptedAt || (lastAmendedAt !== null && lastAmendedAt > c.acceptedAt));

export async function getContract(ctx: Ctx, id: string) {
  allow(ctx, 'contracts', 'read');
  const c = await load(ctx, id);
  const [org] = await ctx.db.select({ name: schema.organisations.name }).from(schema.organisations).where(eq(schema.organisations.id, c.orgId));
  const amendments = await ctx.db.select({ id: am.id, previousEnd: am.previousEnd, newEnd: am.newEnd, previousAmount: am.previousAmount, newAmount: am.newAmount, reason: am.reason, createdAt: am.createdAt }).from(am).where(eq(am.contractId, id)).orderBy(asc(am.createdAt));
  const last = amendments.length ? amendments[amendments.length - 1].createdAt : null;
  const [renewal] = await ctx.db.select({ id: con.id, code: con.code, status: con.status }).from(con).where(eq(con.renewalOf, id)).limit(1);
  let by: string | null = null;
  if (c.acceptedBy) by = (await ctx.db.select({ n: schema.users.name }).from(schema.users).where(eq(schema.users.id, c.acceptedBy)))[0]?.n ?? null;
  const owner = need(ctx).user.role === 'OWNER';
  return {
    id: c.id, code: c.code, orgId: c.orgId, org: org?.name, status: c.status, startDate: c.startDate, endDate: c.endDate, amountGhs: c.amountGhs, planId: c.planId, programmeId: c.programmeId,
    acceptance: { accepted: !!c.acceptedAt, acceptedAt: c.acceptedAt, signatoryName: c.signatoryName, signatoryTitle: c.signatoryTitle, method: c.acceptanceMethod, acceptedBy: by, ...(owner ? {} : { note: c.acceptanceNote }) },
    needsAcceptance: needsAcceptance(c, last), amendments, invoices: await invoicedOn(ctx, id),
    renewalOf: c.renewalOf, renewedBy: renewal ?? null
  };
}

/** The business accepts online, or staff record an acceptance that happened on paper. Either way it is evidence and is kept with who and when. */
export async function acceptContract(ctx: Ctx, id: string, b: { signatoryName: string; signatoryTitle?: string | null; note?: string | null }) {
  const u = need(ctx).user;
  const staff = u.role !== 'OWNER';
  if (staff) { allow(ctx, 'contracts', 'edit'); if ((b.note ?? '').trim().length < 5) throw fieldError({ note: 'Say how the signature was received, for example a signed copy on file' }); }
  else allow(ctx, 'contracts', 'approve');
  const c = await load(ctx, id, true);
  if (c.status !== 'Active') throw unprocessable('Only an active contract can be accepted');
  const [last] = await ctx.db.select({ at: sql<Date | null>`max(${am.createdAt})` }).from(am).where(eq(am.contractId, id));
  if (!needsAcceptance(c, last.at ? new Date(last.at) : null)) throw conflict('This contract has already been accepted');
  const name = b.signatoryName.trim();
  if (name.length < 3) throw fieldError({ signatoryName: 'Enter the full name of the person accepting' });
  await ctx.db.update(con).set({ signatoryName: name, signatoryTitle: b.signatoryTitle?.trim() || null, acceptedAt: new Date(), acceptedBy: u.id, acceptanceMethod: staff ? 'recorded' : 'online', acceptanceNote: b.note?.trim() || null, updatedAt: new Date() }).where(eq(con.id, id));
  await audit(ctx, 'contract.accepted', 'contract', id, undefined, { signatory: name, method: staff ? 'recorded' : 'online' });
  if (!staff) {
    const finance = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(and(inArray(schema.users.role, ['FINANCE', 'ADMIN']), eq(schema.users.active, true)));
    await notifyUsers(ctx, finance.map((x) => x.id), { kind: 'ContractAccepted', title: `Contract ${c.code} accepted`, body: `${name} accepted the contract for the business.`, link: '/finance/contracts' });
  }
  return { ok: true };
}

/** A change to the end date or the amount of an active contract, with a reason. The business is asked to accept again. */
export async function amendContract(ctx: Ctx, id: string, b: { endDate?: string | null; amountGhs?: number; reason: string }) {
  allow(ctx, 'contracts', 'edit');
  const c = await load(ctx, id, true);
  if (c.status !== 'Active') throw unprocessable('Only an active contract can be amended. Edit a draft directly');
  const newEnd = b.endDate ?? c.endDate; const newAmount = b.amountGhs ?? Number(c.amountGhs);
  if (b.endDate && c.endDate && b.endDate < c.endDate) throw fieldError({ endDate: 'An amendment can extend a contract but not shorten it. Cancel the contract to end it early' });
  if (newEnd === c.endDate && Math.abs(newAmount - Number(c.amountGhs)) < 0.005) throw unprocessable('Change the end date or the amount');
  if ((b.reason ?? '').trim().length < 5) throw fieldError({ reason: 'Say why the contract is being amended' });
  const { billed } = await invoicedOn(ctx, id);
  if (newAmount + 0.005 < billed) throw fieldError({ amountGhs: `GHS ${billed.toFixed(2)} has already been invoiced on this contract, so the amount cannot go below that` });
  await ctx.db.insert(am).values({ contractId: id, previousEnd: c.endDate, newEnd, previousAmount: c.amountGhs, newAmount: dec(newAmount), reason: b.reason.trim(), createdBy: need(ctx).user.id });
  await ctx.db.update(con).set({ endDate: newEnd, amountGhs: dec(newAmount), updatedAt: new Date() }).where(eq(con.id, id));
  await audit(ctx, 'contract.amended', 'contract', id, { endDate: c.endDate, amountGhs: c.amountGhs }, { endDate: newEnd, amountGhs: newAmount, reason: b.reason.trim() });
  const owners = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.orgId, c.orgId), eq(schema.users.role, 'OWNER'), eq(schema.users.active, true)));
  await notifyUsers(ctx, owners.map((x) => x.id), { kind: 'ContractAmended', title: `Contract ${c.code} was amended`, body: 'Please review the change and accept it.', link: '/my-case', email: true });
  return { ok: true };
}

/** A renewal is a new draft contract that continues from the old one. A contract can be renewed once. */
export async function renewContract(ctx: Ctx, id: string, b: { startDate?: string | null; endDate?: string | null; amountGhs?: number }) {
  allow(ctx, 'contracts', 'create');
  const old = await load(ctx, id, true);
  await assertOrg(ctx, old.orgId);
  if (!['Active', 'Expired'].includes(old.status)) throw unprocessable('Only an active or expired contract can be renewed');
  if (!old.endDate) throw unprocessable('The contract has no end date to continue from');
  const [existing] = await ctx.db.select({ code: con.code }).from(con).where(eq(con.renewalOf, id)).limit(1);
  if (existing) throw conflict(`This contract was already renewed as ${existing.code}`);
  const start = b.startDate ?? addDays(old.endDate, 1);
  const span = old.startDate ? daysBetween(old.startDate, old.endDate) : 364;
  const end = b.endDate ?? addDays(start, span);
  if (end < start) throw fieldError({ endDate: 'End date must be after the start date' });
  const [row] = await ctx.db.insert(con).values({ orgId: old.orgId, planId: old.planId, programmeId: old.programmeId, startDate: start, endDate: end, amountGhs: dec(b.amountGhs ?? Number(old.amountGhs)), renewalOf: id }).returning({ id: con.id, code: con.code });
  await audit(ctx, 'contract.renewed', 'contract', id, undefined, { renewal: row.code });
  await audit(ctx, 'contract.created', 'contract', row.id, undefined, { renewalOf: old.code });
  return row;
}
