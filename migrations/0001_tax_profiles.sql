-- The baseline migration (0000_baseline_squash.sql, a pg_dump output) sets search_path to '' near its
-- top and never restores it. All migrations run on the same session, so an unqualified CREATE TABLE
-- here would otherwise fail with "no schema has been selected to create in".
SET search_path TO public;
--> statement-breakpoint
CREATE TABLE "tax_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"party_type" text NOT NULL,
	"legal_name" text NOT NULL,
	"tax_identifier" text NOT NULL,
	"tax_residency" text DEFAULT 'GH' NOT NULL,
	"status" text DEFAULT 'Submitted' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "txp_status_idx" ON "tax_profiles" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "tax_profiles" ENABLE ROW LEVEL SECURITY;