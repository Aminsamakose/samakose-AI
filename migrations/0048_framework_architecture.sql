-- 0048: normalized, governed Business Doctor framework architecture.
-- No production migration is implied. This branch is for implementation and qualification.

create table if not exists public.framework_dimensions (
  id uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references public.framework_versions(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  weight integer not null default 1 check (weight > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint framework_dimension_version_code_uq unique(framework_version_id, code)
);
create index if not exists framework_dimension_version_idx on public.framework_dimensions(framework_version_id, sort_order);

create table if not exists public.framework_sub_dimensions (
  id uuid primary key default gen_random_uuid(),
  dimension_id uuid not null references public.framework_dimensions(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  weight integer not null default 1 check (weight > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint framework_sub_dimension_dimension_code_uq unique(dimension_id, code)
);
create index if not exists framework_sub_dimension_dimension_idx on public.framework_sub_dimensions(dimension_id, sort_order);

create table if not exists public.framework_questions (
  id uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references public.framework_versions(id) on delete cascade,
  dimension_id uuid not null references public.framework_dimensions(id),
  sub_dimension_id uuid references public.framework_sub_dimensions(id),
  code text not null,
  text text not null,
  response_type text not null default 'ANCHORED',
  weight integer not null default 1 check (weight > 0),
  criticality text not null default 'Standard' check (criticality in ('Gate','Core','Standard')),
  sort_order integer not null default 0,
  applies_when text,
  risk_tag text,
  consistency_group text,
  anchors jsonb not null default '[]'::jsonb,
  readiness_codes text[] not null default '{}'::text[],
  status text not null default 'Draft' check (status in ('Draft','Published','Retired')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint framework_question_version_code_uq unique(framework_version_id, code)
);
create index if not exists framework_question_dimension_idx on public.framework_questions(dimension_id, sort_order);
create index if not exists framework_question_sub_dimension_idx on public.framework_questions(sub_dimension_id);

create table if not exists public.framework_evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.framework_questions(id) on delete cascade,
  requirement text not null,
  method text not null,
  examples text[] not null default '{}'::text[],
  minimum_evidence_class text not null default 'Self-reported',
  required boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists framework_evidence_question_idx on public.framework_evidence_requirements(question_id);

create table if not exists public.framework_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references public.framework_versions(id) on delete cascade,
  code text not null,
  rule_type text not null,
  expression text not null,
  parameters jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  constraint framework_scoring_rule_version_code_uq unique(framework_version_id, code)
);
create index if not exists framework_scoring_rule_version_priority_idx on public.framework_scoring_rules(framework_version_id, priority);

create table if not exists public.framework_readiness_rules (
  id uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references public.framework_versions(id) on delete cascade,
  code text not null,
  name text not null,
  purpose text,
  expression text not null,
  unlocks text[] not null default '{}'::text[],
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  constraint framework_readiness_rule_version_code_uq unique(framework_version_id, code)
);
create index if not exists framework_readiness_rule_version_priority_idx on public.framework_readiness_rules(framework_version_id, priority);

create table if not exists public.framework_source_records (
  id uuid primary key default gen_random_uuid(),
  framework_version_id uuid not null references public.framework_versions(id) on delete cascade,
  component_type text not null,
  component_code text,
  source text not null,
  rationale text not null,
  adaptation text not null,
  approval_status text not null default 'Proposed' check (approval_status in ('Proposed','Approved','Rejected')),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists framework_source_version_idx on public.framework_source_records(framework_version_id);
create index if not exists framework_source_component_idx on public.framework_source_records(component_type, component_code);

-- Published framework versions and all structured children are immutable.
create or replace function public.framework_version_is_published(p_version uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.framework_versions v
    where v.id = p_version and v.status = 'Published'
  );
$$;

create or replace function public.reject_published_framework_change()
returns trigger language plpgsql as $$
begin
  if public.framework_version_is_published(coalesce(new.framework_version_id, old.framework_version_id)) then
    raise exception 'Published framework content is immutable; create a new framework version.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists framework_dimensions_immutable on public.framework_dimensions;
create trigger framework_dimensions_immutable before update or delete on public.framework_dimensions
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_sub_dimensions_immutable on public.framework_sub_dimensions;
create trigger framework_sub_dimensions_immutable before update or delete on public.framework_sub_dimensions
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_questions_immutable on public.framework_questions;
create trigger framework_questions_immutable before update or delete on public.framework_questions
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_evidence_immutable on public.framework_evidence_requirements;
create trigger framework_evidence_immutable before update or delete on public.framework_evidence_requirements
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_scoring_rules_immutable on public.framework_scoring_rules;
create trigger framework_scoring_rules_immutable before update or delete on public.framework_scoring_rules
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_readiness_rules_immutable on public.framework_readiness_rules;
create trigger framework_readiness_rules_immutable before update or delete on public.framework_readiness_rules
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_sources_immutable on public.framework_source_records;
create trigger framework_sources_immutable before update or delete on public.framework_source_records
for each row execute function public.reject_published_framework_change();

alter table public.framework_dimensions enable row level security;
alter table public.framework_sub_dimensions enable row level security;
alter table public.framework_questions enable row level security;
alter table public.framework_evidence_requirements enable row level security;
alter table public.framework_scoring_rules enable row level security;
alter table public.framework_readiness_rules enable row level security;
alter table public.framework_source_records enable row level security;
