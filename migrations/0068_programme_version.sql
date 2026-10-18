create table if not exists public.programme_versions (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.programmes(id),
  version integer not null,
  status text not null default 'DRAFT',
  name text not null,
  funder text,
  start_date date,
  end_date date,
  budget_ghs numeric(14, 2),
  change_reason text,
  created_by uuid not null references public.users(id),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programme_version_status_ck check (status in ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED')),
  constraint programme_version_number_ck check (version >= 1)
);

create unique index if not exists programme_version_uq on public.programme_versions (programme_id, version);
create index if not exists programme_version_programme_idx on public.programme_versions (programme_id, status);

alter table public.programme_versions enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'samakose_app') then
    alter table public.programme_versions owner to samakose_app;
  end if;
end $$;
