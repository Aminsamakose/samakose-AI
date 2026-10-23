-- Phase 2, slice B: team assessment rounds, saved drafts, and who answered each question. Scoring is not changed.
CREATE TABLE "assessment_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"framework_version_id" uuid,
	"status" text DEFAULT 'Collecting' NOT NULL,
	"owner_id" uuid NOT NULL,
	"diagnostic_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "response_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"question_code" text NOT NULL,
	"value" integer,
	"not_applicable" boolean DEFAULT false NOT NULL,
	"evidence_class" text DEFAULT 'Self-reported' NOT NULL,
	"evidence_ref" text,
	"note" text,
	"answered_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagnostics" ADD COLUMN "assessment_round_id" uuid;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "answered_by" uuid;--> statement-breakpoint
ALTER TABLE "assessment_rounds" ADD CONSTRAINT "assessment_rounds_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_rounds" ADD CONSTRAINT "assessment_rounds_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_rounds" ADD CONSTRAINT "assessment_rounds_framework_version_id_framework_versions_id_fk" FOREIGN KEY ("framework_version_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_rounds" ADD CONSTRAINT "assessment_rounds_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_rounds" ADD CONSTRAINT "assessment_rounds_diagnostic_id_diagnostics_id_fk" FOREIGN KEY ("diagnostic_id") REFERENCES "public"."diagnostics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_drafts" ADD CONSTRAINT "response_drafts_round_id_assessment_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."assessment_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_drafts" ADD CONSTRAINT "response_drafts_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "round_case_idx" ON "assessment_rounds" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_one_open_uq" ON "assessment_rounds" USING btree ("case_id") WHERE "assessment_rounds"."status" = 'Collecting';--> statement-breakpoint
CREATE UNIQUE INDEX "draft_round_question_uq" ON "response_drafts" USING btree ("round_id","question_code");--> statement-breakpoint
ALTER TABLE "assessment_rounds" ADD CONSTRAINT "round_status_valid" CHECK ("status" IN ('Collecting','Submitted','Cancelled'));--> statement-breakpoint
ALTER TABLE "response_drafts" ADD CONSTRAINT "draft_value_range" CHECK ("value" IS NULL OR ("value" >= 0 AND "value" <= 4));--> statement-breakpoint
ALTER TABLE "assessment_rounds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "response_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application connects as samakose_app, which must own every table (see migration 0018).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "assessment_rounds" OWNER TO samakose_app;
    ALTER TABLE "response_drafts" OWNER TO samakose_app;
  END IF;
END $$;
