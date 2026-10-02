CREATE TABLE "framework_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"framework_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"questions" jsonb NOT NULL,
	"dimensions" jsonb NOT NULL,
	"rules" jsonb,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frameworks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"org_type" "org_type",
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frameworks_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "diagnostics" ADD COLUMN "framework_version_id" uuid;--> statement-breakpoint
ALTER TABLE "health_scores" ADD COLUMN "framework_version_id" uuid;--> statement-breakpoint
ALTER TABLE "framework_versions" ADD CONSTRAINT "framework_versions_framework_id_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."frameworks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "framework_version_uq" ON "framework_versions" USING btree ("framework_id","version");--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_framework_version_id_framework_versions_id_fk" FOREIGN KEY ("framework_version_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_framework_version_id_framework_versions_id_fk" FOREIGN KEY ("framework_version_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frameworks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "framework_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "frameworks" ("code", "name", "org_type", "description", "is_default") VALUES
  ('SME360', 'SME360 Business Health', 'SME', 'Baseline framework. Used for every organisation type until a specialised framework has an approved version.', true),
  ('AGRIFOOD360', 'AgriFood360 Business Health', 'AGRIFOOD', 'Specialised agrifood framework. No approved version yet.', false),
  ('ESO360', 'ESO360 Business Health', 'ESO', 'Specialised framework for ecosystem support organisations. No approved version yet.', false);--> statement-breakpoint
INSERT INTO "framework_versions" ("framework_id", "version", "status", "questions", "dimensions", "sources", "note", "approved_at", "published_at")
SELECT f.id, 1, 'Published',
  (SELECT jsonb_agg(jsonb_build_object('code', q.code, 'dimension', q.dimension, 'text', q.text, 'weight', q.weight) ORDER BY q.sort, q.code) FROM questions q WHERE q.active),
  (SELECT jsonb_agg(x.d ORDER BY x.mn) FROM (SELECT q.dimension AS d, min(q.sort) AS mn FROM questions q WHERE q.active GROUP BY q.dimension) x),
  jsonb_build_array(jsonb_build_object('component', 'Question bank and weights', 'source', 'Samakose working question bank in use before versioning', 'rationale', 'Baseline carried over so existing scores stay explainable', 'adaptation', 'None', 'approval', 'Approved')),
  'Baseline migrated from the working question bank', now(), now()
FROM "frameworks" f WHERE f.code = 'SME360' AND EXISTS (SELECT 1 FROM questions WHERE active);--> statement-breakpoint
-- One-off backfill of a new column: the append-only guards are lifted for these two statements only.--> statement-breakpoint
ALTER TABLE "diagnostics" DISABLE TRIGGER "diagnostics_versioned";--> statement-breakpoint
ALTER TABLE "health_scores" DISABLE TRIGGER "health_scores_append_only";--> statement-breakpoint
UPDATE "diagnostics" SET "framework_version_id" = (SELECT v.id FROM framework_versions v JOIN frameworks f ON f.id = v.framework_id WHERE f.code = 'SME360' AND v.version = 1) WHERE "framework_version_id" IS NULL;--> statement-breakpoint
UPDATE "health_scores" SET "framework_version_id" = (SELECT v.id FROM framework_versions v JOIN frameworks f ON f.id = v.framework_id WHERE f.code = 'SME360' AND v.version = 1) WHERE "framework_version_id" IS NULL;--> statement-breakpoint
ALTER TABLE "diagnostics" ENABLE TRIGGER "diagnostics_versioned";--> statement-breakpoint
ALTER TABLE "health_scores" ENABLE TRIGGER "health_scores_append_only";--> statement-breakpoint
CREATE FUNCTION "framework_versions_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'Draft' AND (
    NEW.questions IS DISTINCT FROM OLD.questions OR NEW.dimensions IS DISTINCT FROM OLD.dimensions OR
    NEW.rules IS DISTINCT FROM OLD.rules OR NEW.sources IS DISTINCT FROM OLD.sources OR
    NEW.version IS DISTINCT FROM OLD.version OR NEW.framework_id IS DISTINCT FROM OLD.framework_id) THEN
    RAISE EXCEPTION 'A published framework version cannot be changed. Create a new version instead.';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "framework_versions_guard" BEFORE UPDATE ON "framework_versions" FOR EACH ROW EXECUTE FUNCTION "framework_versions_guard"();--> statement-breakpoint
CREATE FUNCTION "framework_versions_no_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'Draft' THEN RAISE EXCEPTION 'A published framework version cannot be deleted.'; END IF;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER "framework_versions_no_delete" BEFORE DELETE ON "framework_versions" FOR EACH ROW EXECUTE FUNCTION "framework_versions_no_delete"();
