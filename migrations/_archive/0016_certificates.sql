CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"score_id" uuid NOT NULL,
	"framework_version_id" uuid,
	"level" text NOT NULL,
	"status" text DEFAULT 'Proposed' NOT NULL,
	"overall" numeric(5, 1) NOT NULL,
	"criteria" jsonb NOT NULL,
	"unlocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text NOT NULL,
	"proposed_by" uuid NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"expires_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_score_id_health_scores_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."health_scores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_framework_version_id_framework_versions_id_fk" FOREIGN KEY ("framework_version_id") REFERENCES "public"."framework_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cert_case_idx" ON "certificates" USING btree ("case_id","proposed_at");--> statement-breakpoint
CREATE INDEX "cert_org_idx" ON "certificates" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_status_valid" CHECK ("status" IN ('Proposed','Certified','Declined','Revoked'));--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_level_valid" CHECK ("level" IN ('Foundation','Established','Investment-ready'));--> statement-breakpoint
-- Four eyes in the database as well as in the application: nobody decides their own proposal.
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_four_eyes" CHECK ("decided_by" IS NULL OR "decided_by" <> "proposed_by");--> statement-breakpoint
CREATE UNIQUE INDEX "cert_one_open_per_case" ON "certificates" ("case_id") WHERE "status" = 'Proposed';--> statement-breakpoint
CREATE FUNCTION "certificates_guard"() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
     OR NEW.proposed_at IS DISTINCT FROM OLD.proposed_at OR NEW.rationale IS DISTINCT FROM OLD.rationale THEN
    RAISE EXCEPTION 'A certificate record cannot be rewritten. Propose a new one instead.';
  END IF;
  IF OLD.status IN ('Declined','Revoked') THEN RAISE EXCEPTION 'A declined or revoked certificate is final.'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "certificates_guard_trg" BEFORE UPDATE ON "certificates" FOR EACH ROW EXECUTE FUNCTION "certificates_guard"();--> statement-breakpoint
CREATE TRIGGER "certificates_no_delete" BEFORE DELETE ON "certificates" FOR EACH ROW EXECUTE FUNCTION forbid_change();
