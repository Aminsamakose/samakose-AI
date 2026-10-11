-- 0049: first-class Business Health Record identity and append-only source-event ledger.
-- Source facts remain authoritative in their existing tables; the ledger points to them.

create table if not exists public.business_health_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id),
  status text not null default 'Active' check (status in ('Active','Archived')),
  record_version integer not null default 1 check (record_version >= 0),
  latest_case_id uuid references public.cases(id) on delete set null,
  first_assessed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bhr_org_uq unique(org_id)
);
create index if not exists bhr_last_activity_idx on public.business_health_records(last_activity_at);
create index if not exists bhr_latest_case_idx on public.business_health_records(latest_case_id);

create table if not exists public.business_health_record_events (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.business_health_records(id),
  org_id uuid not null references public.organisations(id),
  case_id uuid references public.cases(id),
  event_type text not null,
  source_type text not null,
  source_id uuid not null,
  summary text not null,
  actor_user_id uuid,
  occurred_at timestamptz not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bhr_event_record_time_idx on public.business_health_record_events(record_id, occurred_at);
create index if not exists bhr_event_case_time_idx on public.business_health_record_events(case_id, occurred_at);
create index if not exists bhr_event_type_time_idx on public.business_health_record_events(event_type, occurred_at);
create unique index if not exists bhr_event_fingerprint_uq
  on public.business_health_record_events(record_id, source_type, source_id, event_type, occurred_at);

-- Create one record anchor for every existing organisation.
insert into public.business_health_records
  (org_id, status, record_version, latest_case_id, first_assessed_at, last_activity_at, created_by, created_at, updated_at)
select o.id,
       case when o.status = 'Archived' or o.deleted_at is not null then 'Archived' else 'Active' end,
       0,
       latest_case.id,
       first_diagnostic.at,
       greatest(o.created_at, coalesce(latest_case.updated_at, latest_case.created_at, o.created_at), o.updated_at),
       o.created_by, o.created_at, o.updated_at
from public.organisations o
left join lateral (
  select c.id, c.created_at, c.updated_at
  from public.cases c where c.org_id = o.id
  order by c.updated_at desc, c.created_at desc limit 1
) latest_case on true
left join lateral (
  select min(d.created_at) as at
  from public.cases c join public.diagnostics d on d.case_id = c.id
  where c.org_id = o.id
) first_diagnostic on true
on conflict (org_id) do nothing;

-- Backfill the event ledger as references to existing source rows, not copies of their full records.
insert into public.business_health_record_events
  (record_id, org_id, case_id, event_type, source_type, source_id, summary, actor_user_id, occurred_at, details, created_at)
select bhr.id, o.id, null::uuid, 'ORGANISATION_CREATED', 'organisations', o.id,
       'Business profile registered', o.created_by, o.created_at,
       jsonb_build_object('type', o.type, 'status', o.status, 'region', o.region, 'district', o.district), o.created_at
from public.organisations o join public.business_health_records bhr on bhr.org_id = o.id
union all
select bhr.id, c.org_id, c.id, 'CASE_OPENED', 'cases', c.id,
       'Case ' || c.code || ' opened', c.created_by, c.created_at,
       jsonb_build_object('code', c.code, 'status', c.status, 'programmeId', c.programme_id), c.created_at
from public.cases c join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, d.case_id, 'DIAGNOSTIC_SUBMITTED', 'diagnostics', d.id,
       'Diagnostic ' || d.code || ' submitted', d.submitted_by, d.created_at,
       jsonb_build_object('code', d.code, 'status', d.status, 'source', d.source, 'version', d.version,
                          'completion', d.completion, 'frameworkVersionId', d.framework_version_id), d.created_at
from public.diagnostics d join public.cases c on c.id = d.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, s.case_id, 'SCORE_COMPUTED', 'health_scores', s.id,
       'Business Health score recorded: ' || s.overall::text, null::uuid, s.created_at,
       jsonb_build_object('overall', s.overall, 'maturity', s.maturity, 'confidence', s.confidence_class,
                          'run', s.run, 'frameworkVersionId', s.framework_version_id), s.created_at
from public.health_scores s join public.cases c on c.id = s.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, d.case_id, 'DIAGNOSIS_CREATED', 'diagnoses', d.id,
       'Diagnosis ' || d.code || ' recorded', d.created_by, d.created_at,
       jsonb_build_object('code', d.code, 'status', d.status, 'priority', d.priority, 'summary', d.summary), d.created_at
from public.diagnoses d join public.cases c on c.id = d.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, p.case_id, 'PRESCRIPTION_CREATED', 'prescriptions', p.id,
       'Prescription ' || p.code || ' recorded', p.created_by, p.created_at,
       jsonb_build_object('code', p.code, 'status', p.status, 'itemCount',
         case when jsonb_typeof(p.items) = 'array' then jsonb_array_length(p.items) else 0 end), p.created_at
from public.prescriptions p join public.cases c on c.id = p.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, i.case_id, 'INTERVENTION_CREATED', 'interventions', i.id,
       'Intervention ' || i.code || ' recorded', null::uuid, i.created_at,
       jsonb_build_object('code', i.code, 'libraryCode', i.library_code, 'status', i.status), i.created_at
from public.interventions i join public.cases c on c.id = i.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, a.case_id, 'ACTION_CREATED', 'actions', a.id,
       'Action ' || a.code || ' recorded', null::uuid, a.created_at,
       jsonb_build_object('code', a.code, 'status', a.status, 'ownerRole', a.owner_role, 'dueDate', a.due_date), a.created_at
from public.actions a join public.cases c on c.id = a.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, e.case_id, 'EVIDENCE_ADDED', 'evidence', e.id,
       'Evidence item ' || e.code || ' added', e.verified_by, e.created_at,
       jsonb_build_object('code', e.code, 'class', e.class, 'verified', e.verified_at is not null,
                          'documentId', e.document_id), e.created_at
from public.evidence e join public.cases c on c.id = e.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, d.org_id, d.case_id, 'DOCUMENT_UPLOADED', 'documents', d.id,
       'Document ' || d.filename || ' added', d.uploaded_by, d.created_at,
       jsonb_build_object('code', d.code, 'filename', d.filename, 'mime', d.mime, 'size', d.size, 'status', d.status), d.created_at
from public.documents d join public.business_health_records bhr on bhr.org_id = d.org_id
union all
select bhr.id, c.org_id, a.case_id,
       case when a."function" = 'coach' then 'COACH_ASSIGNED'
            when a."function" = 'reviewer' then 'REVIEWER_ASSIGNED' else 'EXPERT_ASSIGNED' end,
       'case_assignments', a.id, 'Provider assignment recorded', a.assigned_by, a.created_at,
       jsonb_build_object('function', a."function", 'userId', a.user_id, 'status', a.status,
                          'specialisation', a.specialisation), a.created_at
from public.case_assignments a join public.cases c on c.id = a.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, k.case_id, 'KPI_CREATED', 'kpis', k.id,
       'Outcome indicator ' || k.name || ' created', null::uuid, k.created_at,
       jsonb_build_object('name', k.name, 'unit', k.unit, 'baseline', k.baseline, 'target', k.target), k.created_at
from public.kpis k join public.cases c on c.id = k.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, k.case_id, 'OUTCOME_READING_RECORDED', 'kpi_readings', kr.id,
       'Outcome reading recorded for ' || k.name, kr.recorded_by, kr.created_at,
       jsonb_build_object('kpiId', k.id, 'value', kr.value, 'readingDate', kr.reading_date,
                          'sourceClass', kr.source_class), kr.created_at
from public.kpi_readings kr join public.kpis k on k.id = kr.kpi_id
join public.cases c on c.id = k.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, s.case_id, 'COACHING_SESSION_SCHEDULED', 'coaching_sessions', s.id,
       'Coaching session scheduled', s.coach_id, s.created_at,
       jsonb_build_object('code', s.code, 'scheduledAt', s.scheduled_at, 'status', s.status), s.created_at
from public.coaching_sessions s join public.cases c on c.id = s.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, ce.org_id, ce.case_id, 'CERTIFICATE_PROPOSED', 'certificates', ce.id,
       'Business Health certificate proposed (' || ce.level || ')', ce.proposed_by, ce.proposed_at,
       jsonb_build_object('level', ce.level, 'status', ce.status, 'overall', ce.overall, 'expiresAt', ce.expires_at), ce.proposed_at
from public.certificates ce join public.business_health_records bhr on bhr.org_id = ce.org_id
union all
select bhr.id, r.org_id, null::uuid, 'OPPORTUNITY_REFERRAL_STATUS_CHANGED', 'opportunity_referral_events', ev.id,
       'Opportunity referral moved to ' || ev.to_status, ev.actor_id, ev.created_at,
       jsonb_build_object('referralId', r.id, 'opportunityId', r.opportunity_id, 'fromStatus', ev.from_status,
                          'toStatus', ev.to_status, 'note', ev.note), ev.created_at
from public.opportunity_referral_events ev
join public.opportunity_referrals r on r.id = ev.referral_id
join public.business_health_records bhr on bhr.org_id = r.org_id
union all
select bhr.id, c.org_id, r.case_id, 'REPORT_DRAFTED', 'reports', r.id,
       'Report ' || r.code || ' created', r.created_by, r.created_at,
       jsonb_build_object('code', r.code, 'title', r.title, 'status', r.status), r.created_at
from public.reports r join public.cases c on c.id = r.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
union all
select bhr.id, c.org_id, r.case_id, 'REPORT_RELEASED', 'reports', r.id,
       'Report ' || r.code || ' released', r.released_by, r.released_at,
       jsonb_build_object('code', r.code, 'title', r.title, 'status', r.status), r.released_at
from public.reports r join public.cases c on c.id = r.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
where r.status = 'Released' and r.released_at is not null
union all
select bhr.id, c.org_id, a.case_id, 'APPROVAL_RECORDED', 'approvals', a.id,
       'Approval recorded: ' || a.record_type || ' (' || a.decision || ')', a.user_id, a.created_at,
       jsonb_build_object('recordType', a.record_type, 'recordId', a.record_id, 'decision', a.decision, 'reason', a.reason), a.created_at
from public.approvals a join public.cases c on c.id = a.case_id
join public.business_health_records bhr on bhr.org_id = c.org_id
on conflict (record_id, source_type, source_id, event_type, occurred_at) do nothing;

update public.business_health_records b
set record_version = greatest(1, (select count(*)::integer from public.business_health_record_events e where e.record_id = b.id)),
    last_activity_at = greatest(b.created_at, coalesce((select max(e.occurred_at) from public.business_health_record_events e where e.record_id = b.id), b.created_at)),
    first_assessed_at = coalesce(b.first_assessed_at, (
      select min(e.occurred_at) from public.business_health_record_events e
      where e.record_id = b.id and e.event_type = 'DIAGNOSTIC_SUBMITTED'
    ));

create or replace function public.append_business_health_record_event(
  p_org_id uuid, p_case_id uuid, p_event_type text, p_source_type text, p_source_id uuid,
  p_summary text, p_actor_user_id uuid, p_occurred_at timestamptz, p_details jsonb
) returns void language plpgsql as $$
declare
  v_record_id uuid;
  v_event_id uuid;
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
begin
  if p_org_id is null or p_source_id is null then return; end if;
  insert into public.business_health_records
    (org_id, status, record_version, created_by, last_activity_at, created_at, updated_at)
  select o.id, case when o.status = 'Archived' or o.deleted_at is not null then 'Archived' else 'Active' end,
         0, o.created_by, coalesce(o.created_at, now()), coalesce(o.created_at, now()), coalesce(o.updated_at, now())
  from public.organisations o where o.id = p_org_id
  on conflict (org_id) do nothing;

  select id into v_record_id from public.business_health_records where org_id = p_org_id;
  if v_record_id is null then return; end if;

  insert into public.business_health_record_events
    (record_id, org_id, case_id, event_type, source_type, source_id, summary, actor_user_id, occurred_at, details, created_at)
  values
    (v_record_id, p_org_id, p_case_id, p_event_type, p_source_type, p_source_id, p_summary,
     p_actor_user_id, v_occurred_at, coalesce(p_details, '{}'::jsonb), now())
  on conflict (record_id, source_type, source_id, event_type, occurred_at) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    update public.business_health_records
      set record_version = record_version + 1,
          last_activity_at = greatest(last_activity_at, v_occurred_at),
          latest_case_id = coalesce(p_case_id, latest_case_id),
          first_assessed_at = case when p_event_type = 'DIAGNOSTIC_SUBMITTED'
               then coalesce(first_assessed_at, v_occurred_at) else first_assessed_at end,
          updated_at = now()
    where id = v_record_id;
  end if;
end $$;

create or replace function public.business_health_record_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'Business Health Record events are append-only.';
end $$;
drop trigger if exists business_health_record_events_append_only on public.business_health_record_events;
create trigger business_health_record_events_append_only before update or delete on public.business_health_record_events
for each row execute function public.business_health_record_events_append_only();

create or replace function public.capture_business_health_source_event()
returns trigger language plpgsql as $$
declare
  v_org_id uuid;
  v_case_id uuid;
  v_source_id uuid;
  v_event_type text;
  v_summary text;
  v_actor uuid;
  v_occurred_at timestamptz;
  v_details jsonb := '{}'::jsonb;
  v_old_status text;
begin
  v_source_id := new.id;

  if tg_table_name = 'organisations' then
    v_org_id := new.id;
    v_case_id := null;
    v_actor := new.created_by;
    v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'ORGANISATION_CREATED' else 'ORGANISATION_UPDATED' end;
    v_summary := case when tg_op = 'INSERT' then 'Business profile registered' else 'Business profile updated' end;
    v_details := jsonb_build_object('type', new.type, 'status', new.status, 'region', new.region, 'district', new.district);
  elsif tg_table_name = 'cases' then
    v_org_id := new.org_id; v_case_id := new.id; v_actor := new.created_by;
    v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'CASE_OPENED'
      when old.status is distinct from new.status then 'CASE_STATUS_CHANGED' else 'CASE_UPDATED' end;
    v_summary := 'Case ' || new.code || ' status: ' || new.status;
    v_details := jsonb_build_object('code', new.code, 'status', new.status, 'programmeId', new.programme_id);
  elsif tg_table_name = 'diagnostics' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := new.submitted_by; v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'DIAGNOSTIC_SUBMITTED' else 'DIAGNOSTIC_UPDATED' end;
    v_summary := 'Diagnostic ' || new.code || ' submitted';
    v_details := jsonb_build_object('code', new.code, 'status', new.status, 'source', new.source,
      'version', new.version, 'completion', new.completion, 'frameworkVersionId', new.framework_version_id);
  elsif tg_table_name = 'health_scores' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := null; v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := 'SCORE_COMPUTED';
    v_summary := 'Business Health score recorded: ' || new.overall::text;
    v_details := jsonb_build_object('overall', new.overall, 'maturity', new.maturity,
      'confidence', new.confidence_class, 'run', new.run, 'frameworkVersionId', new.framework_version_id);
  elsif tg_table_name = 'diagnoses' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := new.created_by; v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'DIAGNOSIS_CREATED' else 'DIAGNOSIS_UPDATED' end;
    v_summary := 'Diagnosis ' || new.code || ' (' || new.priority || ')';
    v_details := jsonb_build_object('code', new.code, 'status', new.status, 'priority', new.priority, 'summary', new.summary);
  elsif tg_table_name = 'prescriptions' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := new.created_by; v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'PRESCRIPTION_CREATED' else 'PRESCRIPTION_UPDATED' end;
    v_summary := 'Prescription ' || new.code || ' status: ' || new.status;
    v_details := jsonb_build_object('code', new.code, 'status', new.status,
      'itemCount', case when jsonb_typeof(new.items) = 'array' then jsonb_array_length(new.items) else 0 end);
  elsif tg_table_name = 'interventions' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := null; v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'INTERVENTION_CREATED' else 'INTERVENTION_UPDATED' end;
    v_summary := 'Intervention ' || new.code || ' status: ' || new.status;
    v_details := jsonb_build_object('code', new.code, 'libraryCode', new.library_code, 'status', new.status);
  elsif tg_table_name = 'actions' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := null; v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'ACTION_CREATED' else 'ACTION_UPDATED' end;
    v_summary := 'Action ' || new.code || ' status: ' || new.status;
    v_details := jsonb_build_object('code', new.code, 'status', new.status, 'ownerRole', new.owner_role, 'dueDate', new.due_date);
  elsif tg_table_name = 'evidence' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := new.verified_by; v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'EVIDENCE_ADDED'
      when old.verified_at is distinct from new.verified_at then 'EVIDENCE_VERIFIED' else 'EVIDENCE_UPDATED' end;
    v_summary := 'Evidence item ' || new.code || ' recorded';
    v_details := jsonb_build_object('code', new.code, 'class', new.class, 'verified', new.verified_at is not null,
      'documentId', new.document_id);
  elsif tg_table_name = 'documents' then
    v_org_id := new.org_id; v_case_id := new.case_id; v_actor := new.uploaded_by;
    v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'DOCUMENT_UPLOADED' else 'DOCUMENT_STATUS_CHANGED' end;
    v_summary := 'Document ' || new.filename || ' status: ' || new.status;
    v_details := jsonb_build_object('code', new.code, 'filename', new.filename, 'mime', new.mime, 'size', new.size, 'status', new.status);
  elsif tg_table_name = 'case_assignments' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := new.assigned_by; v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT'
      then case when new."function" = 'coach' then 'COACH_ASSIGNED'
                when new."function" = 'reviewer' then 'REVIEWER_ASSIGNED' else 'EXPERT_ASSIGNED' end
      else 'PROVIDER_ASSIGNMENT_CHANGED' end;
    v_summary := 'Provider assignment: ' || new."function" || ' (' || new.status || ')';
    v_details := jsonb_build_object('function', new."function", 'userId', new.user_id, 'status', new.status, 'specialisation', new.specialisation);
  elsif tg_table_name = 'kpis' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := null; v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'KPI_CREATED' else 'KPI_UPDATED' end;
    v_summary := 'Outcome indicator ' || new.name || ' recorded';
    v_details := jsonb_build_object('name', new.name, 'unit', new.unit, 'baseline', new.baseline, 'target', new.target);
  elsif tg_table_name = 'kpi_readings' then
    select k.case_id, c.org_id into v_case_id, v_org_id from public.kpis k
      join public.cases c on c.id = k.case_id where k.id = new.kpi_id;
    v_actor := new.recorded_by; v_occurred_at := new.created_at; v_event_type := 'OUTCOME_READING_RECORDED';
    v_summary := 'Outcome reading recorded';
    v_details := jsonb_build_object('kpiId', new.kpi_id, 'value', new.value, 'readingDate', new.reading_date, 'sourceClass', new.source_class);
  elsif tg_table_name = 'coaching_sessions' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := new.coach_id; v_occurred_at := case when tg_op = 'INSERT' then new.created_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'COACHING_SESSION_SCHEDULED' else 'COACHING_SESSION_UPDATED' end;
    v_summary := 'Coaching session ' || new.status;
    v_details := jsonb_build_object('code', new.code, 'scheduledAt', new.scheduled_at, 'status', new.status);
  elsif tg_table_name = 'certificates' then
    v_org_id := new.org_id; v_case_id := new.case_id; v_actor := coalesce(new.decided_by, new.proposed_by);
    v_occurred_at := case when tg_op = 'INSERT' then new.proposed_at else now() end;
    v_event_type := case when tg_op = 'INSERT' then 'CERTIFICATE_PROPOSED' else 'CERTIFICATE_STATUS_CHANGED' end;
    v_summary := 'Business Health certificate ' || new.level || ' (' || new.status || ')';
    v_details := jsonb_build_object('level', new.level, 'status', new.status, 'overall', new.overall, 'expiresAt', new.expires_at);
  elsif tg_table_name = 'opportunity_referral_events' then
    select r.org_id into v_org_id from public.opportunity_referrals r where r.id = new.referral_id;
    v_case_id := null; v_actor := new.actor_id; v_occurred_at := new.created_at;
    v_event_type := 'OPPORTUNITY_REFERRAL_STATUS_CHANGED';
    v_summary := 'Opportunity referral moved to ' || new.to_status;
    v_details := jsonb_build_object('referralId', new.referral_id, 'toStatus', new.to_status, 'fromStatus', new.from_status, 'note', new.note);
  elsif tg_table_name = 'reports' then
    v_case_id := new.case_id; select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := coalesce(new.released_by, new.created_by); v_occurred_at := case when tg_op = 'INSERT' then new.created_at else coalesce(new.released_at, now()) end;
    v_event_type := case when new.status = 'Released' and new.released_at is not null then 'REPORT_RELEASED'
      when tg_op = 'INSERT' then 'REPORT_DRAFTED' else 'REPORT_UPDATED' end;
    v_summary := case when v_event_type = 'REPORT_RELEASED' then 'Report ' || new.code || ' released' else 'Report ' || new.code || ' updated' end;
    v_details := jsonb_build_object('code', new.code, 'title', new.title, 'status', new.status, 'releasedAt', new.released_at);
  elsif tg_table_name = 'approvals' then
    v_case_id := new.case_id;
    if v_case_id is null then return new; end if;
    select c.org_id into v_org_id from public.cases c where c.id = v_case_id;
    v_actor := new.user_id; v_occurred_at := new.created_at; v_event_type := 'APPROVAL_RECORDED';
    v_summary := 'Approval recorded: ' || new.record_type || ' (' || new.decision || ')';
    v_details := jsonb_build_object('recordType', new.record_type, 'recordId', new.record_id, 'decision', new.decision, 'reason', new.reason);
  else
    return new;
  end if;

  perform public.append_business_health_record_event(
    v_org_id, v_case_id, v_event_type, tg_table_name, v_source_id, v_summary, v_actor, v_occurred_at, v_details
  );
  return new;
end $$;

-- Captures new events from existing authoritative tables. No source data is moved or duplicated.
drop trigger if exists bhr_org_source_event on public.organisations;
create trigger bhr_org_source_event after insert or update on public.organisations
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_case_source_event on public.cases;
create trigger bhr_case_source_event after insert or update on public.cases
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_diagnostic_source_event on public.diagnostics;
create trigger bhr_diagnostic_source_event after insert or update on public.diagnostics
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_score_source_event on public.health_scores;
create trigger bhr_score_source_event after insert or update on public.health_scores
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_diagnosis_source_event on public.diagnoses;
create trigger bhr_diagnosis_source_event after insert or update on public.diagnoses
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_prescription_source_event on public.prescriptions;
create trigger bhr_prescription_source_event after insert or update on public.prescriptions
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_intervention_source_event on public.interventions;
create trigger bhr_intervention_source_event after insert or update on public.interventions
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_action_source_event on public.actions;
create trigger bhr_action_source_event after insert or update on public.actions
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_evidence_source_event on public.evidence;
create trigger bhr_evidence_source_event after insert or update on public.evidence
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_document_source_event on public.documents;
create trigger bhr_document_source_event after insert or update on public.documents
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_assignment_source_event on public.case_assignments;
create trigger bhr_assignment_source_event after insert or update on public.case_assignments
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_kpi_source_event on public.kpis;
create trigger bhr_kpi_source_event after insert or update on public.kpis
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_kpi_reading_source_event on public.kpi_readings;
create trigger bhr_kpi_reading_source_event after insert or update on public.kpi_readings
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_coaching_session_source_event on public.coaching_sessions;
create trigger bhr_coaching_session_source_event after insert or update on public.coaching_sessions
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_certificate_source_event on public.certificates;
create trigger bhr_certificate_source_event after insert or update on public.certificates
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_opportunity_referral_event_source_event on public.opportunity_referral_events;
create trigger bhr_opportunity_referral_event_source_event after insert on public.opportunity_referral_events
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_report_source_event on public.reports;
create trigger bhr_report_source_event after insert or update on public.reports
for each row execute function public.capture_business_health_source_event();
drop trigger if exists bhr_approval_source_event on public.approvals;
create trigger bhr_approval_source_event after insert on public.approvals
for each row execute function public.capture_business_health_source_event();

alter table public.business_health_records enable row level security;
alter table public.business_health_record_events enable row level security;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'samakose_app') THEN
    ALTER TABLE public.business_health_records OWNER TO samakose_app;
    ALTER TABLE public.business_health_record_events OWNER TO samakose_app;
  END IF;
END $$;
