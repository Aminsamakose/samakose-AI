import { boolean, integer, jsonb, text, timestamp, uuid, index, pgTable, check, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { programmes, organisations, users, cohorts, frameworkVersions } from './schema';

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

export const programmeWorkspaces = pgTable('programme_workspaces', {
  id: id(),
  programmeId: uuid('programme_id').notNull().unique().references(() => programmes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').notNull().default('DRAFT'),
  providerSource: text('provider_source').notNull().default('SAMAKOSE_NETWORK'),
  configurationVersion: integer('configuration_version').notNull().default(1),
  frameworkVersionId: uuid('framework_version_id').references(() => frameworkVersions.id),
  participantConsentRequired: boolean('participant_consent_required').notNull().default(true),
  funderReportingEnabled: boolean('funder_reporting_enabled').notNull().default(false),
  configuration: jsonb('configuration').notNull().default(sql`'{}'::jsonb`),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('programme_workspace_status_idx').on(t.status),
  check('programme_workspace_status_ck', sql`${t.status} in ('DRAFT','COMMERCIAL_REVIEW','INVOICED','PAYMENT_PENDING','APPROVED','CONFIGURING','READY','ACTIVE','PAUSED','COMPLETING','COMPLETED','CLOSED','ARCHIVED')`),
  check('programme_workspace_provider_ck', sql`${t.providerSource} in ('SAMAKOSE_NETWORK','BRING_YOUR_OWN','HYBRID')`),
  check('programme_workspace_config_version_ck', sql`${t.configurationVersion} >= 1`),
]);

export const WORKSPACE_ROLES = ['PROGRAMME_MANAGER', 'ASSESSOR', 'EXPERT', 'COACH', 'REVIEWER', 'FINANCE', 'MEL'] as const;

export const programmeWorkspaceMembers = pgTable('programme_workspace_members', {
  workspaceId: uuid('workspace_id').notNull().references(() => programmeWorkspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  active: boolean('active').notNull().default(true),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.userId, t.role], name: 'programme_workspace_member_pk' }),
  index('programme_workspace_member_user_idx').on(t.userId),
  check('programme_workspace_member_role_ck', sql`${t.role} in ('PROGRAMME_MANAGER','ASSESSOR','EXPERT','COACH','REVIEWER','FINANCE','MEL')`),
]);

export const PARTICIPANT_STATUSES = ['APPLICATION','ELIGIBILITY','SELECTED','INVITED','CONSENTED','ONBOARDED','COHORT_ASSIGNED','ACTIVE','COMPLETING','COMPLETED','WITHDRAWN','REJECTED'] as const;

export const programmeParticipants = pgTable('programme_participants', {
  id: id(),
  programmeId: uuid('programme_id').notNull().references(() => programmes.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => programmeWorkspaces.id, { onDelete: 'cascade' }),
  organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
  cohortId: uuid('cohort_id').references(() => cohorts.id),
  status: text('status').notNull().default('APPLICATION'),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  consentBy: uuid('consent_by').references(() => users.id),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('programme_participant_workspace_idx').on(t.workspaceId),
  index('programme_participant_cohort_idx').on(t.cohortId),
  index('programme_participant_status_idx').on(t.status),
  check('programme_participant_status_ck', sql`${t.status} in ('APPLICATION','ELIGIBILITY','SELECTED','INVITED','CONSENTED','ONBOARDED','COHORT_ASSIGNED','ACTIVE','COMPLETING','COMPLETED','WITHDRAWN','REJECTED')`),
]);
