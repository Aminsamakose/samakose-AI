import { text, timestamp, uuid, numeric, date, integer, index, uniqueIndex, pgTable, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { programmes, users } from './schema';

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

export const PROGRAMME_VERSION_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;
export type ProgrammeVersionStatus = (typeof PROGRAMME_VERSION_STATUSES)[number];

/**
 * A formal approval/versioning workflow for the programme's own core definition (name, funder,
 * dates, budget) -- distinct from programme_workspace_configurations, which governs the
 * workspace's objectives/eligibility/delivery-model/reporting layer and already has this pattern.
 * Until now, programmes.status/budgetGhs/dates could be edited directly with no sign-off, versioning
 * or approval audit trail; this gives the programme's own definition the same DRAFT -> SUBMITTED ->
 * APPROVED/REJECTED -> SUPERSEDED lifecycle, approved by ADMIN/EXECUTIVE only (budget and funder
 * commitments are an organisation-leadership decision, not a workspace reviewer's).
 */
export const programmeVersions = pgTable('programme_versions', {
  id: id(),
  programmeId: uuid('programme_id').notNull().references(() => programmes.id),
  version: integer('version').notNull(),
  status: text('status').notNull().default('DRAFT'),
  name: text('name').notNull(),
  funder: text('funder'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  budgetGhs: numeric('budget_ghs', { precision: 14, scale: 2 }),
  changeReason: text('change_reason'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('programme_version_uq').on(t.programmeId, t.version),
  index('programme_version_programme_idx').on(t.programmeId, t.status),
  check('programme_version_status_ck', sql`${t.status} in ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED')`),
  check('programme_version_number_ck', sql`${t.version} >= 1`),
]);
