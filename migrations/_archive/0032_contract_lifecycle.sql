-- Contract lifecycle: acceptance evidence, amendments and renewals. Additive only.
-- Acceptance is evidence and never blocks activation. Amendments are append-only. A contract can be renewed once.
ALTER TABLE "contracts" ADD COLUMN "signatory_name" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "signatory_title" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "acceptance_method" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "acceptance_note" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "renewal_of" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_renewal_of_fk" FOREIGN KEY ("renewal_of") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "con_acceptance_complete" CHECK ("accepted_at" IS NULL OR ("accepted_by" IS NOT NULL AND "signatory_name" IS NOT NULL AND "acceptance_method" IN ('online','recorded')));--> statement-breakpoint
CREATE UNIQUE INDEX "con_renewal_uq" ON "contracts" USING btree ("renewal_of") WHERE "renewal_of" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "contract_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"previous_end" date,
	"new_end" date,
	"previous_amount" numeric(12,2) NOT NULL,
	"new_amount" numeric(12,2) NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "amend_reason_len" CHECK (char_length("reason") BETWEEN 5 AND 1000);--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "amend_changes_something" CHECK ("new_amount" <> "previous_amount" OR "new_end" IS DISTINCT FROM "previous_end");--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amend_contract_idx" ON "contract_amendments" USING btree ("contract_id","created_at");--> statement-breakpoint
CREATE FUNCTION contract_amendments_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'A contract amendment cannot be changed or removed'; END $$;--> statement-breakpoint
CREATE TRIGGER contract_amendments_immutable BEFORE UPDATE OR DELETE ON "contract_amendments" FOR EACH ROW EXECUTE FUNCTION contract_amendments_append_only();--> statement-breakpoint
ALTER TABLE "contract_amendments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "contract_amendments" OWNER TO samakose_app;
    ALTER FUNCTION contract_amendments_append_only() OWNER TO samakose_app;
  END IF;
END $$;
