import { text, timestamp, uuid, numeric, date, index, uniqueIndex, pgTable, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { programmes, programmeBudgetLines, cohorts, users, evidenceClassEnum } from './schema';

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

export const EXPENDITURE_TYPES = ['COMMITMENT', 'PAYMENT', 'REVERSAL'] as const;
export const EXPENDITURE_STATUSES = ['ACTIVE', 'SETTLED', 'REVERSED'] as const;

/**
 * GAP 16 (funder-accountability gap register): a controlled expenditure ledger tied to budget
 * lines, distinct from the commercial billing ledger in services/ledger.ts (which posts
 * double-entry invoice/payment/revenue entries for Samakose's own paid engagements, not a
 * programme's spend against a funder's budget).
 *
 * Commitments, payments and reversals are recorded as separate rows (requirement 4), never
 * edited after the fact -- a payment that settles a commitment flips the commitment to SETTLED
 * (via settlesCommitmentId) rather than merging the two; a reversal is its own row pointing back
 * at what it reverses (via reversalOfId) and flips that row to REVERSED. The ledger stays
 * reconstructible from these rows alone (acceptance criterion: "financial totals can be
 * reproduced from source transactions").
 */
export const programmeExpenditures = pgTable('programme_expenditures', {
  id: id(),
  programmeId: uuid('programme_id').notNull().references(() => programmes.id),
  budgetLineId: uuid('budget_line_id').references(() => programmeBudgetLines.id),
  cohortId: uuid('cohort_id').references(() => cohorts.id),
  type: text('type').notNull().default('PAYMENT'),
  payee: text('payee').notNull(),
  category: text('category').notNull(),
  purpose: text('purpose'),
  amountGhs: numeric('amount_ghs', { precision: 14, scale: 2 }).notNull(),
  date: date('date').notNull(),
  /** The payee's own invoice/receipt number, when they give one -- the duplicate-recording guard
   *  (requirement 6) is a partial unique index on this, scoped to the programme. */
  reference: text('reference'),
  evidenceClass: evidenceClassEnum('evidence_class').notNull().default('Document-supported'),
  evidenceRef: text('evidence_ref'),
  settlesCommitmentId: uuid('settles_commitment_id'),
  reversalOfId: uuid('reversal_of_id'),
  status: text('status').notNull().default('ACTIVE'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('prog_exp_programme_idx').on(t.programmeId),
  index('prog_exp_budget_line_idx').on(t.budgetLineId),
  index('prog_exp_settles_idx').on(t.settlesCommitmentId),
  index('prog_exp_reversal_idx').on(t.reversalOfId),
  uniqueIndex('prog_exp_reference_uq').on(t.programmeId, t.reference).where(sql`${t.reference} is not null`),
  check('prog_exp_type_ck', sql`${t.type} in ('COMMITMENT','PAYMENT','REVERSAL')`),
  check('prog_exp_status_ck', sql`${t.status} in ('ACTIVE','SETTLED','REVERSED')`),
  check('prog_exp_amount_ck', sql`${t.amountGhs} > 0`),
]);
