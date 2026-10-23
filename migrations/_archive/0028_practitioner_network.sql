-- Practitioner network: one photo per person, one profile per expert or coach, assignment history, conflicts and ratings.
-- No existing table is rewritten. Existing lead, coach and reviewer pointers on cases are copied into assignment rows once, so history starts from today.
ALTER TABLE "users" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "photo_mime" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "photo_sha256" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "photo_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "practitioner_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"functions" text[] DEFAULT '{expert}'::text[] NOT NULL,
	"headline" text,
	"bio" text,
	"specialisations" text[] DEFAULT '{}'::text[] NOT NULL,
	"strengths" text[] DEFAULT '{}'::text[] NOT NULL,
	"sectors" text[] DEFAULT '{}'::text[] NOT NULL,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"business_sizes" text[] DEFAULT '{}'::text[] NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"delivery_modes" text[] DEFAULT '{}'::text[] NOT NULL,
	"years_experience" integer,
	"credentials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_active" integer DEFAULT 5 NOT NULL,
	"availability" text DEFAULT 'Available' NOT NULL,
	"vetting_status" text DEFAULT 'Draft' NOT NULL,
	"vetting_note" text,
	"conduct_accepted_at" timestamp with time zone,
	"conduct_version" text,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"rate_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "practitioner_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"declared_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "case_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"function" text NOT NULL,
	"specialisation" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"assigned_by" uuid,
	"match_score" integer,
	"match_breakdown" jsonb,
	"reason" text,
	"replaces_id" uuid,
	"acknowledge_by" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"decline_reason" text,
	"overdue_notified_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "engagement_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"source" text NOT NULL,
	"rater_id" uuid NOT NULL,
	"scores" jsonb NOT NULL,
	"overall" integer NOT NULL,
	"comment" text,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_profiles" ADD CONSTRAINT "practitioner_profiles_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_profiles" ADD CONSTRAINT "pp_vetting_valid" CHECK ("vetting_status" IN ('Draft','Submitted','Approved','Rejected','Suspended'));--> statement-breakpoint
ALTER TABLE "practitioner_profiles" ADD CONSTRAINT "pp_availability_valid" CHECK ("availability" IN ('Available','Limited','Unavailable'));--> statement-breakpoint
ALTER TABLE "practitioner_profiles" ADD CONSTRAINT "pp_capacity_valid" CHECK ("max_active" BETWEEN 1 AND 50);--> statement-breakpoint
ALTER TABLE "practitioner_conflicts" ADD CONSTRAINT "practitioner_conflicts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_conflicts" ADD CONSTRAINT "practitioner_conflicts_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_conflicts" ADD CONSTRAINT "practitioner_conflicts_declared_by_users_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "ca_function_valid" CHECK ("function" IN ('lead','specialist','coach','reviewer'));--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "ca_status_valid" CHECK ("status" IN ('Active','Declined','Completed','Replaced'));--> statement-breakpoint
ALTER TABLE "engagement_ratings" ADD CONSTRAINT "engagement_ratings_assignment_id_case_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."case_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_ratings" ADD CONSTRAINT "engagement_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_ratings" ADD CONSTRAINT "er_source_valid" CHECK ("source" IN ('client','reviewer','programme_manager'));--> statement-breakpoint
ALTER TABLE "engagement_ratings" ADD CONSTRAINT "er_overall_valid" CHECK ("overall" BETWEEN 0 AND 100);--> statement-breakpoint
CREATE INDEX "pp_status_idx" ON "practitioner_profiles" USING btree ("vetting_status");--> statement-breakpoint
CREATE UNIQUE INDEX "pc_user_org_uq" ON "practitioner_conflicts" USING btree ("user_id","org_id");--> statement-breakpoint
CREATE INDEX "ca_case_idx" ON "case_assignments" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "ca_user_idx" ON "case_assignments" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ca_single_uq" ON "case_assignments" USING btree ("case_id","function") WHERE "case_assignments"."status" = 'Active' and "case_assignments"."function" <> 'specialist';--> statement-breakpoint
CREATE UNIQUE INDEX "ca_specialist_uq" ON "case_assignments" USING btree ("case_id","user_id") WHERE "case_assignments"."status" = 'Active' and "case_assignments"."function" = 'specialist';--> statement-breakpoint
CREATE INDEX "er_assignment_idx" ON "engagement_ratings" USING btree ("assignment_id");--> statement-breakpoint
-- Ratings are history. They can be added, never changed or removed.
CREATE FUNCTION "engagement_ratings_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Engagement ratings cannot be changed or deleted. Add a new rating instead.'; END $$;--> statement-breakpoint
CREATE TRIGGER "engagement_ratings_guard" BEFORE UPDATE OR DELETE ON "engagement_ratings" FOR EACH ROW EXECUTE FUNCTION "engagement_ratings_immutable"();--> statement-breakpoint
-- Start the assignment history from the pointers already on cases.
INSERT INTO "case_assignments" ("case_id","user_id","function","status","reason") SELECT "id","consultant_id",'lead','Active','Existing assignment at migration' FROM "cases" WHERE "consultant_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "case_assignments" ("case_id","user_id","function","status","reason") SELECT "id","coach_id",'coach','Active','Existing assignment at migration' FROM "cases" WHERE "coach_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "case_assignments" ("case_id","user_id","function","status","reason") SELECT "id","reviewer_id",'reviewer','Active','Existing assignment at migration' FROM "cases" WHERE "reviewer_id" IS NOT NULL;--> statement-breakpoint
-- Every existing expert gets a Draft profile so the vetting gate has something to act on.
INSERT INTO "practitioner_profiles" ("user_id") SELECT "id" FROM "users" WHERE "role" = 'EXPERT' ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "practitioner_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "practitioner_conflicts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "case_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engagement_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application connects as samakose_app, which must own every table (see migration 0018).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "practitioner_profiles" OWNER TO samakose_app;
    ALTER TABLE "practitioner_conflicts" OWNER TO samakose_app;
    ALTER TABLE "case_assignments" OWNER TO samakose_app;
    ALTER TABLE "engagement_ratings" OWNER TO samakose_app;
    ALTER FUNCTION "engagement_ratings_immutable"() OWNER TO samakose_app;
  END IF;
END $$;
