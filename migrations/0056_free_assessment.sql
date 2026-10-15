-- 0056: Free preliminary Business Health assessment (public, anonymous, SME360 only for now).
-- Hand-written, not drizzle-kit generated: this repo's migrations/meta snapshots are incomplete
-- (0026 through 0054 are missing, journal/sql go to 0055), so `drizzle-kit generate` has no correct
-- baseline to diff against right now and tries to recreate the entire schema from scratch. That is a
-- separate, pre-existing repo issue, not something to paper over here -- this migration is scoped by
-- hand to exactly the two schema.ts changes in this PR (public_assessments, and four new inquiries
-- columns) and was reviewed against schema.ts's column-for-column definitions.

create table if not exists public.public_assessments (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalised_email text not null,
  full_name text not null,
  business_name text,
  platform text not null,
  framework_version_id uuid not null references public.framework_versions(id),
  status text not null default 'Started',
  answers jsonb,
  dimension_scores jsonb,
  overall_score integer,
  classification text,
  marketing_consent boolean not null default false,
  privacy_acknowledged boolean not null default false,
  source text,
  ip_hash text,
  result_viewed_at timestamptz,
  email_sent_at timestamptz,
  downloaded_at timestamptz,
  printed_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  claimed_by_user_id uuid
);

-- The authoritative, race-safe enforcement of "one completed free assessment per normalised email per
-- platform" (spec, Phase 6): a partial unique index, checked by Postgres itself, not application code.
-- A Started (abandoned) row is never covered by it, so an abandoned attempt never blocks a retry.
create unique index if not exists public_assessments_one_completed_uq
  on public.public_assessments (normalised_email, platform)
  where (status = 'Completed');

create index if not exists public_assessments_email_idx
  on public.public_assessments (normalised_email, platform);

-- Free assessment lead capture into the existing CRM (inquiries), per the spec's "reuse the existing
-- CRM, do not build a second one" instruction. Nullable: every pre-existing inquiry kind
-- (contact/demo/newsletter) leaves these null.
alter table public.inquiries add column if not exists public_assessment_id uuid;
alter table public.inquiries add column if not exists platform text;
alter table public.inquiries add column if not exists overall_score integer;
alter table public.inquiries add column if not exists classification text;
