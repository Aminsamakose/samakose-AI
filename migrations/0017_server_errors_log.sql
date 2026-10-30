CREATE TABLE "server_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"source" text NOT NULL,
	"method" text,
	"path" text,
	"name" text,
	"code" text,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "server_errors_at_idx" ON "server_errors" USING btree ("at");--> statement-breakpoint
ALTER TABLE "server_errors" ENABLE ROW LEVEL SECURITY;