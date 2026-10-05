ALTER TABLE "programmes" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "eligibility" text;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "sectors" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "regions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "target_groups" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "target_businesses" integer;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "partners" text;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "logo_media_id" uuid REFERENCES "media_assets"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "prog_target_valid" CHECK ("target_businesses" IS NULL OR "target_businesses" >= 0);
