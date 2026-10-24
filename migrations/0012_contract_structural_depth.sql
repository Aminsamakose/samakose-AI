SET search_path TO public;
CREATE SEQUENCE "public"."seq_cdoc" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."seq_ctp" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "contract_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'CDOC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_cdoc')::text, 6, '0') NOT NULL,
	"contract_id" uuid NOT NULL,
	"template_id" uuid,
	"template_version" integer,
	"content_markdown" text NOT NULL,
	"content_hash" text NOT NULL,
	"reason" text NOT NULL,
	"generated_by" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_documents_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "contract_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"role" text NOT NULL,
	"party_type" text NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'CTP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_ctp')::text, 6, '0') NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"body_markdown" text NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"retired_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cdoc_contract_idx" ON "contract_documents" USING btree ("contract_id","generated_at");--> statement-breakpoint
CREATE INDEX "ctpy_contract_idx" ON "contract_parties" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ctp_name_version_uq" ON "contract_templates" USING btree ("name","version");--> statement-breakpoint
CREATE INDEX "ctp_name_status_idx" ON "contract_templates" USING btree ("name","status");--> statement-breakpoint
ALTER TABLE "contract_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_parties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_templates" ENABLE ROW LEVEL SECURITY;