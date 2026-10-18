create table if not exists public.integration_credentials (
  integration text not null,
  field text not null,
  value text not null,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (integration, field)
);

alter table public.integration_credentials enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'samakose_app') then
    alter table public.integration_credentials owner to samakose_app;
  end if;
end $$;
