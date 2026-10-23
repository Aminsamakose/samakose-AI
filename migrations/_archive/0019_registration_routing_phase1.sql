CREATE TABLE "country_settings" (
	"country_code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"phone_code" text NOT NULL,
	"default_language" text DEFAULT 'en' NOT NULL,
	"level_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_protection_regime" text,
	"regulator_name" text,
	"youth_max_age" integer DEFAULT 35 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "country_settings" ADD CONSTRAINT "country_code_iso2" CHECK ("country_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "country_settings" ADD CONSTRAINT "country_youth_age_valid" CHECK ("youth_max_age" BETWEEN 15 AND 45);--> statement-breakpoint
INSERT INTO "country_settings" ("country_code","name","currency","phone_code","default_language","level_labels","data_protection_regime","regulator_name","youth_max_age","active")
VALUES ('GH','Ghana','GHS','+233','en','["Region","District","Community"]'::jsonb,'Data Protection Act, 2012 (Act 843)','Data Protection Commission',35,true);--> statement-breakpoint
CREATE TABLE "geo_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"level" integer NOT NULL,
	"parent_id" uuid,
	"code" text,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source" text,
	"source_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "geo_units" ADD CONSTRAINT "geo_units_country_code_country_settings_country_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."country_settings"("country_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_units" ADD CONSTRAINT "geo_units_parent_id_geo_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."geo_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_units" ADD CONSTRAINT "geo_level_valid" CHECK ("level" BETWEEN 1 AND 6);--> statement-breakpoint
CREATE INDEX "geo_parent_idx" ON "geo_units" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "geo_country_level_idx" ON "geo_units" USING btree ("country_code","level");--> statement-breakpoint
CREATE UNIQUE INDEX "geo_unique_name" ON "geo_units" ("country_code", "level", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));--> statement-breakpoint
-- The sixteen regions of Ghana (2018 reorganisation). Districts are loaded from the official list by an administrator import, dated and sourced.
INSERT INTO "geo_units" ("country_code","level","name","source") SELECT 'GH', 1, r, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.' FROM unnest(ARRAY['Ahafo','Ashanti','Bono','Bono East','Central','Eastern','Greater Accra','North East','Northern','Oti','Savannah','Upper East','Upper West','Volta','Western','Western North']) AS r;--> statement-breakpoint
CREATE TABLE "consent_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"country_code" text NOT NULL,
	"version" integer NOT NULL,
	"text" text NOT NULL,
	"effective_from" timestamp with time zone,
	"status" text DEFAULT 'Draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "consent_notices" ADD CONSTRAINT "consent_notices_country_code_country_settings_country_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."country_settings"("country_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_notices" ADD CONSTRAINT "consent_notices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_notices" ADD CONSTRAINT "consent_notice_purpose_valid" CHECK ("purpose" IN ('account','assessment','team_invites','demographics','disability','funder_aggregate'));--> statement-breakpoint
ALTER TABLE "consent_notices" ADD CONSTRAINT "consent_notice_status_valid" CHECK ("status" IN ('Draft','Published','Retired'));--> statement-breakpoint
CREATE UNIQUE INDEX "consent_notice_uq" ON "consent_notices" USING btree ("purpose","country_code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_notice_one_published" ON "consent_notices" ("purpose", "country_code") WHERE "status" = 'Published';--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"notice_id" uuid NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_notice_id_consent_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."consent_notices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consent_action_valid" CHECK ("action" IN ('granted','withdrawn'));--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consent_source_valid" CHECK ("source" IN ('registration','profile','invitation'));--> statement-breakpoint
CREATE INDEX "consent_user_idx" ON "consents" USING btree ("user_id","at");--> statement-breakpoint
CREATE TRIGGER "consents_append_only" BEFORE UPDATE OR DELETE ON "consents" FOR EACH ROW EXECUTE FUNCTION forbid_change();--> statement-breakpoint
CREATE TABLE "registration_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"platform" text NOT NULL,
	"job_role" text NOT NULL,
	"job_role_other" text,
	"responsibility" text,
	"assessment_mode" text NOT NULL,
	"suggestion_source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_answers_user_id_unique" UNIQUE("user_id")
);--> statement-breakpoint
ALTER TABLE "registration_answers" ADD CONSTRAINT "registration_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_answers" ADD CONSTRAINT "registration_answers_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_answers" ADD CONSTRAINT "reg_platform_valid" CHECK ("platform" IN ('SME360','AGRIFOOD360','ESO360'));--> statement-breakpoint
ALTER TABLE "registration_answers" ADD CONSTRAINT "reg_mode_valid" CHECK ("assessment_mode" IN ('self','team','hybrid'));--> statement-breakpoint
ALTER TABLE "registration_answers" ADD CONSTRAINT "reg_suggestion_valid" CHECK ("suggestion_source" IN ('rule','ai','user'));--> statement-breakpoint
CREATE TABLE "role_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"framework_code" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"data" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "role_mappings" ADD CONSTRAINT "role_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_mappings" ADD CONSTRAINT "role_mappings_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_mappings" ADD CONSTRAINT "role_mapping_status_valid" CHECK ("status" IN ('Draft','Published','Retired'));--> statement-breakpoint
-- Publishing needs a person's approval, and never the person who created it.
ALTER TABLE "role_mappings" ADD CONSTRAINT "role_mapping_published_needs_approval" CHECK ("status" <> 'Published' OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "role_mapping_version_uq" ON "role_mappings" USING btree ("framework_code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "role_mapping_one_published" ON "role_mappings" ("framework_code") WHERE "status" = 'Published';--> statement-breakpoint
CREATE TABLE "demographic_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"category" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "demographic_profiles" ADD CONSTRAINT "demographic_profiles_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demographic_profiles" ADD CONSTRAINT "demographic_subject_valid" CHECK ("subject_type" IN ('user','organisation'));--> statement-breakpoint
ALTER TABLE "demographic_profiles" ADD CONSTRAINT "demographic_category_valid" CHECK ("category" IN ('demographics','disability'));--> statement-breakpoint
CREATE UNIQUE INDEX "demographic_subject_uq" ON "demographic_profiles" USING btree ("subject_type","subject_id","category");--> statement-breakpoint
-- Every category needs a consent row that records a grant, and disability needs a grant for the disability purpose.
CREATE FUNCTION "demographic_consent_guard"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE a text; p text;
BEGIN
  SELECT c.action, n.purpose INTO a, p FROM consents c JOIN consent_notices n ON n.id = c.notice_id WHERE c.id = NEW.consent_id;
  IF a IS DISTINCT FROM 'granted' THEN RAISE EXCEPTION 'Demographic data needs a recorded consent.'; END IF;
  IF p IS DISTINCT FROM NEW.category THEN RAISE EXCEPTION 'The consent on record is for a different purpose (%).', p; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "demographic_consent_guard_trg" BEFORE INSERT OR UPDATE ON "demographic_profiles" FOR EACH ROW EXECUTE FUNCTION "demographic_consent_guard"();--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "country_code" text DEFAULT 'GH' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "geo_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "community" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "urban_rural" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "years_operating" integer;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "ownership_structure" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_country_code_country_settings_country_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."country_settings"("country_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_geo_unit_id_geo_units_id_fk" FOREIGN KEY ("geo_unit_id") REFERENCES "public"."geo_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "org_urban_rural_valid" CHECK ("urban_rural" IS NULL OR "urban_rural" IN ('Urban','Peri-urban','Rural'));--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "org_years_valid" CHECK ("years_operating" IS NULL OR "years_operating" BETWEEN 0 AND 200);--> statement-breakpoint
ALTER TABLE "country_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "geo_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consent_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demographic_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application connects as samakose_app, which must own every table (see migration 0018).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "country_settings" OWNER TO samakose_app;
    ALTER TABLE "geo_units" OWNER TO samakose_app;
    ALTER TABLE "consent_notices" OWNER TO samakose_app;
    ALTER TABLE "consents" OWNER TO samakose_app;
    ALTER TABLE "registration_answers" OWNER TO samakose_app;
    ALTER TABLE "role_mappings" OWNER TO samakose_app;
    ALTER TABLE "demographic_profiles" OWNER TO samakose_app;
  END IF;
END $$;
