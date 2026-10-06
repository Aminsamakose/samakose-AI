-- 0047: Programme monitoring and provider performance.
-- Staging-gated; no production migration is implied by this file.
-- Monitoring reads authoritative programme/delivery records. Performance scores are human-reviewed and evidence-backed.

create table if not exists public.programme_monitoring_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.programme_workspaces(id) on delete cascade,
  cohort_id uuid references public.cohorts(id) on delete set null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'DRAFT',
  metrics jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  generated_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monitoring_snapshot_status_ck check (status in ('DRAFT','FINAL')),
  constraint monitoring_snapshot_period_ck check (period_end >= period_start)
);
create index if not exists monitoring_snapshot_workspace_idx on public.programme_monitoring_snapshots(workspace_id, period_start, period_end);
create index if not exists monitoring_snapshot_cohort_idx on public.programme_monitoring_snapshots(cohort_id, period_start);

create table if not exists public.provider_performance_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.programme_workspaces(id) on delete cascade,
  provider_assignment_id uuid not null references public.provider_assignments(id) on delete cascade,
  provider_user_id uuid not null references public.users(id),
  provider_role text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  human_performance_score numeric(5,2),
  service_quality_score numeric(5,2),
  client_experience_score numeric(5,2),
  business_outcome_score numeric(5,2),
  composite_score numeric(5,2),
  evidence jsonb not null default '{}'::jsonb,
  notes text,
  status text not null default 'DRAFT',
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_performance_period_uq unique(provider_assignment_id, period_start, period_end),
  constraint provider_performance_role_ck check (provider_role in ('EXPERT','COACH')),
  constraint provider_performance_status_ck check (status in ('DRAFT','REVIEWED','FINAL')),
  constraint provider_performance_period_ck check (period_end >= period_start),
  constraint provider_performance_human_ck check (human_performance_score is null or human_performance_score between 0 and 100),
  constraint provider_performance_service_ck check (service_quality_score is null or service_quality_score between 0 and 100),
  constraint provider_performance_client_ck check (client_experience_score is null or client_experience_score between 0 and 100),
  constraint provider_performance_outcome_ck check (business_outcome_score is null or business_outcome_score between 0 and 100),
  constraint provider_performance_composite_ck check (composite_score is null or composite_score between 0 and 100)
);
create index if not exists provider_performance_workspace_idx on public.provider_performance_reviews(workspace_id, period_start, period_end);
create index if not exists provider_performance_provider_idx on public.provider_performance_reviews(provider_user_id, period_end);

alter table public.programme_monitoring_snapshots enable row level security;
alter table public.provider_performance_reviews enable row level security;

-- Application authorization/scoping is enforced by the service layer. No broad client policies are added.
