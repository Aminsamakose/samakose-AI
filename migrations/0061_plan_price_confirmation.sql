-- Per-plan pricing confirmation, replacing the site-wide "all prices confirmed or none" gate.
-- Gap closed: the master plan-management brief explicitly prohibits showing a placeholder like
-- "To be confirmed" as though it were a price, and asks for pricing status to be configurable -
-- the previous model gated ALL plans' prices behind one site-wide toggle (pricing_settings.pricesConfirmed),
-- so Finance could not confirm Diagnostic's price while Growth's was still pending. This column lets
-- each plan's price be confirmed independently; publicationStatus still controls whether the plan is
-- visible at all.
ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "price_confirmed" boolean NOT NULL DEFAULT false;

-- Editorial backfill: the two pre-existing rows (SME Diagnostic, SME Coaching) were already being sold
-- under their current prices in real contracts, so their price is treated as confirmed. Nothing else
-- changes - no plan newly appears or disappears from the public page as a result of this migration.
UPDATE "plans" SET "price_confirmed" = true WHERE "name" IN ('SME Diagnostic', 'SME Coaching') AND "pricing_model" = 'fixed';
