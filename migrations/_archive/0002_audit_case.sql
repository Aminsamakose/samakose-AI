ALTER TABLE "audit_log" ADD COLUMN "case_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_case_idx" ON "audit_log" USING btree ("case_id");