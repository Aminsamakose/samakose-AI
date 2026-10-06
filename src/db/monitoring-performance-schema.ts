import { check, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users, cohorts } from './schema';
import { programmeWorkspaces } from './programme-workspace-schema';
import { providerAssignments } from './provider-assignment-schema';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const MONITORING_SNAPSHOT_STATUSES = ['DRAFT', 'FINAL'] as const;
export const PROVIDER_PERFORMANCE_STATUSES = ['DRAFT', 'REVIEWED', 'FINAL'] as const;

/** Periodic, evidence-backed operational snapshot. Source records remain authoritative. */
export const programmeMonitoringSnapshots = pgTable('programme_monitoring_snapshots', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => programmeWorkspaces.id, { onDelete: 'cascade' }),
  cohortId: uuid('cohort_id').references(() => cohorts.id, { onDelete: 'set null' }),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('DRAFT'),
  metrics: jsonb('metrics').notNull().default(sql`'{}'::jsonb`),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  generatedBy: uuid('generated_by').notNull().references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('monitoring_snapshot_workspace_idx').on(t.workspaceId, t.periodStart, t.periodEnd),
  index('monitoring_snapshot_cohort_idx').on(t.cohortId, t.periodStart),
  check('monitoring_snapshot_status_ck', sql`${t.status} in ('DRAFT','FINAL')`),
  check('monitoring_snapshot_period_ck', sql`${t.periodEnd} >= ${t.periodStart}`),
]);

/** Human-reviewed provider performance. Four dimensions stay separate so weak areas are actionable. */
export const providerPerformanceReviews = pgTable('provider_performance_reviews', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => programmeWorkspaces.id, { onDelete: 'cascade' }),
  providerAssignmentId: uuid('provider_assignment_id').notNull().references(() => providerAssignments.id, { onDelete: 'cascade' }),
  providerUserId: uuid('provider_user_id').notNull().references(() => users.id),
  providerRole: text('provider_role').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  humanPerformanceScore: numeric('human_performance_score', { precision: 5, scale: 2 }),
  serviceQualityScore: numeric('service_quality_score', { precision: 5, scale: 2 }),
  clientExperienceScore: numeric('client_experience_score', { precision: 5, scale: 2 }),
  businessOutcomeScore: numeric('business_outcome_score', { precision: 5, scale: 2 }),
  compositeScore: numeric('composite_score', { precision: 5, scale: 2 }),
  evidence: jsonb('evidence').notNull().default(sql`'{}'::jsonb`),
  notes: text('notes'),
  status: text('status').notNull().default('DRAFT'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('provider_performance_period_uq').on(t.providerAssignmentId, t.periodStart, t.periodEnd),
  index('provider_performance_workspace_idx').on(t.workspaceId, t.periodStart, t.periodEnd),
  index('provider_performance_provider_idx').on(t.providerUserId, t.periodEnd),
  check('provider_performance_role_ck', sql`${t.providerRole} in ('EXPERT','COACH')`),
  check('provider_performance_status_ck', sql`${t.status} in ('DRAFT','REVIEWED','FINAL')`),
  check('provider_performance_period_ck', sql`${t.periodEnd} >= ${t.periodStart}`),
  check('provider_performance_human_ck', sql`${t.humanPerformanceScore} is null or ${t.humanPerformanceScore} between 0 and 100`),
  check('provider_performance_service_ck', sql`${t.serviceQualityScore} is null or ${t.serviceQualityScore} between 0 and 100`),
  check('provider_performance_client_ck', sql`${t.clientExperienceScore} is null or ${t.clientExperienceScore} between 0 and 100`),
  check('provider_performance_outcome_ck', sql`${t.businessOutcomeScore} is null or ${t.businessOutcomeScore} between 0 and 100`),
  check('provider_performance_composite_ck', sql`${t.compositeScore} is null or ${t.compositeScore} between 0 and 100`),
]);
