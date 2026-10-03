-- Phase 2, slice A: respondent accounts and area assignments.
-- RESPONDENT is a role with no default permissions. A respondent reaches data only through assignments.
-- Adding a value to the role type is safe. Removing one later is not, so it is added once, deliberately.
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'RESPONDENT';--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"job_role" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "area_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"sub_dimension" text NOT NULL,
	"member_id" uuid,
	"suggested_by" text DEFAULT 'rule' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_member_status_valid" CHECK ("status" IN ('invited','active','removed'));--> statement-breakpoint
ALTER TABLE "area_assignments" ADD CONSTRAINT "area_assignments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_assignments" ADD CONSTRAINT "area_assignments_member_id_org_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_assignments" ADD CONSTRAINT "area_assignments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_assignments" ADD CONSTRAINT "area_suggested_by_valid" CHECK ("suggested_by" IN ('rule','ai','owner'));--> statement-breakpoint
CREATE UNIQUE INDEX "org_member_uq" ON "org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "org_member_user_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "area_assignment_uq" ON "area_assignments" USING btree ("org_id","platform","sub_dimension");--> statement-breakpoint
ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "area_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application connects as samakose_app, which must own every table (see migration 0018).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "org_members" OWNER TO samakose_app;
    ALTER TABLE "area_assignments" OWNER TO samakose_app;
  END IF;
END $$;
