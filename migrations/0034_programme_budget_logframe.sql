-- Programme budget lines, funder tranches and logframe levels. Additive only. No personal data.
ALTER TABLE "programme_indicators" ADD COLUMN "level" text DEFAULT 'output' NOT NULL;--> statement-breakpoint
ALTER TABLE "programme_indicators" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "programme_indicators" ADD CONSTRAINT "ind_level_valid" CHECK ("level" IN ('impact','outcome','output'));--> statement-breakpoint
ALTER TABLE "programme_indicators" ADD CONSTRAINT "programme_indicators_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."programme_indicators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "programme_budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"amount_ghs" numeric(14,2) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "programme_budget_lines" ADD CONSTRAINT "pbl_amount_pos" CHECK ("amount_ghs" > 0);--> statement-breakpoint
ALTER TABLE "programme_budget_lines" ADD CONSTRAINT "pbl_category_len" CHECK (char_length("category") BETWEEN 2 AND 80);--> statement-breakpoint
ALTER TABLE "programme_budget_lines" ADD CONSTRAINT "programme_budget_lines_programme_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_budget_lines" ADD CONSTRAINT "programme_budget_lines_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pbl_cat_uq" ON "programme_budget_lines" USING btree ("programme_id","category");--> statement-breakpoint
CREATE TABLE "programme_tranches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount_ghs" numeric(14,2) NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'Planned' NOT NULL,
	"received_on" date,
	"received_ghs" numeric(14,2),
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "programme_tranches" ADD CONSTRAINT "ptr_amount_pos" CHECK ("amount_ghs" > 0);--> statement-breakpoint
ALTER TABLE "programme_tranches" ADD CONSTRAINT "ptr_status_valid" CHECK ("status" IN ('Planned','Received'));--> statement-breakpoint
ALTER TABLE "programme_tranches" ADD CONSTRAINT "ptr_received_consistent" CHECK (("status" = 'Planned' AND "received_on" IS NULL AND "received_ghs" IS NULL) OR ("status" = 'Received' AND "received_on" IS NOT NULL AND "received_ghs" IS NOT NULL AND "received_ghs" >= 0));--> statement-breakpoint
ALTER TABLE "programme_tranches" ADD CONSTRAINT "programme_tranches_programme_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_tranches" ADD CONSTRAINT "programme_tranches_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ptr_label_uq" ON "programme_tranches" USING btree ("programme_id","label");--> statement-breakpoint
ALTER TABLE "programme_budget_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "programme_tranches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "programme_budget_lines" OWNER TO samakose_app;
    ALTER TABLE "programme_tranches" OWNER TO samakose_app;
  END IF;
END $$;
