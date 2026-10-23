-- Programme indicators: a named target for a measure the platform already computes (businesses enrolled, scored, average score, and so on).
-- Additive only. No personal data. Progress is computed live from scores, never stored.
CREATE TABLE "programme_indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid NOT NULL,
	"name" text NOT NULL,
	"metric" text NOT NULL,
	"target" numeric(10,1) NOT NULL,
	"due_date" date,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "programme_indicators" ADD CONSTRAINT "ind_metric_valid" CHECK ("metric" IN ('enrolled','scored','rescored','avg_score','avg_change','pct_improved'));--> statement-breakpoint
ALTER TABLE "programme_indicators" ADD CONSTRAINT "ind_target_valid" CHECK ("target" > 0 AND ("metric" NOT IN ('avg_score','pct_improved') OR "target" <= 100));--> statement-breakpoint
ALTER TABLE "programme_indicators" ADD CONSTRAINT "ind_name_len" CHECK (char_length("name") BETWEEN 3 AND 120);--> statement-breakpoint
ALTER TABLE "programme_indicators" ADD CONSTRAINT "programme_indicators_programme_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_indicators" ADD CONSTRAINT "programme_indicators_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ind_name_uq" ON "programme_indicators" USING btree ("programme_id","name");--> statement-breakpoint
ALTER TABLE "programme_indicators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "programme_indicators" OWNER TO samakose_app;
  END IF;
END $$;
