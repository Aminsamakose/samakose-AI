import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { cohorts, users } from './schema';
import { deliveryActivities, deliverySessions } from './delivery-operations-schema';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const DELIVERY_TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'] as const;
export const DELIVERY_MILESTONE_STATUSES = ['PLANNED', 'AT_RISK', 'ACHIEVED', 'MISSED', 'CANCELLED'] as const;
export const DELIVERY_EXCEPTION_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const DELIVERY_EXCEPTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

export const deliveryTasks = pgTable('delivery_tasks', {
  id: id(),
  cohortId: uuid('cohort_id').notNull().references(() => cohorts.id, { onDelete: 'cascade' }),
  activityId: uuid('activity_id').references(() => deliveryActivities.id, { onDelete: 'set null' }),
  sessionId: uuid('session_id').references(() => deliverySessions.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('TODO'),
  priority: text('priority').notNull().default('NORMAL'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  dueAt: timestamp('due_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('delivery_task_cohort_idx').on(t.cohortId, t.status, t.dueAt),
  index('delivery_task_assignee_idx').on(t.assignedTo, t.status),
  check('delivery_task_status_ck', sql`${t.status} in ('TODO','IN_PROGRESS','BLOCKED','DONE','CANCELLED')`),
  check('delivery_task_priority_ck', sql`${t.priority} in ('LOW','NORMAL','HIGH','URGENT')`),
]);

export const deliveryMilestones = pgTable('delivery_milestones', {
  id: id(),
  cohortId: uuid('cohort_id').notNull().references(() => cohorts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('PLANNED'),
  achievedAt: timestamp('achieved_at', { withTimezone: true }),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('delivery_milestone_cohort_idx').on(t.cohortId, t.dueAt),
  check('delivery_milestone_status_ck', sql`${t.status} in ('PLANNED','AT_RISK','ACHIEVED','MISSED','CANCELLED')`),
]);

export const deliveryExceptions = pgTable('delivery_exceptions', {
  id: id(),
  cohortId: uuid('cohort_id').notNull().references(() => cohorts.id, { onDelete: 'cascade' }),
  activityId: uuid('activity_id').references(() => deliveryActivities.id, { onDelete: 'set null' }),
  sessionId: uuid('session_id').references(() => deliverySessions.id, { onDelete: 'set null' }),
  taskId: uuid('task_id').references(() => deliveryTasks.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  severity: text('severity').notNull().default('MEDIUM'),
  status: text('status').notNull().default('OPEN'),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  resolution: text('resolution'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('delivery_exception_cohort_idx').on(t.cohortId, t.status, t.severity),
  index('delivery_exception_owner_idx').on(t.ownerUserId, t.status),
  check('delivery_exception_severity_ck', sql`${t.severity} in ('LOW','MEDIUM','HIGH','CRITICAL')`),
  check('delivery_exception_status_ck', sql`${t.status} in ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')`),
]);
