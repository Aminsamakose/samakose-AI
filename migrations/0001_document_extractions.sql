-- The baseline squash (pg_dump) sets search_path to '' session-wide and never restores it, which this
-- migration otherwise inherits since migrations run on the same connection. Set it back explicitly.
SET search_path TO public;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_dex" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "document_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'DEX-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_dex')::text, 6, '0') NOT NULL,
	"document_id" uuid NOT NULL,
	"case_id" uuid,
	"org_id" uuid NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"extracted_text" text,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"evidence_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_extractions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dex_case_idx" ON "document_extractions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "dex_doc_idx" ON "document_extractions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "dex_status_idx" ON "document_extractions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "document_extractions" ENABLE ROW LEVEL SECURITY;