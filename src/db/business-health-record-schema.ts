import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { cases, organisations, users } from './schema';

/**
 * A stable, one-per-organisation anchor for the longitudinal Business Health Record.
 * Scores, diagnostics, interventions and other business data remain in their existing
 * authoritative tables; the event ledger links to those records by source type and ID.
 */
export const businessHealthRecords = pgTable('business_health_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  status: text('status').notNull().default('Active'),
  recordVersion: integer('record_version').notNull().default(1),
  latestCaseId: uuid('latest_case_id').references(() => cases.id, { onDelete: 'set null' }),
  firstAssessedAt: timestamp('first_assessed_at', { withTimezone: true }),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('bhr_org_uq').on(t.orgId),
  index('bhr_last_activity_idx').on(t.lastActivityAt),
  index('bhr_latest_case_idx').on(t.latestCaseId),
]);

/**
 * Append-only references to events in the authoritative domain tables.
 * details is a small event snapshot for explainability, not a replacement for source data.
 */
export const businessHealthRecordEvents = pgTable('business_health_record_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  recordId: uuid('record_id').notNull().references(() => businessHealthRecords.id),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  caseId: uuid('case_id').references(() => cases.id),
  eventType: text('event_type').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  summary: text('summary').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('bhr_event_record_time_idx').on(t.recordId, t.occurredAt),
  index('bhr_event_case_time_idx').on(t.caseId, t.occurredAt),
  index('bhr_event_type_time_idx').on(t.eventType, t.occurredAt),
  uniqueIndex('bhr_event_fingerprint_uq').on(t.recordId, t.sourceType, t.sourceId, t.eventType, t.occurredAt),
]);
