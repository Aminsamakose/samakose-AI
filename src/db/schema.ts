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
export const ROLES = ['ADMIN', 'EXECUTIVE', 'PROGRAMME_MANAGER', 'EXPERT', 'REVIEWER', 'FINANCE', 'OWNER', 'FUNDER', 'CONTENT_EDITOR', 'SITE_MANAGER', 'RESPONDENT'] as const;
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
  mfaRecovery: text('mfa_recovery').array().notNull().default(sql`'{}'::text[]`),
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
  // One profile photo per person, for every role. The file sits in private storage and is served only after an access check.
  photoKey: text('photo_key'), photoMime: text('photo_mime'), photoSha256: text('photo_sha256'), photoUpdatedAt: timestamp('photo_updated_at', { withTimezone: true }),
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
  /** Where the organisation operates. The country comes first so the platform can scale beyond Ghana. */
  countryCode: text('country_code').notNull().default('GH').references((): any => countrySettings.countryCode),
  geoUnitId: uuid('geo_unit_id').references((): any => geoUnits.id),
  community: text('community'),
  urbanRural: text('urban_rural'),
  yearsOperating: integer('years_operating'),
  ownershipStructure: text('ownership_structure'),
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
export const INDICATOR_METRICS = ['enrolled', 'scored', 'rescored', 'avg_score', 'avg_change', 'pct_improved'] as const;
/** A target for a measure the platform already computes. Progress is worked out live from scores and never stored. */
export const programmeIndicators = pgTable('programme_indicators', {
  id: id(),
  programmeId: uuid('programme_id').notNull().references(() => programmes.id),
  name: text('name').notNull(),
  metric: text('metric').notNull(),
  target: numeric('target', { precision: 10, scale: 1 }).notNull(),
  dueDate: date('due_date'),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(), updatedAt: updated()
}, (t) => [uniqueIndex('ind_name_uq').on(t.programmeId, t.name)]);
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
  /** The team round this diagnostic was built from, when it came from one. */
  assessmentRoundId: uuid('assessment_round_id'),
  /** How the answers were actually given: self, hybrid, team, consultant or imported. Null for diagnostics taken before this was recorded. Scoring does not read it. */
  assessmentMode: text('assessment_mode'),
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
  /** Who gave this answer (the owner or a team respondent). Null for answers given before rounds existed. */
  answeredBy: uuid('answered_by'),
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
}, (t) => [index('doc_case_idx').on(t.caseId), index('doc_org_idx').on(t.orgId), index('doc_uploader_idx').on(t.orgId, t.uploadedBy)]);

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
  /** The registered agent and the exact version that handled the request. Null for requests before the registry existed. */
  agentId: uuid('agent_id'),
  agentVersionId: uuid('agent_version_id'),
  /** Set when the request was refused before any model call: paused, disabled, over a limit, or not approved for the live model. */
  blockedReason: text('blocked_reason'),
  createdAt: created()
}, (t) => [index('ai_case_idx').on(t.caseId), index('ai_agent_idx').on(t.agentId, t.createdAt)]);

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
  /** Set when the reminder before the session was sent. Cleared when the session is moved. */
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
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
  /** Acceptance is evidence of agreement. It never blocks activation. */
  signatoryName: text('signatory_name'), signatoryTitle: text('signatory_title'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }), acceptedBy: uuid('accepted_by').references(() => users.id),
  acceptanceMethod: text('acceptance_method'), // online | recorded
  acceptanceNote: text('acceptance_note'),
  renewalOf: uuid('renewal_of').references((): any => contracts.id),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('con_org_idx').on(t.orgId)]);
/** Append-only record of a change to an active contract's end date or amount. */
export const contractAmendments = pgTable('contract_amendments', {
  id: id(),
  contractId: uuid('contract_id').notNull().references(() => contracts.id),
  previousEnd: date('previous_end'), newEnd: date('new_end'),
  previousAmount: numeric('previous_amount', { precision: 12, scale: 2 }).notNull(), newAmount: numeric('new_amount', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created()
}, (t) => [index('amend_contract_idx').on(t.contractId, t.createdAt)]);
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
  after: jsonb('after'),
  /** HUMAN, AI or HYBRID (an AI draft made at a person's request). */
  actorType: text('actor_type').notNull().default('HUMAN')
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

/* ------------------------- AI agent registry ------------------------- */
/** One record per AI agent. The agent has no login. It runs under the requesting person's account and case scope. */
export const aiAgents = pgTable('ai_agents', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  purpose: text('purpose'),
  /** The platform role this agent works within. Informational: the agent gets no permissions from it. */
  role: text('role').notNull(),
  /** The human accountable for this agent. */
  ownerId: uuid('owner_id').references(() => users.id),
  status: text('status').notNull().default('Draft'),
  limits: jsonb('limits').notNull().default({}).$type<Record<string, unknown>>(),
  currentVersionId: uuid('current_version_id'),
  pausedFrom: text('paused_from'),
  statusReason: text('status_reason'),
  statusBy: uuid('status_by'),
  statusAt: timestamp('status_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
});
/** A version freezes the prompt, model and configuration. Changing any of them makes a new version. */
export const aiAgentVersions = pgTable('ai_agent_versions', {
  id: id(),
  agentId: uuid('agent_id').notNull().references(() => aiAgents.id),
  version: integer('version').notNull(),
  prompt: text('prompt').notNull(),
  model: text('model'),
  config: jsonb('config').notNull().$type<Record<string, unknown>>(),
  note: text('note'),
  evaluation: text('evaluation').notNull().default('Not run'),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
  evaluationNote: text('evaluation_note'),
  createdBy: uuid('created_by'),
  createdAt: created()
}, (t) => [uniqueIndex('ai_agent_version_uq').on(t.agentId, t.version)]);

/* ------------------------- certification ------------------------- */
export const CERT_STATUSES = ['Proposed', 'Certified', 'Declined', 'Revoked'] as const;
/** A business health certificate. Proposed by the lead expert, decided by a different person, valid for a fixed period. The criteria results are frozen at each step. */
export const certificates = pgTable('certificates', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  scoreId: uuid('score_id').notNull().references(() => healthScores.id),
  frameworkVersionId: uuid('framework_version_id').references((): any => frameworkVersions.id),
  level: text('level').notNull(),
  status: text('status').notNull().default('Proposed'),
  overall: numeric('overall', { precision: 5, scale: 1 }).notNull(),
  criteria: jsonb('criteria').notNull(),
  unlocks: jsonb('unlocks').notNull().default(sql`'[]'::jsonb`),
  rationale: text('rationale').notNull(),
  proposedBy: uuid('proposed_by').notNull().references(() => users.id),
  proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: text('revoke_reason'),
  /** The owner has agreed that anyone with the certificate link may confirm its level and validity. Off by default. */
  verifyPublic: boolean('verify_public').notNull().default(false)
}, (t) => [index('cert_case_idx').on(t.caseId, t.proposedAt), index('cert_org_idx').on(t.orgId)]);


/* ------------------- registration routing, phase 1 -------------------- */
/** One row per country. Ghana first. Nothing else in the platform should assume Ghana. */
export const countrySettings = pgTable('country_settings', {
  countryCode: text('country_code').primaryKey(),
  name: text('name').notNull(),
  currency: text('currency').notNull(),
  phoneCode: text('phone_code').notNull(),
  defaultLanguage: text('default_language').notNull().default('en'),
  /** Names of the location levels, for example Region, District, Community. */
  levelLabels: jsonb('level_labels').notNull().$type<string[]>().default(sql`'[]'::jsonb`),
  dataProtectionRegime: text('data_protection_regime'),
  regulatorName: text('regulator_name'),
  youthMaxAge: integer('youth_max_age').notNull().default(35),
  active: boolean('active').notNull().default(false),
  createdAt: created(), updatedAt: updated()
});

/** Location hierarchy as reference data: country, region, district, community. */
export const geoUnits = pgTable('geo_units', {
  id: id(),
  countryCode: text('country_code').notNull().references(() => countrySettings.countryCode),
  level: integer('level').notNull(),
  parentId: uuid('parent_id').references((): any => geoUnits.id),
  code: text('code'),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  source: text('source'),
  sourceDate: date('source_date'),
  createdAt: created()
}, (t) => [index('geo_parent_idx').on(t.parentId), index('geo_country_level_idx').on(t.countryCode, t.level)]);

export const CONSENT_PURPOSES = ['account', 'assessment', 'team_invites', 'demographics', 'disability', 'funder_aggregate'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Versioned consent wording, per purpose and country. */
export const consentNotices = pgTable('consent_notices', {
  id: id(),
  purpose: text('purpose').notNull(),
  countryCode: text('country_code').notNull().references(() => countrySettings.countryCode),
  version: integer('version').notNull(),
  text: text('text').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }),
  status: text('status').notNull().default('Draft'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created()
}, (t) => [uniqueIndex('consent_notice_uq').on(t.purpose, t.countryCode, t.version)]);

/** Every grant and every withdrawal is a new row. Append-only. */
export const consents = pgTable('consents', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  orgId: uuid('org_id').references(() => organisations.id),
  noticeId: uuid('notice_id').notNull().references(() => consentNotices.id),
  action: text('action').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  source: text('source').notNull()
}, (t) => [index('consent_user_idx').on(t.userId, t.at)]);

/** The routing inputs captured at registration. Job role is not permission. */
export const registrationAnswers = pgTable('registration_answers', {
  id: id(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  orgId: uuid('org_id').references(() => organisations.id),
  platform: text('platform').notNull(),
  jobRole: text('job_role').notNull(),
  jobRoleOther: text('job_role_other'),
  responsibility: text('responsibility'),
  assessmentMode: text('assessment_mode').notNull(),
  suggestionSource: text('suggestion_source').notNull().default('user'),
  createdAt: created(), updatedAt: updated()
});

/** Versioned, Administrator-managed mapping from job role to assessment area. One Published version per framework. */
export const roleMappings = pgTable('role_mappings', {
  id: id(),
  frameworkCode: text('framework_code').notNull(),
  version: integer('version').notNull(),
  status: text('status').notNull().default('Draft'),
  data: jsonb('data').notNull(),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: created()
}, (t) => [uniqueIndex('role_mapping_version_uq').on(t.frameworkCode, t.version)]);

/** Optional demographics and disability status. Kept apart from the organisation record so access and withdrawal stay simple.
 *  Never read by scoring or diagnosis. Each category needs its own granted consent. */
export const demographicProfiles = pgTable('demographic_profiles', {
  id: id(),
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  category: text('category').notNull(),
  fields: jsonb('fields').notNull().default(sql`'{}'::jsonb`),
  consentId: uuid('consent_id').notNull().references(() => consents.id),
  updatedAt: updated()
}, (t) => [uniqueIndex('demographic_subject_uq').on(t.subjectType, t.subjectId, t.category)]);

/** A colleague the business owner has invited to answer part of the assessment. Access comes only from assignments, never from the job role. */
export const orgMembers = pgTable('org_members', {
  id: id(),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  jobRole: text('job_role').notNull(),
  status: text('status').notNull().default('invited'),
  invitedBy: uuid('invited_by').references(() => users.id),
  createdAt: created(), updatedAt: updated()
}, (t) => [uniqueIndex('org_member_uq').on(t.orgId, t.userId), index('org_member_user_idx').on(t.userId)]);

/** Who answers which assessment area for a business. Suggested by the rule, confirmed by the owner. Rounds attach to this later. */
export const areaAssignments = pgTable('area_assignments', {
  id: id(),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  platform: text('platform').notNull(),
  subDimension: text('sub_dimension').notNull(),
  memberId: uuid('member_id').references(() => orgMembers.id),
  suggestedBy: text('suggested_by').notNull().default('rule'),
  confirmedBy: uuid('confirmed_by').references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  updatedAt: updated()
}, (t) => [uniqueIndex('area_assignment_uq').on(t.orgId, t.platform, t.subDimension)]);


/** One team assessment in progress for a case. The owner collects answers from colleagues as drafts, then submits once. Scoring only ever sees the full answer set at submission. */
export const assessmentRounds = pgTable('assessment_rounds', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  frameworkVersionId: uuid('framework_version_id').references((): any => frameworkVersions.id),
  status: text('status').notNull().default('Collecting'),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  diagnosticId: uuid('diagnostic_id').references((): any => diagnostics.id),
  createdAt: created(), submittedAt: timestamp('submitted_at', { withTimezone: true })
}, (t) => [index('round_case_idx').on(t.caseId), uniqueIndex('round_one_open_uq').on(t.caseId).where(sql`${t.status} = 'Collecting'`)]);

/** Answers saved before submission. They are not evidence and are never scored until the owner submits the round. */
export const responseDrafts = pgTable('response_drafts', {
  id: id(),
  roundId: uuid('round_id').notNull().references(() => assessmentRounds.id),
  questionCode: text('question_code').notNull(),
  value: integer('value'),
  notApplicable: boolean('not_applicable').notNull().default(false),
  evidenceClass: text('evidence_class').notNull().default('Self-reported'),
  evidenceRef: text('evidence_ref'),
  note: text('note'),
  answeredBy: uuid('answered_by').notNull().references(() => users.id),
  updatedAt: updated()
}, (t) => [uniqueIndex('draft_round_question_uq').on(t.roundId, t.questionCode)]);


/** Feedback from signed-in people. `app` is UAT feedback about a screen; `result` is the owner's view of whether a score matched their business.
 *  Only the administrator reads it. It never reaches scoring, diagnosis or any report. */
export const feedback = pgTable('feedback', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: text('role').notNull(),
  orgId: uuid('org_id').references(() => organisations.id),
  kind: text('kind').notNull(),
  page: text('page'),
  rating: integer('rating'),
  accuracy: text('accuracy'),
  message: text('message'),
  caseId: uuid('case_id').references(() => cases.id),
  healthScoreId: uuid('health_score_id').references(() => healthScores.id),
  status: text('status').notNull().default('New'),
  adminNote: text('admin_note'),
  handledBy: uuid('handled_by').references(() => users.id),
  handledAt: timestamp('handled_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('feedback_status_idx').on(t.status, t.createdAt), uniqueIndex('feedback_result_uq').on(t.userId, t.healthScoreId).where(sql`${t.kind} = 'result'`)]);


/* ------------------------ practitioner network ------------------------ */
export const PRACTITIONER_FUNCTIONS = ['expert', 'coach'] as const;
export const VETTING_STATUSES = ['Draft', 'Submitted', 'Approved', 'Rejected', 'Suspended'] as const;
export const AVAILABILITY = ['Available', 'Limited', 'Unavailable'] as const;
export const ASSIGNMENT_FUNCTIONS = ['lead', 'specialist', 'coach', 'reviewer'] as const;
export const ASSIGNMENT_STATUSES = ['Active', 'Declined', 'Completed', 'Replaced'] as const;
export const RATING_SOURCES = ['client', 'reviewer', 'programme_manager'] as const;

/** One professional profile per expert or coach, attached to the same user identity as everyone else. Fees stay in rateNote, which only administrators read. */
export const practitionerProfiles = pgTable('practitioner_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  functions: text('functions').array().notNull().default(sql`'{expert}'::text[]`),
  headline: text('headline'),
  bio: text('bio'),
  specialisations: text('specialisations').array().notNull().default(sql`'{}'::text[]`),
  strengths: text('strengths').array().notNull().default(sql`'{}'::text[]`), // dimension names the person is strong in
  sectors: text('sectors').array().notNull().default(sql`'{}'::text[]`),
  platforms: text('platforms').array().notNull().default(sql`'{}'::text[]`),
  businessSizes: text('business_sizes').array().notNull().default(sql`'{}'::text[]`),
  languages: text('languages').array().notNull().default(sql`'{}'::text[]`),
  regions: text('regions').array().notNull().default(sql`'{}'::text[]`),
  deliveryModes: text('delivery_modes').array().notNull().default(sql`'{}'::text[]`),
  yearsExperience: integer('years_experience'),
  credentials: jsonb('credentials').$type<{ type: string; title: string; issuer?: string; year?: number }[]>().notNull().default(sql`'[]'::jsonb`),
  maxActive: integer('max_active').notNull().default(5),
  availability: text('availability').notNull().default('Available'),
  vettingStatus: text('vetting_status').notNull().default('Draft'),
  vettingNote: text('vetting_note'),
  conductAcceptedAt: timestamp('conduct_accepted_at', { withTimezone: true }),
  conductVersion: text('conduct_version'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  decidedBy: uuid('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  rateNote: text('rate_note'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('pp_status_idx').on(t.vettingStatus)]);

/** A business a practitioner must not serve, and why. Matching and assignment both enforce it. */
export const practitionerConflicts = pgTable('practitioner_conflicts', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  reason: text('reason').notNull(),
  declaredBy: uuid('declared_by').references(() => users.id),
  createdAt: created()
}, (t) => [uniqueIndex('pc_user_org_uq').on(t.userId, t.orgId)]);

/** Who works on a case, in what capacity, and for how long. Rows are never edited into history: a change closes one row and opens another.
 *  cases.consultantId, coachId and reviewerId stay as a read-through pointer to the active lead, coach and reviewer. */
export const caseAssignments = pgTable('case_assignments', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  fn: text('function').notNull(), // lead | specialist | coach | reviewer
  specialisation: text('specialisation'),
  status: text('status').notNull().default('Active'),
  assignedBy: uuid('assigned_by').references(() => users.id),
  matchScore: integer('match_score'),
  matchBreakdown: jsonb('match_breakdown'),
  reason: text('reason'),
  replacesId: uuid('replaces_id'),
  acknowledgeBy: timestamp('acknowledge_by', { withTimezone: true }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  declineReason: text('decline_reason'),
  overdueNotifiedAt: timestamp('overdue_notified_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
}, (t) => [
  index('ca_case_idx').on(t.caseId), index('ca_user_idx').on(t.userId, t.status),
  uniqueIndex('ca_single_uq').on(t.caseId, t.fn).where(sql`${t.status} = 'Active' and ${t.fn} <> 'specialist'`),
  uniqueIndex('ca_specialist_uq').on(t.caseId, t.userId).where(sql`${t.status} = 'Active' and ${t.fn} = 'specialist'`)
]);

/** A rating of one engagement from one source. Rows are never edited or deleted; a correction is a new row from the same source. */
export const engagementRatings = pgTable('engagement_ratings', {
  id: id(),
  assignmentId: uuid('assignment_id').notNull().references(() => caseAssignments.id),
  source: text('source').notNull(),
  raterId: uuid('rater_id').notNull().references(() => users.id),
  scores: jsonb('scores').$type<Record<string, number>>().notNull(),
  overall: integer('overall').notNull(), // 0 to 100
  comment: text('comment'),
  supersedesId: uuid('supersedes_id'),
  createdAt: created()
}, (t) => [index('er_assignment_idx').on(t.assignmentId)]);

/* ------------------------------ UNLOCK -------------------------------- */
export const OPPORTUNITY_TYPES = ['Funding', 'Grant', 'Loan', 'Equity', 'Partnership', 'Market', 'Procurement', 'Programme', 'Assistance', 'Training'] as const;
export const OPPORTUNITY_STATES = ['Draft', 'Open', 'Closed', 'Archived'] as const;
export const REFERRAL_STATES = ['Suggested', 'Consented', 'Approved', 'Referred', 'Applied', 'Shortlisted', 'Awarded', 'Declined', 'Withdrawn'] as const;

/** Something an enterprise can reach once it is ready: money, a partner, a market, a programme. Eligibility lives in `criteria`, set per opportunity. */
export const opportunities = pgTable('opportunities', {
  id: id(),
  title: text('title').notNull(),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  summary: text('summary').notNull(),
  url: text('url'),
  valueMin: numeric('value_min', { precision: 14, scale: 2 }), valueMax: numeric('value_max', { precision: 14, scale: 2 }),
  currency: text('currency').notNull().default('GHS'),
  deadline: date('deadline'),
  status: text('status').notNull().default('Draft'),
  criteria: jsonb('criteria').notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),
  /** manual, or the system it was imported from (for example sopis). With a source reference, the same item is never imported twice. */
  source: text('source').notNull().default('manual'),
  sourceRef: text('source_ref'),
  createdBy: uuid('created_by').references(() => users.id),
  publishedBy: uuid('published_by').references(() => users.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('opp_status_idx').on(t.status, t.deadline), uniqueIndex('opp_source_uq').on(t.source, t.sourceRef).where(sql`${t.sourceRef} is not null`)]);

/** One enterprise and one opportunity. The database refuses to move past Approved without the owner's consent and a person's approval. */
export const opportunityReferrals = pgTable('opportunity_referrals', {
  id: id(),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  opportunityId: uuid('opportunity_id').notNull().references(() => opportunities.id),
  status: text('status').notNull().default('Suggested'),
  suggestedBy: uuid('suggested_by').references(() => users.id),
  consentBy: uuid('consent_by').references(() => users.id),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  /** What the owner agreed may be shared: overall, maturity, dimensions, certification, readiness. */
  consentScope: text('consent_scope').array().notNull().default(sql`'{}'::text[]`),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  referredAt: timestamp('referred_at', { withTimezone: true }),
  amountGhs: numeric('amount_ghs', { precision: 14, scale: 2 }),
  outcomeNote: text('outcome_note'),
  /** The match as it stood when the referral was made, so history shows what was known then. */
  matchSnapshot: jsonb('match_snapshot'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('ref_org_idx').on(t.orgId), index('ref_status_idx').on(t.status),
  uniqueIndex('ref_live_uq').on(t.orgId, t.opportunityId).where(sql`${t.status} not in ('Declined','Withdrawn')`)]);

export const opportunityReferralEvents = pgTable('opportunity_referral_events', {
  id: id(),
  referralId: uuid('referral_id').notNull().references(() => opportunityReferrals.id),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  note: text('note'),
  createdAt: created()
}, (t) => [index('refev_idx').on(t.referralId, t.createdAt)]);

/* ---- Delivery: escalations for stalled work and the message thread on each case (migration 0030). CHECKs and the no-update trigger live in the SQL. ---- */
export const ESCALATION_KINDS = ['stalled', 'session_outcome'] as const;
export const caseEscalations = pgTable('case_escalations', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  kind: text('kind').notNull(),
  /** The session, for session_outcome. */
  refId: uuid('ref_id'),
  detail: text('detail'),
  flaggedAt: timestamp('flagged_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true })
}, (t) => [index('esc_case_idx').on(t.caseId)]);

export const caseMessages = pgTable('case_messages', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id),
  senderId: uuid('sender_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: created()
}, (t) => [index('msg_case_idx').on(t.caseId, t.createdAt)]);

export const caseMessageReads = pgTable('case_message_reads', {
  caseId: uuid('case_id').notNull().references(() => cases.id),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [primaryKey({ columns: [t.caseId, t.userId], name: 'case_message_reads_pk' })]);
