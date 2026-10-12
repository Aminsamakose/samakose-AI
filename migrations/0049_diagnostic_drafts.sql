-- 0049: one autosaved diagnostic draft per case, for the plain (non-team) diagnostic form.
-- Additive only. Hand-written, matching 0048's note: drizzle-kit's snapshot baseline is stale against
-- 0048_framework_architecture.sql (also hand-written), so `drizzle-kit generate` would re-emit the whole
-- schema as new; do not run it against this migration set without first reconciling the meta snapshot.

create table if not exists public.diagnostic_drafts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.cases(id),
  answers jsonb not null default '{}'::jsonb,
  updated_by uuid,
  reminder_tier integer not null default 0,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.diagnostic_drafts enable row level security;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE public.diagnostic_drafts OWNER TO samakose_app;
  END IF;
END $$;
