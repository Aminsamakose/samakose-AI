ALTER TABLE "users" DROP CONSTRAINT "users_owner_has_org";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
UPDATE "users" SET "role" = 'EXPERT' WHERE "role" IN ('CONSULTANT', 'COACH');--> statement-breakpoint
INSERT INTO "rules" ("key", "value") SELECT 'switch.role.EXPERT', max("value") FROM "rules" WHERE "key" IN ('switch.role.CONSULTANT', 'switch.role.COACH') HAVING count(*) > 0 ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
DELETE FROM "rules" WHERE "key" IN ('switch.role.CONSULTANT', 'switch.role.COACH');--> statement-breakpoint
DROP TYPE "public"."role";--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'EXECUTIVE', 'PROGRAMME_MANAGER', 'EXPERT', 'REVIEWER', 'FINANCE', 'OWNER', 'FUNDER', 'CONTENT_EDITOR', 'SITE_MANAGER');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_owner_has_org" CHECK ("role" <> 'OWNER' OR "org_id" IS NOT NULL);
