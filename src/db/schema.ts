import {
  pgTable, pgSequence, pgEnum, uuid, text, integer, numeric, boolean, timestamp, date, jsonb, bigserial, bigint,
  index, uniqueIndex, primaryKey, check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* Human readable codes: PREFIX-YYYY-000001, from one sequence each.   */
/* Codes are never reused or edited (design: identifier rules).        */
/* ------------------------------------------------------------------ */
export const CODE_PREFIXES = {
  org: 'SME', prog: 'PRG', cohort: 'COH', case: 'CASE', diag: 'DIAG', ev: 'EVD', doc: 'DOC', dgn: 'DGN',
  rx: 'RX', iv: 'INT', act: 'ACT', risk: 'RISK', kpi: 'KPI', sess: 'SES', rep: 'REP', ai: 'AI',
  plan: 'PLN', con: 'CON', inv: 'INV', pay: 'PAY', usr: 'USR',
  rsa: 'RSA', rsc: 'RSC', pyo: 'PYO', rfd: 'RFD', dex: 'DEX', txc: 'TXC', txr: 'TXR'
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
export const seq_rsa = pgSequence('seq_rsa');
export const seq_rsc = pgSequence('seq_rsc');
export const seq_pyo = pgSequence('seq_pyo');
export const seq_rfd = pgSequence('seq_rfd');
export const seq_dex = pgSequence('seq_dex');
export const seq_txc = pgSequence('seq_txc');
export const seq_txr = pgSequence('seq_txr');

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
  // The role this session is currently acting as. Null means "the user's own users.role" (the
  // ordinary, single-role case). Set only when the signed-in person also holds an approved
  // additional role (see roleGrants) and switched into it; see services/roleGrants.ts.
  activeRole: roleEnum('active_role'),
  ip: text('ip'), userAgent: text('user_agent'),
  createdAt: created(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
}, (t) => [index('sessions_user_idx').on(t.userId), index('sessions_exp_idx').on(t.expiresAt)]);

/**
 * Additional roles a person is authorised to act as, beyond their primary users.role (which
 * always stands and needs no row here). One account, several authorised roles -- a consultant who
 * is also a trained Reviewer, say -- switchable per session via roleGrants.switchRole(), never
 * concurrent. Granting one is a distinct decision from approving the account itself: an ADMIN
 * reviews and decides each request on its own evidence.
 */
export const roleGrants = pgTable('role_grants', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  status: text('status').notNull().default('pending'), // pending | approved | rejected
  note: text('note'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
}, (t) => [uniqueIndex('role_grants_user_role_uq').on(t.userId, t.role), index('role_grants_user_idx').on(t.userId), index('role_grants_status_idx').on(t.status)]);

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
  /** Tax identification number. Unique among live organisations. */
  tin: text('tin'),
  /** Set when this record was merged into another. */
  mergedInto: uuid('merged_into'),
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
  /** The programme profile: what it is for, who it is for, where it runs, and who to contact. */
  summary: text('summary'), objective: text('objective'), eligibility: text('eligibility'),
  sectors: text('sectors').array().notNull().default(sql`'{}'::text[]`),
  regions: text('regions').array().notNull().default(sql`'{}'::text[]`),
  targetGroups: text('target_groups').array().notNull().default(sql`'{}'::text[]`),
  targetBusinesses: integer('target_businesses'),
  partners: text('partners'), contactName: text('contact_name'), contactEmail: text('contact_email'), website: text('website'),
  logoMediaId: uuid('logo_media_id'),
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
  /** Logframe level: impact above outcome above output. A parent is always exactly one level up. */
  level: text('level').notNull().default('output'),
  parentId: uuid('parent_id').references((): any => programmeIndicators.id),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(), updatedAt: updated()
}, (t) => [uniqueIndex('ind_name_uq').on(t.programmeId, t.name)]);
/** A planned spend category inside the programme budget. The lines can never add up to more than the budget. */
export const programmeBudgetLines = pgTable('programme_budget_lines', {
  id: id(),
  programmeId: uuid('programme_id').notNull().references(() => programmes.id),
  category: text('category').notNull(),
  description: text('description'),
  amountGhs: numeric('amount_ghs', { precision: 14, scale: 2 }).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(), updatedAt: updated()
}, (t) => [uniqueIndex('pbl_cat_uq').on(t.programmeId, t.category)]);
/** A funder payment schedule entry. Planned until money lands, then Received with the date and amount. */
export const programmeTranches = pgTable('programme_tranches', {
  id: id(),
  programmeId: uuid('programme_id').notNull().references(() => programmes.id),
  label: text('label').notNull(),
  amountGhs: numeric('amount_ghs', { precision: 14, scale: 2 }).notNull(),
  dueDate: date('due_date'),
  status: text('status').notNull().default('Planned'),
  receivedOn: date('received_on'),
  receivedGhs: numeric('received_ghs', { precision: 14, scale: 2 }),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(), updatedAt: updated()
}, (t) => [uniqueIndex('ptr_label_uq').on(t.programmeId, t.label)]);
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

/**
 * One in-progress diagnostic per case: the autosaved working copy of answers before submission. A case
 * has at most one open draft at a time (unique caseId); submitDiagnosticCore() clears it once the
 * answers become a real `diagnostics` row. Answers are stored exactly as the form holds them (the same
 * AnswerInput shape submitDiagnostic takes), so resuming is just reloading this JSON back into the form.
 */
export const diagnosticDrafts = pgTable('diagnostic_drafts', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => cases.id).unique(),
  answers: jsonb('answers').notNull().default({}),
  updatedBy: uuid('updated_by'),
  /** How many of the configured reminder tiers (sla.ts's `scanIncompleteDiagnostics`) have fired for the
   *  draft currently sitting in `answers`. Reset to 0 whenever the draft is saved again, so working on it
   *  cancels the next escalation step the same way completing it clears the row entirely. */
  reminderTier: integer('reminder_tier').notNull().default(0),
  lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
});

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

/**
 * A machine-read first pass over an uploaded document: what kind of document it looks like, and any
 * facts (dates, amounts, percentages) a cheap text pass could pull from it. Nothing here is trusted on
 * its own -- it sits in 'Pending' until a human reviews it, and only on acceptance does it become real
 * evidence (an `evidence` row linked to the same document). Rejecting it just closes the review with no
 * evidence created. `extractedText` and `facts` are null/empty when the file format has no text layer we
 * can read without OCR (images, scanned PDFs) -- that is a real, stated limit, not a bug.
 */
export const documentExtractions = pgTable('document_extractions', {
  id: id(), code: codeCol('dex'),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  caseId: uuid('case_id').references(() => cases.id),
  orgId: uuid('org_id').notNull().references(() => organisations.id),
  kind: text('kind').notNull().default('other'), // invoice | certificate | financial_statement | id_document | contract | other
  extractedText: text('extracted_text'),
  facts: jsonb('facts').notNull().default([]), // [{ label, value }]
  status: text('status').notNull().default('Pending'), // Pending | Accepted | Rejected
  evidenceId: uuid('evidence_id').references(() => evidence.id),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: created()
}, (t) => [index('dex_case_idx').on(t.caseId), index('dex_doc_idx').on(t.documentId), index('dex_status_idx').on(t.status)]);

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

export const HEALTH_SCORE_PHASES = ['BASELINE', 'MIDLINE', 'ENDLINE', 'OTHER'] as const;
export type HealthScorePhase = (typeof HEALTH_SCORE_PHASES)[number];
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
  /** BASELINE/MIDLINE/ENDLINE/OTHER -- set once at scoring time from the case's lifecycle state
   *  (computeScore in diagnostics.ts), not inferred positionally from run number. The first score a
   *  case ever gets is always BASELINE; a score taken while the case sits in MIDLINE or ENDLINE
   *  carries that label; anything else (a re-diagnostic during ordinary MONITORING, say) is OTHER.
   *  Funder reporting can then ask for "the baseline score" and "the endline score" directly instead
   *  of guessing from run=1/run=latest, which breaks the moment a round is skipped or repeated. */
  phase: text('phase').notNull().default('OTHER'),
  createdAt: created()
}, (t) => [index('score_case_idx').on(t.caseId), check('score_phase_ck', sql`${t.phase} in ('BASELINE','MIDLINE','ENDLINE','OTHER')`)]);

/* ------------------- diagnosis, prescription, delivery ---------------- */
export const aiRequests = pgTable('ai_requests', {
  id: id(), code: codeCol('ai'),
  agent: text('agent').notNull(),
  tier: text('tier'),
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
/** Service tier a plan represents (what the customer receives) - distinct from durationDays (how long support lasts). */
export const PLAN_SERVICE_TIERS = ['discovery', 'diagnostic', 'transform', 'growth', 'programme'] as const;
/** How a plan is priced. 'custom' means the amount is agreed per-contract (e.g. Programme tier) rather than fixed here. */
export const PLAN_PRICING_MODELS = ['free', 'fixed', 'custom'] as const;
/** Draft: being configured, never public. Published: live on the public pricing page and selectable for new contracts.
 *  Inactive: hidden from new selection but existing contracts keep working. Archived: hidden everywhere; kept only for history. */
export const PLAN_PUBLICATION_STATUSES = ['draft', 'published', 'inactive', 'archived'] as const;
/** A fixed catalogue of entitlement keys a plan can grant, each with an optional limit. Keeping this a small fixed
 *  list (rather than free text) is what lets the admin UI render checkboxes/limits instead of a textarea, and lets
 *  future code actually enforce a feature instead of merely describing it. Extend this list only once a feature is
 *  real and reviewed - never add a key here to make a plan look more complete than the product actually is. */
export const PLAN_ENTITLEMENT_KEYS = [
  'free_assessment', 'full_assessment', 'ai_assisted_report', 'detailed_report',
  'action_plan', 'kpi_tracking', 'coaching_sessions', 'progress_reviews',
  'priority_support', 'opportunity_matching', 'investment_readiness_pack',
  'cohort_management', 'coach_management', 'portfolio_reporting'
] as const;
export const plans = pgTable('plans', {
  id: id(), code: codeCol('plan'),
  name: text('name').notNull(),
  description: text('description'),
  /** Who this plan is for, shown publicly - e.g. "Owners who want a full picture and clear priorities." */
  audience: text('audience'),
  /** One of PLAN_SERVICE_TIERS, or null for a legacy plan created before this model existed. */
  serviceTier: text('service_tier'),
  /** Org types this plan applies to (e.g. ['SME','AGRIFOOD','ESO']). Empty/null means all platforms. */
  platforms: jsonb('platforms').$type<string[]>().default([]),
  /** Structured entitlements this plan grants: [{ key: 'coaching_sessions', enabled: true, limit: 4 }, ...].
   *  key must be one of PLAN_ENTITLEMENT_KEYS. limit is optional (e.g. session count, participant cap). */
  entitlements: jsonb('entitlements').$type<{ key: string; enabled: boolean; limit?: number | string }[]>().default([]),
  /** Support duration in days (30/180/360, or a custom number). Null means the plan has no fixed support
   *  horizon (e.g. a one-off assessment). This is independent of serviceTier - a Diagnostic plan can be sold
   *  standalone (durationDays null) or bundled with any horizon. */
  durationDays: integer('duration_days'),
  pricingModel: text('pricing_model').notNull().default('fixed'),
  /** Required even for pricingModel 'free' (0.00) or 'custom' (a representative/placeholder figure); the
   *  authoritative custom amount for a real deal lives on the contract, not here. */
  priceGhs: numeric('price_ghs', { precision: 12, scale: 2 }).notNull(),
  intervalMonths: integer('interval_months').notNull().default(12),
  /** Whether THIS plan's own price is approved to be shown as a real figure on the public page.
   *  Independent of publicationStatus: a plan can be published (visible, sellable by Samakose staff via
   *  a contract) while its price still reads "Pricing pending confirmation" to a visitor, and a Finance
   *  reviewer can confirm one plan's price without exposing every other plan's price at the same time. */
  priceConfirmed: boolean('price_confirmed').notNull().default(false),
  publicationStatus: text('publication_status').notNull().default('draft'),
  /** Kept in sync with publicationStatus (true only when 'published') so existing code that filters or
   *  orders by `active` keeps working unchanged. Write through updatePlan()/setPlanStatus(), never directly.
   *  Defaults to false to match the 'draft' default above - a freshly inserted row is never active until published. */
  active: boolean('active').notNull().default(false),
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

/* ------------------------------------------------------------------ */
/* Professional economy & finance (Master Directive §31-54). Additive */
/* only in this pass: these tables carry no write path yet from any   */
/* service or API route. See the "Finance & Professional Economy      */
/* Design" document for the lifecycles, calculation rules and rollout */
/* order this schema is built for.                                    */
/* ------------------------------------------------------------------ */

export const REVENUE_SHARE_MODELS = ['PERCENTAGE', 'FIXED', 'TIERED', 'HYBRID'] as const;
export const REVENUE_SHARE_BASES = ['SHARE_ON_LIST_PRICE', 'SHARE_ON_NET_PRICE', 'SHARE_ON_COLLECTED_AMOUNT'] as const;
export const REVENUE_SHARE_STATUSES = ['Draft', 'Pending approval', 'Approved', 'Active', 'Suspended', 'Expired', 'Cancelled'] as const;
export const ALLOCATEE_ROLES = ['SAMAKOSE', 'LEAD', 'SPECIALIST', 'COACH', 'REVIEWER'] as const;

/** A revenue-split arrangement for one assignment under one contract. Never applied retroactively: it governs
 *  calculations created after it becomes Active, never calculations that already exist. */
export const revenueShareAgreements = pgTable('revenue_share_agreements', {
  id: id(), code: codeCol('rsa'),
  contractId: uuid('contract_id').notNull().references(() => contracts.id),
  assignmentId: uuid('assignment_id').notNull().references(() => caseAssignments.id),
  professionalId: uuid('professional_id').notNull().references(() => users.id),
  model: text('model').notNull(), // PERCENTAGE | FIXED | TIERED | HYBRID
  basis: text('basis').notNull(), // SHARE_ON_LIST_PRICE | SHARE_ON_NET_PRICE | SHARE_ON_COLLECTED_AMOUNT
  percentage: numeric('percentage', { precision: 5, scale: 2 }),
  fixedAmountGhs: numeric('fixed_amount_ghs', { precision: 12, scale: 2 }),
  tierRules: jsonb('tier_rules').$type<{ upToGhs: number | null; percentage: number }[]>(),
  status: text('status').notNull().default('Draft'),
  proposedBy: uuid('proposed_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  effectiveFrom: date('effective_from'), effectiveTo: date('effective_to'),
  createdAt: created(), updatedAt: updated()
}, (t) => [
  index('rsa_contract_idx').on(t.contractId), index('rsa_assignment_idx').on(t.assignmentId),
  index('rsa_professional_idx').on(t.professionalId)
]);

/** How one agreement's share is split across the people who earn from it. Must sum to 100% (enforced by trigger). */
export const revenueShareAllocations = pgTable('revenue_share_allocations', {
  id: id(),
  agreementId: uuid('agreement_id').notNull().references(() => revenueShareAgreements.id),
  allocateeRole: text('allocatee_role').notNull(), // SAMAKOSE | LEAD | SPECIALIST | COACH | REVIEWER
  professionalId: uuid('professional_id').references(() => users.id), // null for SAMAKOSE
  percentOfShare: numeric('percent_of_share', { precision: 5, scale: 2 }).notNull(),
  createdAt: created()
}, (t) => [index('rsal_agreement_idx').on(t.agreementId)]);

/** The immutable snapshot taken at financial activation (Directive §34). Never recalculated in place: a
 *  correction is a new row referencing supersedesId, exactly like diagnostics.supersedesId. */
export const revenueShareCalculations = pgTable('revenue_share_calculations', {
  id: id(), code: codeCol('rsc'),
  agreementId: uuid('agreement_id').notNull().references(() => revenueShareAgreements.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  paymentId: uuid('payment_id').references(() => payments.id),
  grossAmountGhs: numeric('gross_amount_ghs', { precision: 12, scale: 2 }).notNull(),
  discountAmountGhs: numeric('discount_amount_ghs', { precision: 12, scale: 2 }).notNull().default('0'),
  netAmountGhs: numeric('net_amount_ghs', { precision: 12, scale: 2 }).notNull(),
  basisUsed: text('basis_used').notNull(),
  calculationVersion: integer('calculation_version').notNull().default(1),
  professionalAmountGhs: numeric('professional_amount_ghs', { precision: 12, scale: 2 }).notNull(),
  samakoseAmountGhs: numeric('samakose_amount_ghs', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('GHS'),
  supersedesId: uuid('supersedes_id'),
  computedBy: uuid('computed_by'), // a user id, or an AI agent identifier
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: created()
}, (t) => [index('rscalc_agreement_idx').on(t.agreementId), index('rscalc_invoice_idx').on(t.invoiceId)]);

export const PAYOUT_STATUSES = ['Earned', 'Reviewed', 'Approved', 'Payable', 'Payment initiated', 'Paid', 'Reconciled'] as const;

/** One professional's earnings on one calculation, tracked Earned -> Reconciled (Directive §47). */
export const professionalPayouts = pgTable('professional_payouts', {
  id: id(), code: codeCol('pyo'),
  professionalId: uuid('professional_id').notNull().references(() => users.id),
  calculationId: uuid('calculation_id').notNull().references(() => revenueShareCalculations.id),
  assignmentId: uuid('assignment_id').notNull().references(() => caseAssignments.id),
  contractId: uuid('contract_id').notNull().references(() => contracts.id),
  amountGhs: numeric('amount_ghs', { precision: 12, scale: 2 }).notNull(),
  /** Gross amount withheld as tax so far (0 until applyTax() posts a WITHHOLDING tax_line against this payout). */
  taxWithheldGhs: numeric('tax_withheld_ghs', { precision: 12, scale: 2 }).notNull().default('0.00'),
  /** What is actually disbursed on markPaid(): amountGhs - taxWithheldGhs. Defaults to the full gross amount. */
  netAmountGhs: numeric('net_amount_ghs', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('GHS'),
  status: text('status').notNull().default('Earned'),
  payoutMethod: text('payout_method'),
  paymentReference: text('payment_reference'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  createdAt: created(), updatedAt: updated()
}, (t) => [
  index('pyo_professional_idx').on(t.professionalId, t.status),
  index('pyo_calculation_idx').on(t.calculationId)
]);

/** A hold that blocks Payable -> Payment initiated. AI may flag a candidate; only a human creates or lifts one. */
export const payoutHolds = pgTable('payout_holds', {
  id: id(),
  payoutId: uuid('payout_id').notNull().references(() => professionalPayouts.id),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNote: text('resolution_note')
}, (t) => [index('ph_payout_idx').on(t.payoutId)]);

/** A correction, reversal, or refund-driven clawback against an already-earned payout. Never a silent edit. */
export const payoutAdjustments = pgTable('payout_adjustments', {
  id: id(),
  payoutId: uuid('payout_id').notNull().references(() => professionalPayouts.id),
  type: text('type').notNull(), // CORRECTION | REVERSAL | REFUND_CLAWBACK
  amountGhs: numeric('amount_ghs', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  // bigint, not uuid: financial_ledger_entries.id is a bigserial. Fixed in migration 0052 -
  // migration 0051 originally typed this uuid, which could never actually reference that table.
  ledgerEntryId: bigint('ledger_entry_id', { mode: 'number' }).references(() => financialLedgerEntries.id),
  createdAt: created()
}, (t) => [index('pa_payout_idx').on(t.payoutId)]);

export const TAX_PROFILE_PARTY_TYPES = ['INDIVIDUAL', 'SOLE_PROPRIETOR', 'ORGANISATION'] as const;
export const TAX_PROFILE_STATUSES = ['Submitted', 'Verified', 'Rejected'] as const;

/** A professional's own tax identity (Payouts & Compliance design, Component 2): the Ghana Card PIN
 *  (individual/sole proprietor) or organisational TIN a payout is actually made against, and whether
 *  that identifier has been verified. Distinct from practitioner_profiles (vetting/skills) and from
 *  tax_rules (the rates applied) -- this is *whose* identity a payout and any GRA return must carry.
 *  One row per user: there is only ever one "current" identity on file, so a correction overwrites in
 *  place and resets status to Submitted, unlike revenue_share_calculations' immutable-snapshot pattern. */
export const taxProfiles = pgTable('tax_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  partyType: text('party_type').notNull(), // INDIVIDUAL | SOLE_PROPRIETOR | ORGANISATION
  legalName: text('legal_name').notNull(),
  taxIdentifier: text('tax_identifier').notNull(), // Ghana Card PIN or organisational TIN
  taxResidency: text('tax_residency').notNull().default('GH'),
  status: text('status').notNull().default('Submitted'), // Submitted | Verified | Rejected
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verificationNote: text('verification_note'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('txp_status_idx').on(t.status)]);

export const FINANCIAL_ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY'] as const;

/** A small fixed chart of accounts. Rows are reference data, not transactions. */
export const financialAccounts = pgTable('financial_accounts', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull(), // ASSET | LIABILITY | REVENUE | EXPENSE | EQUITY
  createdAt: created()
});

export const FINANCIAL_PERIOD_STATUSES = ['Open', 'Closing', 'Closed', 'Locked'] as const;

/** OPEN -> CLOSING -> CLOSED -> LOCKED. Once Closed, postLedgerEntry() refuses any entry dated into it. */
export const financialPeriods = pgTable('financial_periods', {
  id: id(),
  label: text('label').notNull().unique(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  status: text('status').notNull().default('Open'),
  closedBy: uuid('closed_by').references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true })
});

/** Double-entry, append-only (Directive §40). The ONLY writer is postLedgerEntry() in the finance service;
 *  nothing else should INSERT here, and the database role never gets UPDATE/DELETE on this table. */
export const financialLedgerEntries = pgTable('financial_ledger_entries', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  accountId: uuid('account_id').notNull().references(() => financialAccounts.id),
  debitGhs: numeric('debit_ghs', { precision: 12, scale: 2 }).notNull().default('0'),
  creditGhs: numeric('credit_ghs', { precision: 12, scale: 2 }).notNull().default('0'),
  currency: text('currency').notNull().default('GHS'),
  referenceType: text('reference_type').notNull(), // INVOICE | PAYMENT | REVENUE_SHARE | PAYOUT | REFUND | ADJUSTMENT
  referenceId: uuid('reference_id').notNull(),
  description: text('description'),
  periodId: uuid('period_id').notNull().references(() => financialPeriods.id),
  createdBy: uuid('created_by'), // a user id, or an AI agent identifier
  createdAt: created()
}, (t) => [
  index('fle_account_idx').on(t.accountId), index('fle_reference_idx').on(t.referenceType, t.referenceId),
  index('fle_period_idx').on(t.periodId)
]);

/** A price reduction rule, applied automatically by its conditions or redeemed through a promo code. */
export const discountRules = pgTable('discount_rules', {
  id: id(),
  kind: text('kind').notNull(), // PERCENTAGE | FIXED | PROMOTIONAL_PRICE
  value: numeric('value', { precision: 12, scale: 2 }).notNull(),
  conditions: jsonb('conditions').$type<{
    planId?: string; horizonDays?: number; programmeId?: string; cohortId?: string; partnerOrgId?: string;
    orgId?: string; segment?: string; firstPurchaseOnly?: boolean; campaign?: string;
    startDate?: string; endDate?: string;
  }>(),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  createdAt: created(), updatedAt: updated()
});

export const promoCampaigns = pgTable('promo_campaigns', {
  id: id(),
  name: text('name').notNull(),
  discountRuleId: uuid('discount_rule_id').notNull().references(() => discountRules.id),
  startDate: date('start_date'), endDate: date('end_date'),
  active: boolean('active').notNull().default(true),
  createdAt: created()
});

/** A redeemable code. Generated with a cryptographically random generator, never sequential. */
export const promoCodes = pgTable('promo_codes', {
  id: id(),
  campaignId: uuid('campaign_id').notNull().references(() => promoCampaigns.id),
  code: text('code').notNull().unique(),
  maxRedemptions: integer('max_redemptions'),
  perCustomerLimit: integer('per_customer_limit'),
  minPurchaseGhs: numeric('min_purchase_ghs', { precision: 12, scale: 2 }),
  maxDiscountGhs: numeric('max_discount_ghs', { precision: 12, scale: 2 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
  createdAt: created()
}, (t) => [index('pc_campaign_idx').on(t.campaignId)]);

/** One successful redemption. Unique per (promoCodeId, customerId) when the code is single-use-per-customer,
 *  enforced server-side inside the same transaction that discounts the invoice (prevents a double-redeem race). */
export const promoRedemptions = pgTable('promo_redemptions', {
  id: id(),
  promoCodeId: uuid('promo_code_id').notNull().references(() => promoCodes.id),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  customerId: uuid('customer_id').notNull().references(() => users.id),
  discountAppliedGhs: numeric('discount_applied_ghs', { precision: 12, scale: 2 }).notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [uniqueIndex('pr_code_customer_uq').on(t.promoCodeId, t.customerId)]);

/** A configurable tax/VAT/withholding rule. Replaces the single flat org-wide rate in billing.ts with
 *  versioned, jurisdiction-aware rules, without assuming any specific rate is applicable. */
export const taxRules = pgTable('tax_rules', {
  id: id(),
  type: text('type').notNull(), // VAT | WITHHOLDING | OTHER
  rate: numeric('rate', { precision: 5, scale: 2 }).notNull(),
  jurisdiction: text('jurisdiction').notNull(),
  inclusiveOfPrice: boolean('inclusive_of_price').notNull().default(false),
  ruleVersion: integer('rule_version').notNull().default(1),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  createdAt: created()
}, (t) => [index('tr_type_jurisdiction_idx').on(t.type, t.jurisdiction)]);

export const taxLines = pgTable('tax_lines', {
  id: id(),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  payoutId: uuid('payout_id').references(() => professionalPayouts.id),
  taxRuleId: uuid('tax_rule_id').notNull().references(() => taxRules.id),
  baseAmountGhs: numeric('base_amount_ghs', { precision: 12, scale: 2 }).notNull(),
  amountGhs: numeric('amount_ghs', { precision: 12, scale: 2 }).notNull(),
  ruleVersion: integer('rule_version').notNull(),
  createdAt: created()
}, (t) => [index('tl_invoice_idx').on(t.invoiceId), index('tl_payout_idx').on(t.payoutId)]);

export const REFUND_STATUSES = ['Requested', 'Approved', 'Processed', 'Rejected'] as const;

/** Replaces an implicit payment.status = refunded flip with a first-class, approvable record. */
export const refunds = pgTable('refunds', {
  id: id(), code: codeCol('rfd'),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  amountGhs: numeric('amount_ghs', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('Requested'),
  requestedBy: uuid('requested_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  // bigint, not uuid: see the matching comment on payoutAdjustments.ledgerEntryId - migration 0052.
  ledgerEntryId: bigint('ledger_entry_id', { mode: 'number' }).references(() => financialLedgerEntries.id),
  createdAt: created()
}, (t) => [index('rf_payment_idx').on(t.paymentId)]);

/** A GRA withholding-tax certificate issued to one payee for one tax_line. One certificate per tax_line. */
export const taxCertificates = pgTable('tax_certificates', {
  id: id(), code: codeCol('txc'),
  taxLineId: uuid('tax_line_id').notNull().unique().references(() => taxLines.id),
  payeeId: uuid('payee_id').notNull().references(() => users.id),
  periodLabel: text('period_label').notNull(),
  amountGhs: numeric('amount_ghs', { precision: 12, scale: 2 }).notNull(),
  issuedBy: uuid('issued_by').references(() => users.id),
  createdAt: created()
}, (t) => [index('txc_payee_idx').on(t.payeeId)]);

export const TAX_REMITTANCE_STATUSES = ['Pending', 'Remitted'] as const;

/** A batch of tax_lines remitted to GRA together, by tax type and period. */
export const taxRemittances = pgTable('tax_remittances', {
  id: id(), code: codeCol('txr'),
  periodLabel: text('period_label').notNull(),
  type: text('type').notNull(), // VAT | WITHHOLDING | OTHER
  totalAmountGhs: numeric('total_amount_ghs', { precision: 12, scale: 2 }).notNull(),
  status: text('status').notNull().default('Pending'),
  paymentReference: text('payment_reference'),
  createdBy: uuid('created_by').references(() => users.id),
  remittedBy: uuid('remitted_by').references(() => users.id),
  remittedAt: timestamp('remitted_at', { withTimezone: true }),
  createdAt: created()
}, (t) => [index('txr_status_idx').on(t.status)]);

/** A tax_line included in a remittance batch. One tax_line can only be remitted once. */
export const taxRemittanceLines = pgTable('tax_remittance_lines', {
  id: id(),
  remittanceId: uuid('remittance_id').notNull().references(() => taxRemittances.id),
  taxLineId: uuid('tax_line_id').notNull().unique().references(() => taxLines.id),
  createdAt: created()
}, (t) => [index('trl_remittance_idx').on(t.remittanceId)]);

export const chargebacks = pgTable('chargebacks', {
  id: id(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  amountGhs: numeric('amount_ghs', { precision: 12, scale: 2 }).notNull(),
  provider: text('provider').notNull(),
  providerReference: text('provider_reference'),
  status: text('status').notNull().default('Received'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true })
}, (t) => [index('cb_payment_idx').on(t.paymentId)]);

export const APPROVAL_ACTION_TYPES = [
  'DISCOUNT_EXCEPTION', 'REVENUE_SHARE_OVERRIDE', 'PAYOUT', 'REFUND', 'LEDGER_ADJUSTMENT', 'CONTRACT'
] as const;

/** A request for a high-risk commercial/financial action to be approved. requestedBy and the decider are
 *  always different people: enforced in the decision service, never only in the UI. */
export const approvalRequests = pgTable('approval_requests', {
  id: id(),
  actionType: text('action_type').notNull(),
  referenceId: uuid('reference_id').notNull(),
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  amountGhs: numeric('amount_ghs', { precision: 12, scale: 2 }), // for threshold-based routing
  requiredApproverRole: text('required_approver_role'),
  status: text('status').notNull().default('Pending'),
  createdAt: created()
}, (t) => [index('ar_action_idx').on(t.actionType, t.referenceId), index('ar_status_idx').on(t.status)]);

export const approvalDecisions = pgTable('approval_decisions', {
  id: id(),
  requestId: uuid('request_id').notNull().references(() => approvalRequests.id),
  decision: text('decision').notNull(), // Approved | Rejected
  decidedBy: uuid('decided_by').notNull().references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason'),
  beforeValue: jsonb('before_value'),
  afterValue: jsonb('after_value')
}, (t) => [index('ad_request_idx').on(t.requestId)]);

export const CONFLICT_CONTEXT_TYPES = [
  'REVENUE_SHARE_APPROVAL', 'PAYOUT_APPROVAL', 'REVIEW', 'COMMERCIAL_EXCEPTION'
] as const;

/** Evaluates whether a user's combination of roles on one case creates a prohibited conflict for a specific
 *  action. Distinct from practitionerConflicts, which declares a business a practitioner must not serve. */
export const conflictChecks = pgTable('conflict_checks', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  contextType: text('context_type').notNull(),
  referenceId: uuid('reference_id').notNull(),
  result: text('result').notNull(), // CLEAR | BLOCKED
  reason: text('reason'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [index('cc_user_idx').on(t.userId), index('cc_reference_idx').on(t.contextType, t.referenceId)]);

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

/** Admin-settable Zoom/Google Meet credentials (see services/integration-credentials.ts). `value` is
 * always an AES-256-GCM-encrypted blob, never plaintext -- including for non-secret fields like an
 * account ID, so this table never has to distinguish secret from non-secret columns at the DB layer. */
export const integrationCredentials = pgTable('integration_credentials', {
  integration: text('integration').notNull(), // 'zoom' | 'google_meet'
  field: text('field').notNull(), // e.g. 'accountId', 'clientId', 'clientSecret', 'refreshToken', 'calendarId'
  value: text('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: updated()
}, (t) => [primaryKey({ columns: [t.integration, t.field] })]);

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
export const INQUIRY_KINDS = ['contact', 'demo', 'newsletter', 'assessment'] as const;
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
  createdAt: created(),
  // Free Business Health assessment lead capture (see public_assessments below). Nullable: every
  // pre-existing inquiry kind (contact/demo/newsletter) leaves these null. Kept on this table, not a
  // parallel CRM, per the approved spec's "use the existing CRM, do not build a second one" instruction.
  publicAssessmentId: uuid('public_assessment_id'),
  platform: text('platform'),
  overallScore: integer('overall_score'),
  classification: text('classification')
}, (t) => [index('inquiries_status_idx').on(t.status, t.createdAt)]);

/**
 * Admin-configurable owner(s) for new free-assessment leads (#129). Not per-lead assignment -- an
 * administrator maintains a small set of users who own triaging newly completed free assessments as a
 * team responsibility; who actually works a given lead is still a manual call among that set.
 */
export const freeAssessmentOwners = pgTable('free_assessment_owners', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  addedBy: uuid('added_by').references(() => users.id),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow()
});

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
export const FRAMEWORK_PURPOSES = ['full', 'free_preliminary'] as const;
export type FrameworkPurpose = (typeof FRAMEWORK_PURPOSES)[number];
/**
 * One framework per kind of organisation. The default one is used until a specialised framework has
 * an approved version.
 *
 * `purpose` (#133) is what lets resolveVersion() (real paid diagnostics) and
 * resolveFreeAssessmentVersion() (the free preliminary assessment) pick the right framework for a
 * given orgType without colliding. Before this, the only signal was `isDefault`, which happened to
 * work for SME360 (its paid framework is the platform's one isDefault:true framework) but would have
 * silently let a real paying AgriFood360/ESO360 client get scored against the free 25-question bank,
 * or vice versa, since neither of those platforms has an isDefault:true framework to anchor on.
 */
export const frameworks = pgTable('frameworks', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  orgType: orgTypeEnum('org_type'),
  description: text('description'),
  isDefault: boolean('is_default').notNull().default(false),
  purpose: text('purpose').notNull().default('full').$type<FrameworkPurpose>(),
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

/* ------------------- Free preliminary Business Health assessment (public, anonymous) ------------------- */
/**
 * One row per attempt. `status` moves Started -> Completed; a Started row never blocks a retry (the
 * partial unique index below only covers Completed), so an abandoned attempt does not consume the
 * one-per-email-per-platform allowance. Answers and the computed result are preserved verbatim for
 * historical review once completed, per the approved spec's scoring safeguards.
 */
export const PUBLIC_ASSESSMENT_STATUSES = ['Started', 'Completed'] as const;
export const publicAssessments = pgTable('public_assessments', {
  id: id(),
  email: text('email').notNull(),
  // trim + lowercase only -- never strip dots or plus-addressing (spec, Phase 6).
  normalisedEmail: text('normalised_email').notNull(),
  fullName: text('full_name').notNull(),
  businessName: text('business_name'),
  platform: text('platform').notNull(), // 'SME360' | 'AGRIFOOD360' | 'ESO360'
  frameworkVersionId: uuid('framework_version_id').notNull().references(() => frameworkVersions.id),
  status: text('status').notNull().default('Started'),
  answers: jsonb('answers').$type<Record<string, 1 | 2 | 3 | 4>>(),
  dimensionScores: jsonb('dimension_scores').$type<{ dimension: string; score: number }[]>(),
  overallScore: integer('overall_score'),
  classification: text('classification'),
  marketingConsent: boolean('marketing_consent').notNull().default(false),
  privacyAcknowledged: boolean('privacy_acknowledged').notNull().default(false),
  source: text('source'),
  ipHash: text('ip_hash'),
  // One-time result-action allowances. Null = unused. Each is set only on a confirmed success
  // (spec, Phase 7): emailSentAt only once the mail service accepts the send, downloadedAt/printedAt
  // only once that action's server-side step completes, never on a failed or merely-attempted action.
  resultViewedAt: timestamp('result_viewed_at', { withTimezone: true }),
  emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
  downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
  printedAt: timestamp('printed_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  // Set when a signed-up account's verified email is matched to this row (spec, Phase 8). Never set silently.
  claimedByUserId: uuid('claimed_by_user_id')
}, (t) => [
  // The authoritative, race-safe enforcement of "one completed free assessment per normalised email per
  // platform": a partial unique index, checked by Postgres itself on INSERT/UPDATE, not by application code.
  uniqueIndex('public_assessments_one_completed_uq').on(t.normalisedEmail, t.platform).where(sql`${t.status} = 'Completed'`),
  index('public_assessments_email_idx').on(t.normalisedEmail, t.platform)
]);

/** Allowlisted result record for browser-scored free assessments. No answers or progress are stored. */
export const freeAssessmentResults = pgTable('free_assessment_results', {
  id: id(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  platform: text('platform').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  result: jsonb('result').notNull().$type<{
    overallScore: number;
    classification: string;
    dimensionScores: { dimension: string; score: number }[];
    completedAt: string;
  }>(),
  /**
   * The organisation this free-assessment respondent later registered as, matched by normalised email
   * (see match_public_assessments_to_organisations() in migration 0070). Supports #127's convergent-validity
   * check: comparing this row's classification against the matched organisation's own full diagnostic.
   * Left null on an ambiguous match (more than one organisation shares the email) rather than guessed at.
   */
  matchedOrgId: uuid('matched_org_id').references(() => organisations.id)
}, (t) => [
  uniqueIndex('free_assessment_results_email_platform_uq').on(sql`lower(btrim(${t.email}))`, t.platform)
]);

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
  /** Employment classification, distinct from the vetted role: every EXPERT/COACH/REVIEWER here is engaged as an
   *  independent contractor ("Associate"), not payroll staff, so payouts carry withholding tax rather than payroll
   *  tax. Administrator-set only; practitioners never self-declare their own classification. */
  engagementType: text('engagement_type').notNull().default('Associate'), // Associate | Employee
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

/** Where the Opportunity Scout looks each week: a feed, a single page, or a search query. Found items become Draft opportunities for a person to review. */
export const opportunitySources = pgTable('opportunity_sources', {
  id: id(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  url: text('url'),
  query: text('query'),
  region: text('region').notNull().default('Global'),
  active: boolean('active').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  lastFound: integer('last_found').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('ops_due_idx').on(t.active, t.lastRunAt)]);

export const scoutRuns = pgTable('scout_runs', {
  id: id(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  sources: integer('sources').notNull().default(0), candidates: integer('candidates').notNull().default(0), drafted: integer('drafted').notNull().default(0),
  skipped: integer('skipped').notNull().default(0), failed: integer('failed').notNull().default(0), searches: integer('searches').notNull().default(0),
  note: text('note')
}, (t) => [index('scout_runs_started_idx').on(t.startedAt)]);

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

/* ------------------------------------------------------------------ */
/* Business Doctor Resource Library. Additive only: a free/premium    */
/* catalogue of resources, authored, reviewed and published through   */
/* the same draft -> review -> publish discipline as site content.    */
/* Purchases flow through the existing invoices/payments tables - a   */
/* premium resource is a new invoice line kind, not a new payment     */
/* rail. See the Phase 0 assessment for the architecture decision.    */
/* ------------------------------------------------------------------ */

/** A named byline shown on a Library resource. Not a user account by itself - an author may or may not also sign in. */
export const libraryAuthors = pgTable('library_authors', {
  id: id(),
  name: text('name').notNull(),
  title: text('title'),
  bio: text('bio'),
  photoMediaId: uuid('photo_media_id').references(() => mediaAssets.id),
  userId: uuid('user_id').references(() => users.id),
  createdAt: created(), updatedAt: updated()
});

/** Draft -> In review -> Published -> Archived, the same lifecycle as contentDocs. A null price means the resource is free. */
export const LIBRARY_RESOURCE_STATUSES = ['Draft', 'In review', 'Published', 'Archived'] as const;
export const libraryResources = pgTable('library_resources', {
  id: id(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  authorId: uuid('author_id').notNull().references(() => libraryAuthors.id),
  topic: text('topic'),
  dimension: text('dimension'),
  summary: text('summary').notNull().default(''),
  body: text('body').notNull().default(''),
  coverMediaId: uuid('cover_media_id').references(() => mediaAssets.id),
  fileStorageKey: text('file_storage_key'),
  fileMime: text('file_mime'),
  fileSize: integer('file_size'),
  priceGhs: numeric('price_ghs', { precision: 10, scale: 2 }),
  status: text('status').notNull().default('Draft'),
  publishAt: timestamp('publish_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  createdAt: created(), updatedAt: updated()
}, (t) => [
  index('lib_res_status_idx').on(t.status),
  index('lib_res_author_idx').on(t.authorId),
  index('lib_res_dimension_idx').on(t.dimension)
]);

/** A grant of standing access to one premium resource for one user: by purchase, promo redemption or an administrator override. Never written for a free resource. */
export const LIBRARY_ENTITLEMENT_SOURCES = ['purchase', 'promo', 'admin_grant'] as const;
export const resourceEntitlements = pgTable('resource_entitlements', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  resourceId: uuid('resource_id').notNull().references(() => libraryResources.id),
  grantedVia: text('granted_via').notNull(),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  grantedBy: uuid('granted_by').references(() => users.id),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true })
}, (t) => [
  uniqueIndex('res_ent_user_res_uq').on(t.userId, t.resourceId),
  index('res_ent_resource_idx').on(t.resourceId)
]);

/** A resource purchase's own payment row, standalone from invoices (which require an organisation):
 *  a Library buyer may be an individual with no org. Shares the one Paystack account/webhook
 *  signature-verification logic in finance.ts - this is the same payment rail, a second row shape. */
export const resourcePayments = pgTable('resource_payments', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  resourceId: uuid('resource_id').notNull().references(() => libraryResources.id),
  reference: text('reference').notNull().unique(),
  amountGhs: numeric('amount_ghs', { precision: 10, scale: 2 }).notNull(),
  status: text('status').notNull().default('Pending'),
  providerPayload: jsonb('provider_payload'),
  createdAt: created(), updatedAt: updated()
}, (t) => [index('res_pay_resource_idx').on(t.resourceId), index('res_pay_user_idx').on(t.userId)]);
