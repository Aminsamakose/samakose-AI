import { integer, jsonb, text, timestamp, uuid, index, uniqueIndex, pgTable, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { cohorts } from './schema';
import { users } from './schema';

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

export const COHORT_CONFIGURATION_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;
export type CohortConfigurationStatus = (typeof COHORT_CONFIGURATION_STATUSES)[number];

/** Versioned operational configuration for one cohort. It governs delivery without creating a second programme engine. */
export const cohortConfigurations = pgTable('cohort_configurations', {
  id: id(),
  cohortId: uuid('cohort_id').notNull().references(() => cohorts.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  status: text('status').notNull().default('DRAFT'),
  deliveryMode: text('delivery_mode').notNull().default('HYBRID'),
  schedule: jsonb('schedule').notNull().default(sql`'{}'::jsonb`),
  milestones: jsonb('milestones').notNull().default(sql`'[]'::jsonb`),
  serviceLevels: jsonb('service_levels').notNull().default(sql`'{}'::jsonb`),
  providerPlan: jsonb('provider_plan').notNull().default(sql`'{}'::jsonb`),
  sessionPlan: jsonb('session_plan').notNull().default(sql`'{}'::jsonb`),
  changeReason: text('change_reason'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('cohort_configuration_uq').on(t.cohortId, t.version),
  index('cohort_configuration_cohort_idx').on(t.cohortId, t.version),
  index('cohort_configuration_status_idx').on(t.cohortId, t.status),
  check('cohort_configuration_status_ck', sql`${t.status} in ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED')`),
  check('cohort_configuration_version_ck', sql`${t.version} >= 1`),
  check('cohort_configuration_delivery_mode_ck', sql`${t.deliveryMode} in ('IN_PERSON','REMOTE','HYBRID','SELF_PACED')`),
]);
