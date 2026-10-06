import { check, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users, cohorts } from './schema';
import { programmeWorkspaces } from './programme-workspace-schema';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const PROVIDER_ROLES = ['EXPERT', 'COACH'] as const;
export const PROVIDER_ASSIGNMENT_STATUSES = ['PROPOSED', 'ACTIVE', 'PAUSED', 'ENDED', 'DECLINED'] as const;
export const PROVIDER_AVAILABILITY = ['AVAILABLE', 'LIMITED', 'UNAVAILABLE'] as const;

/** Programme-scoped provider engagement. Case assignments remain authoritative for case work. */
export const providerAssignments = pgTable('provider_assignments', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => programmeWorkspaces.id, { onDelete: 'cascade' }),
  cohortId: uuid('cohort_id').references(() => cohorts.id, { onDelete: 'set null' }),
  providerUserId: uuid('provider_user_id').notNull().references(() => users.id),
  providerRole: text('provider_role').notNull(),
  status: text('status').notNull().default('PROPOSED'),
  allocationPercent: integer('allocation_percent').notNull().default(100),
  maxParticipants: integer('max_participants'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  reason: text('reason'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('provider_assignment_workspace_idx').on(t.workspaceId, t.status),
  index('provider_assignment_provider_idx').on(t.providerUserId, t.status),
  index('provider_assignment_cohort_idx').on(t.cohortId, t.status),
  check('provider_assignment_role_ck', sql`${t.providerRole} in ('EXPERT','COACH')`),
  check('provider_assignment_status_ck', sql`${t.status} in ('PROPOSED','ACTIVE','PAUSED','ENDED','DECLINED')`),
  check('provider_assignment_allocation_ck', sql`${t.allocationPercent} between 1 and 100`),
  check('provider_assignment_participants_ck', sql`${t.maxParticipants} is null or ${t.maxParticipants} > 0`),
  check('provider_assignment_dates_ck', sql`${t.endsAt} is null or ${t.startsAt} is null or ${t.endsAt} >= ${t.startsAt}`),
]);

/** Capacity is programme/workspace specific and does not overwrite the practitioner's global profile. */
export const providerCapacities = pgTable('provider_capacities', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => programmeWorkspaces.id, { onDelete: 'cascade' }),
  providerUserId: uuid('provider_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerRole: text('provider_role').notNull(),
  maxActiveAssignments: integer('max_active_assignments').notNull().default(5),
  maxSessionsPerWeek: integer('max_sessions_per_week'),
  weeklyHours: integer('weekly_hours'),
  availability: text('availability').notNull().default('AVAILABLE'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('provider_capacity_scope_uq').on(t.workspaceId, t.providerUserId, t.providerRole),
  index('provider_capacity_provider_idx').on(t.providerUserId, t.availability),
  check('provider_capacity_role_ck', sql`${t.providerRole} in ('EXPERT','COACH')`),
  check('provider_capacity_assignments_ck', sql`${t.maxActiveAssignments} > 0`),
  check('provider_capacity_sessions_ck', sql`${t.maxSessionsPerWeek} is null or ${t.maxSessionsPerWeek} > 0`),
  check('provider_capacity_hours_ck', sql`${t.weeklyHours} is null or ${t.weeklyHours} > 0`),
  check('provider_capacity_availability_ck', sql`${t.availability} in ('AVAILABLE','LIMITED','UNAVAILABLE')`),
  check('provider_capacity_dates_ck', sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
]);
