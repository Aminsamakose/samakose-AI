CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"organisation" text,
	"phone" text,
	"interest" text,
	"message" text,
	"consent" boolean DEFAULT false NOT NULL,
	"source" text,
	"status" text DEFAULT 'New' NOT NULL,
	"ip_hash" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "inquiries_status_idx" ON "inquiries" USING btree ("status","created_at");
--> statement-breakpoint
ALTER TABLE "inquiries" ENABLE ROW LEVEL SECURITY;
