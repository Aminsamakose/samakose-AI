-- Phase A: feedback from signed-in people (screen feedback during UAT, and whether a score matched the business). Read only by the administrator; never reaches scoring.
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"org_id" uuid,
	"kind" text NOT NULL,
	"page" text,
	"rating" integer,
	"accuracy" text,
	"message" text,
	"case_id" uuid,
	"health_score_id" uuid,
	"status" text DEFAULT 'New' NOT NULL,
	"admin_note" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_health_score_id_health_scores_id_fk" FOREIGN KEY ("health_score_id") REFERENCES "public"."health_scores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_result_uq" ON "feedback" USING btree ("user_id","health_score_id") WHERE "feedback"."kind" = 'result';--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_kind_valid" CHECK ("kind" IN ('app','result'));--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_status_valid" CHECK ("status" IN ('New','Triaged','Resolved','Not an issue'));--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_rating_range" CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5));--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_accuracy_valid" CHECK ("accuracy" IS NULL OR "accuracy" IN ('accurate','partly','not_accurate'));--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application connects as samakose_app, which must own every table (see migration 0018).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "feedback" OWNER TO samakose_app;
  END IF;
END $$;
