-- One-time recovery codes for two-step sign-in. Only SHA-256 hashes are stored; the codes themselves are shown once. Empty for everyone until they enrol or regenerate.
ALTER TABLE "users" ADD COLUMN "mfa_recovery" text[] DEFAULT '{}'::text[] NOT NULL;
