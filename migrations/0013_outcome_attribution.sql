SET search_path TO public;
CREATE TABLE "outcome_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outcome_record_id" uuid NOT NULL,
	"intervention_id" uuid NOT NULL,
	"contribution_weight" numeric(5, 2) DEFAULT '0' NOT NULL,
	"confidence" text DEFAULT 'Low' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcome_attr_confidence_ck" CHECK ("outcome_attributions"."confidence" in ('Low','Medium','High')),
	CONSTRAINT "outcome_attr_weight_ck" CHECK ("outcome_attributions"."contribution_weight" >= 0 and "outcome_attributions"."contribution_weight" <= 100)
);
--> statement-breakpoint
ALTER TABLE "outcome_attributions" ADD CONSTRAINT "outcome_attributions_outcome_record_id_outcome_records_id_fk" FOREIGN KEY ("outcome_record_id") REFERENCES "public"."outcome_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_attributions" ADD CONSTRAINT "outcome_attributions_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_attributions" ADD CONSTRAINT "outcome_attributions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_attr_rec_iv_uq" ON "outcome_attributions" USING btree ("outcome_record_id","intervention_id");--> statement-breakpoint
CREATE INDEX "outcome_attr_rec_idx" ON "outcome_attributions" USING btree ("outcome_record_id");--> statement-breakpoint
CREATE INDEX "outcome_attr_iv_idx" ON "outcome_attributions" USING btree ("intervention_id");--> statement-breakpoint
ALTER TABLE "outcome_attributions" ENABLE ROW LEVEL SECURITY;