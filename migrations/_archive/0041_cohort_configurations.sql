-- 0041: Versioned cohort delivery configuration.
-- Staging-gated; no production migration is implied by this file.

create table if not exists public.cohort_configurations (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  version integer not null,
  status text not null default 'DRAFT',
  delivery_mode text not null default 'HYBRID',
  schedule jsonb not null default '{}'::jsonb,
  milestones jsonb not null default '[]'::jsonb,
  service_levels jsonb not null default '{}'::jsonb,
  provider_plan jsonb not null default '{}'::jsonb,
  session_plan jsonb not null default '{}'::jsonb,
  change_reason text,
  created_by uuid not null references public.users(id),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cohort_configuration_version_ck check (version >= 1),
  constraint cohort_configuration_status_ck check (status in ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED')),
  constraint cohort_configuration_delivery_mode_ck check (delivery_mode in ('IN_PERSON','REMOTE','HYBRID','SELF_PACED')),
  constraint cohort_configuration_approval_ck check (
    (status = 'APPROVED' and approved_by is not null and approved_at is not null)
    or status <> 'APPROVED'
  ),
  constraint cohort_configuration_rejection_ck check (
    (status = 'REJECTED' and rejection_reason is not null and length(trim(rejection_reason)) >= 3)
    or status <> 'REJECTED'
  ),
  constraint cohort_configuration_uq unique (cohort_id, version)
);

create index if not exists cohort_configuration_cohort_idx on public.cohort_configurations(cohort_id, version);
create index if not exists cohort_configuration_status_idx on public.cohort_configurations(cohort_id, status);

alter table public.cohort_configurations enable row level security;

-- Application authorization/scoping is enforced by the service layer, consistent with
-- programme_workspaces and programme_workspace_configurations. No broad client policies are added.
