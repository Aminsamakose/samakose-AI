ALTER TABLE "opportunity_sources" DROP CONSTRAINT "ops_kind_valid";--> statement-breakpoint
ALTER TABLE "opportunity_sources" ADD CONSTRAINT "ops_kind_valid" CHECK ("kind" IN ('feed','page','query','site'));
