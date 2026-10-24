SET search_path TO public;
--> statement-breakpoint
ALTER TABLE "professional_payouts" ADD COLUMN "tax_withheld_ghs" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "professional_payouts" ADD COLUMN "net_amount_ghs" numeric(12, 2);--> statement-breakpoint
UPDATE "professional_payouts" SET "net_amount_ghs" = "amount_ghs" WHERE "net_amount_ghs" IS NULL;--> statement-breakpoint
ALTER TABLE "professional_payouts" ALTER COLUMN "net_amount_ghs" SET NOT NULL;
