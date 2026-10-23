CREATE TYPE "public"."case_state" AS ENUM('PROSPECT', 'ONBOARDING', 'PROFILED', 'DIAGNOSTIC', 'DIAGNOSED', 'PRESCRIBED', 'APPROVAL', 'IN EXECUTION', 'COACHING', 'MONITORING', 'MIDLINE', 'ENDLINE', 'FOLLOW-UP', 'GRADUATED', 'RE-ENTRY');--> statement-breakpoint
CREATE TYPE "public"."evidence_class" AS ENUM('Verified', 'Document-supported', 'Self-reported', 'Unverified', 'Missing');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('SME', 'AGRIFOOD', 'ESO');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'EXECUTIVE', 'PROGRAMME_MANAGER', 'CONSULTANT', 'REVIEWER', 'COACH', 'FINANCE', 'OWNER', 'FUNDER');--> statement-breakpoint
CREATE SEQUENCE "public"."seq_act" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_ai" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_case" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_cohort" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_con" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_dgn" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_diag" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_doc" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_ev" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_inv" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_iv" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_kpi" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_org" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_pay" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_plan" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_prog" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_rep" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_risk" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_rx" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_sess" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_usr" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'ACT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_act')::text, 6, '0') NOT NULL,
	"case_id" uuid NOT NULL,
	"intervention_id" uuid,
	"text" text NOT NULL,
	"owner_role" text NOT NULL,
	"assignee_id" uuid,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"evidence_note" text,
	"completed_at" timestamp with time zone,
	"overdue_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ai_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"valid" boolean NOT NULL,
	"raw" text,
	"input_tokens" integer DEFAULT 0,
	"output_tokens" integer DEFAULT 0,
	"latency_ms" integer DEFAULT 0,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'AI-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_ai')::text, 6, '0') NOT NULL,
	"agent" text NOT NULL,
	"case_id" uuid,
	"model" text NOT NULL,
	"context_bytes" integer DEFAULT 0 NOT NULL,
	"requested_by" uuid,
	"ok" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_requests_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"case_id" uuid,
	"user_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"ip" text,
	"request_id" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'CASE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_case')::text, 6, '0') NOT NULL,
	"org_id" uuid NOT NULL,
	"programme_id" uuid,
	"cohort_id" uuid,
	"status" "case_state" DEFAULT 'PROFILED' NOT NULL,
	"consultant_id" uuid,
	"coach_id" uuid,
	"reviewer_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "coaching_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'SES-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_sess')::text, 6, '0') NOT NULL,
	"case_id" uuid NOT NULL,
	"coach_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'Scheduled' NOT NULL,
	"notes" text,
	"brief" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaching_sessions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'COH-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_cohort')::text, 6, '0') NOT NULL,
	"programme_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"capacity" integer DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cohorts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'CON-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_con')::text, 6, '0') NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_id" uuid,
	"programme_id" uuid,
	"status" text DEFAULT 'Draft' NOT NULL,
	"start_date" date,
	"end_date" date,
	"amount_ghs" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'DGN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_dgn')::text, 6, '0') NOT NULL,
	"case_id" uuid NOT NULL,
	"diagnostic_id" uuid NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"summary" text NOT NULL,
	"root_causes" jsonb NOT NULL,
	"priority" text NOT NULL,
	"risks" jsonb NOT NULL,
	"model_confidence" numeric(3, 2),
	"ai_request_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnoses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'DIAG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_diag')::text, 6, '0') NOT NULL,
	"case_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"submission_uuid" text,
	"completion" numeric(4, 3) DEFAULT '0' NOT NULL,
	"validation_notes" text,
	"submitted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostics_code_unique" UNIQUE("code"),
	CONSTRAINT "diagnostics_submission_uuid_unique" UNIQUE("submission_uuid")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'DOC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_doc')::text, 6, '0') NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'Stored' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"case_id" uuid,
	"org_id" uuid,
	"actor_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'EVD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_ev')::text, 6, '0') NOT NULL,
	"case_id" uuid NOT NULL,
	"response_id" uuid,
	"document_id" uuid,
	"class" "evidence_class" DEFAULT 'Self-reported' NOT NULL,
	"description" text NOT NULL,
	"link" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "health_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diagnostic_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"run" integer DEFAULT 1 NOT NULL,
	"overall" numeric(5, 1) NOT NULL,
	"maturity" text NOT NULL,
	"confidence_class" text NOT NULL,
	"dimensions" jsonb NOT NULL,
	"evidence_share" jsonb NOT NULL,
	"rules_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'INT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_iv')::text, 6, '0') NOT NULL,
	"case_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"library_code" text NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interventions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_inv')::text, 6, '0') NOT NULL,
	"contract_id" uuid,
	"org_id" uuid NOT NULL,
	"amount_ghs" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"due_date" date NOT NULL,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"locked_at" timestamp with time zone,
	"result" jsonb,
	"last_error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kpi_id" uuid NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"reading_date" date NOT NULL,
	"source_class" "evidence_class" DEFAULT 'Self-reported' NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'KPI-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_kpi')::text, 6, '0') NOT NULL,
	"case_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text,
	"baseline" numeric(14, 2),
	"target" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpis_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"dimension" text NOT NULL,
	"description" text NOT NULL,
	"typical_days" integer DEFAULT 30 NOT NULL,
	"kpi_hint" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_items_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'SME-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_org')::text, 6, '0') NOT NULL,
	"name" text NOT NULL,
	"type" "org_type" DEFAULT 'SME' NOT NULL,
	"sector" text,
	"region" text,
	"district" text,
	"size" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"consent_at" timestamp with time zone,
	"consent_by" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "outbox_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'PAY-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_pay')::text, 6, '0') NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"amount_ghs" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"provider_payload" jsonb,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_code_unique" UNIQUE("code"),
	CONSTRAINT "payments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'PLN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_plan')::text, 6, '0') NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_ghs" numeric(12, 2) NOT NULL,
	"interval_months" integer DEFAULT 12 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'RX-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_rx')::text, 6, '0') NOT NULL,
	"case_id" uuid NOT NULL,
	"diagnosis_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"items" jsonb NOT NULL,
	"reviewer_note" text,
	"ai_request_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescriptions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'PRG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_prog')::text, 6, '0') NOT NULL,
	"name" text NOT NULL,
	"funder" text,
	"start_date" date,
	"end_date" date,
	"budget_ghs" numeric(14, 2),
	"status" text DEFAULT 'Draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programmes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"dimension" text NOT NULL,
	"text" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'REP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_rep')::text, 6, '0') NOT NULL,
	"case_id" uuid NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"basis" jsonb,
	"ai_request_id" uuid,
	"created_by" uuid,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diagnostic_id" uuid NOT NULL,
	"question_code" text NOT NULL,
	"value" integer NOT NULL,
	"evidence_class" "evidence_class" DEFAULT 'Self-reported' NOT NULL,
	"evidence_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'RISK-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_risk')::text, 6, '0') NOT NULL,
	"case_id" uuid NOT NULL,
	"text" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risks_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_programmes" (
	"user_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	CONSTRAINT "user_programmes_user_id_programme_id_pk" PRIMARY KEY("user_id","programme_id")
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'USR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_usr')::text, 6, '0') NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"org_id" uuid,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"mfa_secret" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_attempts" ADD CONSTRAINT "ai_attempts_request_id_ai_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ai_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_consultant_id_users_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_coach_id_users_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching_sessions" ADD CONSTRAINT "coaching_sessions_coach_id_users_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_diagnostic_id_diagnostics_id_fk" FOREIGN KEY ("diagnostic_id") REFERENCES "public"."diagnostics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_diagnostic_id_diagnostics_id_fk" FOREIGN KEY ("diagnostic_id") REFERENCES "public"."diagnostics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_readings" ADD CONSTRAINT "kpi_readings_kpi_id_kpis_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_diagnosis_id_diagnoses_id_fk" FOREIGN KEY ("diagnosis_id") REFERENCES "public"."diagnoses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_diagnostic_id_diagnostics_id_fk" FOREIGN KEY ("diagnostic_id") REFERENCES "public"."diagnostics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_programmes" ADD CONSTRAINT "user_programmes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_programmes" ADD CONSTRAINT "user_programmes_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "act_case_idx" ON "actions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "act_due_idx" ON "actions" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "act_assignee_idx" ON "actions" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "ai_case_idx" ON "ai_requests" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "apr_record_idx" ON "approvals" USING btree ("record_type","record_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "case_org_idx" ON "cases" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "case_status_idx" ON "cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "case_prog_idx" ON "cases" USING btree ("programme_id");--> statement-breakpoint
CREATE INDEX "case_consultant_idx" ON "cases" USING btree ("consultant_id");--> statement-breakpoint
CREATE INDEX "case_coach_idx" ON "cases" USING btree ("coach_id");--> statement-breakpoint
CREATE INDEX "case_reviewer_idx" ON "cases" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "sess_case_idx" ON "coaching_sessions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "cohort_prog_idx" ON "cohorts" USING btree ("programme_id");--> statement-breakpoint
CREATE INDEX "con_org_idx" ON "contracts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "dgn_case_idx" ON "diagnoses" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "diag_case_idx" ON "diagnostics" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "doc_case_idx" ON "documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "doc_org_idx" ON "documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "evt_case_idx" ON "events" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "evt_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "evt_created_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ev_case_idx" ON "evidence" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "score_case_idx" ON "health_scores" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "iv_case_idx" ON "interventions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "inv_org_idx" ON "invoices" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "inv_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_pick_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "kr_kpi_idx" ON "kpi_readings" USING btree ("kpi_id");--> statement-breakpoint
CREATE INDEX "kpi_case_idx" ON "kpis" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "org_name_idx" ON "organisations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "org_region_idx" ON "organisations" USING btree ("region");--> statement-breakpoint
CREATE INDEX "pay_inv_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "rx_case_idx" ON "prescriptions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "rep_case_idx" ON "reports" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "resp_diag_idx" ON "responses" USING btree ("diagnostic_id");--> statement-breakpoint
CREATE INDEX "risk_case_idx" ON "risks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_exp_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_uq" ON "webhook_events" USING btree ("provider","event_id");