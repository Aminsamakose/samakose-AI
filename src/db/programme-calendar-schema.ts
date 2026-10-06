import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { cohorts, users } from './schema';
import { deliverySessions } from './delivery-operations-schema';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const CALENDAR_PROVIDERS = ['GOOGLE', 'MICROSOFT', 'ICS', 'INTERNAL'] as const;
export const CALENDAR_CONNECTION_STATUSES = ['CONNECTED', 'DISCONNECTED', 'ERROR'] as const;
export const CALENDAR_EVENT_STATUSES = ['SCHEDULED', 'UPDATED', 'CANCELLED', 'SYNC_ERROR'] as const;

/** Provider-neutral calendar connection metadata. Secrets/tokens are deliberately not stored here. */
export const calendarConnections = pgTable('calendar_connections', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  externalCalendarId: text('external_calendar_id'),
  status: text('status').notNull().default('CONNECTED'),
  accountLabel: text('account_label'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex('calendar_connection_user_provider_idx').on(t.userId, t.provider),
  index('calendar_connection_status_idx').on(t.status),
  check('calendar_connection_provider_ck', sql`${t.provider} in ('GOOGLE','MICROSOFT','ICS','INTERNAL')`),
  check('calendar_connection_status_ck', sql`${t.status} in ('CONNECTED','DISCONNECTED','ERROR')`),
]);

export const calendarEvents = pgTable('calendar_events', {
  id: id(),
  cohortId: uuid('cohort_id').notNull().references(() => cohorts.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').references(() => deliverySessions.id, { onDelete: 'set null' }),
  connectionId: uuid('connection_id').references(() => calendarConnections.id, { onDelete: 'set null' }),
  provider: text('provider').notNull().default('INTERNAL'),
  externalEventId: text('external_event_id'),
  title: text('title').notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  location: text('location'),
  meetingUrl: text('meeting_url'),
  status: text('status').notNull().default('SCHEDULED'),
  syncError: text('sync_error'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('calendar_event_cohort_time_idx').on(t.cohortId, t.startsAt),
  index('calendar_event_session_idx').on(t.sessionId),
  index('calendar_event_connection_idx').on(t.connectionId),
  index('calendar_event_external_idx').on(t.provider, t.externalEventId),
  check('calendar_event_provider_ck', sql`${t.provider} in ('GOOGLE','MICROSOFT','ICS','INTERNAL')`),
  check('calendar_event_status_ck', sql`${t.status} in ('SCHEDULED','UPDATED','CANCELLED','SYNC_ERROR')`),
  check('calendar_event_time_ck', sql`${t.endsAt} > ${t.startsAt}`),
]);
