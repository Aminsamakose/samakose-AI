/**
 * Billing credit notes (Business Doctor finance gap #3). Distinct from a refund (refunds.ts),
 * which always moves cash: a credit note reduces what's owed on an invoice without touching cash.
 *
 * Issuing posts debit REVENUE / credit RECEIVABLE when the invoice is still unpaid (it directly
 * shrinks the receivable), or debit REVENUE / credit CUSTOMER_CREDIT when the invoice is already
 * paid (there's no receivable left to reduce, so the customer is owed a credit balance instead).
 * That balance is then applied against a future invoice - possibly a different one from the
 * invoice that issued it - via applyCreditNote(), which posts debit CUSTOMER_CREDIT / credit
 * RECEIVABLE on the target invoice. A credit note can be voided (reversing its original posting)
 * only before anything has been applied against it; once applied, voiding would leave an
 * inconsistent ledger, so it's refused.
 *
 * Reuses the 'refunds' RBAC resource rather than adding a new one: the same roles (ADMIN, FINANCE,
 * EXECUTIVE-approve-only) that handle refunds handle credit notes, and the access shape (create to
 * originate, approve to move money/void) already fits exactly.
 */
import { eq } from 'drizzle-orm';
import { schema } from '@/db/client';
import type { Ctx } from '@/lib/context';
import { audit } from '@/lib/audit';
import { allow, need } from './common';
import { conflict, fieldError, notFound, unprocessable } from '@/lib/errors';
import { postLedgerEntries } from './ledger';

const crn = schema.creditNotes, cna = schema.creditNoteApplications, inv = schema.invoices, rfd = schema.refunds;
const dec = (n: number) => n.toFixed(2);
const CENT = 0.005;

export const CREDIT_NOTE_STATUSES = ['Issued', 'Void'] as const;

async function appliedTotal(ctx: Ctx, creditNoteId: string): Promise<number> {
  const rows = await ctx.db.select({ amountGhs: cna.amountGhs }).from(cna).where(eq(cna.creditNoteId, creditNoteId));
  return rows.reduce((s, r) => s + Number(r.amountGhs), 0);
}

/** What's actually still owed on an invoice: its amount, less any processed refund against it, less
 *  any non-Void credit note already issued against it (issuing doesn't check applications - a
 *  credit note reduces the issuing invoice's outstanding balance the moment it's issued). */
async function outstandingOnInvoice(ctx: Ctx, invoiceId: string): Promise<number> {
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, invoiceId)).limit(1);
  if (!i) throw notFound('Invoice not found');
  const refunds = await ctx.db.select({ amountGhs: rfd.amountGhs, status: rfd.status }).from(rfd).where(eq(rfd.invoiceId, invoiceId));
  const refundedTotal = refunds.filter((r) => r.status === 'Processed').reduce((s, r) => s + Number(r.amountGhs), 0);
  const notes = await ctx.db.select({ amountGhs: crn.amountGhs, status: crn.status }).from(crn).where(eq(crn.invoiceId, invoiceId));
  const creditedTotal = notes.filter((n) => n.status !== 'Void').reduce((s, n) => s + Number(n.amountGhs), 0);
  return Number(i.amountGhs) - refundedTotal - creditedTotal;
}

export async function listCreditNotes(ctx: Ctx, filters: { status?: string; invoiceId?: string } = {}) {
  allow(ctx, 'refunds', 'read');
  const rows = await ctx.db.select().from(crn);
  return rows.filter((r) => (!filters.status || r.status === filters.status) && (!filters.invoiceId || r.invoiceId === filters.invoiceId));
}

export async function listCreditNoteApplications(ctx: Ctx, creditNoteId: string) {
  allow(ctx, 'refunds', 'read');
  return ctx.db.select().from(cna).where(eq(cna.creditNoteId, creditNoteId));
}

export async function issueCreditNote(ctx: Ctx, b: { invoiceId: string; amountGhs: number; reason: string }) {
  allow(ctx, 'refunds', 'create');
  const u = need(ctx).user;
  if (!(b.amountGhs > 0)) throw fieldError({ amountGhs: 'Must be a positive amount' });
  if (!b.reason.trim()) throw fieldError({ reason: 'Required' });
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, b.invoiceId)).limit(1);
  if (!i) throw notFound('Invoice not found');
  if (i.status === 'Void') throw unprocessable('A void invoice cannot carry a credit note');
  const outstanding = await outstandingOnInvoice(ctx, b.invoiceId);
  if (b.amountGhs > outstanding + CENT) throw fieldError({ amountGhs: `Cannot exceed the invoice's outstanding balance of GHS ${outstanding.toFixed(2)}` });

  const stillOwed = i.status !== 'Paid';
  const posted = await postLedgerEntries(ctx, {
    referenceType: 'ADJUSTMENT', referenceId: i.id, description: `Credit note on invoice ${i.code}: ${b.reason.trim()}`,
    lines: [
      { accountCode: 'REVENUE', debitGhs: b.amountGhs },
      { accountCode: stillOwed ? 'RECEIVABLE' : 'CUSTOMER_CREDIT', creditGhs: b.amountGhs }
    ]
  });
  const [row] = await ctx.db.insert(crn).values({
    invoiceId: i.id, orgId: i.orgId, amountGhs: dec(b.amountGhs), reason: b.reason.trim(),
    status: 'Issued', issuedBy: u.id, ledgerEntryId: posted[0]?.id ?? null
  }).returning();
  await audit(ctx, 'credit_note.issued', 'credit_notes', row.id, undefined, row);
  return row;
}

/**
 * Applies some or all of a credit note's remaining balance against a (possibly different) target
 * invoice: debit CUSTOMER_CREDIT, credit RECEIVABLE on the target invoice. Only Issued (never Void)
 * credit notes can be applied, and only up to what remains unapplied.
 */
export async function applyCreditNote(ctx: Ctx, creditNoteId: string, b: { invoiceId: string; amountGhs: number }) {
  allow(ctx, 'refunds', 'approve');
  const u = need(ctx).user;
  if (!(b.amountGhs > 0)) throw fieldError({ amountGhs: 'Must be a positive amount' });
  const [note] = await ctx.db.select().from(crn).where(eq(crn.id, creditNoteId)).limit(1);
  if (!note) throw notFound('Credit note not found');
  if (note.status !== 'Issued') throw unprocessable(`A ${note.status.toLowerCase()} credit note cannot be applied`);
  const [target] = await ctx.db.select().from(inv).where(eq(inv.id, b.invoiceId)).limit(1);
  if (!target) throw notFound('Target invoice not found');
  if (target.status === 'Void') throw unprocessable('A credit note cannot be applied against a void invoice');

  const applied = await appliedTotal(ctx, creditNoteId);
  const remaining = Number(note.amountGhs) - applied;
  if (b.amountGhs > remaining + CENT) throw fieldError({ amountGhs: `Cannot exceed the credit note's remaining balance of GHS ${remaining.toFixed(2)}` });

  const posted = await postLedgerEntries(ctx, {
    referenceType: 'ADJUSTMENT', referenceId: note.id, description: `Credit note ${note.code} applied to invoice ${target.code}`,
    lines: [{ accountCode: 'CUSTOMER_CREDIT', debitGhs: b.amountGhs }, { accountCode: 'RECEIVABLE', creditGhs: b.amountGhs }]
  });
  const [row] = await ctx.db.insert(cna).values({
    creditNoteId: note.id, invoiceId: target.id, amountGhs: dec(b.amountGhs), appliedBy: u.id, ledgerEntryId: posted[0]?.id ?? null
  }).returning();
  await audit(ctx, 'credit_note.applied', 'credit_note_applications', row.id, undefined, row);
  return row;
}

/**
 * Reverses a credit note's original posting (debit RECEIVABLE-or-CUSTOMER_CREDIT, credit REVENUE -
 * the mirror image of issueCreditNote()) and marks it Void. Refused once anything has been applied
 * against it: an applied credit note has already moved money forward, and voiding it then would
 * leave the ledger inconsistent with no clean reversal path, so that case requires reversing the
 * application(s) first through a path this service doesn't expose - matching the design doc's own
 * scope (void is for a credit note issued in error, before it's acted on).
 */
export async function voidCreditNote(ctx: Ctx, creditNoteId: string, reason?: string) {
  allow(ctx, 'refunds', 'approve');
  const u = need(ctx).user;
  const [note] = await ctx.db.select().from(crn).where(eq(crn.id, creditNoteId)).limit(1);
  if (!note) throw notFound('Credit note not found');
  if (note.status !== 'Issued') throw conflict(`This credit note is already ${note.status.toLowerCase()}`);
  const applied = await appliedTotal(ctx, creditNoteId);
  if (applied > CENT) throw unprocessable('A credit note that has already been applied against an invoice cannot be voided');
  const [i] = await ctx.db.select().from(inv).where(eq(inv.id, note.invoiceId)).limit(1);
  const stillOwed = i && i.status !== 'Paid';
  await postLedgerEntries(ctx, {
    referenceType: 'ADJUSTMENT', referenceId: note.id, description: `Credit note ${note.code} voided${reason ? `: ${reason}` : ''}`,
    lines: [
      { accountCode: stillOwed ? 'RECEIVABLE' : 'CUSTOMER_CREDIT', debitGhs: Number(note.amountGhs) },
      { accountCode: 'REVENUE', creditGhs: Number(note.amountGhs) }
    ]
  });
  const [updated] = await ctx.db.update(crn).set({ status: 'Void', voidedBy: u.id, voidedAt: new Date() }).where(eq(crn.id, creditNoteId)).returning();
  await audit(ctx, 'credit_note.voided', 'credit_notes', creditNoteId, note, { ...updated, reason: reason ?? null });
  return updated;
}
