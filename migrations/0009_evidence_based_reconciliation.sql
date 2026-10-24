SET search_path TO public;
CREATE SEQUENCE "public"."seq_rec" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_xtx" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "payout_external_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'XTX-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_xtx')::text, 6, '0') NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"payee_user_id" uuid,
	"amount_ghs" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'GHS' NOT NULL,
	"transaction_date" date NOT NULL,
	"fee_ghs" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"settlement_status" text DEFAULT 'Settled' NOT NULL,
	"raw_payload" jsonb,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_external_transactions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payout_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'REC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_rec')::text, 6, '0') NOT NULL,
	"payout_id" uuid NOT NULL,
	"external_transaction_id" uuid,
	"outcome" text NOT NULL,
	"expected_amount_ghs" numeric(12, 2) NOT NULL,
	"matched_amount_ghs" numeric(12, 2),
	"discrepancy_ghs" numeric(12, 2),
	"note" text,
	"decided_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_reconciliations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "payout_external_transactions" ADD CONSTRAINT "payout_external_transactions_payee_user_id_users_id_fk" FOREIGN KEY ("payee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_external_transactions" ADD CONSTRAINT "payout_external_transactions_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_reconciliations" ADD CONSTRAINT "payout_reconciliations_payout_id_professional_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."professional_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_reconciliations" ADD CONSTRAINT "payout_reconciliations_external_transaction_id_payout_external_transactions_id_fk" FOREIGN KEY ("external_transaction_id") REFERENCES "public"."payout_external_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_reconciliations" ADD CONSTRAINT "payout_reconciliations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pet_provider_ref_uq" ON "payout_external_transactions" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "pet_payee_idx" ON "payout_external_transactions" USING btree ("payee_user_id");--> statement-breakpoint
CREATE INDEX "prec_payout_idx" ON "payout_reconciliations" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "prec_external_idx" ON "payout_reconciliations" USING btree ("external_transaction_id");--> statement-breakpoint
ALTER TABLE "payout_external_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payout_reconciliations" ENABLE ROW LEVEL SECURITY;