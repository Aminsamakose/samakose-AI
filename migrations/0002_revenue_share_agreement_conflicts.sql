SET search_path TO public;
--> statement-breakpoint
CREATE SEQUENCE "public"."seq_rsx" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "revenue_share_agreement_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'RSX-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_rsx')::text, 6, '0') NOT NULL,
	"assignment_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"conflicting_agreement_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"prevailing_agreement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_share_agreement_conflicts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "revenue_share_agreement_conflicts" ADD CONSTRAINT "revenue_share_agreement_conflicts_assignment_id_case_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."case_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_agreement_conflicts" ADD CONSTRAINT "revenue_share_agreement_conflicts_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."revenue_share_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_agreement_conflicts" ADD CONSTRAINT "revenue_share_agreement_conflicts_conflicting_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("conflicting_agreement_id") REFERENCES "public"."revenue_share_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_agreement_conflicts" ADD CONSTRAINT "revenue_share_agreement_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_agreement_conflicts" ADD CONSTRAINT "revenue_share_agreement_conflicts_prevailing_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("prevailing_agreement_id") REFERENCES "public"."revenue_share_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rsac_pair_uq" ON "revenue_share_agreement_conflicts" USING btree ("assignment_id","agreement_id","conflicting_agreement_id");--> statement-breakpoint
CREATE INDEX "rsac_assignment_idx" ON "revenue_share_agreement_conflicts" USING btree ("assignment_id","status");--> statement-breakpoint
CREATE INDEX "rsac_conflicting_idx" ON "revenue_share_agreement_conflicts" USING btree ("conflicting_agreement_id");
--> statement-breakpoint
ALTER TABLE "revenue_share_agreement_conflicts" ENABLE ROW LEVEL SECURITY;