-- 0065: Outcome verification (funder-accountability gap register, GAP 11).
-- A higher health score or a completed coaching session does not by itself prove increased
-- income, profitability, employment or access to finance. outcome_definitions lets a programme
-- state what real-world outcome it is actually funded to produce; outcome_records holds one
-- enterprise's baseline/followup result against a definition, with an explicit verifier decision
-- distinct from the health-score delta the platform already computes. A correction is a new row
-- with supersedes_id pointing back at the original, which is kept, not overwritten.
create table if not exists public.outcome_definitions (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.programmes(id),
  name text not null,
  unit text not null,
  reporting_period text,
  source text,
  verification_required boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists outcome_def_name_uq
  on public.outcome_definitions (programme_id, name);

create table if not exists public.outcome_records (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.outcome_definitions(id),
  case_id uuid not null references public.cases(id),
  baseline_value numeric(14,2),
  baseline_date date,
  followup_value numeric(14,2),
  followup_date date,
  evidence_class evidence_class not null default 'Self-reported',
  document_id uuid references public.documents(id),
  attribution_note text,
  status text not null default 'PENDING' check (status in ('PENDING','VERIFIED','REJECTED','SUPERSEDED')),
  verified_by uuid references public.users(id),
  verified_at timestamptz,
  decision text,
  reason text,
  supersedes_id uuid,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outcome_rec_has_value_ck check (baseline_value is not null or followup_value is not null)
);

create index if not exists outcome_rec_def_idx on public.outcome_records (definition_id);
create index if not exists outcome_rec_case_idx on public.outcome_records (case_id);
create index if not exists outcome_rec_supersedes_idx on public.outcome_records (supersedes_id);

alter table public.outcome_definitions enable row level security;
alter table public.outcome_records enable row level security;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'samakose_app') then
    alter table public.outcome_definitions owner to samakose_app;
    alter table public.outcome_records owner to samakose_app;
  end if;
end $$;
