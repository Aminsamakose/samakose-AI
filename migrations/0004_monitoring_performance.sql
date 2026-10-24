SET search_path TO public;
CREATE TABLE "programme_monitoring_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"cohort_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_snapshot_status_ck" CHECK ("programme_monitoring_snapshots"."status" in ('DRAFT','FINAL')),
	CONSTRAINT "monitoring_snapshot_period_ck" CHECK ("programme_monitoring_snapshots"."period_end" >= "programme_monitoring_snapshots"."period_start")
);
--> statement-breakpoint
CREATE TABLE "provider_performance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_assignment_id" uuid NOT NULL,
	"provider_user_id" uuid NOT NULL,
	"provider_role" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"human_performance_score" numeric(5, 2),
	"service_quality_score" numeric(5, 2),
	"client_experience_score" numeric(5, 2),
	"business_outcome_score" numeric(5, 2),
	"composite_score" numeric(5, 2),
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_performance_role_ck" CHECK ("provider_performance_reviews"."provider_role" in ('EXPERT','COACH')),
	CONSTRAINT "provider_performance_status_ck" CHECK ("provider_performance_reviews"."status" in ('DRAFT','REVIEWED','FINAL')),
	CONSTRAINT "provider_performance_period_ck" CHECK ("provider_performance_reviews"."period_end" >= "provider_performance_reviews"."period_start"),
	CONSTRAINT "provider_performance_human_ck" CHECK ("provider_performance_reviews"."human_performance_score" is null or "provider_performance_reviews"."human_performance_score" between 0 and 100),
	CONSTRAINT "provider_performance_service_ck" CHECK ("provider_performance_reviews"."service_quality_score" is null or "provider_performance_reviews"."service_quality_score" between 0 and 100),
	CONSTRAINT "provider_performance_client_ck" CHECK ("provider_performance_reviews"."client_experience_score" is null or "provider_performance_reviews"."client_experience_score" between 0 and 100),
	CONSTRAINT "provider_performance_outcome_ck" CHECK ("provider_performance_reviews"."business_outcome_score" is null or "provider_performance_reviews"."business_outcome_score" between 0 and 100),
	CONSTRAINT "provider_performance_composite_ck" CHECK ("provider_performance_reviews"."composite_score" is null or "provider_performance_reviews"."composite_score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "programme_monitoring_snapshots" ADD CONSTRAINT "programme_monitoring_snapshots_workspace_id_programme_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."programme_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_monitoring_snapshots" ADD CONSTRAINT "programme_monitoring_snapshots_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_monitoring_snapshots" ADD CONSTRAINT "programme_monitoring_snapshots_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_performance_reviews" ADD CONSTRAINT "provider_performance_reviews_workspace_id_programme_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."programme_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_performance_reviews" ADD CONSTRAINT "provider_performance_reviews_provider_assignment_id_provider_assignments_id_fk" FOREIGN KEY ("provider_assignment_id") REFERENCES "public"."provider_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_performance_reviews" ADD CONSTRAINT "provider_performance_reviews_provider_user_id_users_id_fk" FOREIGN KEY ("provider_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_performance_reviews" ADD CONSTRAINT "provider_performance_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_performance_reviews" ADD CONSTRAINT "provider_performance_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitoring_snapshot_workspace_idx" ON "programme_monitoring_snapshots" USING btree ("workspace_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "monitoring_snapshot_cohort_idx" ON "programme_monitoring_snapshots" USING btree ("cohort_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_performance_period_uq" ON "provider_performance_reviews" USING btree ("provider_assignment_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "provider_performance_workspace_idx" ON "provider_performance_reviews" USING btree ("workspace_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "provider_performance_provider_idx" ON "provider_performance_reviews" USING btree ("provider_user_id","period_end");--> statement-breakpoint
ALTER TABLE "programme_monitoring_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_performance_reviews" ENABLE ROW LEVEL SECURITY;