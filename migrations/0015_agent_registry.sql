-- AI agent registry (Phase 1 of the role and agent architecture). Evolves the existing AI gateway in place.
CREATE TABLE "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"purpose" text,
	"role" text NOT NULL,
	"owner_id" uuid,
	"status" text DEFAULT 'Draft' NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_version_id" uuid,
	"paused_from" text,
	"status_reason" text,
	"status_by" uuid,
	"status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agents_code_unique" UNIQUE("code"),
	CONSTRAINT "ai_agents_status_valid" CHECK ("status" IN ('Draft','Configured','Testing','Evaluation','Approval required','Active','Paused','Disabled','Archived'))
);
--> statement-breakpoint
CREATE TABLE "ai_agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"prompt" text NOT NULL,
	"model" text,
	"config" jsonb NOT NULL,
	"note" text,
	"evaluation" text DEFAULT 'Not run' NOT NULL,
	"evaluated_at" timestamp with time zone,
	"evaluation_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_versions_evaluation_valid" CHECK ("evaluation" IN ('Not run','Passed','Failed')),
	-- Autonomy is capped at Level 2 in the database as well as in the application.
	CONSTRAINT "ai_agent_versions_autonomy_cap" CHECK ((("config"->>'autonomy')::int) BETWEEN 0 AND 2)
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD COLUMN "agent_version_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_type" text DEFAULT 'HUMAN' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_uq" ON "ai_agent_versions" USING btree ("agent_id","version");--> statement-breakpoint
CREATE INDEX "ai_agent_idx" ON "ai_requests" USING btree ("agent_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- A version freezes prompt, model and configuration. Only the evaluation result may change, and versions are never deleted.
CREATE FUNCTION "ai_agent_versions_guard"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.prompt IS DISTINCT FROM OLD.prompt OR NEW.model IS DISTINCT FROM OLD.model OR NEW.config IS DISTINCT FROM OLD.config
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    RAISE EXCEPTION 'An agent version cannot be changed. Create a new version instead.';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "ai_agent_versions_frozen" BEFORE UPDATE ON "ai_agent_versions" FOR EACH ROW EXECUTE FUNCTION "ai_agent_versions_guard"();--> statement-breakpoint
CREATE TRIGGER "ai_agent_versions_no_delete" BEFORE DELETE ON "ai_agent_versions" FOR EACH ROW EXECUTE FUNCTION forbid_change();
