-- 0042: Cohort delivery operations: activities, sessions and attendance.
-- Staging-gated; no production migration is implied by this file.

create table if not exists public.delivery_activities (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  name text not null,
  activity_type text not null default 'GENERAL',
  description text,
  sequence integer not null default 1,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  status text not null default 'PLANNED',
  owner_user_id uuid references public.users(id),
  cohort_configuration_version integer,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_activity_sequence_ck check (sequence >= 1),
  constraint delivery_activity_status_ck check (status in ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  constraint delivery_activity_dates_ck check (scheduled_end is null or scheduled_start is null or scheduled_end >= scheduled_start)
);

create index if not exists delivery_activity_cohort_idx on public.delivery_activities(cohort_id, sequence);
create index if not exists delivery_activity_status_idx on public.delivery_activities(status);

create table if not exists public.delivery_sessions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.delivery_activities(id) on delete cascade,
  facilitator_user_id uuid references public.users(id),
  mode text not null default 'HYBRID',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  meeting_url text,
  status text not null default 'SCHEDULED',
  capacity integer,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_session_mode_ck check (mode in ('IN_PERSON','REMOTE','HYBRID','SELF_PACED')),
  constraint delivery_session_status_ck check (status in ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW')),
  constraint delivery_session_time_ck check (ends_at > starts_at),
  constraint delivery_session_capacity_ck check (capacity is null or capacity > 0)
);

create index if not exists delivery_session_activity_idx on public.delivery_sessions(activity_id, starts_at);
create index if not exists delivery_session_facilitator_idx on public.delivery_sessions(facilitator_user_id, starts_at);

create table if not exists public.delivery_attendance (
  session_id uuid not null references public.delivery_sessions(id) on delete cascade,
  participant_id uuid not null references public.programme_participants(id) on delete cascade,
  status text not null default 'PRESENT',
  arrived_at timestamptz,
  note text,
  recorded_by uuid not null references public.users(id),
  recorded_at timestamptz not null default now(),
  constraint delivery_attendance_pk primary key (session_id, participant_id),
  constraint delivery_attendance_status_ck check (status in ('PRESENT','ABSENT','EXCUSED','LATE'))
);

create index if not exists delivery_attendance_participant_idx on public.delivery_attendance(participant_id);

alter table public.delivery_activities enable row level security;
alter table public.delivery_sessions enable row level security;
alter table public.delivery_attendance enable row level security;

-- Application authorization/scoping is enforced by the service layer, consistent with
-- the existing Programme Workspace and cohort configuration tables. No broad client policies are added.
