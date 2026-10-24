SET search_path TO public;
CREATE SEQUENCE "public"."seq_txc" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_txr" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "tax_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'TXC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_txc')::text, 6, '0') NOT NULL,
	"tax_line_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"period_label" text NOT NULL,
	"amount_ghs" numeric(12, 2) NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_certificates_code_unique" UNIQUE("code"),
	CONSTRAINT "tax_certificates_tax_line_id_unique" UNIQUE("tax_line_id")
);
--> statement-breakpoint
CREATE TABLE "tax_remittance_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"remittance_id" uuid NOT NULL,
	"tax_line_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_remittance_lines_tax_line_id_unique" UNIQUE("tax_line_id")
);
--> statement-breakpoint
CREATE TABLE "tax_remittances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'TXR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_txr')::text, 6, '0') NOT NULL,
	"period_label" text NOT NULL,
	"type" text NOT NULL,
	"total_amount_ghs" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"payment_reference" text,
	"created_by" uuid,
	"remitted_by" uuid,
	"remitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_remittances_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "tax_certificates" ADD CONSTRAINT "tax_certificates_tax_line_id_tax_lines_id_fk" FOREIGN KEY ("tax_line_id") REFERENCES "public"."tax_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificates" ADD CONSTRAINT "tax_certificates_payee_id_users_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_certificates" ADD CONSTRAINT "tax_certificates_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_lines" ADD CONSTRAINT "tax_remittance_lines_remittance_id_tax_remittances_id_fk" FOREIGN KEY ("remittance_id") REFERENCES "public"."tax_remittances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_lines" ADD CONSTRAINT "tax_remittance_lines_tax_line_id_tax_lines_id_fk" FOREIGN KEY ("tax_line_id") REFERENCES "public"."tax_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittances" ADD CONSTRAINT "tax_remittances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittances" ADD CONSTRAINT "tax_remittances_remitted_by_users_id_fk" FOREIGN KEY ("remitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "txc_payee_idx" ON "tax_certificates" USING btree ("payee_id");--> statement-breakpoint
CREATE INDEX "trl_remittance_idx" ON "tax_remittance_lines" USING btree ("remittance_id");--> statement-breakpoint
CREATE INDEX "txr_status_idx" ON "tax_remittances" USING btree ("status");--> statement-breakpoint
ALTER TABLE "tax_certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_remittance_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_remittances" ENABLE ROW LEVEL SECURITY;