-- 0064: Person-level participant identity (funder-accountability gap register, GAP 02).
-- programme_participants (00XX workspace migration) is an enterprise's enrolment in a programme --
-- one row per (programme, organisation). It has no room for the human beings behind that
-- enterprise. participants is the person, independent of any one enrolment; the join table
-- carries the role a given person plays on a given enrolment, so one enterprise can put forward
-- several people and one person can represent several enterprises.
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  merged_into uuid references public.participants(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists participant_name_idx on public.participants (full_name);
create index if not exists participant_phone_idx on public.participants (phone);

create table if not exists public.programme_participant_people (
  id uuid primary key default gen_random_uuid(),
  programme_participant_id uuid not null references public.programme_participants(id) on delete cascade,
  participant_id uuid not null references public.participants(id),
  role text not null default 'OWNER' check (role in ('OWNER', 'MANAGER', 'DELEGATE', 'OTHER')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists programme_participant_people_uq
  on public.programme_participant_people (programme_participant_id, participant_id);
create index if not exists programme_participant_people_participant_idx
  on public.programme_participant_people (participant_id);

alter table public.participants enable row level security;
alter table public.programme_participant_people enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'samakose_app') then
    alter table public.participants owner to samakose_app;
    alter table public.programme_participant_people owner to samakose_app;
  end if;
end $$;
