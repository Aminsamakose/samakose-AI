-- Delivery: session reminders, escalations for stalled work, and a message thread on each case.
-- Additive only. One new nullable column on coaching_sessions; three new tables.
ALTER TABLE "coaching_sessions" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "case_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid,
	"detail" text,
	"flagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "case_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "case_message_reads" (
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_message_reads_pk" PRIMARY KEY ("case_id","user_id")
);--> statement-breakpoint
ALTER TABLE "case_escalations" ADD CONSTRAINT "esc_kind_valid" CHECK ("kind" IN ('stalled','session_outcome'));--> statement-breakpoint
ALTER TABLE "case_escalations" ADD CONSTRAINT "esc_session_ref" CHECK ("kind" <> 'session_outcome' OR "ref_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "case_escalations" ADD CONSTRAINT "case_escalations_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_messages" ADD CONSTRAINT "msg_body_valid" CHECK (char_length(btrim("body")) BETWEEN 1 AND 4000);--> statement-breakpoint
ALTER TABLE "case_messages" ADD CONSTRAINT "case_messages_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_messages" ADD CONSTRAINT "case_messages_sender_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_message_reads" ADD CONSTRAINT "case_message_reads_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_message_reads" ADD CONSTRAINT "case_message_reads_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "esc_open_ref_uq" ON "case_escalations" USING btree ("kind","ref_id") WHERE "resolved_at" IS NULL AND "ref_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "esc_open_case_uq" ON "case_escalations" USING btree ("kind","case_id") WHERE "resolved_at" IS NULL AND "ref_id" IS NULL;--> statement-breakpoint
CREATE INDEX "esc_case_idx" ON "case_escalations" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "msg_case_idx" ON "case_messages" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "sess_reminder_idx" ON "coaching_sessions" USING btree ("scheduled_at") WHERE "status" = 'Scheduled' AND "reminder_sent_at" IS NULL;--> statement-breakpoint
-- A sent message cannot be edited. It can be deleted, so retention and erasure requests can be honoured.
CREATE FUNCTION case_messages_no_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'A sent message cannot be changed'; END $$;--> statement-breakpoint
CREATE TRIGGER case_messages_immutable BEFORE UPDATE ON "case_messages" FOR EACH ROW EXECUTE FUNCTION case_messages_no_update();--> statement-breakpoint
ALTER TABLE "case_escalations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "case_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "case_message_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "case_escalations" OWNER TO samakose_app;
    ALTER TABLE "case_messages" OWNER TO samakose_app;
    ALTER TABLE "case_message_reads" OWNER TO samakose_app;
    ALTER FUNCTION case_messages_no_update() OWNER TO samakose_app;
  END IF;
END $$;
