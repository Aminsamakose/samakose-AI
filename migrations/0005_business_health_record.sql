SET search_path TO public;
CREATE TABLE "business_health_record_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid,
	"event_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_health_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"record_version" integer DEFAULT 1 NOT NULL,
	"latest_case_id" uuid,
	"first_assessed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_health_record_events" ADD CONSTRAINT "business_health_record_events_record_id_business_health_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."business_health_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_health_record_events" ADD CONSTRAINT "business_health_record_events_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_health_record_events" ADD CONSTRAINT "business_health_record_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_health_records" ADD CONSTRAINT "business_health_records_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_health_records" ADD CONSTRAINT "business_health_records_latest_case_id_cases_id_fk" FOREIGN KEY ("latest_case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bhr_event_record_time_idx" ON "business_health_record_events" USING btree ("record_id","occurred_at");--> statement-breakpoint
CREATE INDEX "bhr_event_case_time_idx" ON "business_health_record_events" USING btree ("case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "bhr_event_type_time_idx" ON "business_health_record_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bhr_event_fingerprint_uq" ON "business_health_record_events" USING btree ("record_id","source_type","source_id","event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bhr_org_uq" ON "business_health_records" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "bhr_last_activity_idx" ON "business_health_records" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "bhr_latest_case_idx" ON "business_health_records" USING btree ("latest_case_id");--> statement-breakpoint
ALTER TABLE "business_health_record_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "business_health_records" ENABLE ROW LEVEL SECURITY;