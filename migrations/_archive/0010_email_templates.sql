CREATE TABLE "email_templates" (
	"key" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;
