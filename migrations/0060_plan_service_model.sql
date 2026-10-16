-- Separates service tier, entitlements, support duration and pricing model on `plans`,
-- which previously only had a flat name/price/interval/active shape (see PR for the
-- "Simplify Admin Plan Management" brief). Purely additive and backward compatible:
-- every new column is nullable or has a safe default, the existing `active` boolean is
-- kept (and stays in sync with the new `publication_status`), and the two existing rows
-- (SME Diagnostic, SME Coaching) are backfilled below rather than left null.

ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "audience" text,
  ADD COLUMN IF NOT EXISTS "service_tier" text,
  ADD COLUMN IF NOT EXISTS "platforms" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "entitlements" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "duration_days" integer,
  ADD COLUMN IF NOT EXISTS "pricing_model" text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS "publication_status" text NOT NULL DEFAULT 'draft';

ALTER TABLE "plans"
  ADD CONSTRAINT "plan_service_tier_ck" CHECK ("service_tier" IS NULL OR "service_tier" IN ('discovery','diagnostic','transform','growth','programme')),
  ADD CONSTRAINT "plan_pricing_model_ck" CHECK ("pricing_model" IN ('free','fixed','custom')),
  ADD CONSTRAINT "plan_publication_status_ck" CHECK ("publication_status" IN ('draft','published','inactive','archived'));

-- Backfill: every plan that existed before this migration was being sold and used in real
-- contracts, so it is published (not left in draft) and kept active, matching its current
-- `active` value. No plan loses availability as a result of this migration.
UPDATE "plans" SET "publication_status" = CASE WHEN "active" THEN 'published' ELSE 'inactive' END
WHERE "publication_status" = 'draft';

-- Known existing rows get a best-effort service tier so they render sensibly in the new
-- admin UI immediately; this is a one-time editorial backfill, not a generated guess the
-- system will repeat - an administrator can change it like any other field.
UPDATE "plans" SET "service_tier" = 'diagnostic' WHERE "name" = 'SME Diagnostic' AND "service_tier" IS NULL;
UPDATE "plans" SET "service_tier" = 'transform' WHERE "name" = 'SME Coaching' AND "service_tier" IS NULL;

-- A plan row created from here on starts in 'draft'/inactive by default (see schema.ts) - a fresh
-- insert should never come out "active" before anyone has published it. Existing rows are untouched;
-- their publication_status/active were already set consistently above.
ALTER TABLE "plans" ALTER COLUMN "active" SET DEFAULT false;
