-- Hardening and cleanup. No data changes.
-- Pin search_path on the four guard functions so they cannot be hijacked by a shadowing schema object.
ALTER FUNCTION "forbid_change"() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION "guard_workflow_row"() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION "framework_versions_guard"() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION "framework_versions_no_delete"() SET search_path = public, pg_temp;--> statement-breakpoint
-- The role type retired by 0012 is unused (verified: no column depends on it).
DROP TYPE IF EXISTS "public"."role_retired_0012";
