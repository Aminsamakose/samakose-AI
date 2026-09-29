-- Integrity rules that the application cannot bypass.

-- 1. Append-only tables: no UPDATE and no DELETE, ever.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER kpi_readings_append_only BEFORE UPDATE OR DELETE ON kpi_readings FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER health_scores_append_only BEFORE UPDATE OR DELETE ON health_scores FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER approvals_append_only BEFORE UPDATE OR DELETE ON approvals FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER responses_append_only BEFORE UPDATE OR DELETE ON responses FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER ai_attempts_append_only BEFORE UPDATE OR DELETE ON ai_attempts FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- 2. Versioned records are never overwritten. A change is a new row that supersedes the old one.
CREATE TRIGGER diagnostics_versioned BEFORE UPDATE OR DELETE ON diagnostics FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER diagnoses_versioned BEFORE UPDATE OR DELETE ON diagnoses FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER prescriptions_versioned BEFORE UPDATE OR DELETE ON prescriptions FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- 3. Value rules.
ALTER TABLE responses ADD CONSTRAINT responses_value_range CHECK (value BETWEEN 0 AND 4);
--> statement-breakpoint
ALTER TABLE health_scores ADD CONSTRAINT scores_range CHECK (overall BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE diagnoses ADD CONSTRAINT dgn_status CHECK (status IN ('Draft', 'Reviewed', 'Rejected'));
--> statement-breakpoint
ALTER TABLE diagnoses ADD CONSTRAINT dgn_priority CHECK (priority IN ('High', 'Medium', 'Low'));
--> statement-breakpoint
ALTER TABLE prescriptions ADD CONSTRAINT rx_status CHECK (status IN ('DRAFT', 'IN REVIEW', 'APPROVED', 'RETURNED', 'SUPERSEDED'));
--> statement-breakpoint
ALTER TABLE actions ADD CONSTRAINT act_status CHECK (status IN ('Open', 'In progress', 'Done'));
--> statement-breakpoint
ALTER TABLE actions ADD CONSTRAINT act_owner_role CHECK (owner_role IN ('OWNER', 'COACH', 'CONSULTANT'));
--> statement-breakpoint
ALTER TABLE risks ADD CONSTRAINT risk_severity CHECK (severity IN ('High', 'Medium', 'Low'));
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT inv_status CHECK (status IN ('Draft', 'Sent', 'Paid', 'Overdue', 'Void'));
--> statement-breakpoint
ALTER TABLE invoices ADD CONSTRAINT inv_amount CHECK (amount_ghs > 0);
--> statement-breakpoint
ALTER TABLE contracts ADD CONSTRAINT con_amount CHECK (amount_ghs >= 0);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT pay_amount CHECK (amount_ghs > 0);
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT pay_status CHECK (status IN ('Pending', 'Succeeded', 'Failed'));
--> statement-breakpoint
ALTER TABLE cohorts ADD CONSTRAINT cohort_capacity CHECK (capacity > 0);
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_status CHECK (status IN ('queued', 'running', 'done', 'failed'));
--> statement-breakpoint
-- 4. An invoice can be paid only once.
CREATE UNIQUE INDEX payments_one_success_per_invoice ON payments (invoice_id) WHERE status = 'Succeeded';
--> statement-breakpoint
-- 5. Owners and other org-bound users must point at a real organisation.
ALTER TABLE users ADD CONSTRAINT users_org_fk FOREIGN KEY (org_id) REFERENCES organisations(id);
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_owner_has_org CHECK (role <> 'OWNER' OR org_id IS NOT NULL);
--> statement-breakpoint
-- 6. Faster search on names and emails.
CREATE INDEX org_name_lower_idx ON organisations (lower(name));
--> statement-breakpoint
CREATE INDEX users_name_lower_idx ON users (lower(name));
