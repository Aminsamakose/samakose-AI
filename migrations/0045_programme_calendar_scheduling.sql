-- 0045: Programme calendar and scheduling integration foundation.
-- Staging-gated; no production migration is implied by this file.
-- Provider credentials/tokens are intentionally not persisted by this layer.

create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  external_calendar_id text,
  status text not null default 'CONNECTED',
  account_label text,
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_connection_provider_ck check (provider in ('GOOGLE','MICROSOFT','ICS','INTERNAL')),
  constraint calendar_connection_status_ck check (status in ('CONNECTED','DISCONNECTED','ERROR'))
);

create unique index if not exists calendar_connection_user_provider_idx
  on public.calendar_connections(user_id, provider);
create index if not exists calendar_connection_status_idx
  on public.calendar_connections(status);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  session_id uuid references public.delivery_sessions(id) on delete set null,
  connection_id uuid references public.calendar_connections(id) on delete set null,
  provider text not null default 'INTERNAL',
  external_event_id text,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'UTC',
  location text,
  meeting_url text,
  status text not null default 'SCHEDULED',
  sync_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_event_provider_ck check (provider in ('GOOGLE','MICROSOFT','ICS','INTERNAL')),
  constraint calendar_event_status_ck check (status in ('SCHEDULED','UPDATED','CANCELLED','SYNC_ERROR')),
  constraint calendar_event_time_ck check (ends_at > starts_at)
);

create index if not exists calendar_event_cohort_time_idx
  on public.calendar_events(cohort_id, starts_at);
create index if not exists calendar_event_session_idx
  on public.calendar_events(session_id);
create index if not exists calendar_event_connection_idx
  on public.calendar_events(connection_id);
create index if not exists calendar_event_external_idx
  on public.calendar_events(provider, external_event_id);

alter table public.calendar_connections enable row level security;
alter table public.calendar_events enable row level security;

-- Application authorization/scoping is enforced by the service layer, consistent with
-- the existing Programme Workspace and delivery services. Provider synchronization is
-- deliberately separated from this domain foundation.
