SET search_path TO public;
CREATE SEQUENCE "public"."seq_prc" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "pricing_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text DEFAULT 'PRC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('seq_prc')::text, 6, '0') NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"data" jsonb NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"published_at" timestamp with time zone,
	"supersedes" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_configs_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_configs" ADD CONSTRAINT "pricing_configs_supersedes_pricing_configs_id_fk" FOREIGN KEY ("supersedes") REFERENCES "public"."pricing_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prc_one_published_uq" ON "pricing_configs" USING btree ("is_published") WHERE "pricing_configs"."is_published" = true;--> statement-breakpoint
CREATE INDEX "prc_status_idx" ON "pricing_configs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "pricing_configs" ENABLE ROW LEVEL SECURITY;