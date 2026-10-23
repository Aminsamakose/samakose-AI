-- 0046: Programme provider assignment and capacity governance.
-- Staging-gated; no production migration is implied by this file.
-- This layer governs programme-scoped provider commitments. Case assignments remain authoritative for case work.

create table if not exists public.provider_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.programme_workspaces(id) on delete cascade,
  cohort_id uuid references public.cohorts(id) on delete set null,
  provider_user_id uuid not null references public.users(id),
  provider_role text not null,
  status text not null default 'PROPOSED',
  allocation_percent integer not null default 100,
  max_participants integer,
  starts_at timestamptz,
  ends_at timestamptz,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_assignment_role_ck check (provider_role in ('EXPERT','COACH')),
  constraint provider_assignment_status_ck check (status in ('PROPOSED','ACTIVE','PAUSED','ENDED','DECLINED')),
  constraint provider_assignment_allocation_ck check (allocation_percent between 1 and 100),
  constraint provider_assignment_participants_ck check (max_participants is null or max_participants > 0),
  constraint provider_assignment_dates_ck check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index if not exists provider_assignment_workspace_idx on public.provider_assignments(workspace_id, status);
create index if not exists provider_assignment_provider_idx on public.provider_assignments(provider_user_id, status);
create index if not exists provider_assignment_cohort_idx on public.provider_assignments(cohort_id, status);

create table if not exists public.provider_capacities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.programme_workspaces(id) on delete cascade,
  provider_user_id uuid not null references public.users(id) on delete cascade,
  provider_role text not null,
  max_active_assignments integer not null default 5,
  max_sessions_per_week integer,
  weekly_hours integer,
  availability text not null default 'AVAILABLE',
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_capacity_scope_uq unique(workspace_id, provider_user_id, provider_role),
  constraint provider_capacity_role_ck check (provider_role in ('EXPERT','COACH')),
  constraint provider_capacity_assignments_ck check (max_active_assignments > 0),
  constraint provider_capacity_sessions_ck check (max_sessions_per_week is null or max_sessions_per_week > 0),
  constraint provider_capacity_hours_ck check (weekly_hours is null or weekly_hours > 0),
  constraint provider_capacity_availability_ck check (availability in ('AVAILABLE','LIMITED','UNAVAILABLE')),
  constraint provider_capacity_dates_ck check (effective_to is null or effective_to >= effective_from)
);
create index if not exists provider_capacity_provider_idx on public.provider_capacities(provider_user_id, availability);

alter table public.provider_assignments enable row level security;
alter table public.provider_capacities enable row level security;

-- Application authorization/scoping is enforced by the service layer, consistent with Programme Workspace delivery services.
