CREATE TABLE "programme_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "programme_id" uuid NOT NULL UNIQUE REFERENCES "programmes"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "provider_source" text NOT NULL DEFAULT 'SAMAKOSE_NETWORK',
  "configuration_version" integer NOT NULL DEFAULT 1,
  "framework_version_id" uuid REFERENCES "framework_versions"("id"),
  "participant_consent_required" boolean NOT NULL DEFAULT true,
  "funder_reporting_enabled" boolean NOT NULL DEFAULT false,
  "configuration" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "programme_workspace_status_ck" CHECK ("status" in ('DRAFT','COMMERCIAL_REVIEW','INVOICED','PAYMENT_PENDING','APPROVED','CONFIGURING','READY','ACTIVE','PAUSED','COMPLETING','COMPLETED','CLOSED','ARCHIVED')),
  CONSTRAINT "programme_workspace_provider_ck" CHECK ("provider_source" in ('SAMAKOSE_NETWORK','BRING_YOUR_OWN','HYBRID')),
  CONSTRAINT "programme_workspace_config_version_ck" CHECK ("configuration_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX "programme_workspace_status_idx" ON "programme_workspaces" USING btree ("status");
--> statement-breakpoint
CREATE TABLE "programme_workspace_members" (
  "workspace_id" uuid NOT NULL REFERENCES "programme_workspaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "joined_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "programme_workspace_member_role_ck" CHECK ("role" in ('PROGRAMME_MANAGER','ASSESSOR','EXPERT','COACH','REVIEWER','FINANCE','MEL')),
  CONSTRAINT "programme_workspace_member_uq" UNIQUE ("workspace_id","user_id","role")
);
--> statement-breakpoint
CREATE INDEX "programme_workspace_member_user_idx" ON "programme_workspace_members" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "programme_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "programme_id" uuid NOT NULL REFERENCES "programmes"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "programme_workspaces"("id") ON DELETE CASCADE,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id"),
  "cohort_id" uuid REFERENCES "cohorts"("id"),
  "status" text NOT NULL DEFAULT 'APPLICATION',
  "invited_at" timestamptz,
  "consent_at" timestamptz,
  "consent_by" uuid REFERENCES "users"("id"),
  "onboarded_at" timestamptz,
  "completed_at" timestamptz,
  "withdrawn_at" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "programme_participant_programme_org_uq" UNIQUE ("programme_id","organisation_id"),
  CONSTRAINT "programme_participant_status_ck" CHECK ("status" in ('APPLICATION','ELIGIBILITY','SELECTED','INVITED','CONSENTED','ONBOARDED','COHORT_ASSIGNED','ACTIVE','COMPLETING','COMPLETED','WITHDRAWN','REJECTED'))
);
--> statement-breakpoint
CREATE INDEX "programme_participant_workspace_idx" ON "programme_participants" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "programme_participant_cohort_idx" ON "programme_participants" USING btree ("cohort_id");
--> statement-breakpoint
CREATE INDEX "programme_participant_status_idx" ON "programme_participants" USING btree ("status");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "programme_workspaces" OWNER TO samakose_app;
    ALTER TABLE "programme_workspace_members" OWNER TO samakose_app;
    ALTER TABLE "programme_participants" OWNER TO samakose_app;
  END IF;
END $$;
