ALTER TYPE "public"."role" ADD VALUE 'CONTENT_EDITOR';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'SITE_MANAGER';--> statement-breakpoint
CREATE TABLE "content_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"live" jsonb,
	"draft" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"publish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"updated_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"note" text,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_doc_id_content_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."content_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_docs_kind_key_uq" ON "content_docs" USING btree ("kind","key");--> statement-breakpoint
CREATE INDEX "content_docs_kind_idx" ON "content_docs" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_doc_ver_uq" ON "content_versions" USING btree ("doc_id","version");--> statement-breakpoint
ALTER TABLE "content_docs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "content_versions" ENABLE ROW LEVEL SECURITY;
