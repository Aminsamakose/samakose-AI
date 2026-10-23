ALTER TABLE "users" ADD COLUMN "approval_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_org_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_note" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_approval_status_chk" CHECK ("approval_status" IN ('approved','pending','rejected'));
