-- #133: resolveVersion() couldn't safely tell a paid-full framework apart from a free-preliminary one
-- for any orgType other than SME, since the only existing signal was isDefault, and SME is the one
-- platform whose paid framework happens to be isDefault:true. Adding an explicit purpose column lets
-- resolveVersion() (paid) and the new resolveFreeAssessmentVersion() (free) each filter on it directly.
ALTER TABLE "frameworks" ADD COLUMN "purpose" text NOT NULL DEFAULT 'full';
ALTER TABLE "frameworks" ADD CONSTRAINT "framework_purpose_valid" CHECK ("purpose" IN ('full', 'free_preliminary'));

-- Backfill: SME360_FREE already exists in production, created before this column existed.
UPDATE "frameworks" SET "purpose" = 'free_preliminary' WHERE "code" = 'SME360_FREE';
