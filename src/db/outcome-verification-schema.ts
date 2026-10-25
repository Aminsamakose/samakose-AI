import { boolean, text, timestamp, uuid, numeric, date, index, uniqueIndex, pgTable, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { cases, documents, users, evidenceClassEnum, interventions } from './schema';
import { programmes } from './schema';

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

/**
 * GAP 11 (funder-accountability gap register): a higher health score or a completed coaching
 * session does not prove increased income, profitability, employment or access to finance. These
 * two tables let a programme define the real-world outcomes it is actually funded to produce, and
 * record per-enterprise results against them with an explicit verification decision -- deliberately
 * separate from programmeIndicators (which only tracks progress against health-score-derived
 * metrics). Works for programmes with no formal diagnostic too, since a record only needs a
 * definition and a case, not a diagnosis.
 */
export const outcomeDefinitions = pgTable('outcome_definitions', {
  id: id(),
  programmeId: uuid('programme_id').notNull().references(() => programmes.id),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  reportingPeriod: text('reporting_period'),
  source: text('source'),
  verificationRequired: boolean('verification_required').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('outcome_def_name_uq').on(t.programmeId, t.name),
]);

export const OUTCOME_RECORD_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED', 'SUPERSEDED'] as const;

/**
 * One enterprise's result against one outcome definition. baseline/followup are optional on their
 * own (a programme may only ever capture one side), but a record needs at least one of them to mean
 * anything -- enforced by a check constraint rather than left to the service layer, since this is a
 * funder-accountability record, not a draft. verifiedBy/verifiedAt/decision/reason are set once, by
 * verifyOutcome(); after that the record is immutable (requirement 7: rejected/unverified results
 * are kept, not overwritten) and a correction is a NEW row with supersedesId pointing back here, with
 * this row's status flipped to SUPERSEDED -- so the original evidence and decision are always still
 * there (requirement 8).
 */
export const outcomeRecords = pgTable('outcome_records', {
  id: id(),
  definitionId: uuid('definition_id').notNull().references(() => outcomeDefinitions.id),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  baselineValue: numeric('baseline_value', { precision: 14, scale: 2 }),
  baselineDate: date('baseline_date'),
  followupValue: numeric('followup_value', { precision: 14, scale: 2 }),
  followupDate: date('followup_date'),
  /** Self-reported / Document-supported / Verified / Unverified / Missing -- the same scale already
   *  used for diagnostic evidence, reused here so "verified" means the same thing everywhere. */
  evidenceClass: evidenceClassEnum('evidence_class').notNull().default('Self-reported'),
  documentId: uuid('document_id').references(() => documents.id),
  /** Requirement 9: whether the change observed can actually be attributed to this programme, in the
   *  recorder's own words -- never inferred automatically from the score delta. */
  attributionNote: text('attribution_note'),
  status: text('status').notNull().default('PENDING'),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  decision: text('decision'),
  reason: text('reason'),
  supersedesId: uuid('supersedes_id'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('outcome_rec_def_idx').on(t.definitionId),
  index('outcome_rec_case_idx').on(t.caseId),
  index('outcome_rec_supersedes_idx').on(t.supersedesId),
  check('outcome_rec_status_ck', sql`${t.status} in ('PENDING','VERIFIED','REJECTED','SUPERSEDED')`),
  check('outcome_rec_has_value_ck', sql`${t.baselineValue} is not null or ${t.followupValue} is not null`),
]);

export const ATTRIBUTION_CONFIDENCE = ['Low', 'Medium', 'High'] as const;

/**
 * #91 (MEL outcome attribution): outcome_records.attributionNote already lets a recorder say in
 * prose whether a result is attributable to the programme -- requirement 9, never inferred
 * automatically. This table makes that claim structural instead of a sentence: a named link from one
 * outcome record to the specific intervention(s) the recorder believes contributed to it, each with
 * its own weight and confidence, so "correlation" (an outcome record with no row here, or only
 * low-confidence ones) and "verified attribution" (a high-confidence row the outcome's own
 * verification has also passed) stop being the same thing in the data. An outcome can credit more
 * than one intervention (contributionWeight splits credit across them; nothing forces the weights to
 * sum to 100, since a recorder may legitimately not know the remainder, e.g. factors outside the
 * programme). The linked intervention must belong to the same case as the outcome record -- enforced
 * in the service layer, not by a cross-table check constraint, which Postgres cannot express here.
 */
export const outcomeAttributions = pgTable('outcome_attributions', {
  id: id(),
  outcomeRecordId: uuid('outcome_record_id').notNull().references(() => outcomeRecords.id),
  interventionId: uuid('intervention_id').notNull().references(() => interventions.id),
  contributionWeight: numeric('contribution_weight', { precision: 5, scale: 2 }).notNull().default('0'),
  confidence: text('confidence').notNull().default('Low'),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('outcome_attr_rec_iv_uq').on(t.outcomeRecordId, t.interventionId),
  index('outcome_attr_rec_idx').on(t.outcomeRecordId),
  index('outcome_attr_iv_idx').on(t.interventionId),
  check('outcome_attr_confidence_ck', sql`${t.confidence} in ('Low','Medium','High')`),
  check('outcome_attr_weight_ck', sql`${t.contributionWeight} >= 0 and ${t.contributionWeight} <= 100`),
]);
