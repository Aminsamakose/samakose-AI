CREATE TABLE "programme_workspace_configurations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "programme_workspaces"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "configuration" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "objectives" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "eligibility_rules" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "delivery_model" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "reporting" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "entitlements" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "framework_version_id" uuid REFERENCES "framework_versions"("id"),
  "participant_consent_required" boolean NOT NULL DEFAULT true,
  "funder_reporting_enabled" boolean NOT NULL DEFAULT false,
  "change_reason" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamptz,
  "rejection_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "programme_workspace_configuration_status_ck" CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED')),
  CONSTRAINT "programme_workspace_configuration_version_ck" CHECK ("version" >= 1),
  CONSTRAINT "programme_workspace_configuration_approval_ck" CHECK (("status" = 'APPROVED' AND "approved_by" IS NOT NULL AND "approved_at" IS NOT NULL) OR "status" <> 'APPROVED'),
  CONSTRAINT "programme_workspace_configuration_uq" UNIQUE ("workspace_id", "version")
);

CREATE INDEX "programme_workspace_configuration_workspace_idx" ON "programme_workspace_configurations" ("workspace_id", "version");
CREATE INDEX "programme_workspace_configuration_status_idx" ON "programme_workspace_configurations" ("workspace_id", "status");

ALTER TABLE "programme_workspace_configurations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "programme_workspace_configurations" OWNER TO "samakose_app";
