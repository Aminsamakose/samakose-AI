-- Diagnoses and prescriptions keep their content forever. Only the workflow status
-- (and the reviewer's note) may change, and rows can never be deleted.
-- A change to the content is a new row that supersedes the old one.
DROP TRIGGER IF EXISTS diagnoses_versioned ON diagnoses;
--> statement-breakpoint
DROP TRIGGER IF EXISTS prescriptions_versioned ON prescriptions;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_workflow_row() RETURNS trigger AS $$
DECLARE mutable text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  mutable := TG_ARGV;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION '% content is versioned: create a new version instead of editing', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER diagnoses_guard BEFORE UPDATE OR DELETE ON diagnoses FOR EACH ROW EXECUTE FUNCTION guard_workflow_row('status');
--> statement-breakpoint
CREATE TRIGGER prescriptions_guard BEFORE UPDATE OR DELETE ON prescriptions FOR EACH ROW EXECUTE FUNCTION guard_workflow_row('status', 'reviewer_note');
--> statement-breakpoint
-- Reviewed diagnoses and prescriptions must be decided by someone other than their author.
ALTER TABLE cases ADD CONSTRAINT cases_reviewer_not_consultant CHECK (reviewer_id IS NULL OR consultant_id IS NULL OR reviewer_id <> consultant_id);
