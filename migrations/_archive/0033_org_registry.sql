-- Organisation registry: a tax identification number and a pointer for merged duplicates.
-- Additive only. Existing rows are untouched.
ALTER TABLE "organisations" ADD COLUMN "tin" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "org_tin_len" CHECK ("tin" IS NULL OR char_length("tin") BETWEEN 5 AND 20);--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_merged_into_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_tin_uq" ON "organisations" USING btree (lower("tin")) WHERE "tin" IS NOT NULL AND "deleted_at" IS NULL;
