-- §4 CRM/Marketing review: promo_codes.per_customer_limit was configurable in the admin UI (and documented
-- there as "How many times one customer may use this code") but applyPromoCode() never read it, and the
-- pr_code_customer_uq unique index on promo_redemptions(promo_code_id, customer_id) unconditionally blocked
-- any second redemption by the same customer regardless of the configured limit. Setting perCustomerLimit
-- above 1 was silently a no-op: the second redemption always failed with "already used this promo code".
-- The service now enforces the configured limit itself (src/services/discounts.ts, applyPromoCode), guarded
-- by a pg_advisory_xact_lock on (promo_code_id, customer_id) to keep concurrent requests race-safe, so the
-- unique index must become non-unique to allow more than one redemption row per pair when the limit allows it.
ALTER TABLE public.promo_redemptions DROP CONSTRAINT IF EXISTS pr_code_customer_uq;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pr_code_customer_idx ON public.promo_redemptions (promo_code_id, customer_id);
