import { boolean, check, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { cohorts, users } from './schema';
import { programmeParticipants } from './programme-workspace-schema';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const DELIVERY_ACTIVITY_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const DELIVERY_SESSION_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED', 'LATE'] as const;

export const deliveryActivities = pgTable('delivery_activities', {
  id: id(),
  cohortId: uuid('cohort_id').notNull().references(() => cohorts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  activityType: text('activity_type').notNull().default('GENERAL'),
  description: text('description'),
  sequence: integer('sequence').notNull().default(1),
  scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
  scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
  status: text('status').notNull().default('PLANNED'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  cohortConfigurationVersion: integer('cohort_configuration_version'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('delivery_activity_cohort_idx').on(t.cohortId, t.sequence),
  index('delivery_activity_status_idx').on(t.status),
  check('delivery_activity_status_ck', sql`${t.status} in ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')`),
  check('delivery_activity_dates_ck', sql`${t.scheduledEnd} is null or ${t.scheduledStart} is null or ${t.scheduledEnd} >= ${t.scheduledStart}`),
  check('delivery_activity_sequence_ck', sql`${t.sequence} >= 1`),
]);

export const deliverySessions = pgTable('delivery_sessions', {
  id: id(),
  activityId: uuid('activity_id').notNull().references(() => deliveryActivities.id, { onDelete: 'cascade' }),
  facilitatorUserId: uuid('facilitator_user_id').references(() => users.id),
  mode: text('mode').notNull().default('HYBRID'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  location: text('location'),
  meetingUrl: text('meeting_url'),
  status: text('status').notNull().default('SCHEDULED'),
  capacity: integer('capacity'),
  notes: text('notes'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('delivery_session_activity_idx').on(t.activityId, t.startsAt),
  index('delivery_session_facilitator_idx').on(t.facilitatorUserId, t.startsAt),
  check('delivery_session_mode_ck', sql`${t.mode} in ('IN_PERSON','REMOTE','HYBRID','SELF_PACED')`),
  check('delivery_session_status_ck', sql`${t.status} in ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW')`),
  check('delivery_session_time_ck', sql`${t.endsAt} > ${t.startsAt}`),
  check('delivery_session_capacity_ck', sql`${t.capacity} is null or ${t.capacity} > 0`),
]);

export const deliveryAttendance = pgTable('delivery_attendance', {
  sessionId: uuid('session_id').notNull().references(() => deliverySessions.id, { onDelete: 'cascade' }),
  participantId: uuid('participant_id').notNull().references(() => programmeParticipants.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('PRESENT'),
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  note: text('note'),
  recordedBy: uuid('recorded_by').notNull().references(() => users.id),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('delivery_attendance_uq').on(t.sessionId, t.participantId),
  index('delivery_attendance_participant_idx').on(t.participantId),
  check('delivery_attendance_status_ck', sql`${t.status} in ('PRESENT','ABSENT','EXCUSED','LATE')`),
]);
