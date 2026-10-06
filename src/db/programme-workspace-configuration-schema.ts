import { boolean, integer, jsonb, text, timestamp, uuid, index, uniqueIndex, pgTable, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { programmeWorkspaces } from './programme-workspace-schema';
import { users } from './schema';

const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

export const PROGRAMME_WORKSPACE_CONFIGURATION_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;
export type ProgrammeWorkspaceConfigurationStatus = (typeof PROGRAMME_WORKSPACE_CONFIGURATION_STATUSES)[number];

export const programmeWorkspaceConfigurations = pgTable('programme_workspace_configurations', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => programmeWorkspaces.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  status: text('status').notNull().default('DRAFT'),
  configuration: jsonb('configuration').notNull().default(sql`'{}'::jsonb`),
  objectives: jsonb('objectives').notNull().default(sql`'[]'::jsonb`),
  eligibilityRules: jsonb('eligibility_rules').notNull().default(sql`'{}'::jsonb`),
  deliveryModel: jsonb('delivery_model').notNull().default(sql`'{}'::jsonb`),
  reporting: jsonb('reporting').notNull().default(sql`'{}'::jsonb`),
  entitlements: jsonb('entitlements').notNull().default(sql`'[]'::jsonb`),
  // framework_version_id is intentionally kept as a scalar UUID here. The legacy
  // framework_versions table is migration-defined but is not represented in the
  // current Drizzle schema barrel. The authoritative database FK remains in 0040.
  frameworkVersionId: uuid('framework_version_id'),
  participantConsentRequired: boolean('participant_consent_required').notNull().default(true),
  funderReportingEnabled: boolean('funder_reporting_enabled').notNull().default(false),
  changeReason: text('change_reason'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('programme_workspace_configuration_uq').on(t.workspaceId, t.version),
  index('programme_workspace_configuration_workspace_idx').on(t.workspaceId, t.version),
  index('programme_workspace_configuration_status_idx').on(t.workspaceId, t.status),
  check('programme_workspace_configuration_status_ck', sql`${t.status} in ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED')`),
  check('programme_workspace_configuration_version_ck', sql`${t.version} >= 1`),
]);
