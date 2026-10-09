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

-- Backfill normalized records from legacy snapshots before immutability triggers are installed.
-- The existing JSON snapshot remains in place for old diagnostics and deterministic scoring.
insert into public.framework_dimensions
  (framework_version_id, code, name, weight, sort_order)
select v.id, 'DIM_' || lpad(d.ordinality::text, 3, '0'), d.name, 1, (d.ordinality - 1)::integer
from public.framework_versions v
cross join lateral jsonb_array_elements_text(v.dimensions) with ordinality as d(name, ordinality)
on conflict (framework_version_id, code) do nothing;

insert into public.framework_sub_dimensions
  (dimension_id, code, name, description, weight, sort_order)
select dim.id, coalesce(nullif(s.item->>'code', ''), 'SUB_' || lpad(s.ordinality::text, 3, '0')),
       coalesce(nullif(s.item->>'name', ''), s.item->>'code', 'Unnamed sub-dimension'),
       null, 1, (s.ordinality - 1)::integer
from public.framework_versions v
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(v.meta->'subDimensions') = 'array' then v.meta->'subDimensions' else '[]'::jsonb end
) with ordinality as s(item, ordinality)
join public.framework_dimensions dim
  on dim.framework_version_id = v.id and dim.name = s.item->>'dimension'
on conflict (dimension_id, code) do nothing;

insert into public.framework_questions
  (framework_version_id, dimension_id, sub_dimension_id, code, text, response_type, weight,
   criticality, sort_order, applies_when, risk_tag, consistency_group, anchors, readiness_codes,
   status, created_by)
select v.id, dim.id, sub.id, q.item->>'code', q.item->>'text',
       coalesce(q.item->>'responseType', 'ANCHORED'),
       coalesce(nullif(q.item->>'weight', '')::integer, 1),
       coalesce(q.item->>'criticality', 'Standard'),
       (q.ordinality - 1)::integer,
       q.item->>'applies', q.item->>'riskTag', q.item->>'consistencyGroup',
       case when jsonb_typeof(q.item->'anchors') = 'array' then q.item->'anchors' else '[]'::jsonb end,
       array(
         select jsonb_array_elements_text(
           case when jsonb_typeof(q.item->'readiness') = 'array' then q.item->'readiness' else '[]'::jsonb end
         )
       ),
       case when v.status in ('Published', 'Retired') then v.status else 'Draft' end,
       v.created_by
from public.framework_versions v
cross join lateral jsonb_array_elements(v.questions) with ordinality as q(item, ordinality)
join public.framework_dimensions dim
  on dim.framework_version_id = v.id and dim.name = q.item->>'dimension'
left join public.framework_sub_dimensions sub
  on sub.dimension_id = dim.id and sub.code = q.item->>'subDimension'
on conflict (framework_version_id, code) do nothing;

insert into public.framework_evidence_requirements
  (question_id, requirement, method, examples, minimum_evidence_class, required)
select fq.id, evidence.item->>'requirement', evidence.item->>'method',
       array(select jsonb_array_elements_text(
         case when jsonb_typeof(evidence.item->'examples') = 'array' then evidence.item->'examples' else '[]'::jsonb end
       )),
       'Self-reported', false
from public.framework_versions v
cross join lateral jsonb_array_elements(v.questions) as q(item)
join public.framework_questions fq on fq.framework_version_id = v.id and fq.code = q.item->>'code'
cross join lateral (select q.item->'evidence' as item) evidence
where jsonb_typeof(evidence.item) = 'object'
  and nullif(evidence.item->>'requirement', '') is not null
  and nullif(evidence.item->>'method', '') is not null;

insert into public.framework_scoring_rules
  (framework_version_id, code, rule_type, expression, parameters, priority)
select v.id, r.key, 'LEGACY_OVERRIDE', r.value::text,
       jsonb_build_object('compatibilitySource', 'framework_versions.rules', 'value', r.value),
       (row_number() over (partition by v.id order by r.key) - 1)::integer
from public.framework_versions v
cross join lateral jsonb_each(case when jsonb_typeof(v.rules) = 'object' then v.rules else '{}'::jsonb end) as r(key, value)
on conflict (framework_version_id, code) do nothing;

insert into public.framework_readiness_rules
  (framework_version_id, code, name, purpose, expression, unlocks, priority)
select v.id, coalesce(nullif(r.item->>'code', ''), 'READY_' || lpad(r.ordinality::text, 3, '0')),
       coalesce(nullif(r.item->>'name', ''), r.item->>'code', 'Unnamed readiness rule'),
       r.item->>'purpose',
       coalesce(nullif(r.item->>'purpose', ''), nullif(r.item->>'name', ''), 'Not specified'),
       case when nullif(r.item->>'unlocks', '') is null then '{}'::text[]
            else array(
              select btrim(part) from regexp_split_to_table(r.item->>'unlocks', '[,;]') as part
              where btrim(part) <> ''
            ) end,
       (r.ordinality - 1)::integer
from public.framework_versions v
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(v.meta->'readiness') = 'array' then v.meta->'readiness' else '[]'::jsonb end
) with ordinality as r(item, ordinality)
on conflict (framework_version_id, code) do nothing;

insert into public.framework_source_records
  (framework_version_id, component_type, component_code, source, rationale, adaptation,
   approval_status, approved_by, approved_at)
select v.id,
       coalesce(nullif(s.item->>'component', ''), 'General'), null,
       coalesce(nullif(s.item->>'source', ''), 'Not recorded'),
       coalesce(nullif(s.item->>'rationale', ''), 'Not recorded'),
       coalesce(nullif(s.item->>'adaptation', ''), 'Not recorded'),
       case when s.item->>'approval' in ('Proposed','Approved','Rejected') then s.item->>'approval' else 'Proposed' end,
       case when s.item->>'approvedBy' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (s.item->>'approvedBy')::uuid else null end,
       case when s.item->>'approvedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            then (s.item->>'approvedAt')::timestamptz else null end
from public.framework_versions v
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(v.sources) = 'array' then v.sources else '[]'::jsonb end
) as s(item);

-- Published and retired versions are immutable. Draft content can be rebuilt before sign-off.
create or replace function public.framework_version_is_published(p_version uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.framework_versions v
    where v.id = p_version and v.status in ('Published', 'Retired')
  );
$$;

create or replace function public.reject_published_framework_change()
returns trigger language plpgsql as $$
declare
  v_version uuid;
  v_parent_id uuid;
begin
  if tg_table_name = 'framework_sub_dimensions' then
    v_parent_id := case when tg_op = 'DELETE' then old.dimension_id else new.dimension_id end;
    select d.framework_version_id into v_version
      from public.framework_dimensions d where d.id = v_parent_id;
  elsif tg_table_name = 'framework_evidence_requirements' then
    v_parent_id := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
    select q.framework_version_id into v_version
      from public.framework_questions q where q.id = v_parent_id;
  else
    v_version := case when tg_op = 'DELETE' then old.framework_version_id else new.framework_version_id end;
  end if;

  if public.framework_version_is_published(v_version) then
    raise exception 'Published framework content is immutable; create a new framework version.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists framework_dimensions_immutable on public.framework_dimensions;
create trigger framework_dimensions_immutable before insert or update or delete on public.framework_dimensions
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_sub_dimensions_immutable on public.framework_sub_dimensions;
create trigger framework_sub_dimensions_immutable before insert or update or delete on public.framework_sub_dimensions
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_questions_immutable on public.framework_questions;
create trigger framework_questions_immutable before insert or update or delete on public.framework_questions
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_evidence_immutable on public.framework_evidence_requirements;
create trigger framework_evidence_immutable before insert or update or delete on public.framework_evidence_requirements
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_scoring_rules_immutable on public.framework_scoring_rules;
create trigger framework_scoring_rules_immutable before insert or update or delete on public.framework_scoring_rules
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_readiness_rules_immutable on public.framework_readiness_rules;
create trigger framework_readiness_rules_immutable before insert or update or delete on public.framework_readiness_rules
for each row execute function public.reject_published_framework_change();

drop trigger if exists framework_sources_immutable on public.framework_source_records;
create trigger framework_sources_immutable before insert or update or delete on public.framework_source_records
for each row execute function public.reject_published_framework_change();

alter table public.framework_dimensions enable row level security;
alter table public.framework_sub_dimensions enable row level security;
alter table public.framework_questions enable row level security;
alter table public.framework_evidence_requirements enable row level security;
alter table public.framework_scoring_rules enable row level security;
alter table public.framework_readiness_rules enable row level security;
alter table public.framework_source_records enable row level security;

-- Keep application ownership consistent with migration 0018 on environments that use samakose_app.
-- Local/test environments without this role are intentionally left unchanged.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE public.framework_dimensions OWNER TO samakose_app;
    ALTER TABLE public.framework_sub_dimensions OWNER TO samakose_app;
    ALTER TABLE public.framework_questions OWNER TO samakose_app;
    ALTER TABLE public.framework_evidence_requirements OWNER TO samakose_app;
    ALTER TABLE public.framework_scoring_rules OWNER TO samakose_app;
    ALTER TABLE public.framework_readiness_rules OWNER TO samakose_app;
    ALTER TABLE public.framework_source_records OWNER TO samakose_app;
  END IF;
END $$;
