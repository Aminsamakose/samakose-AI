-- 0058: Tables created via the Supabase console/MCP (resource_payments, public_assessments,
-- free_assessment_owners) were owned by postgres, not samakose_app -- the role the production app
-- actually connects as. Same failure mode 0018 already fixed once for a different set of tables
-- (Error 42501 insufficient_privilege, confirmed live via Vercel runtime errors after a real
-- end-to-end click-through of the free assessment, not caught by CI since the test database's
-- ownership setup differs from production's). Re-applying that fix to the three tables created
-- directly against production this session.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "resource_payments" OWNER TO samakose_app;
    ALTER TABLE "public_assessments" OWNER TO samakose_app;
    ALTER TABLE "free_assessment_owners" OWNER TO samakose_app;
  END IF;
END $$;
