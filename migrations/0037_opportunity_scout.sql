-- Opportunity Scout: the sources it reads each week and a record of each run. Additive only.
CREATE TABLE "opportunity_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"query" text,
	"region" text DEFAULT 'Global' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_found" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "scout_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"sources" integer DEFAULT 0 NOT NULL,
	"candidates" integer DEFAULT 0 NOT NULL,
	"drafted" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"searches" integer DEFAULT 0 NOT NULL,
	"note" text
);--> statement-breakpoint
ALTER TABLE "opportunity_sources" ADD CONSTRAINT "ops_kind_valid" CHECK ("kind" IN ('feed','page','query'));--> statement-breakpoint
ALTER TABLE "opportunity_sources" ADD CONSTRAINT "ops_target_valid" CHECK (("kind" = 'query' AND "query" IS NOT NULL AND length("query") BETWEEN 3 AND 200) OR ("kind" <> 'query' AND "url" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "opportunity_sources" ADD CONSTRAINT "opportunity_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ops_due_idx" ON "opportunity_sources" USING btree ("active","last_run_at");--> statement-breakpoint
CREATE INDEX "scout_runs_started_idx" ON "scout_runs" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "opportunity_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scout_runs" ENABLE ROW LEVEL SECURITY;
