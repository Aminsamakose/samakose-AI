/**
 * GRA tax reporting (#201 Phase 4a): withholding-tax certificates for payees, and the periodic
 * remittance batches sent to GRA for each tax type. Built on top of tax_lines (already posted by
 * tax.ts against invoices and payouts) - this service never computes tax itself, it only reports
 * what has already been withheld.
 *
 * One certificate per tax_line (you cannot certify the same withholding twice), and one
 * remittance per tax_line (a line can only be remitted once, and only as part of a batch whose
 * declared type matches every included line's tax_rules.type).
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow } from './common';
import { conflict, fieldError, notFound, unprocessable } from '@/lib/errors';

const txc = schema.taxCertificates, txr = schema.taxRemittances, trl = schema.taxRemittanceLines;
const tl = schema.taxLines, tr = schema.taxRules, pyo = schema.professionalPayouts;
const dec = (n: number) => n.toFixed(2);

/* ------------------------------- certificates ------------------------------- */

/** Issues a withholding certificate for one payout-side tax_line. Invoice-side tax lines (VAT
 *  charged to a client) have no payee to certify, so only a payout tax_line is eligible. */
export async function issueCertificate(ctx: Ctx, b: { taxLineId: string; periodLabel: string }) {
  allow(ctx, 'tax_reports', 'create');
  const [line] = await ctx.db.select().from(tl).where(eq(tl.id, b.taxLineId)).limit(1);
  if (!line) throw notFound('tax line');
  if (!line.payoutId) throw unprocessable('Only a payout-side withholding tax line can be certified. Invoice-side VAT has no payee');
  const [payout] = await ctx.db.select().from(pyo).where(eq(pyo.id, line.payoutId)).limit(1);
  if (!payout) throw notFound('payout');
  const [existing] = await ctx.db.select({ id: txc.id }).from(txc).where(eq(txc.taxLineId, b.taxLineId)).limit(1);
  if (existing) throw conflict('A certificate has already been issued for this tax line');
  if (!b.periodLabel?.trim()) throw fieldError({ periodLabel: 'Say which period this certificate covers, for example 2026-Q3' });
  const [row] = await ctx.db.insert(txc).values({
    taxLineId: b.taxLineId, payeeId: payout.professionalId, periodLabel: b.periodLabel.trim(),
    amountGhs: line.amountGhs, issuedBy: ctx.user?.id
  }).returning();
  await audit(ctx, 'tax_certificate.issued', 'tax_certificate', row.id, undefined, { taxLineId: b.taxLineId, payeeId: payout.professionalId, amountGhs: line.amountGhs });
  return row;
}

export async function listCertificates(ctx: Ctx, filters: { payeeId?: string } = {}) {
  allow(ctx, 'tax_reports', 'read');
  const q = ctx.db.select().from(txc);
  if (filters.payeeId) return q.where(eq(txc.payeeId, filters.payeeId));
  return q;
}

/* -------------------------------- remittances -------------------------------- */

/** Bundles a set of not-yet-remitted tax lines of the SAME tax type into one GRA remittance batch. */
export async function createRemittance(ctx: Ctx, b: { periodLabel: string; type: string; taxLineIds: string[] }) {
  allow(ctx, 'tax_reports', 'create');
  if (!b.periodLabel?.trim()) throw fieldError({ periodLabel: 'Say which period this remittance covers' });
  if (!b.type?.trim()) throw fieldError({ type: 'Choose the tax type being remitted' });
  if (!b.taxLineIds?.length) throw fieldError({ taxLineIds: 'Select at least one tax line to remit' });

  const lines = await ctx.db.select({ id: tl.id, amountGhs: tl.amountGhs, ruleType: tr.type })
    .from(tl).innerJoin(tr, eq(tl.taxRuleId, tr.id)).where(inArray(tl.id, b.taxLineIds));
  if (lines.length !== b.taxLineIds.length) throw notFound('tax line');
  if (lines.some((l) => l.ruleType !== b.type)) throw fieldError({ taxLineIds: `Every line in this batch must be of type ${b.type}` });

  const already = await ctx.db.select({ id: trl.taxLineId }).from(trl).where(inArray(trl.taxLineId, b.taxLineIds));
  if (already.length) throw conflict('One or more of these tax lines has already been included in a remittance');

  const total = lines.reduce((s, l) => s + Number(l.amountGhs), 0);
  const [row] = await ctx.db.insert(txr).values({
    periodLabel: b.periodLabel.trim(), type: b.type, totalAmountGhs: dec(total), createdBy: ctx.user?.id
  }).returning();
  await ctx.db.insert(trl).values(b.taxLineIds.map((id) => ({ remittanceId: row.id, taxLineId: id })));
  await audit(ctx, 'tax_remittance.created', 'tax_remittance', row.id, undefined, { type: b.type, periodLabel: b.periodLabel.trim(), totalAmountGhs: dec(total), lineCount: b.taxLineIds.length });
  return row;
}

export async function listRemittances(ctx: Ctx, filters: { status?: string } = {}) {
  allow(ctx, 'tax_reports', 'read');
  const q = ctx.db.select().from(txr);
  if (filters.status) return q.where(eq(txr.status, filters.status));
  return q;
}

export async function getRemittance(ctx: Ctx, id: string) {
  allow(ctx, 'tax_reports', 'read');
  const [row] = await ctx.db.select().from(txr).where(eq(txr.id, id)).limit(1);
  if (!row) throw notFound('remittance');
  const lines = await ctx.db.select({ id: tl.id, amountGhs: tl.amountGhs })
    .from(trl).innerJoin(tl, eq(trl.taxLineId, tl.id)).where(eq(trl.remittanceId, id));
  return { remittance: row, lines };
}

/** Records that a Pending remittance batch has actually been paid to GRA. */
export async function markRemitted(ctx: Ctx, id: string, b: { paymentReference: string }) {
  allow(ctx, 'tax_reports', 'edit');
  const [row] = await ctx.db.select().from(txr).where(eq(txr.id, id)).limit(1);
  if (!row) throw notFound('remittance');
  if (row.status !== 'Pending') throw unprocessable(`A ${row.status} remittance cannot be marked remitted again`);
  if (!b.paymentReference?.trim()) throw fieldError({ paymentReference: 'Enter the GRA payment reference' });
  await ctx.db.update(txr).set({
    status: 'Remitted', paymentReference: b.paymentReference.trim(), remittedBy: ctx.user?.id, remittedAt: new Date()
  }).where(eq(txr.id, id));
  await audit(ctx, 'tax_remittance.remitted', 'tax_remittance', id, { status: 'Pending' }, { status: 'Remitted', paymentReference: b.paymentReference.trim() });
}
