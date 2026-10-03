-- How a diagnostic's answers were actually given (self, hybrid, team, consultant, imported). Derived by the server, never typed in. Null for diagnostics taken before this existed. Scoring does not read it.
ALTER TABLE "diagnostics" ADD COLUMN "assessment_mode" text;--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diag_mode_valid" CHECK ("assessment_mode" IS NULL OR "assessment_mode" IN ('self','hybrid','team','consultant','imported'));
