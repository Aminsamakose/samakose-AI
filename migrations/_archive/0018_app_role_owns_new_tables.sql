-- The application connects as the role samakose_app, which owns every table. Tables created from the Supabase console or MCP
-- were owned by postgres, so the app could not read or write them (AI workforce and certification failed in production).
-- Environments without that role (local development, the test database) are left alone.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE "ai_agents" OWNER TO samakose_app;
    ALTER TABLE "ai_agent_versions" OWNER TO samakose_app;
    ALTER TABLE "certificates" OWNER TO samakose_app;
  END IF;
END $$;
