-- 0050: additional-role grants (one account authorised to act as more than one role,
-- switching between them per session) plus the session column that records which role a
-- session is currently acting as. Additive only. Hand-written, matching 0048/0049's note:
-- drizzle-kit's snapshot baseline is stale, so `drizzle-kit generate` would try to re-emit
-- the whole schema; do not run it against this migration set without first reconciling the
-- meta snapshot.

alter table public.sessions add column if not exists active_role role;

create table if not exists public.role_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  role role not null,
  status text not null default 'pending',
  note text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists role_grants_user_role_uq on public.role_grants(user_id, role);
create index if not exists role_grants_user_idx on public.role_grants(user_id);
create index if not exists role_grants_status_idx on public.role_grants(status);
alter table public.role_grants enable row level security;
