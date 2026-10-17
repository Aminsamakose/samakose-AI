-- 0062: Store only the allowlisted completed result for browser-scored free assessments.
-- The email/platform expression index is the race-safe one-completion rule. No answer, score
-- intermediate, status, progress, consent, source, IP, or action timestamp columns are present.
create table if not exists public.free_assessment_results (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  platform text not null check (platform in ('SME360', 'AGRIFOOD360', 'ESO360')),
  result jsonb not null
);

create unique index if not exists free_assessment_results_email_platform_uq
  on public.free_assessment_results (lower(btrim(email)), platform);

alter table public.free_assessment_results enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'samakose_app') then
    alter table public.free_assessment_results owner to samakose_app;
  end if;
end $$;
