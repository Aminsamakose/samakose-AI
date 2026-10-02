import {
  pgTable, pgSequence, pgEnum, uuid, text, integer, numeric, boolean, timestamp, date, jsonb, bigserial,
  index, uniqueIndex, primaryKey
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* Human readable codes: PREFIX-YYYY-000001, from one sequence each.   */
/* Codes are never reused or edited (design: identifier rules).        */
/* ------------------------------------------------------------------ */
export const CODE_PREFIXES = {
  org: 'SME', prog: 'PRG', cohort: 'COH', case: 'CASE', diag: 'DIAG', ev: 'EVD', doc: 'DOC', dgn: 'DGN',
  rx: 'RX', iv: 'INT', act: 'ACT', risk: 'RISK', kpi: 'KPI', sess: 'SES', rep: 'REP', ai: 'AI',
  plan: 'PLN', con: 'CON', inv: 'INV', pay: 'PAY', usr: 'USR'
} as const;
export type CodeKey = keyof typeof CODE_PREFIXES;

// Each sequence is a top-level export so drizzle-kit creates it.
export const seq_org = pgSequence('seq_org');
export const seq_prog = pgSequence('seq_prog');
export const seq_cohort = pgSequence('seq_cohort');
export const seq_case = pgSequence('seq_case');
export const seq_diag = pgSequence('seq_diag');
export const seq_ev = pgSequence('seq_ev');
export const seq_doc = pgSequence('seq_doc');
export const seq_dgn = pgSequence('seq_dgn');
export const seq_rx = pgSequence('seq_rx');
export const seq_iv = pgSequence('seq_iv');
export const seq_act = pgSequence('seq_act');
export const seq_risk = pgSequence('seq_risk');
export const seq_kpi = pgSequence('seq_kpi');
export const seq_sess = pgSequence('seq_sess');
export const seq_rep = pgSequence('seq_rep');
export const seq_ai = pgSequence('seq_ai');
export const seq_plan = pgSequence('seq_plan');
export const seq_con = pgSequence('seq_con');
export const seq_inv = pgSequence('seq_inv');
export const seq_pay = pgSequence('seq_pay');
export const seq_usr = pgSequence('seq_usr');

const codeCol = (k: CodeKey) =>
  text('code').notNull().unique().default(
    sql.raw(`'${CODE_PREFIXES[k]}-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_${k}')::text, 6, '0')`)
  );

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/* ------------------------------ enums ------------------------------ */
export const ROLES = ['ADMIN', 'EXECUTIVE', 'PROGRAMME_MANAGER', 'EXPERT', 'REVIEWER', 'FINANCE', 'OWNER', 'FUNDER', 'CONTENT_EDITOR', 'SITE_MANAGER'] as const;
export type Role = (typeof ROLES)[number];
export const roleEnum = pgEnum('role', ROLES);

export const CASE_STATES = ['PROSPECT', 'ONBOARDING', 'PROFILED', 'DIAGNOSTIC', 'DIAGNOSED', 'PRESCRIBED', 'APPROVAL', 'IN EXECUTION', 'COACHING', 'MONITORING', 'MIDLINE', 'ENDLINE', 'FOLLOW-UP', 'GRADUATED', 'RE-ENTRY'] as const;
export type CaseState = (typeof CASE_STATES)[number];
export const caseStateEnum = pgEnum('case_state', CASE_STATES);

export const EVIDENCE_CLASSES = ['Verified', 'Document-supported', 'Self-reported', 'Unverified', 'Missing'] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];
export const evidenceClassEnum = pgEnum('evidence_class', EVIDENCE_CLASSES);

export const ORG_TYPES = ['SME', 'AGRIFOOD', 'ESO'] as const;
export const orgTypeEnum = pgEnum('org_type', ORG_TYPES);

/* ------------------------- identity and access ---------------------- */
export const users = pgTable('users', {
  id: id(),
  code: codeCol('usr'),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull(),
  orgId: uuid('org_id'),
  passwordHash: text('password_hash'),
  active: boolean('active').notNull().default(true),
  mfaSecret: text('mfa_secret'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  // Self-registration: existing and invited users are 'approved' and verified. Self-registered users start pending.
  approvalStatus: text('approval_status').notNull().default('approved'), // approved | pending | rejected
  emailVerified: boolean('email_verified').notNull().default(true),
  googleSub: text('google_sub'),
  profileRequired: boolean('profile_required').notNull().default(false), // self-registered owners must finish their profile first
  signupOrgName: text('signup_org_name'),
  signupNote: text('signup_note'),
  createdAt: created(), updatedAt: updated()
}, (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`), uniqueIndex('users_google_sub_uq').on(t.googleSub), index('users_role_idx').on(t.role), index('users_org_idx').on(t.orgId)]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256 of the cookie token
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mfaVerified: boolean('mfa_verified').notNull().default(false),
  ip: text('ip'), userAgent: text('user_agent'),
  createdAt: created(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
}, (t) => [index('sessions_user_idx').on(t.userId), index('sessions_exp_idx').on(t.expiresAt)]);

export const userTokens = pgTable('user_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // invite | reset
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: created()
});

/* ------------------------------ organisations ------------------------ */
export const organisations = pgTable('organisations', {
  id: id(), code: codeCol('org'),
  name: text('name').notNull(),
  type: orgTypeEnum('type').notNull().default('SME'),
  sector: text('sector'), region: text('region'), district: text('district'),
  size: text('size'),
  registrationNumber: text('registration_number'),
  contactName: text('contact_name'), contactEmail: text('contact_email'), contactPhone: text('contact_phone'),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  consentBy: text('consent_by'),
  status: text('status').notNull().default('Active'),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('org_name_idx').on(t.name), index('org_region_idx').on(t.region)]);

/* --------------------------- programmes ------------------------------ */
export const programmes = pgTable('programmes', {
  id: id(), code: codeCol('prog'),
  name: text('name').notNull(),
  funder: text('funder'),
  startDate: date('start_date'), endDate: date('end_date'),
  budgetGhs: numeric('budget_ghs', { precision: 14, scale: 2 }),
  status: text('status').notNull().default('Draft'),
  createdAt: created(), updatedAt: updated()
});
export const cohorts = pgTable('cohorts', {
  id: id(), code: codeCol('cohort'),
  programmeId: uuid('programme_id').notNull().references(() => programmes.id),
  name: text('name').notNull(),
  startDate: date('start_date'), endDate: date('end_date'),
  capacity: integer('capacity').notNull().default(30),
  status: text('status').notNull().default('Draft'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('cohort_prog_idx').on(t.programmeId)]);
export const userProgrammes = pgTable('user_programmes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  programmeId: uuid('programme_id').notNull().references(() => programmes.id, { onDelete: 'cascade' })
}, (t) => [primaryKey({ columns: [t.userId, t.programmeId] })]);

/* ------------------------------- cases ------------------------------- */
export const cases = pgTable('cases', {
  id: id(), code: codeCol('case'),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  programmeId: uuid('programme_id').references(() => programmes.id),
  cohortId: uuid('cohort_id').references(() => cohorts.id),
  status: caseStateEnum('status').notNull().default('PROFILED'),
  consultantId: uuid('consultant_id').references(() => users.id),
  coachId: uuid('coach_id').references(() => users.id),
  reviewerId: uuid('reviewer_id').references(() => users.id),
  createdBy: uuid('created_by'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('case_org_idx').on(t.orgId), index('case_status_idx').on(t.status), index('case_prog_idx').on(t.programmeId), index('case_consultant_idx').on(t.consultantId), index('case_coach_idx').on(t.coachId), index('case_reviewer_idx').on(t.reviewerId)]);

/* ------------------------ diagnostic and evidence --------------------- */
export const questions = pgTable('questions', {
  id: id(),
  code: text('code').notNull().unique(),
  dimension: text('dimension').notNull(),
  text: text('text').notNull(),
  weight: integer('weight').notNull().default(1),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: created(), updatedAt: updated()
});

export const diagnostics = pgTable('diagnostics', {
  id: id(), code: codeCol('diag'),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  status: text('status').notNull(), // Validated | Rejected
  source: text('source').notNull().default('web'), // web | kobo
  submissionUuid: text('submission_uuid').unique(),
  completion: numeric('completion', { precision: 4, scale: 3 }).notNull().default('0'),
  validationNotes: text('validation_notes'),
  submittedBy: uuid('submitted_by'),
  version: integer('version').notNull().default(1),
  supersedesId: uuid('supersedes_id'),
  /** The framework version the questions and rules came from. History keeps the version it was taken under. */
  frameworkVersionId: uuid('framework_version_id').references((): any => frameworkVersions.id),
  createdAt: created()
}, (t) => [index('diag_case_idx').on(t.caseId)]);

export const responses = pgTable('responses', {
  id: id(),
  diagnosticId: uuid('diagnostic_id').notNull().references(() => diagnostics.id),
  questionCode: text('question_code').notNull(),
  value: integer('value').notNull(),
  /** True when a conditional question does not apply. The value is stored as 0 and ignored by scoring. */
  notApplicable: boolean('not_applicable').notNull().default(false),
  evidenceClass: evidenceClassEnum('evidence_class').notNull().default('Self-reported'),
  evidenceRef: text('evidence_ref'),
  createdAt: created()
}, (t) => [index('resp_diag_idx').on(t.diagnosticId)]);

export const documents = pgTable('documents', {
  id: id(), code: codeCol('doc'),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  caseId: uuid('case_id').references(() => cases.id),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull(),
  status: text('status').notNull().default('Stored'), // Stored | Quarantined
  uploadedBy: uuid('uploaded_by'),
  createdAt: created()
}, (t) => [index('doc_case_idx').on(t.caseId), index('doc_org_idx').on(t.orgId)]);

export const evidence = pgTable('evidence', {
  id: id(), code: codeCol('ev'),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  responseId: uuid('response_id'),
  documentId: uuid('document_id').references(() => documents.id),
  class: evidenceClassEnum('class').notNull().default('Self-reported'),
  description: text('description').notNull(),
  link: text('link'),
  verifiedBy: uuid('verified_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('ev_case_idx').on(t.caseId)]);

export const healthScores = pgTable('health_scores', {
  id: id(),
  diagnosticId: uuid('diagnostic_id').notNull().references(() => diagnostics.id),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  run: integer('run').notNull().default(1),
  overall: numeric('overall', { precision: 5, scale: 1 }).notNull(),
  maturity: text('maturity').notNull(),
  confidenceClass: text('confidence_class').notNull(),
  dimensions: jsonb('dimensions').notNull().$type<{ dimension: string; value: number }[]>(),
  evidenceShare: jsonb('evidence_share').notNull().$type<Record<string, number>>(),
  rulesSnapshot: jsonb('rules_snapshot').$type<Record<string, unknown>>(),
  frameworkVersionId: uuid('framework_version_id').references((): any => frameworkVersions.id),
  /** Sub-dimension scores, readiness levels, risks and priorities for banks that define them. Null for version 1 scoring. */
  extras: jsonb('extras').$type<Record<string, unknown>>(),
  createdAt: created()
}, (t) => [index('score_case_idx').on(t.caseId)]);

/* ------------------- diagnosis, prescription, delivery ---------------- */
export const aiRequests = pgTable('ai_requests', {
  id: id(), code: codeCol('ai'),
  agent: text('agent').notNull(),
  caseId: uuid('case_id').references(() => cases.id),
  model: text('model').notNull(),
  contextBytes: integer('context_bytes').notNull().default(0),
  requestedBy: uuid('requested_by'),
  ok: boolean('ok'),
  createdAt: created()
}, (t) => [index('ai_case_idx').on(t.caseId)]);

export const aiAttempts = pgTable('ai_attempts', {
  id: id(),
  requestId: uuid('request_id').notNull().references(() => aiRequests.id),
  attempt: integer('attempt').notNull(),
  valid: boolean('valid').notNull(),
  raw: text('raw'),
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  latencyMs: integer('latency_ms').default(0),
  error: text('error'),
  createdAt: created()
});

export const diagnoses = pgTable('diagnoses', {
  id: id(), code: codeCol('dgn'),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  diagnosticId: uuid('diagnostic_id').notNull().references(() => diagnostics.id),
  status: text('status').notNull().default('Draft'), // Draft | Reviewed | Rejected
  summary: text('summary').notNull(),
  rootCauses: jsonb('root_causes').notNull().$type<{ cause: string; evidence_ids: string[] }[]>(),
  priority: text('priority').notNull(),
  risks: jsonb('risks').notNull().$type<{ text: string; severity: string }[]>(),
  modelConfidence: numeric('model_confidence', { precision: 3, scale: 2 }),
  aiRequestId: uuid('ai_request_id'),
  version: integer('version').notNull().default(1),
  supersedesId: uuid('supersedes_id'),
  createdBy: uuid('created_by'),
  createdAt: created()
}, (t) => [index('dgn_case_idx').on(t.caseId)]);

export const libraryItems = pgTable('library_items', {
  id: id(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  dimension: text('dimension').notNull(),
  description: text('description').notNull(),
  typicalDays: integer('typical_days').notNull().default(30),
  kpiHint: text('kpi_hint'),
  active: boolean('active').notNull().default(true),
  createdAt: created(), updatedAt: updated()
});

export type PrescriptionItem = {
  library_id: string;
  actions: { text: string; owner_role: 'OWNER' | 'COACH' | 'CONSULTANT'; deadline_days: number }[];
  kpi_ids?: string[];
};
export const prescriptions = pgTable('prescriptions', {
  id: id(), code: codeCol('rx'),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  diagnosisId: uuid('diagnosis_id').notNull().references(() => diagnoses.id),
  status: text('status').notNull().default('DRAFT'), // DRAFT | IN REVIEW | APPROVED | RETURNED | SUPERSEDED
  items: jsonb('items').notNull().$type<PrescriptionItem[]>(),
  reviewerNote: text('reviewer_note'),
  aiRequestId: uuid('ai_request_id'),
  version: integer('version').notNull().default(1),
  supersedesId: uuid('supersedes_id'),
  createdBy: uuid('created_by'),
  createdAt: created()
}, (t) => [index('rx_case_idx').on(t.caseId)]);

export const interventions = pgTable('interventions', {
  id: id(), code: codeCol('iv'),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  prescriptionId: uuid('prescription_id').notNull().references(() => prescriptions.id),
  libraryCode: text('library_code').notNull(),
  status: text('status').notNull().default('PLANNED'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('iv_case_idx').on(t.caseId)]);

export const actions = pgTable('actions', {
  id: id(), code: codeCol('act'),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  interventionId: uuid('intervention_id').references(() => interventions.id),
  text: text('text').notNull(),
  ownerRole: text('owner_role').notNull(),
  assigneeId: uuid('assignee_id').references(() => users.id),
  dueDate: date('due_date').notNull(),
  status: text('status').notNull().default('Open'), // Open | In progress | Done
  evidenceNote: text('evidence_note'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  overdueNotifiedAt: timestamp('overdue_notified_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('act_case_idx').on(t.caseId), index('act_due_idx').on(t.dueDate), index('act_assignee_idx').on(t.assigneeId)]);

export const risks = pgTable('risks', {
  id: id(), code: codeCol('risk'),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  text: text('text').notNull(),
  severity: text('severity').notNull(),
  status: text('status').notNull().default('Open'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('risk_case_idx').on(t.caseId)]);

export const kpis = pgTable('kpis', {
  id: id(), code: codeCol('kpi'),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  name: text('name').notNull(),
  unit: text('unit'),
  baseline: numeric('baseline', { precision: 14, scale: 2 }),
  target: numeric('target', { precision: 14, scale: 2 }),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('kpi_case_idx').on(t.caseId)]);

export const kpiReadings = pgTable('kpi_readings', {
  id: id(),
  kpiId: uuid('kpi_id').notNull().references(() => kpis.id),
  value: numeric('value', { precision: 14, scale: 2 }).notNull(),
  readingDate: date('reading_date').notNull(),
  sourceClass: evidenceClassEnum('source_class').notNull().default('Self-reported'),
  recordedBy: uuid('recorded_by'),
  createdAt: created()
}, (t) => [index('kr_kpi_idx').on(t.kpiId)]);

export const coachingSessions = pgTable('coaching_sessions', {
  id: id(), code: codeCol('sess'),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  coachId: uuid('coach_id').references(() => users.id),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('Scheduled'), // Scheduled | Held | Missed | Cancelled
  notes: text('notes'),
  brief: text('brief'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('sess_case_idx').on(t.caseId)]);

export const approvals = pgTable('approvals', {
  id: id(),
  recordType: text('record_type').notNull(),
  recordId: uuid('record_id').notNull(),
  caseId: uuid('case_id'),
  userId: uuid('user_id').notNull(),
  decision: text('decision').notNull(),
  reason: text('reason'),
  createdAt: created()
}, (t) => [index('apr_record_idx').on(t.recordType, t.recordId)]);

export const reports = pgTable('reports', {
  id: id(), code: codeCol('rep'),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  status: text('status').notNull().default('Draft'), // Draft | Released
  title: text('title').notNull(),
  content: jsonb('content').notNull().$type<{ heading: string; body: string }[]>(),
  basis: jsonb('basis').$type<{ verified: number; unverified: number }>(),
  aiRequestId: uuid('ai_request_id'),
  createdBy: uuid('created_by'),
  releasedBy: uuid('released_by'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdAt: created()
}, (t) => [index('rep_case_idx').on(t.caseId)]);

/* ----------------------- commercial and payments ---------------------- */
export const plans = pgTable('plans', {
  id: id(), code: codeCol('plan'),
  name: text('name').notNull(),
  description: text('description'),
  priceGhs: numeric('price_ghs', { precision: 12, scale: 2 }).notNull(),
  intervalMonths: integer('interval_months').notNull().default(12),
  active: boolean('active').notNull().default(true),
  createdAt: created(), updatedAt: updated()
});
export const contracts = pgTable('contracts', {
  id: id(), code: codeCol('con'),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  planId: uuid('plan_id').references(() => plans.id),
  programmeId: uuid('programme_id').references(() => programmes.id),
  status: text('status').notNull().default('Draft'), // Draft | Active | Expired | Cancelled
  startDate: date('start_date'), endDate: date('end_date'),
  amountGhs: numeric('amount_ghs', { precision: 12, scale: 2 }).notNull(),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('con_org_idx').on(t.orgId)]);
export const invoices = pgTable('invoices', {
  id: id(), code: codeCol('inv'),
  contractId: uuid('contract_id').references(() => contracts.id),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  amountGhs: numeric('amount_ghs', { precision: 12, scale: 2 }).notNull(),
  status: text('status').notNull().default('Draft'), // Draft | Sent | Paid | Overdue | Void
  dueDate: date('due_date').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('inv_org_idx').on(t.orgId), index('inv_status_idx').on(t.status)]);
export const payments = pgTable('payments', {
  id: id(), code: codeCol('pay'),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  provider: text('provider').notNull(), // paystack | manual
  reference: text('reference').notNull().unique(),
  amountGhs: numeric('amount_ghs', { precision: 12, scale: 2 }).notNull(),
  status: text('status').notNull().default('Pending'), // Pending | Succeeded | Failed
  providerPayload: jsonb('provider_payload'),
  recordedBy: uuid('recorded_by'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('pay_inv_idx').on(t.invoiceId)]);
export const webhookEvents = pgTable('webhook_events', {
  id: id(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  type: text('type'),
  payload: jsonb('payload'),
  createdAt: created()
}, (t) => [uniqueIndex('webhook_uq').on(t.provider, t.eventId)]);

/* --------------------- platform: events, audit, jobs ------------------ */
export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  type: text('type').notNull(),
  caseId: uuid('case_id'),
  orgId: uuid('org_id'),
  actorId: uuid('actor_id'),
  payload: jsonb('payload'),
  createdAt: created()
}, (t) => [index('evt_case_idx').on(t.caseId), index('evt_type_idx').on(t.type), index('evt_created_idx').on(t.createdAt)]);

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorId: uuid('actor_id'),
  actorEmail: text('actor_email'),
  ip: text('ip'),
  requestId: text('request_id'),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  caseId: uuid('case_id'),
  before: jsonb('before'),
  after: jsonb('after')
}, (t) => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_actor_idx').on(t.actorId), index('audit_at_idx').on(t.at), index('audit_case_idx').on(t.caseId)]);

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: created()
}, (t) => [index('notif_user_idx').on(t.userId, t.readAt)]);

export const outboxEmails = pgTable('outbox_emails', {
  id: id(),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('Pending'), // Pending | Sent | Failed
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: created()
});

export const rules = pgTable('rules', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  note: text('note'),
  updatedBy: uuid('updated_by'),
  updatedAt: updated()
});

export const jobs = pgTable('jobs', {
  id: id(),
  kind: text('kind').notNull(),
  payload: jsonb('payload').notNull().default({}),
  status: text('status').notNull().default('queued'), // queued | running | done | failed
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  result: jsonb('result'),
  lastError: text('last_error'),
  requestedBy: uuid('requested_by'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('jobs_pick_idx').on(t.status, t.runAt)]);

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow()
});


/** Public website enquiries (contact, demo, newsletter). Created by anonymous visitors through one rate-limited endpoint. */
export const INQUIRY_KINDS = ['contact', 'demo', 'newsletter'] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];
export const INQUIRY_STATUSES = ['New', 'Handled', 'Spam'] as const;
export const inquiries = pgTable('inquiries', {
  id: id(),
  kind: text('kind').notNull(),
  name: text('name'),
  email: text('email').notNull(),
  organisation: text('organisation'),
  phone: text('phone'),
  interest: text('interest'),
  message: text('message'),
  consent: boolean('consent').notNull().default(false),
  source: text('source'),
  status: text('status').notNull().default('New'),
  ipHash: text('ip_hash'),
  handledBy: uuid('handled_by'),
  handledAt: timestamp('handled_at', { withTimezone: true }),
  createdAt: created()
}, (t) => [index('inquiries_status_idx').on(t.status, t.createdAt)]);

/* ---------------- website content (Phase 1 of the configuration centre) ---------------- */
export const CONTENT_STATUS = ['Draft', 'In review', 'Published', 'Scheduled', 'Archived'] as const;
/** One document per piece of public content: a setting, an FAQ, a testimonial, an article. `live` is what visitors see; `draft` is the working copy. */
export const contentDocs = pgTable('content_docs', {
  id: id(),
  kind: text('kind').notNull(),
  key: text('key').notNull(),
  title: text('title').notNull().default(''),
  status: text('status').notNull().default('Draft'),
  live: jsonb('live'),
  draft: jsonb('draft').notNull(),
  version: integer('version').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  publishAt: timestamp('publish_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by'),
  updatedBy: uuid('updated_by'),
  createdBy: uuid('created_by'),
  createdAt: created(),
  updatedAt: updated()
}, (t) => [uniqueIndex('content_docs_kind_key_uq').on(t.kind, t.key), index('content_docs_kind_idx').on(t.kind, t.status)]);

/** A frozen copy of each published version, so any change can be compared and restored. */
export const contentVersions = pgTable('content_versions', {
  id: id(),
  docId: uuid('doc_id').notNull().references(() => contentDocs.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  data: jsonb('data').notNull(),
  note: text('note'),
  authorId: uuid('author_id'),
  createdAt: created()
}, (t) => [uniqueIndex('content_versions_doc_ver_uq').on(t.docId, t.version)]);

/** Images and documents uploaded for the public website. The file itself lives in file storage; visitors reach it at /media/<id>. */
export const mediaAssets = pgTable('media_assets', {
  id: id(),
  name: text('name').notNull(),
  filename: text('filename').notNull(),
  category: text('category').notNull().default('Image'),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull(),
  altText: text('alt_text'),
  uploadedBy: uuid('uploaded_by'),
  createdAt: created(),
  updatedAt: updated()
}, (t) => [index('media_assets_cat_idx').on(t.category, t.createdAt)]);

/** Administrator-edited wording for the system emails. A row overrides the built-in text for that key. */
export const emailTemplates = pgTable('email_templates', {
  key: text('key').primaryKey(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});


/* ------------------- Business Health frameworks and versions ------------------- */
/** Optional Business Health Architecture v2 metadata. Version 1 questions carry none of it and score exactly as before. */
export type QuestionEvidence = { requirement: string; method: string; examples?: string[] };
export type FrameworkQuestion = {
  code: string; dimension: string; text: string; weight: number;
  subDimension?: string; responseType?: 'ANCHORED' | 'BANDED' | 'YNP' | 'FREQ';
  anchors?: (string | null)[]; evidence?: QuestionEvidence;
  criticality?: 'Gate' | 'Core' | 'Standard'; readiness?: string[];
  /** 'All' or a short condition. A conditional question may be answered not applicable. */
  applies?: string; riskTag?: string; consistencyGroup?: string; basis?: string;
};
/** Version-level structure: sub-dimensions, readiness indices, consistency checks and the diagnosis to measurement mapping. */
export type FrameworkMeta = {
  architecture?: string;
  subDimensions?: { code: string; domain?: string; name: string; dimension: string; mapping?: unknown }[];
  readiness?: { code: string; name: string; purpose?: string; unlocks?: string }[];
  consistencyChecks?: { id: string; itemA: string; itemB: string; rule: string; condition: string }[];
};
/** Evidence-to-framework audit trail: where a framework component came from and who approved it. */
export type FrameworkSource = {
  component: string; source: string; rationale: string; adaptation: string;
  approval: 'Proposed' | 'Approved' | 'Rejected'; approvedBy?: string | null; approvedAt?: string | null;
};
/** One framework per kind of organisation. The default one is used until a specialised framework has an approved version. */
export const frameworks = pgTable('frameworks', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  orgType: orgTypeEnum('org_type'),
  description: text('description'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: created(), updatedAt: updated()
});
/** A published version never changes; scores and diagnostics point at the version they were produced under. */
export const frameworkVersions = pgTable('framework_versions', {
  id: id(),
  frameworkId: uuid('framework_id').notNull().references(() => frameworks.id),
  version: integer('version').notNull(),
  status: text('status').notNull().default('Draft'), // Draft | Published | Retired
  questions: jsonb('questions').notNull().$type<FrameworkQuestion[]>(),
  dimensions: jsonb('dimensions').notNull().$type<string[]>(),
  rules: jsonb('rules').$type<Record<string, string | number>>(),
  sources: jsonb('sources').notNull().$type<FrameworkSource[]>().default(sql`'[]'::jsonb`),
  meta: jsonb('meta').$type<FrameworkMeta>(),
  note: text('note'),
  createdBy: uuid('created_by'),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: created()
}, (t) => [uniqueIndex('framework_version_uq').on(t.frameworkId, t.version)]);
