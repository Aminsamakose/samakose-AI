-- Merge CONSULTANT and COACH into EXPERT.
-- Non-destructive by design: the old role type is renamed, not dropped, and the old coach switch row is left inert.
-- Rehearsed on staging against records in both old roles.
ALTER TABLE "users" DROP CONSTRAINT "users_owner_has_org";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
UPDATE "users" SET "role" = 'EXPERT' WHERE "role" IN ('CONSULTANT', 'COACH');--> statement-breakpoint
UPDATE "rules" SET "key" = 'switch.role.EXPERT' WHERE "key" = 'switch.role.CONSULTANT' AND NOT EXISTS (SELECT 1 FROM "rules" WHERE "key" = 'switch.role.EXPERT');--> statement-breakpoint
ALTER TYPE "public"."role" RENAME TO "role_retired_0012";--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'EXECUTIVE', 'PROGRAMME_MANAGER', 'EXPERT', 'REVIEWER', 'FINANCE', 'OWNER', 'FUNDER', 'CONTENT_EDITOR', 'SITE_MANAGER');--> statement-breakpoint
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN ALTER TYPE "public"."role" OWNER TO samakose_app; END IF; END $$;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_owner_has_org" CHECK ("role" <> 'OWNER' OR "org_id" IS NOT NULL);
