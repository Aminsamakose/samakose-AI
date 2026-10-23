ALTER TABLE "framework_versions" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "health_scores" ADD COLUMN "extras" jsonb;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "not_applicable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "framework_versions_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'Draft' AND (
    NEW.questions IS DISTINCT FROM OLD.questions OR NEW.dimensions IS DISTINCT FROM OLD.dimensions OR
    NEW.rules IS DISTINCT FROM OLD.rules OR NEW.sources IS DISTINCT FROM OLD.sources OR
    NEW.meta IS DISTINCT FROM OLD.meta OR
    NEW.version IS DISTINCT FROM OLD.version OR NEW.framework_id IS DISTINCT FROM OLD.framework_id) THEN
    RAISE EXCEPTION 'A published framework version cannot be changed. Create a new version instead.';
  END IF;
  RETURN NEW;
END $$;
