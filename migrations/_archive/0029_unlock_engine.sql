-- UNLOCK: opportunities (funding, partnerships, markets, programmes and more), consented referrals and their history.
-- Additive only. No existing table changes. A referral can only move past Approved when the owner has consented and a person has approved it; the database enforces that.
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"summary" text NOT NULL,
	"url" text,
	"value_min" numeric(14,2),
	"value_max" numeric(14,2),
	"currency" text DEFAULT 'GHS' NOT NULL,
	"deadline" date,
	"status" text DEFAULT 'Draft' NOT NULL,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "opportunity_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"status" text DEFAULT 'Suggested' NOT NULL,
	"suggested_by" uuid,
	"consent_by" uuid,
	"consent_at" timestamp with time zone,
	"consent_scope" text[] DEFAULT '{}'::text[] NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"referred_at" timestamp with time zone,
	"amount_ghs" numeric(14,2),
	"outcome_note" text,
	"match_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "opportunity_referral_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opp_type_valid" CHECK ("type" IN ('Funding','Grant','Loan','Equity','Partnership','Market','Procurement','Programme','Assistance','Training'));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opp_status_valid" CHECK ("status" IN ('Draft','Open','Closed','Archived'));--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opp_value_valid" CHECK ("value_min" IS NULL OR "value_max" IS NULL OR "value_min" <= "value_max");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_referrals" ADD CONSTRAINT "opportunity_referrals_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_referrals" ADD CONSTRAINT "opportunity_referrals_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_referrals" ADD CONSTRAINT "opportunity_referrals_suggested_by_users_id_fk" FOREIGN KEY ("suggested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_referrals" ADD CONSTRAINT "opportunity_referrals_consent_by_users_id_fk" FOREIGN KEY ("consent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_referrals" ADD CONSTRAINT "opportunity_referrals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_referrals" ADD CONSTRAINT "ref_status_valid" CHECK ("status" IN ('Suggested','Consented','Approved','Referred','Applied','Shortlisted','Awarded','Declined','Withdrawn'));--> statement-breakpoint
ALTER TABLE "opportunity_referrals" ADD CONSTRAINT "ref_consent_gate" CHECK ("status" NOT IN ('Approved','Referred','Applied','Shortlisted','Awarded') OR ("consent_at" IS NOT NULL AND "consent_by" IS NOT NULL AND cardinality("consent_scope") > 0));--> statement-breakpoint
ALTER TABLE "opportunity_referrals" ADD CONSTRAINT "ref_approval_gate" CHECK ("status" NOT IN ('Approved','Referred','Applied','Shortlisted','Awarded') OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "opportunity_referrals" ADD CONSTRAINT "ref_amount_only_when_awarded" CHECK ("amount_ghs" IS NULL OR "status" = 'Awarded');--> statement-breakpoint
ALTER TABLE "opportunity_referral_events" ADD CONSTRAINT "opportunity_referral_events_referral_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."opportunity_referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_referral_events" ADD CONSTRAINT "opportunity_referral_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opp_status_idx" ON "opportunities" USING btree ("status","deadline");--> statement-breakpoint
CREATE UNIQUE INDEX "opp_source_uq" ON "opportunities" USING btree ("source","source_ref") WHERE "opportunities"."source_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ref_org_idx" ON "opportunity_referrals" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ref_status_idx" ON "opportunity_referrals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ref_live_uq" ON "opportunity_referrals" USING btree ("org_id","opportunity_id") WHERE "opportunity_referrals"."status" NOT IN ('Declined','Withdrawn');--> statement-breakpoint
CREATE INDEX "refev_idx" ON "opportunity_referral_events" USING btree ("referral_id","created_at");--> statement-breakpoint
ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunity_referrals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunity_referral_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "opportunities" OWNER TO samakose_app;
    ALTER TABLE "opportunity_referrals" OWNER TO samakose_app;
    ALTER TABLE "opportunity_referral_events" OWNER TO samakose_app;
  END IF;
END $$;
