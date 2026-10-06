import { check, index, pgTable, text, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './schema';
import { programmes, cohorts } from './schema';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const COMMUNICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP'] as const;
export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ', 'CANCELLED'] as const;
export const DELIVERY_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'RETRYING'] as const;

export const notificationTemplates = pgTable('notification_templates', {
  id: id(),
  programmeId: uuid('programme_id').references(() => programmes.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  channel: text('channel').notNull().default('IN_APP'),
  subject: text('subject'),
  body: text('body').notNull(),
  active: text('active').notNull().default('true'),
  version: text('version').notNull().default('1'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(), updatedAt: updated(),
}, (t) => [
  index('notification_template_programme_idx').on(t.programmeId, t.key, t.channel),
  check('notification_template_channel_ck', sql`${t.channel} in ('IN_APP','EMAIL','SMS','WHATSAPP')`),
]);

export const notificationPreferences = pgTable('notification_preferences', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  programmeId: uuid('programme_id').references(() => programmes.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  enabled: text('enabled').notNull().default('true'),
  createdAt: created(), updatedAt: updated(),
}, (t) => [
  index('notification_pref_user_idx').on(t.userId, t.programmeId, t.channel),
  check('notification_pref_channel_ck', sql`${t.channel} in ('IN_APP','EMAIL','SMS','WHATSAPP')`),
]);

export const notificationEvents = pgTable('notification_events', {
  id: id(),
  programmeId: uuid('programme_id').references(() => programmes.id, { onDelete: 'cascade' }),
  cohortId: uuid('cohort_id').references(() => cohorts.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(),
}, (t) => [index('notification_event_scope_idx').on(t.programmeId, t.cohortId, t.eventType, t.createdAt)]);

export const notificationDeliveries = pgTable('notification_deliveries', {
  id: id(),
  notificationId: uuid('notification_id').notNull().references(() => sql`public.notifications(id)`, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  status: text('status').notNull().default('QUEUED'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  attempts: text('attempts').notNull().default('0'),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  error: text('error'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: created(), updatedAt: updated(),
}, (t) => [
  index('notification_delivery_idx').on(t.notificationId, t.status, t.nextAttemptAt),
  check('notification_delivery_channel_ck', sql`${t.channel} in ('IN_APP','EMAIL','SMS','WHATSAPP')`),
  check('notification_delivery_status_ck', sql`${t.status} in ('QUEUED','SENDING','SENT','DELIVERED','FAILED','RETRYING')`),
]);
