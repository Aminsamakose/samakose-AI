-- 0043: Programme delivery coordination: tasks, milestones and exceptions.
-- Staging-gated; no production migration is implied by this file.

create table if not exists public.delivery_tasks (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  activity_id uuid references public.delivery_activities(id) on delete set null,
  session_id uuid references public.delivery_sessions(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'TODO',
  priority text not null default 'NORMAL',
  assigned_to uuid references public.users(id),
  due_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_task_status_ck check (status in ('TODO','IN_PROGRESS','BLOCKED','DONE','CANCELLED')),
  constraint delivery_task_priority_ck check (priority in ('LOW','NORMAL','HIGH','URGENT'))
);
create index if not exists delivery_task_cohort_idx on public.delivery_tasks(cohort_id, status, due_at);
create index if not exists delivery_task_assignee_idx on public.delivery_tasks(assigned_to, status);

create table if not exists public.delivery_milestones (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  name text not null,
  description text,
  due_at timestamptz not null,
  status text not null default 'PLANNED',
  achieved_at timestamptz,
  owner_user_id uuid references public.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_milestone_status_ck check (status in ('PLANNED','AT_RISK','ACHIEVED','MISSED','CANCELLED'))
);
create index if not exists delivery_milestone_cohort_idx on public.delivery_milestones(cohort_id, due_at);

create table if not exists public.delivery_exceptions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  activity_id uuid references public.delivery_activities(id) on delete set null,
  session_id uuid references public.delivery_sessions(id) on delete set null,
  task_id uuid references public.delivery_tasks(id) on delete set null,
  title text not null,
  description text,
  severity text not null default 'MEDIUM',
  status text not null default 'OPEN',
  owner_user_id uuid references public.users(id),
  resolution text,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_exception_severity_ck check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  constraint delivery_exception_status_ck check (status in ('OPEN','IN_PROGRESS','RESOLVED','CLOSED'))
);
create index if not exists delivery_exception_cohort_idx on public.delivery_exceptions(cohort_id, status, severity);
create index if not exists delivery_exception_owner_idx on public.delivery_exceptions(owner_user_id, status);

alter table public.delivery_tasks enable row level security;
alter table public.delivery_milestones enable row level security;
alter table public.delivery_exceptions enable row level security;

-- Application authorization/scoping is enforced by the service layer, consistent with
-- the existing Programme Workspace and delivery operations tables. No broad client policies are added.
