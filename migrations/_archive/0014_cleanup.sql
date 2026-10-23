-- Hardening and cleanup. No data changes.
-- Pin search_path on the four guard functions so they cannot be hijacked by a shadowing schema object.
ALTER FUNCTION "forbid_change"() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION "guard_workflow_row"() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION "framework_versions_guard"() SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION "framework_versions_no_delete"() SET search_path = public, pg_temp;
-- Not included: dropping the retired role type from 0012 (role_retired_0012). It is unused and inert; the drop is deferred.
