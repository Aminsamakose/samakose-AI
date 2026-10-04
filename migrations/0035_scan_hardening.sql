-- Scan hardening. Additive only: pins the search path of trigger functions and adds indexes for the lookups that run on every list screen.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype
             AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.sig);
  END LOOP;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invoices_contract_idx ON invoices (contract_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_status_end_idx ON contracts (status, end_date);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cases_cohort_idx ON cases (cohort_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS diagnoses_diagnostic_idx ON diagnoses (diagnostic_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS approvals_case_idx ON approvals (case_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS evidence_response_idx ON evidence (response_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS kpi_readings_kpi_date_idx ON kpi_readings (kpi_id, reading_date);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS health_scores_case_created_idx ON health_scores (case_id, created_at);
