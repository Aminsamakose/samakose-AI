import { boolean, integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { frameworkVersions, users } from './schema';

/**
 * Normalized Business Doctor framework architecture.
 *
 * The existing framework_versions JSON columns remain backward-compatible.
 * These tables are the authoritative structured representation for new
 * framework content. Published versions are immutable at the database layer.
 */

export const FRAMEWORK_STATUSES = ['Draft', 'Published', 'Retired'] as const;
export const frameworkDimensions = pgTable('framework_dimensions', {
  id: uuid('id').primaryKey().defaultRandom(),
  frameworkVersionId: uuid('framework_version_id').notNull().references(() => frameworkVersions.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  weight: integer('weight').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('framework_dimension_version_code_uq').on(t.frameworkVersionId, t.code),
  index('framework_dimension_version_idx').on(t.frameworkVersionId, t.sortOrder),
]);

export const frameworkSubDimensions = pgTable('framework_sub_dimensions', {
  id: uuid('id').primaryKey().defaultRandom(),
  dimensionId: uuid('dimension_id').notNull().references(() => frameworkDimensions.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  weight: integer('weight').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('framework_sub_dimension_dimension_code_uq').on(t.dimensionId, t.code),
  index('framework_sub_dimension_dimension_idx').on(t.dimensionId, t.sortOrder),
]);

export const frameworkQuestions = pgTable('framework_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  frameworkVersionId: uuid('framework_version_id').notNull().references(() => frameworkVersions.id, { onDelete: 'cascade' }),
  dimensionId: uuid('dimension_id').notNull().references(() => frameworkDimensions.id),
  subDimensionId: uuid('sub_dimension_id').references(() => frameworkSubDimensions.id),
  code: text('code').notNull(),
  text: text('text').notNull(),
  responseType: text('response_type').notNull().default('ANCHORED'),
  weight: integer('weight').notNull().default(1),
  criticality: text('criticality').notNull().default('Standard'),
  sortOrder: integer('sort_order').notNull().default(0),
  appliesWhen: text('applies_when'),
  riskTag: text('risk_tag'),
  consistencyGroup: text('consistency_group'),
  anchors: jsonb('anchors').notNull().default(sql`'[]'::jsonb`),
  readinessCodes: text('readiness_codes').array().notNull().default(sql`'{}'::text[]`),
  status: text('status').notNull().default('Draft'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('framework_question_version_code_uq').on(t.frameworkVersionId, t.code),
  index('framework_question_dimension_idx').on(t.dimensionId, t.sortOrder),
  index('framework_question_sub_dimension_idx').on(t.subDimensionId),
]);

export const frameworkEvidenceRequirements = pgTable('framework_evidence_requirements', {
  id: uuid('id').primaryKey().defaultRandom(),
  questionId: uuid('question_id').notNull().references(() => frameworkQuestions.id, { onDelete: 'cascade' }),
  requirement: text('requirement').notNull(),
  method: text('method').notNull(),
  examples: text('examples').array().notNull().default(sql`'{}'::text[]`),
  minimumEvidenceClass: text('minimum_evidence_class').notNull().default('Self-reported'),
  required: boolean('required').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('framework_evidence_question_idx').on(t.questionId),
]);

export const frameworkScoringRules = pgTable('framework_scoring_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  frameworkVersionId: uuid('framework_version_id').notNull().references(() => frameworkVersions.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  ruleType: text('rule_type').notNull(),
  expression: text('expression').notNull(),
  parameters: jsonb('parameters').notNull().default(sql`'{}'::jsonb`),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('framework_scoring_rule_version_code_uq').on(t.frameworkVersionId, t.code),
  index('framework_scoring_rule_version_priority_idx').on(t.frameworkVersionId, t.priority),
]);

export const frameworkReadinessRules = pgTable('framework_readiness_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  frameworkVersionId: uuid('framework_version_id').notNull().references(() => frameworkVersions.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  purpose: text('purpose'),
  expression: text('expression').notNull(),
  unlocks: text('unlocks').array().notNull().default(sql`'{}'::text[]`),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('framework_readiness_rule_version_code_uq').on(t.frameworkVersionId, t.code),
  index('framework_readiness_rule_version_priority_idx').on(t.frameworkVersionId, t.priority),
]);

export const frameworkSourceRecords = pgTable('framework_source_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  frameworkVersionId: uuid('framework_version_id').notNull().references(() => frameworkVersions.id, { onDelete: 'cascade' }),
  componentType: text('component_type').notNull(),
  componentCode: text('component_code'),
  source: text('source').notNull(),
  rationale: text('rationale').notNull(),
  adaptation: text('adaptation').notNull(),
  approvalStatus: text('approval_status').notNull().default('Proposed'),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('framework_source_version_idx').on(t.frameworkVersionId),
  index('framework_source_component_idx').on(t.componentType, t.componentCode),
]);
