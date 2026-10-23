--
--



SET statement_timeout = 0;
--> statement-breakpoint
SET lock_timeout = 0;
--> statement-breakpoint
SET idle_in_transaction_session_timeout = 0;
--> statement-breakpoint
SET client_encoding = 'UTF8';
--> statement-breakpoint
SET standard_conforming_strings = on;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', false);
--> statement-breakpoint
SET check_function_bodies = false;
--> statement-breakpoint
SET xmloption = content;
--> statement-breakpoint
SET client_min_messages = warning;
--> statement-breakpoint
SET row_security = off;
--> statement-breakpoint

--
-- Name: case_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.case_state AS ENUM (
    'PROSPECT',
    'ONBOARDING',
    'PROFILED',
    'DIAGNOSTIC',
    'DIAGNOSED',
    'PRESCRIBED',
    'APPROVAL',
    'IN EXECUTION',
    'COACHING',
    'MONITORING',
    'MIDLINE',
    'ENDLINE',
    'FOLLOW-UP',
    'GRADUATED',
    'RE-ENTRY'
);
--> statement-breakpoint


--
-- Name: evidence_class; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.evidence_class AS ENUM (
    'Verified',
    'Document-supported',
    'Self-reported',
    'Unverified',
    'Missing'
);
--> statement-breakpoint


--
-- Name: org_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.org_type AS ENUM (
    'SME',
    'AGRIFOOD',
    'ESO'
);
--> statement-breakpoint


--
-- Name: role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role AS ENUM (
    'ADMIN',
    'EXECUTIVE',
    'PROGRAMME_MANAGER',
    'EXPERT',
    'REVIEWER',
    'FINANCE',
    'OWNER',
    'FUNDER',
    'CONTENT_EDITOR',
    'SITE_MANAGER',
    'RESPONDENT'
);
--> statement-breakpoint


--
-- Name: role_retired_0012; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role_retired_0012 AS ENUM (
    'ADMIN',
    'EXECUTIVE',
    'PROGRAMME_MANAGER',
    'CONSULTANT',
    'REVIEWER',
    'COACH',
    'FINANCE',
    'OWNER',
    'FUNDER',
    'CONTENT_EDITOR',
    'SITE_MANAGER'
);
--> statement-breakpoint


--
-- Name: ai_agent_versions_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ai_agent_versions_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.prompt IS DISTINCT FROM OLD.prompt OR NEW.model IS DISTINCT FROM OLD.model OR NEW.config IS DISTINCT FROM OLD.config
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    RAISE EXCEPTION 'An agent version cannot be changed. Create a new version instead.';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint


--
-- Name: case_messages_no_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.case_messages_no_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN RAISE EXCEPTION 'A sent message cannot be changed'; END $$;
--> statement-breakpoint


--
-- Name: certificates_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.certificates_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
     OR NEW.proposed_at IS DISTINCT FROM OLD.proposed_at OR NEW.rationale IS DISTINCT FROM OLD.rationale THEN
    RAISE EXCEPTION 'A certificate record cannot be rewritten. Propose a new one instead.';
  END IF;
  IF OLD.status IN ('Declined','Revoked') THEN RAISE EXCEPTION 'A declined or revoked certificate is final.'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint


--
-- Name: check_revenue_share_allocation_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_revenue_share_allocation_total() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  target_agreement uuid := coalesce(new.agreement_id, old.agreement_id);
  total numeric(6,2);
begin
  select coalesce(sum(percent_of_share), 0) into total from public.revenue_share_allocations where agreement_id = target_agreement;
  if total <> 100 then
    raise exception 'Revenue share allocations for agreement % must sum to 100%%, got %', target_agreement, total;
  end if;
  return null;
end $$;
--> statement-breakpoint


--
-- Name: contract_amendments_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contract_amendments_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN RAISE EXCEPTION 'A contract amendment cannot be changed or removed'; END $$;
--> statement-breakpoint


--
-- Name: demographic_consent_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.demographic_consent_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE a text; p text;
BEGIN
  SELECT c.action, n.purpose INTO a, p FROM consents c JOIN consent_notices n ON n.id = c.notice_id WHERE c.id = NEW.consent_id;
  IF a IS DISTINCT FROM 'granted' THEN RAISE EXCEPTION 'Demographic data needs a recorded consent.'; END IF;
  IF p IS DISTINCT FROM NEW.category THEN RAISE EXCEPTION 'The consent on record is for a different purpose (%).', p; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint


--
-- Name: engagement_ratings_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.engagement_ratings_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN RAISE EXCEPTION 'Engagement ratings cannot be changed or deleted. Add a new rating instead.'; END $$;
--> statement-breakpoint


--
-- Name: forbid_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint


--
-- Name: framework_version_is_published(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.framework_version_is_published(p_version uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1 from public.framework_versions v
    where v.id = p_version and v.status in ('Published', 'Retired')
  );
$$;
--> statement-breakpoint


--
-- Name: framework_versions_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.framework_versions_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF OLD.status <> 'Draft' AND (
    NEW.questions IS DISTINCT FROM OLD.questions OR NEW.dimensions IS DISTINCT FROM OLD.dimensions OR
    NEW.rules IS DISTINCT FROM OLD.rules OR NEW.sources IS DISTINCT FROM OLD.sources OR
    NEW.meta IS DISTINCT FROM OLD.meta OR
    NEW.version IS DISTINCT FROM OLD.version OR NEW.framework_id IS DISTINCT FROM OLD.framework_id) THEN
    RAISE EXCEPTION 'A published framework version cannot be changed. Create a new version instead.';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint


--
-- Name: framework_versions_no_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.framework_versions_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF OLD.status <> 'Draft' THEN RAISE EXCEPTION 'A published framework version cannot be deleted.'; END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint


--
-- Name: guard_workflow_row(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_workflow_row() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE mutable text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  mutable := TG_ARGV;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION '% content is versioned: create a new version instead of editing', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint


--
-- Name: match_public_assessments_to_organisations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_public_assessments_to_organisations() RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  updated integer;
begin
  with candidates as (
    select far.id as result_id, o.id as org_id,
      count(*) over (partition by far.id) as org_count
    from public.free_assessment_results far
    join public.organisations o
      on lower(trim(o.contact_email)) = lower(trim(far.email))
      and o.type = (case far.platform when 'AGRIFOOD360' then 'AGRIFOOD' when 'ESO360' then 'ESO' else 'SME' end)::org_type
    where far.matched_org_id is null and o.contact_email is not null
  ), unambiguous as (
    select result_id, org_id from candidates where org_count = 1
  )
  update public.free_assessment_results far set matched_org_id = u.org_id
  from unambiguous u where far.id = u.result_id;
  get diagnostics updated = row_count;
  return updated;
end;
$$;
--> statement-breakpoint


--
-- Name: reject_calculation_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_calculation_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin raise exception 'A revenue-share calculation is an immutable snapshot; create a new row referencing supersedes_id instead'; end $$;
--> statement-breakpoint


--
-- Name: reject_entry_into_closed_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_entry_into_closed_period() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare period_status text;
begin
  select status into period_status from public.financial_periods where id = new.period_id;
  if period_status in ('Closed','Locked') then
    raise exception 'Financial period % is % and cannot accept new ledger entries', new.period_id, period_status;
  end if;
  return new;
end $$;
--> statement-breakpoint


--
-- Name: reject_ledger_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_ledger_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin raise exception 'The financial ledger is append-only; post an ADJUSTMENT, REVERSAL or CORRECTION entry instead'; end $$;
--> statement-breakpoint


--
-- Name: reject_published_framework_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_published_framework_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_old_version uuid;
  v_new_version uuid;
  v_old_parent uuid;
  v_new_parent uuid;
begin
  if tg_table_name = 'framework_sub_dimensions' then
    if tg_op <> 'INSERT' then
      v_old_parent := old.dimension_id;
      select d.framework_version_id into v_old_version
        from public.framework_dimensions d where d.id = v_old_parent;
    end if;
    if tg_op <> 'DELETE' then
      v_new_parent := new.dimension_id;
      select d.framework_version_id into v_new_version
        from public.framework_dimensions d where d.id = v_new_parent;
    end if;
  elsif tg_table_name = 'framework_evidence_requirements' then
    if tg_op <> 'INSERT' then
      v_old_parent := old.question_id;
      select q.framework_version_id into v_old_version
        from public.framework_questions q where q.id = v_old_parent;
    end if;
    if tg_op <> 'DELETE' then
      v_new_parent := new.question_id;
      select q.framework_version_id into v_new_version
        from public.framework_questions q where q.id = v_new_parent;
    end if;
  else
    if tg_op <> 'INSERT' then v_old_version := old.framework_version_id; end if;
    if tg_op <> 'DELETE' then v_new_version := new.framework_version_id; end if;
  end if;

  if public.framework_version_is_published(v_old_version)
     or public.framework_version_is_published(v_new_version) then
    raise exception 'Published framework content is immutable; create a new framework version.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
--> statement-breakpoint


--
-- Name: reject_self_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_self_approval() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare requester uuid;
begin
  select requested_by into requester from public.approval_requests where id = new.request_id;
  if requester = new.decided_by then
    raise exception 'Approval request % cannot be decided by its own requester (four-eyes violation)', new.request_id;
  end if;
  return new;
end $$;
--> statement-breakpoint


--
-- Name: seq_act; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_act
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


SET default_tablespace = '';
--> statement-breakpoint

SET default_table_access_method = heap;
--> statement-breakpoint

--
-- Name: actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('ACT-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_act'::regclass))::text, 6, '0'::text)) NOT NULL,
    case_id uuid NOT NULL,
    intervention_id uuid,
    text text NOT NULL,
    owner_role text NOT NULL,
    assignee_id uuid,
    due_date date NOT NULL,
    status text DEFAULT 'Open'::text NOT NULL,
    evidence_note text,
    completed_at timestamp with time zone,
    overdue_notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT act_owner_role CHECK ((owner_role = ANY (ARRAY['OWNER'::text, 'COACH'::text, 'CONSULTANT'::text]))),
    CONSTRAINT act_status CHECK ((status = ANY (ARRAY['Open'::text, 'In progress'::text, 'Done'::text])))
);
--> statement-breakpoint


--
-- Name: ai_agent_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agent_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    version integer NOT NULL,
    prompt text NOT NULL,
    model text,
    config jsonb NOT NULL,
    note text,
    evaluation text DEFAULT 'Not run'::text NOT NULL,
    evaluated_at timestamp with time zone,
    evaluation_note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_agent_versions_autonomy_cap CHECK (((((config ->> 'autonomy'::text))::integer >= 0) AND (((config ->> 'autonomy'::text))::integer <= 2))),
    CONSTRAINT ai_agent_versions_evaluation_valid CHECK ((evaluation = ANY (ARRAY['Not run'::text, 'Passed'::text, 'Failed'::text])))
);
--> statement-breakpoint


--
-- Name: ai_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    purpose text,
    role text NOT NULL,
    owner_id uuid,
    status text DEFAULT 'Draft'::text NOT NULL,
    limits jsonb DEFAULT '{}'::jsonb NOT NULL,
    current_version_id uuid,
    paused_from text,
    status_reason text,
    status_by uuid,
    status_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_agents_status_valid CHECK ((status = ANY (ARRAY['Draft'::text, 'Configured'::text, 'Testing'::text, 'Evaluation'::text, 'Approval required'::text, 'Active'::text, 'Paused'::text, 'Disabled'::text, 'Archived'::text])))
);
--> statement-breakpoint


--
-- Name: ai_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    attempt integer NOT NULL,
    valid boolean NOT NULL,
    raw text,
    input_tokens integer DEFAULT 0,
    output_tokens integer DEFAULT 0,
    latency_ms integer DEFAULT 0,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: seq_ai; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_ai
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: ai_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('AI-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_ai'::regclass))::text, 6, '0'::text)) NOT NULL,
    agent text NOT NULL,
    case_id uuid,
    model text NOT NULL,
    context_bytes integer DEFAULT 0 NOT NULL,
    requested_by uuid,
    ok boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_id uuid,
    agent_version_id uuid,
    blocked_reason text,
    tier text
);
--> statement-breakpoint


--
-- Name: approval_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    decision text NOT NULL,
    decided_by uuid NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    before_value jsonb,
    after_value jsonb,
    CONSTRAINT approval_decisions_decision_check CHECK ((decision = ANY (ARRAY['Approved'::text, 'Rejected'::text])))
);
--> statement-breakpoint


--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action_type text NOT NULL,
    reference_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    amount_ghs numeric(12,2),
    required_approver_role text,
    status text DEFAULT 'Pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approval_requests_action_type_check CHECK ((action_type = ANY (ARRAY['DISCOUNT_EXCEPTION'::text, 'REVENUE_SHARE_OVERRIDE'::text, 'PAYOUT'::text, 'REFUND'::text, 'LEDGER_ADJUSTMENT'::text, 'CONTRACT'::text]))),
    CONSTRAINT approval_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])))
);
--> statement-breakpoint


--
-- Name: approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    record_type text NOT NULL,
    record_id uuid NOT NULL,
    case_id uuid,
    user_id uuid NOT NULL,
    decision text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: area_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.area_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    platform text NOT NULL,
    sub_dimension text NOT NULL,
    member_id uuid,
    suggested_by text DEFAULT 'rule'::text NOT NULL,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT area_suggested_by_valid CHECK ((suggested_by = ANY (ARRAY['rule'::text, 'ai'::text, 'owner'::text])))
);
--> statement-breakpoint


--
-- Name: assessment_rounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_rounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    org_id uuid NOT NULL,
    framework_version_id uuid,
    status text DEFAULT 'Collecting'::text NOT NULL,
    owner_id uuid NOT NULL,
    diagnostic_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    CONSTRAINT round_status_valid CHECK ((status = ANY (ARRAY['Collecting'::text, 'Submitted'::text, 'Cancelled'::text])))
);
--> statement-breakpoint


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    actor_email text,
    ip text,
    request_id text,
    action text NOT NULL,
    entity text,
    entity_id text,
    before jsonb,
    after jsonb,
    case_id uuid,
    actor_type text DEFAULT 'HUMAN'::text NOT NULL
);
--> statement-breakpoint


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;
--> statement-breakpoint


--
-- Name: calendar_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    external_calendar_id text,
    status text DEFAULT 'CONNECTED'::text NOT NULL,
    account_label text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    disconnected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_connection_provider_ck CHECK ((provider = ANY (ARRAY['GOOGLE'::text, 'MICROSOFT'::text, 'ICS'::text, 'INTERNAL'::text, 'ZOOM'::text]))),
    CONSTRAINT calendar_connection_status_ck CHECK ((status = ANY (ARRAY['CONNECTED'::text, 'DISCONNECTED'::text, 'ERROR'::text])))
);
--> statement-breakpoint


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cohort_id uuid NOT NULL,
    session_id uuid,
    connection_id uuid,
    provider text DEFAULT 'INTERNAL'::text NOT NULL,
    external_event_id text,
    title text NOT NULL,
    description text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    location text,
    meeting_url text,
    status text DEFAULT 'SCHEDULED'::text NOT NULL,
    sync_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_event_provider_ck CHECK ((provider = ANY (ARRAY['GOOGLE'::text, 'MICROSOFT'::text, 'ICS'::text, 'INTERNAL'::text, 'ZOOM'::text]))),
    CONSTRAINT calendar_event_status_ck CHECK ((status = ANY (ARRAY['SCHEDULED'::text, 'UPDATED'::text, 'CANCELLED'::text, 'SYNC_ERROR'::text]))),
    CONSTRAINT calendar_event_time_ck CHECK ((ends_at > starts_at))
);
--> statement-breakpoint


--
-- Name: case_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.case_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    user_id uuid NOT NULL,
    function text NOT NULL,
    specialisation text,
    status text DEFAULT 'Active'::text NOT NULL,
    assigned_by uuid,
    match_score integer,
    match_breakdown jsonb,
    reason text,
    replaces_id uuid,
    acknowledge_by timestamp with time zone,
    acknowledged_at timestamp with time zone,
    decline_reason text,
    overdue_notified_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ca_function_valid CHECK ((function = ANY (ARRAY['lead'::text, 'specialist'::text, 'coach'::text, 'reviewer'::text]))),
    CONSTRAINT ca_status_valid CHECK ((status = ANY (ARRAY['Active'::text, 'Declined'::text, 'Completed'::text, 'Replaced'::text])))
);
--> statement-breakpoint


--
-- Name: case_escalations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.case_escalations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    kind text NOT NULL,
    ref_id uuid,
    detail text,
    flagged_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT esc_kind_valid CHECK ((kind = ANY (ARRAY['stalled'::text, 'session_outcome'::text]))),
    CONSTRAINT esc_session_ref CHECK (((kind <> 'session_outcome'::text) OR (ref_id IS NOT NULL)))
);
--> statement-breakpoint


--
-- Name: case_message_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.case_message_reads (
    case_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: case_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.case_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT msg_body_valid CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 4000)))
);
--> statement-breakpoint


--
-- Name: seq_case; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_case
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('CASE-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_case'::regclass))::text, 6, '0'::text)) NOT NULL,
    org_id uuid NOT NULL,
    programme_id uuid,
    cohort_id uuid,
    status public.case_state DEFAULT 'PROFILED'::public.case_state NOT NULL,
    consultant_id uuid,
    coach_id uuid,
    reviewer_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cases_reviewer_not_consultant CHECK (((reviewer_id IS NULL) OR (consultant_id IS NULL) OR (reviewer_id <> consultant_id)))
);
--> statement-breakpoint


--
-- Name: certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    org_id uuid NOT NULL,
    score_id uuid NOT NULL,
    framework_version_id uuid,
    level text NOT NULL,
    status text DEFAULT 'Proposed'::text NOT NULL,
    overall numeric(5,1) NOT NULL,
    criteria jsonb NOT NULL,
    unlocks jsonb DEFAULT '[]'::jsonb NOT NULL,
    rationale text NOT NULL,
    proposed_by uuid NOT NULL,
    proposed_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_note text,
    expires_at timestamp with time zone,
    revoked_by uuid,
    revoked_at timestamp with time zone,
    revoke_reason text,
    verify_public boolean DEFAULT false NOT NULL,
    CONSTRAINT certificates_four_eyes CHECK (((decided_by IS NULL) OR (decided_by <> proposed_by))),
    CONSTRAINT certificates_level_valid CHECK ((level = ANY (ARRAY['Foundation'::text, 'Established'::text, 'Investment-ready'::text]))),
    CONSTRAINT certificates_status_valid CHECK ((status = ANY (ARRAY['Proposed'::text, 'Certified'::text, 'Declined'::text, 'Revoked'::text])))
);
--> statement-breakpoint


--
-- Name: chargebacks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chargebacks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    amount_ghs numeric(12,2) NOT NULL,
    provider text NOT NULL,
    provider_reference text,
    status text DEFAULT 'Received'::text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone
);
--> statement-breakpoint


--
-- Name: seq_sess; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_sess
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: coaching_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coaching_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('SES-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_sess'::regclass))::text, 6, '0'::text)) NOT NULL,
    case_id uuid NOT NULL,
    coach_id uuid,
    scheduled_at timestamp with time zone NOT NULL,
    status text DEFAULT 'Scheduled'::text NOT NULL,
    notes text,
    brief text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reminder_sent_at timestamp with time zone
);
--> statement-breakpoint


--
-- Name: cohort_configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cohort_configurations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cohort_id uuid NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    delivery_mode text DEFAULT 'HYBRID'::text NOT NULL,
    schedule jsonb DEFAULT '{}'::jsonb NOT NULL,
    milestones jsonb DEFAULT '[]'::jsonb NOT NULL,
    service_levels jsonb DEFAULT '{}'::jsonb NOT NULL,
    provider_plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    session_plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    change_reason text,
    created_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cohort_configuration_approval_ck CHECK ((((status = 'APPROVED'::text) AND (approved_by IS NOT NULL) AND (approved_at IS NOT NULL)) OR (status <> 'APPROVED'::text))),
    CONSTRAINT cohort_configuration_delivery_mode_ck CHECK ((delivery_mode = ANY (ARRAY['IN_PERSON'::text, 'REMOTE'::text, 'HYBRID'::text, 'SELF_PACED'::text]))),
    CONSTRAINT cohort_configuration_rejection_ck CHECK ((((status = 'REJECTED'::text) AND (rejection_reason IS NOT NULL) AND (length(TRIM(BOTH FROM rejection_reason)) >= 3)) OR (status <> 'REJECTED'::text))),
    CONSTRAINT cohort_configuration_status_ck CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'SUPERSEDED'::text]))),
    CONSTRAINT cohort_configuration_version_ck CHECK ((version >= 1))
);
--> statement-breakpoint


--
-- Name: seq_cohort; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_cohort
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: cohorts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cohorts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('COH-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_cohort'::regclass))::text, 6, '0'::text)) NOT NULL,
    programme_id uuid NOT NULL,
    name text NOT NULL,
    start_date date,
    end_date date,
    capacity integer DEFAULT 30 NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cohort_capacity CHECK ((capacity > 0))
);
--> statement-breakpoint


--
-- Name: conflict_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conflict_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    context_type text NOT NULL,
    reference_id uuid NOT NULL,
    result text NOT NULL,
    reason text,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conflict_checks_context_type_check CHECK ((context_type = ANY (ARRAY['REVENUE_SHARE_APPROVAL'::text, 'PAYOUT_APPROVAL'::text, 'REVIEW'::text, 'COMMERCIAL_EXCEPTION'::text]))),
    CONSTRAINT conflict_checks_result_check CHECK ((result = ANY (ARRAY['CLEAR'::text, 'BLOCKED'::text])))
);
--> statement-breakpoint


--
-- Name: consent_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purpose text NOT NULL,
    country_code text NOT NULL,
    version integer NOT NULL,
    text text NOT NULL,
    effective_from timestamp with time zone,
    status text DEFAULT 'Draft'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consent_notice_purpose_valid CHECK ((purpose = ANY (ARRAY['account'::text, 'assessment'::text, 'team_invites'::text, 'demographics'::text, 'disability'::text, 'funder_aggregate'::text]))),
    CONSTRAINT consent_notice_status_valid CHECK ((status = ANY (ARRAY['Draft'::text, 'Published'::text, 'Retired'::text])))
);
--> statement-breakpoint


--
-- Name: consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid,
    notice_id uuid NOT NULL,
    action text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    CONSTRAINT consent_action_valid CHECK ((action = ANY (ARRAY['granted'::text, 'withdrawn'::text]))),
    CONSTRAINT consent_source_valid CHECK ((source = ANY (ARRAY['registration'::text, 'profile'::text, 'invitation'::text])))
);
--> statement-breakpoint


--
-- Name: content_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_docs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    key text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    live jsonb,
    draft jsonb NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    publish_at timestamp with time zone,
    published_at timestamp with time zone,
    published_by uuid,
    updated_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: content_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doc_id uuid NOT NULL,
    version integer NOT NULL,
    data jsonb NOT NULL,
    note text,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: contract_amendments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_amendments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    previous_end date,
    new_end date,
    previous_amount numeric(12,2) NOT NULL,
    new_amount numeric(12,2) NOT NULL,
    reason text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT amend_changes_something CHECK (((new_amount <> previous_amount) OR (new_end IS DISTINCT FROM previous_end))),
    CONSTRAINT amend_reason_len CHECK (((char_length(reason) >= 5) AND (char_length(reason) <= 1000)))
);
--> statement-breakpoint


--
-- Name: seq_con; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_con
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('CON-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_con'::regclass))::text, 6, '0'::text)) NOT NULL,
    org_id uuid NOT NULL,
    plan_id uuid,
    programme_id uuid,
    status text DEFAULT 'Draft'::text NOT NULL,
    start_date date,
    end_date date,
    amount_ghs numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    signatory_name text,
    signatory_title text,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    acceptance_method text,
    acceptance_note text,
    renewal_of uuid,
    CONSTRAINT con_acceptance_complete CHECK (((accepted_at IS NULL) OR ((accepted_by IS NOT NULL) AND (signatory_name IS NOT NULL) AND (acceptance_method = ANY (ARRAY['online'::text, 'recorded'::text]))))),
    CONSTRAINT con_amount CHECK ((amount_ghs >= (0)::numeric))
);
--> statement-breakpoint


--
-- Name: country_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.country_settings (
    country_code text NOT NULL,
    name text NOT NULL,
    currency text NOT NULL,
    phone_code text NOT NULL,
    default_language text DEFAULT 'en'::text NOT NULL,
    level_labels jsonb DEFAULT '[]'::jsonb NOT NULL,
    data_protection_regime text,
    regulator_name text,
    youth_max_age integer DEFAULT 35 NOT NULL,
    active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT country_code_iso2 CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT country_youth_age_valid CHECK (((youth_max_age >= 15) AND (youth_max_age <= 45)))
);
--> statement-breakpoint


--
-- Name: delivery_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cohort_id uuid NOT NULL,
    name text NOT NULL,
    activity_type text DEFAULT 'GENERAL'::text NOT NULL,
    description text,
    sequence integer DEFAULT 1 NOT NULL,
    scheduled_start timestamp with time zone,
    scheduled_end timestamp with time zone,
    status text DEFAULT 'PLANNED'::text NOT NULL,
    owner_user_id uuid,
    cohort_configuration_version integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delivery_activity_dates_ck CHECK (((scheduled_end IS NULL) OR (scheduled_start IS NULL) OR (scheduled_end >= scheduled_start))),
    CONSTRAINT delivery_activity_sequence_ck CHECK ((sequence >= 1)),
    CONSTRAINT delivery_activity_status_ck CHECK ((status = ANY (ARRAY['PLANNED'::text, 'IN_PROGRESS'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);
--> statement-breakpoint


--
-- Name: delivery_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_attendance (
    session_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    status text DEFAULT 'PRESENT'::text NOT NULL,
    arrived_at timestamp with time zone,
    note text,
    recorded_by uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delivery_attendance_status_ck CHECK ((status = ANY (ARRAY['PRESENT'::text, 'ABSENT'::text, 'EXCUSED'::text, 'LATE'::text])))
);
--> statement-breakpoint


--
-- Name: delivery_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cohort_id uuid NOT NULL,
    activity_id uuid,
    session_id uuid,
    task_id uuid,
    title text NOT NULL,
    description text,
    severity text DEFAULT 'MEDIUM'::text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    owner_user_id uuid,
    resolution text,
    resolved_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delivery_exception_severity_ck CHECK ((severity = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text]))),
    CONSTRAINT delivery_exception_status_ck CHECK ((status = ANY (ARRAY['OPEN'::text, 'IN_PROGRESS'::text, 'RESOLVED'::text, 'CLOSED'::text])))
);
--> statement-breakpoint


--
-- Name: delivery_milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_milestones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cohort_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    due_at timestamp with time zone NOT NULL,
    status text DEFAULT 'PLANNED'::text NOT NULL,
    achieved_at timestamp with time zone,
    owner_user_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delivery_milestone_status_ck CHECK ((status = ANY (ARRAY['PLANNED'::text, 'AT_RISK'::text, 'ACHIEVED'::text, 'MISSED'::text, 'CANCELLED'::text])))
);
--> statement-breakpoint


--
-- Name: delivery_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    facilitator_user_id uuid,
    mode text DEFAULT 'HYBRID'::text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    location text,
    meeting_url text,
    status text DEFAULT 'SCHEDULED'::text NOT NULL,
    capacity integer,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delivery_session_capacity_ck CHECK (((capacity IS NULL) OR (capacity > 0))),
    CONSTRAINT delivery_session_mode_ck CHECK ((mode = ANY (ARRAY['IN_PERSON'::text, 'REMOTE'::text, 'HYBRID'::text, 'SELF_PACED'::text]))),
    CONSTRAINT delivery_session_status_ck CHECK ((status = ANY (ARRAY['SCHEDULED'::text, 'IN_PROGRESS'::text, 'COMPLETED'::text, 'CANCELLED'::text, 'NO_SHOW'::text]))),
    CONSTRAINT delivery_session_time_ck CHECK ((ends_at > starts_at))
);
--> statement-breakpoint


--
-- Name: delivery_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cohort_id uuid NOT NULL,
    activity_id uuid,
    session_id uuid,
    title text NOT NULL,
    description text,
    status text DEFAULT 'TODO'::text NOT NULL,
    priority text DEFAULT 'NORMAL'::text NOT NULL,
    assigned_to uuid,
    due_at timestamp with time zone,
    completed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delivery_task_priority_ck CHECK ((priority = ANY (ARRAY['LOW'::text, 'NORMAL'::text, 'HIGH'::text, 'URGENT'::text]))),
    CONSTRAINT delivery_task_status_ck CHECK ((status = ANY (ARRAY['TODO'::text, 'IN_PROGRESS'::text, 'BLOCKED'::text, 'DONE'::text, 'CANCELLED'::text])))
);
--> statement-breakpoint


--
-- Name: demographic_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demographic_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    category text NOT NULL,
    fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    consent_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT demographic_category_valid CHECK ((category = ANY (ARRAY['demographics'::text, 'disability'::text]))),
    CONSTRAINT demographic_subject_valid CHECK ((subject_type = ANY (ARRAY['user'::text, 'organisation'::text])))
);
--> statement-breakpoint


--
-- Name: seq_dgn; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_dgn
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: diagnoses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diagnoses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('DGN-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_dgn'::regclass))::text, 6, '0'::text)) NOT NULL,
    case_id uuid NOT NULL,
    diagnostic_id uuid NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    summary text NOT NULL,
    root_causes jsonb NOT NULL,
    priority text NOT NULL,
    risks jsonb NOT NULL,
    model_confidence numeric(3,2),
    ai_request_id uuid,
    version integer DEFAULT 1 NOT NULL,
    supersedes_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dgn_priority CHECK ((priority = ANY (ARRAY['High'::text, 'Medium'::text, 'Low'::text]))),
    CONSTRAINT dgn_status CHECK ((status = ANY (ARRAY['Draft'::text, 'Reviewed'::text, 'Rejected'::text])))
);
--> statement-breakpoint


--
-- Name: diagnostic_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diagnostic_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    reminder_tier integer DEFAULT 0 NOT NULL,
    last_reminder_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: seq_diag; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_diag
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: diagnostics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diagnostics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('DIAG-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_diag'::regclass))::text, 6, '0'::text)) NOT NULL,
    case_id uuid NOT NULL,
    status text NOT NULL,
    source text DEFAULT 'web'::text NOT NULL,
    submission_uuid text,
    completion numeric(4,3) DEFAULT '0'::numeric NOT NULL,
    validation_notes text,
    submitted_by uuid,
    version integer DEFAULT 1 NOT NULL,
    supersedes_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    framework_version_id uuid,
    assessment_round_id uuid,
    assessment_mode text,
    CONSTRAINT diag_mode_valid CHECK (((assessment_mode IS NULL) OR (assessment_mode = ANY (ARRAY['self'::text, 'hybrid'::text, 'team'::text, 'consultant'::text, 'imported'::text]))))
);
--> statement-breakpoint


--
-- Name: discount_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discount_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    value numeric(12,2) NOT NULL,
    conditions jsonb,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discount_rules_kind_check CHECK ((kind = ANY (ARRAY['PERCENTAGE'::text, 'FIXED'::text, 'PROMOTIONAL_PRICE'::text])))
);
--> statement-breakpoint


--
-- Name: seq_doc; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_doc
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('DOC-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_doc'::regclass))::text, 6, '0'::text)) NOT NULL,
    org_id uuid NOT NULL,
    case_id uuid,
    filename text NOT NULL,
    mime text NOT NULL,
    size integer NOT NULL,
    sha256 text NOT NULL,
    storage_key text NOT NULL,
    status text DEFAULT 'Stored'::text NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    key text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: engagement_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assignment_id uuid NOT NULL,
    source text NOT NULL,
    rater_id uuid NOT NULL,
    scores jsonb NOT NULL,
    overall integer NOT NULL,
    comment text,
    supersedes_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT er_overall_valid CHECK (((overall >= 0) AND (overall <= 100))),
    CONSTRAINT er_source_valid CHECK ((source = ANY (ARRAY['client'::text, 'reviewer'::text, 'programme_manager'::text])))
);
--> statement-breakpoint


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id bigint NOT NULL,
    type text NOT NULL,
    case_id uuid,
    org_id uuid,
    actor_id uuid,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;
--> statement-breakpoint


--
-- Name: seq_ev; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_ev
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('EVD-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_ev'::regclass))::text, 6, '0'::text)) NOT NULL,
    case_id uuid NOT NULL,
    response_id uuid,
    document_id uuid,
    class public.evidence_class DEFAULT 'Self-reported'::public.evidence_class NOT NULL,
    description text NOT NULL,
    link text,
    verified_by uuid,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    org_id uuid,
    kind text NOT NULL,
    page text,
    rating integer,
    accuracy text,
    message text,
    case_id uuid,
    health_score_id uuid,
    status text DEFAULT 'New'::text NOT NULL,
    admin_note text,
    handled_by uuid,
    handled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feedback_accuracy_valid CHECK (((accuracy IS NULL) OR (accuracy = ANY (ARRAY['accurate'::text, 'partly'::text, 'not_accurate'::text])))),
    CONSTRAINT feedback_kind_valid CHECK ((kind = ANY (ARRAY['app'::text, 'result'::text]))),
    CONSTRAINT feedback_rating_range CHECK (((rating IS NULL) OR ((rating >= 1) AND (rating <= 5)))),
    CONSTRAINT feedback_status_valid CHECK ((status = ANY (ARRAY['New'::text, 'Triaged'::text, 'Resolved'::text, 'Not an issue'::text])))
);
--> statement-breakpoint


--
-- Name: financial_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT financial_accounts_type_check CHECK ((type = ANY (ARRAY['ASSET'::text, 'LIABILITY'::text, 'REVENUE'::text, 'EXPENSE'::text, 'EQUITY'::text])))
);
--> statement-breakpoint


--
-- Name: financial_ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_ledger_entries (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    debit_ghs numeric(12,2) DEFAULT 0 NOT NULL,
    credit_ghs numeric(12,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'GHS'::text NOT NULL,
    reference_type text NOT NULL,
    reference_id uuid NOT NULL,
    description text,
    period_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT financial_ledger_entries_reference_type_check CHECK ((reference_type = ANY (ARRAY['INVOICE'::text, 'PAYMENT'::text, 'REVENUE_SHARE'::text, 'PAYOUT'::text, 'REFUND'::text, 'ADJUSTMENT'::text]))),
    CONSTRAINT fle_one_sided_ck CHECK ((((debit_ghs = (0)::numeric) AND (credit_ghs > (0)::numeric)) OR ((credit_ghs = (0)::numeric) AND (debit_ghs > (0)::numeric))))
);
--> statement-breakpoint


--
-- Name: financial_ledger_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.financial_ledger_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: financial_ledger_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.financial_ledger_entries_id_seq OWNED BY public.financial_ledger_entries.id;
--> statement-breakpoint


--
-- Name: financial_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text DEFAULT 'Open'::text NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    CONSTRAINT financial_periods_status_check CHECK ((status = ANY (ARRAY['Open'::text, 'Closing'::text, 'Closed'::text, 'Locked'::text]))),
    CONSTRAINT fp_dates_ck CHECK ((end_date >= start_date))
);
--> statement-breakpoint


--
-- Name: framework_dimensions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.framework_dimensions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    framework_version_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    weight integer DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT framework_dimensions_weight_check CHECK ((weight > 0))
);
--> statement-breakpoint


--
-- Name: framework_evidence_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.framework_evidence_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question_id uuid NOT NULL,
    requirement text NOT NULL,
    method text NOT NULL,
    examples text[] DEFAULT '{}'::text[] NOT NULL,
    minimum_evidence_class text DEFAULT 'Self-reported'::text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: framework_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.framework_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    framework_version_id uuid NOT NULL,
    dimension_id uuid NOT NULL,
    sub_dimension_id uuid,
    code text NOT NULL,
    text text NOT NULL,
    response_type text DEFAULT 'ANCHORED'::text NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    criticality text DEFAULT 'Standard'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    applies_when text,
    risk_tag text,
    consistency_group text,
    anchors jsonb DEFAULT '[]'::jsonb NOT NULL,
    readiness_codes text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT framework_questions_criticality_check CHECK ((criticality = ANY (ARRAY['Gate'::text, 'Core'::text, 'Standard'::text]))),
    CONSTRAINT framework_questions_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Published'::text, 'Retired'::text]))),
    CONSTRAINT framework_questions_weight_check CHECK ((weight > 0))
);
--> statement-breakpoint


--
-- Name: framework_readiness_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.framework_readiness_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    framework_version_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    purpose text,
    expression text NOT NULL,
    unlocks text[] DEFAULT '{}'::text[] NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: framework_scoring_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.framework_scoring_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    framework_version_id uuid NOT NULL,
    code text NOT NULL,
    rule_type text NOT NULL,
    expression text NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: framework_source_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.framework_source_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    framework_version_id uuid NOT NULL,
    component_type text NOT NULL,
    component_code text,
    source text NOT NULL,
    rationale text NOT NULL,
    adaptation text NOT NULL,
    approval_status text DEFAULT 'Proposed'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT framework_source_records_approval_status_check CHECK ((approval_status = ANY (ARRAY['Proposed'::text, 'Approved'::text, 'Rejected'::text])))
);
--> statement-breakpoint


--
-- Name: framework_sub_dimensions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.framework_sub_dimensions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dimension_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    weight integer DEFAULT 1 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT framework_sub_dimensions_weight_check CHECK ((weight > 0))
);
--> statement-breakpoint


--
-- Name: framework_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.framework_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    framework_id uuid NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    questions jsonb NOT NULL,
    dimensions jsonb NOT NULL,
    rules jsonb,
    sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    note text,
    created_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    meta jsonb
);
--> statement-breakpoint


--
-- Name: frameworks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.frameworks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    org_type public.org_type,
    description text,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    purpose text DEFAULT 'full'::text NOT NULL,
    CONSTRAINT framework_purpose_valid CHECK ((purpose = ANY (ARRAY['full'::text, 'free_preliminary'::text])))
);
--> statement-breakpoint


--
-- Name: free_assessment_owners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.free_assessment_owners (
    user_id uuid NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: free_assessment_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.free_assessment_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    full_name text NOT NULL,
    platform text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    matched_org_id uuid,
    CONSTRAINT free_assessment_results_platform_check CHECK ((platform = ANY (ARRAY['SME360'::text, 'AGRIFOOD360'::text, 'ESO360'::text])))
);
--> statement-breakpoint


--
-- Name: geo_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geo_units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country_code text NOT NULL,
    level integer NOT NULL,
    parent_id uuid,
    code text,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    source text,
    source_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT geo_level_valid CHECK (((level >= 1) AND (level <= 6)))
);
--> statement-breakpoint


--
-- Name: health_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    diagnostic_id uuid NOT NULL,
    case_id uuid NOT NULL,
    run integer DEFAULT 1 NOT NULL,
    overall numeric(5,1) NOT NULL,
    maturity text NOT NULL,
    confidence_class text NOT NULL,
    dimensions jsonb NOT NULL,
    evidence_share jsonb NOT NULL,
    rules_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    framework_version_id uuid,
    extras jsonb,
    phase text DEFAULT 'OTHER'::text NOT NULL,
    CONSTRAINT health_scores_phase_check CHECK ((phase = ANY (ARRAY['BASELINE'::text, 'MIDLINE'::text, 'ENDLINE'::text, 'OTHER'::text]))),
    CONSTRAINT scores_range CHECK (((overall >= (0)::numeric) AND (overall <= (100)::numeric)))
);
--> statement-breakpoint


--
-- Name: inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    name text,
    email text NOT NULL,
    organisation text,
    phone text,
    interest text,
    message text,
    consent boolean DEFAULT false NOT NULL,
    source text,
    status text DEFAULT 'New'::text NOT NULL,
    ip_hash text,
    handled_by uuid,
    handled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    public_assessment_id uuid,
    platform text,
    overall_score integer,
    classification text
);
--> statement-breakpoint


--
-- Name: integration_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_credentials (
    integration text NOT NULL,
    field text NOT NULL,
    value text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: seq_iv; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_iv
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: interventions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interventions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('INT-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_iv'::regclass))::text, 6, '0'::text)) NOT NULL,
    case_id uuid NOT NULL,
    prescription_id uuid NOT NULL,
    library_code text NOT NULL,
    status text DEFAULT 'PLANNED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: seq_inv; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_inv
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('INV-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_inv'::regclass))::text, 6, '0'::text)) NOT NULL,
    contract_id uuid,
    org_id uuid NOT NULL,
    amount_ghs numeric(12,2) NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    due_date date NOT NULL,
    issued_at timestamp with time zone,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inv_amount CHECK ((amount_ghs > (0)::numeric)),
    CONSTRAINT inv_status CHECK ((status = ANY (ARRAY['Draft'::text, 'Sent'::text, 'Paid'::text, 'Overdue'::text, 'Void'::text])))
);
--> statement-breakpoint


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    locked_at timestamp with time zone,
    result jsonb,
    last_error text,
    requested_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jobs_status CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text])))
);
--> statement-breakpoint


--
-- Name: kpi_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kpi_id uuid NOT NULL,
    value numeric(14,2) NOT NULL,
    reading_date date NOT NULL,
    source_class public.evidence_class DEFAULT 'Self-reported'::public.evidence_class NOT NULL,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: seq_kpi; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_kpi
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: kpis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpis (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('KPI-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_kpi'::regclass))::text, 6, '0'::text)) NOT NULL,
    case_id uuid NOT NULL,
    name text NOT NULL,
    unit text,
    baseline numeric(14,2),
    target numeric(14,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: library_authors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_authors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    title text,
    bio text,
    photo_media_id uuid,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: library_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    dimension text NOT NULL,
    description text NOT NULL,
    typical_days integer DEFAULT 30 NOT NULL,
    kpi_hint text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: library_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    author_id uuid NOT NULL,
    topic text,
    dimension text,
    summary text DEFAULT ''::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    cover_media_id uuid,
    file_storage_key text,
    file_mime text,
    file_size integer,
    price_ghs numeric(10,2),
    status text DEFAULT 'Draft'::text NOT NULL,
    publish_at timestamp with time zone,
    published_at timestamp with time zone,
    created_by uuid,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lib_res_price_ck CHECK (((price_ghs IS NULL) OR (price_ghs >= (0)::numeric))),
    CONSTRAINT lib_res_status_ck CHECK ((status = ANY (ARRAY['Draft'::text, 'In review'::text, 'Published'::text, 'Archived'::text])))
);
--> statement-breakpoint


--
-- Name: media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    filename text NOT NULL,
    category text DEFAULT 'Image'::text NOT NULL,
    mime text NOT NULL,
    size integer NOT NULL,
    sha256 text NOT NULL,
    storage_key text NOT NULL,
    alt_text text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    summary text NOT NULL,
    url text,
    value_min numeric(14,2),
    value_max numeric(14,2),
    currency text DEFAULT 'GHS'::text NOT NULL,
    deadline date,
    status text DEFAULT 'Draft'::text NOT NULL,
    criteria jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    source_ref text,
    created_by uuid,
    published_by uuid,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT opp_status_valid CHECK ((status = ANY (ARRAY['Draft'::text, 'Open'::text, 'Closed'::text, 'Archived'::text]))),
    CONSTRAINT opp_type_valid CHECK ((type = ANY (ARRAY['Funding'::text, 'Grant'::text, 'Loan'::text, 'Equity'::text, 'Partnership'::text, 'Market'::text, 'Procurement'::text, 'Programme'::text, 'Assistance'::text, 'Training'::text]))),
    CONSTRAINT opp_value_valid CHECK (((value_min IS NULL) OR (value_max IS NULL) OR (value_min <= value_max)))
);
--> statement-breakpoint


--
-- Name: opportunity_referral_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_referral_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referral_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: opportunity_referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    status text DEFAULT 'Suggested'::text NOT NULL,
    suggested_by uuid,
    consent_by uuid,
    consent_at timestamp with time zone,
    consent_scope text[] DEFAULT '{}'::text[] NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    referred_at timestamp with time zone,
    amount_ghs numeric(14,2),
    outcome_note text,
    match_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ref_amount_only_when_awarded CHECK (((amount_ghs IS NULL) OR (status = 'Awarded'::text))),
    CONSTRAINT ref_approval_gate CHECK (((status <> ALL (ARRAY['Approved'::text, 'Referred'::text, 'Applied'::text, 'Shortlisted'::text, 'Awarded'::text])) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL)))),
    CONSTRAINT ref_consent_gate CHECK (((status <> ALL (ARRAY['Approved'::text, 'Referred'::text, 'Applied'::text, 'Shortlisted'::text, 'Awarded'::text])) OR ((consent_at IS NOT NULL) AND (consent_by IS NOT NULL) AND (cardinality(consent_scope) > 0)))),
    CONSTRAINT ref_status_valid CHECK ((status = ANY (ARRAY['Suggested'::text, 'Consented'::text, 'Approved'::text, 'Referred'::text, 'Applied'::text, 'Shortlisted'::text, 'Awarded'::text, 'Declined'::text, 'Withdrawn'::text])))
);
--> statement-breakpoint


--
-- Name: opportunity_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    url text,
    query text,
    region text DEFAULT 'Global'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    last_status text,
    last_found integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_kind_valid CHECK ((kind = ANY (ARRAY['feed'::text, 'page'::text, 'query'::text]))),
    CONSTRAINT ops_target_valid CHECK ((((kind = 'query'::text) AND (query IS NOT NULL) AND ((length(query) >= 3) AND (length(query) <= 200))) OR ((kind <> 'query'::text) AND (url IS NOT NULL))))
);
--> statement-breakpoint


--
-- Name: org_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    job_role text NOT NULL,
    status text DEFAULT 'invited'::text NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_member_status_valid CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'removed'::text])))
);
--> statement-breakpoint


--
-- Name: seq_org; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_org
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: organisations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organisations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('SME-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_org'::regclass))::text, 6, '0'::text)) NOT NULL,
    name text NOT NULL,
    type public.org_type DEFAULT 'SME'::public.org_type NOT NULL,
    sector text,
    region text,
    district text,
    size text,
    contact_name text,
    contact_email text,
    contact_phone text,
    consent_at timestamp with time zone,
    consent_by text,
    status text DEFAULT 'Active'::text NOT NULL,
    created_by uuid,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    registration_number text,
    country_code text DEFAULT 'GH'::text NOT NULL,
    geo_unit_id uuid,
    community text,
    urban_rural text,
    years_operating integer,
    ownership_structure text,
    tin text,
    merged_into uuid,
    CONSTRAINT org_tin_len CHECK (((tin IS NULL) OR ((char_length(tin) >= 5) AND (char_length(tin) <= 20)))),
    CONSTRAINT org_urban_rural_valid CHECK (((urban_rural IS NULL) OR (urban_rural = ANY (ARRAY['Urban'::text, 'Peri-urban'::text, 'Rural'::text])))),
    CONSTRAINT org_years_valid CHECK (((years_operating IS NULL) OR ((years_operating >= 0) AND (years_operating <= 200))))
);
--> statement-breakpoint


--
-- Name: outbox_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "to" text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: outcome_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outcome_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    reporting_period text,
    source text,
    verification_required boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: outcome_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outcome_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    case_id uuid NOT NULL,
    baseline_value numeric(14,2),
    baseline_date date,
    followup_value numeric(14,2),
    followup_date date,
    evidence_class public.evidence_class DEFAULT 'Self-reported'::public.evidence_class NOT NULL,
    document_id uuid,
    attribution_note text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    decision text,
    reason text,
    supersedes_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outcome_rec_has_value_ck CHECK (((baseline_value IS NOT NULL) OR (followup_value IS NOT NULL))),
    CONSTRAINT outcome_records_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'VERIFIED'::text, 'REJECTED'::text, 'SUPERSEDED'::text])))
);
--> statement-breakpoint


--
-- Name: participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    phone text,
    email text,
    merged_into uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: seq_pay; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_pay
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('PAY-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_pay'::regclass))::text, 6, '0'::text)) NOT NULL,
    invoice_id uuid NOT NULL,
    provider text NOT NULL,
    reference text NOT NULL,
    amount_ghs numeric(12,2) NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    provider_payload jsonb,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pay_amount CHECK ((amount_ghs > (0)::numeric)),
    CONSTRAINT pay_status CHECK ((status = ANY (ARRAY['Pending'::text, 'Succeeded'::text, 'Failed'::text])))
);
--> statement-breakpoint


--
-- Name: payout_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payout_id uuid NOT NULL,
    type text NOT NULL,
    amount_ghs numeric(12,2) NOT NULL,
    reason text NOT NULL,
    created_by uuid,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ledger_entry_id bigint,
    CONSTRAINT payout_adjustments_type_check CHECK ((type = ANY (ARRAY['CORRECTION'::text, 'REVERSAL'::text, 'REFUND_CLAWBACK'::text])))
);
--> statement-breakpoint


--
-- Name: payout_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payout_id uuid NOT NULL,
    reason text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution_note text
);
--> statement-breakpoint


--
-- Name: seq_plan; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_plan
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('PLN-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_plan'::regclass))::text, 6, '0'::text)) NOT NULL,
    name text NOT NULL,
    description text,
    price_ghs numeric(12,2) NOT NULL,
    interval_months integer DEFAULT 12 NOT NULL,
    active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    audience text,
    service_tier text,
    platforms jsonb DEFAULT '[]'::jsonb,
    entitlements jsonb DEFAULT '[]'::jsonb,
    duration_days integer,
    pricing_model text DEFAULT 'fixed'::text NOT NULL,
    publication_status text DEFAULT 'draft'::text NOT NULL,
    price_confirmed boolean DEFAULT false NOT NULL,
    CONSTRAINT plan_pricing_model_ck CHECK ((pricing_model = ANY (ARRAY['free'::text, 'fixed'::text, 'custom'::text]))),
    CONSTRAINT plan_publication_status_ck CHECK ((publication_status = ANY (ARRAY['draft'::text, 'published'::text, 'inactive'::text, 'archived'::text]))),
    CONSTRAINT plan_service_tier_ck CHECK (((service_tier IS NULL) OR (service_tier = ANY (ARRAY['discovery'::text, 'diagnostic'::text, 'transform'::text, 'growth'::text, 'programme'::text]))))
);
--> statement-breakpoint


--
-- Name: practitioner_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practitioner_conflicts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    reason text NOT NULL,
    declared_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: practitioner_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practitioner_profiles (
    user_id uuid NOT NULL,
    functions text[] DEFAULT '{expert}'::text[] NOT NULL,
    headline text,
    bio text,
    specialisations text[] DEFAULT '{}'::text[] NOT NULL,
    strengths text[] DEFAULT '{}'::text[] NOT NULL,
    sectors text[] DEFAULT '{}'::text[] NOT NULL,
    platforms text[] DEFAULT '{}'::text[] NOT NULL,
    business_sizes text[] DEFAULT '{}'::text[] NOT NULL,
    languages text[] DEFAULT '{}'::text[] NOT NULL,
    regions text[] DEFAULT '{}'::text[] NOT NULL,
    delivery_modes text[] DEFAULT '{}'::text[] NOT NULL,
    years_experience integer,
    credentials jsonb DEFAULT '[]'::jsonb NOT NULL,
    max_active integer DEFAULT 5 NOT NULL,
    availability text DEFAULT 'Available'::text NOT NULL,
    vetting_status text DEFAULT 'Draft'::text NOT NULL,
    vetting_note text,
    conduct_accepted_at timestamp with time zone,
    conduct_version text,
    submitted_at timestamp with time zone,
    decided_by uuid,
    decided_at timestamp with time zone,
    rate_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    engagement_type text DEFAULT 'Associate'::text NOT NULL,
    CONSTRAINT pp_availability_valid CHECK ((availability = ANY (ARRAY['Available'::text, 'Limited'::text, 'Unavailable'::text]))),
    CONSTRAINT pp_capacity_valid CHECK (((max_active >= 1) AND (max_active <= 50))),
    CONSTRAINT pp_engagement_type_ck CHECK ((engagement_type = ANY (ARRAY['Associate'::text, 'Employee'::text]))),
    CONSTRAINT pp_vetting_valid CHECK ((vetting_status = ANY (ARRAY['Draft'::text, 'Submitted'::text, 'Approved'::text, 'Rejected'::text, 'Suspended'::text])))
);
--> statement-breakpoint


--
-- Name: seq_rx; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_rx
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: prescriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prescriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('RX-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_rx'::regclass))::text, 6, '0'::text)) NOT NULL,
    case_id uuid NOT NULL,
    diagnosis_id uuid NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    items jsonb NOT NULL,
    reviewer_note text,
    ai_request_id uuid,
    version integer DEFAULT 1 NOT NULL,
    supersedes_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rx_status CHECK ((status = ANY (ARRAY['DRAFT'::text, 'IN REVIEW'::text, 'APPROVED'::text, 'RETURNED'::text, 'SUPERSEDED'::text])))
);
--> statement-breakpoint


--
-- Name: seq_pyo; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_pyo
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: professional_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.professional_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('PYO-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_pyo'::regclass))::text, 6, '0'::text)) NOT NULL,
    professional_id uuid NOT NULL,
    calculation_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    amount_ghs numeric(12,2) NOT NULL,
    currency text DEFAULT 'GHS'::text NOT NULL,
    status text DEFAULT 'Earned'::text NOT NULL,
    payout_method text,
    payment_reference text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    approved_by uuid,
    approved_at timestamp with time zone,
    paid_at timestamp with time zone,
    reconciled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT professional_payouts_status_check CHECK ((status = ANY (ARRAY['Earned'::text, 'Reviewed'::text, 'Approved'::text, 'Payable'::text, 'Payment initiated'::text, 'Paid'::text, 'Reconciled'::text]))),
    CONSTRAINT pyo_approver_not_professional_ck CHECK (((approved_by IS NULL) OR (approved_by <> professional_id))),
    CONSTRAINT pyo_reviewer_not_professional_ck CHECK (((reviewed_by IS NULL) OR (reviewed_by <> professional_id)))
);
--> statement-breakpoint


--
-- Name: programme_budget_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programme_budget_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    category text NOT NULL,
    description text,
    amount_ghs numeric(14,2) NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pbl_amount_pos CHECK ((amount_ghs > (0)::numeric)),
    CONSTRAINT pbl_category_len CHECK (((char_length(category) >= 2) AND (char_length(category) <= 80)))
);
--> statement-breakpoint


--
-- Name: programme_expenditures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programme_expenditures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    budget_line_id uuid,
    cohort_id uuid,
    type text DEFAULT 'PAYMENT'::text NOT NULL,
    payee text NOT NULL,
    category text NOT NULL,
    purpose text,
    amount_ghs numeric(14,2) NOT NULL,
    date date NOT NULL,
    reference text,
    evidence_class public.evidence_class DEFAULT 'Document-supported'::public.evidence_class NOT NULL,
    evidence_ref text,
    settles_commitment_id uuid,
    reversal_of_id uuid,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programme_expenditures_amount_ghs_check CHECK ((amount_ghs > (0)::numeric)),
    CONSTRAINT programme_expenditures_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SETTLED'::text, 'REVERSED'::text]))),
    CONSTRAINT programme_expenditures_type_check CHECK ((type = ANY (ARRAY['COMMITMENT'::text, 'PAYMENT'::text, 'REVERSAL'::text])))
);
--> statement-breakpoint


--
-- Name: programme_indicators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programme_indicators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    name text NOT NULL,
    metric text NOT NULL,
    target numeric(10,1) NOT NULL,
    due_date date,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    level text DEFAULT 'output'::text NOT NULL,
    parent_id uuid,
    CONSTRAINT ind_level_valid CHECK ((level = ANY (ARRAY['impact'::text, 'outcome'::text, 'output'::text]))),
    CONSTRAINT ind_metric_valid CHECK ((metric = ANY (ARRAY['enrolled'::text, 'scored'::text, 'rescored'::text, 'avg_score'::text, 'avg_change'::text, 'pct_improved'::text]))),
    CONSTRAINT ind_name_len CHECK (((char_length(name) >= 3) AND (char_length(name) <= 120))),
    CONSTRAINT ind_target_valid CHECK (((target > (0)::numeric) AND ((metric <> ALL (ARRAY['avg_score'::text, 'pct_improved'::text])) OR (target <= (100)::numeric))))
);
--> statement-breakpoint


--
-- Name: programme_participant_people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programme_participant_people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_participant_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    role text DEFAULT 'OWNER'::text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programme_participant_people_role_check CHECK ((role = ANY (ARRAY['OWNER'::text, 'MANAGER'::text, 'DELEGATE'::text, 'OTHER'::text])))
);
--> statement-breakpoint


--
-- Name: programme_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programme_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    organisation_id uuid NOT NULL,
    cohort_id uuid,
    status text DEFAULT 'APPLICATION'::text NOT NULL,
    invited_at timestamp with time zone,
    consent_at timestamp with time zone,
    consent_by uuid,
    onboarded_at timestamp with time zone,
    completed_at timestamp with time zone,
    withdrawn_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programme_participant_status_ck CHECK ((status = ANY (ARRAY['APPLICATION'::text, 'ELIGIBILITY'::text, 'SELECTED'::text, 'INVITED'::text, 'CONSENTED'::text, 'ONBOARDED'::text, 'COHORT_ASSIGNED'::text, 'ACTIVE'::text, 'COMPLETING'::text, 'COMPLETED'::text, 'WITHDRAWN'::text, 'REJECTED'::text])))
);
--> statement-breakpoint


--
-- Name: programme_tranches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programme_tranches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    label text NOT NULL,
    amount_ghs numeric(14,2) NOT NULL,
    due_date date,
    status text DEFAULT 'Planned'::text NOT NULL,
    received_on date,
    received_ghs numeric(14,2),
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ptr_amount_pos CHECK ((amount_ghs > (0)::numeric)),
    CONSTRAINT ptr_received_consistent CHECK ((((status = 'Planned'::text) AND (received_on IS NULL) AND (received_ghs IS NULL)) OR ((status = 'Received'::text) AND (received_on IS NOT NULL) AND (received_ghs IS NOT NULL) AND (received_ghs >= (0)::numeric)))),
    CONSTRAINT ptr_status_valid CHECK ((status = ANY (ARRAY['Planned'::text, 'Received'::text])))
);
--> statement-breakpoint


--
-- Name: programme_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programme_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    name text NOT NULL,
    funder text,
    start_date date,
    end_date date,
    budget_ghs numeric(14,2),
    change_reason text,
    created_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programme_version_number_ck CHECK ((version >= 1)),
    CONSTRAINT programme_version_status_ck CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'SUPERSEDED'::text])))
);
--> statement-breakpoint


--
-- Name: programme_workspace_configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programme_workspace_configurations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    objectives jsonb DEFAULT '[]'::jsonb NOT NULL,
    eligibility_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    delivery_model jsonb DEFAULT '{}'::jsonb NOT NULL,
    reporting jsonb DEFAULT '{}'::jsonb NOT NULL,
    entitlements jsonb DEFAULT '[]'::jsonb NOT NULL,
    framework_version_id uuid,
    participant_consent_required boolean DEFAULT true NOT NULL,
    funder_reporting_enabled boolean DEFAULT false NOT NULL,
    change_reason text,
    created_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programme_workspace_configuration_approval_ck CHECK ((((status = 'APPROVED'::text) AND (approved_by IS NOT NULL) AND (approved_at IS NOT NULL)) OR (status <> 'APPROVED'::text))),
    CONSTRAINT programme_workspace_configuration_status_ck CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'SUPERSEDED'::text]))),
    CONSTRAINT programme_workspace_configuration_version_ck CHECK ((version >= 1))
);
--> statement-breakpoint


--
-- Name: programme_workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programme_workspace_members (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programme_workspace_member_role_ck CHECK ((role = ANY (ARRAY['PROGRAMME_MANAGER'::text, 'ASSESSOR'::text, 'EXPERT'::text, 'COACH'::text, 'REVIEWER'::text, 'FINANCE'::text, 'MEL'::text])))
);
--> statement-breakpoint


--
-- Name: programme_workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programme_workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programme_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    provider_source text DEFAULT 'SAMAKOSE_NETWORK'::text NOT NULL,
    configuration_version integer DEFAULT 1 NOT NULL,
    framework_version_id uuid,
    participant_consent_required boolean DEFAULT true NOT NULL,
    funder_reporting_enabled boolean DEFAULT false NOT NULL,
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programme_workspace_config_version_ck CHECK ((configuration_version >= 1)),
    CONSTRAINT programme_workspace_provider_ck CHECK ((provider_source = ANY (ARRAY['SAMAKOSE_NETWORK'::text, 'BRING_YOUR_OWN'::text, 'HYBRID'::text]))),
    CONSTRAINT programme_workspace_status_ck CHECK ((status = ANY (ARRAY['DRAFT'::text, 'COMMERCIAL_REVIEW'::text, 'INVOICED'::text, 'PAYMENT_PENDING'::text, 'APPROVED'::text, 'CONFIGURING'::text, 'READY'::text, 'ACTIVE'::text, 'PAUSED'::text, 'COMPLETING'::text, 'COMPLETED'::text, 'CLOSED'::text, 'ARCHIVED'::text])))
);
--> statement-breakpoint


--
-- Name: seq_prog; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_prog
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: programmes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programmes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('PRG-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_prog'::regclass))::text, 6, '0'::text)) NOT NULL,
    name text NOT NULL,
    funder text,
    start_date date,
    end_date date,
    budget_ghs numeric(14,2),
    status text DEFAULT 'Draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: promo_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    discount_rule_id uuid NOT NULL,
    start_date date,
    end_date date,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pcamp_dates_ck CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date)))
);
--> statement-breakpoint


--
-- Name: promo_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    code text NOT NULL,
    max_redemptions integer,
    per_customer_limit integer,
    min_purchase_ghs numeric(12,2),
    max_discount_ghs numeric(12,2),
    expires_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promo_codes_max_redemptions_check CHECK (((max_redemptions IS NULL) OR (max_redemptions > 0))),
    CONSTRAINT promo_codes_per_customer_limit_check CHECK (((per_customer_limit IS NULL) OR (per_customer_limit > 0)))
);
--> statement-breakpoint


--
-- Name: promo_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promo_code_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    discount_applied_ghs numeric(12,2) NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: provider_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    cohort_id uuid,
    provider_user_id uuid NOT NULL,
    provider_role text NOT NULL,
    status text DEFAULT 'PROPOSED'::text NOT NULL,
    allocation_percent integer DEFAULT 100 NOT NULL,
    max_participants integer,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provider_assignment_allocation_ck CHECK (((allocation_percent >= 1) AND (allocation_percent <= 100))),
    CONSTRAINT provider_assignment_dates_ck CHECK (((ends_at IS NULL) OR (starts_at IS NULL) OR (ends_at >= starts_at))),
    CONSTRAINT provider_assignment_participants_ck CHECK (((max_participants IS NULL) OR (max_participants > 0))),
    CONSTRAINT provider_assignment_role_ck CHECK ((provider_role = ANY (ARRAY['EXPERT'::text, 'COACH'::text]))),
    CONSTRAINT provider_assignment_status_ck CHECK ((status = ANY (ARRAY['PROPOSED'::text, 'ACTIVE'::text, 'PAUSED'::text, 'ENDED'::text, 'DECLINED'::text])))
);
--> statement-breakpoint


--
-- Name: provider_capacities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_capacities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    provider_user_id uuid NOT NULL,
    provider_role text NOT NULL,
    max_active_assignments integer DEFAULT 5 NOT NULL,
    max_sessions_per_week integer,
    weekly_hours integer,
    availability text DEFAULT 'AVAILABLE'::text NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_to timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provider_capacity_assignments_ck CHECK ((max_active_assignments > 0)),
    CONSTRAINT provider_capacity_availability_ck CHECK ((availability = ANY (ARRAY['AVAILABLE'::text, 'LIMITED'::text, 'UNAVAILABLE'::text]))),
    CONSTRAINT provider_capacity_dates_ck CHECK (((effective_to IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT provider_capacity_hours_ck CHECK (((weekly_hours IS NULL) OR (weekly_hours > 0))),
    CONSTRAINT provider_capacity_role_ck CHECK ((provider_role = ANY (ARRAY['EXPERT'::text, 'COACH'::text]))),
    CONSTRAINT provider_capacity_sessions_ck CHECK (((max_sessions_per_week IS NULL) OR (max_sessions_per_week > 0)))
);
--> statement-breakpoint


--
-- Name: public_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    normalised_email text NOT NULL,
    full_name text NOT NULL,
    business_name text,
    platform text NOT NULL,
    framework_version_id uuid NOT NULL,
    status text DEFAULT 'Started'::text NOT NULL,
    answers jsonb,
    dimension_scores jsonb,
    overall_score integer,
    classification text,
    marketing_consent boolean DEFAULT false NOT NULL,
    privacy_acknowledged boolean DEFAULT false NOT NULL,
    source text,
    ip_hash text,
    result_viewed_at timestamp with time zone,
    email_sent_at timestamp with time zone,
    downloaded_at timestamp with time zone,
    printed_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    claimed_by_user_id uuid
);
--> statement-breakpoint


--
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    dimension text NOT NULL,
    text text NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    key text NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    window_start timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: seq_rfd; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_rfd
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('RFD-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_rfd'::regclass))::text, 6, '0'::text)) NOT NULL,
    payment_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    amount_ghs numeric(12,2) NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'Requested'::text NOT NULL,
    requested_by uuid,
    approved_by uuid,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ledger_entry_id bigint,
    CONSTRAINT refund_approver_not_requester_ck CHECK (((approved_by IS NULL) OR (requested_by IS NULL) OR (approved_by <> requested_by))),
    CONSTRAINT refunds_status_check CHECK ((status = ANY (ARRAY['Requested'::text, 'Approved'::text, 'Processed'::text, 'Rejected'::text])))
);
--> statement-breakpoint


--
-- Name: registration_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registration_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    org_id uuid,
    platform text NOT NULL,
    job_role text NOT NULL,
    job_role_other text,
    responsibility text,
    assessment_mode text NOT NULL,
    suggestion_source text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reg_mode_valid CHECK ((assessment_mode = ANY (ARRAY['self'::text, 'team'::text, 'hybrid'::text]))),
    CONSTRAINT reg_platform_valid CHECK ((platform = ANY (ARRAY['SME360'::text, 'AGRIFOOD360'::text, 'ESO360'::text]))),
    CONSTRAINT reg_suggestion_valid CHECK ((suggestion_source = ANY (ARRAY['rule'::text, 'ai'::text, 'user'::text])))
);
--> statement-breakpoint


--
-- Name: seq_rep; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_rep
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('REP-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_rep'::regclass))::text, 6, '0'::text)) NOT NULL,
    case_id uuid NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    title text NOT NULL,
    content jsonb NOT NULL,
    basis jsonb,
    ai_request_id uuid,
    created_by uuid,
    released_by uuid,
    released_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: resource_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    granted_via text NOT NULL,
    invoice_id uuid,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT res_ent_granted_via_ck CHECK ((granted_via = ANY (ARRAY['purchase'::text, 'promo'::text, 'admin_grant'::text])))
);
--> statement-breakpoint


--
-- Name: resource_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    reference text NOT NULL,
    amount_ghs numeric(10,2) NOT NULL,
    status text DEFAULT 'Pending'::text NOT NULL,
    provider_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT res_pay_status_ck CHECK ((status = ANY (ARRAY['Pending'::text, 'Succeeded'::text, 'Failed'::text])))
);
--> statement-breakpoint


--
-- Name: response_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    round_id uuid NOT NULL,
    question_code text NOT NULL,
    value integer,
    not_applicable boolean DEFAULT false NOT NULL,
    evidence_class text DEFAULT 'Self-reported'::text NOT NULL,
    evidence_ref text,
    note text,
    answered_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT draft_value_range CHECK (((value IS NULL) OR ((value >= 0) AND (value <= 4))))
);
--> statement-breakpoint


--
-- Name: responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    diagnostic_id uuid NOT NULL,
    question_code text NOT NULL,
    value integer NOT NULL,
    evidence_class public.evidence_class DEFAULT 'Self-reported'::public.evidence_class NOT NULL,
    evidence_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    not_applicable boolean DEFAULT false NOT NULL,
    answered_by uuid,
    CONSTRAINT responses_value_range CHECK (((value >= 0) AND (value <= 4)))
);
--> statement-breakpoint


--
-- Name: seq_rsa; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_rsa
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: revenue_share_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_share_agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('RSA-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_rsa'::regclass))::text, 6, '0'::text)) NOT NULL,
    contract_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    professional_id uuid NOT NULL,
    model text NOT NULL,
    basis text NOT NULL,
    percentage numeric(5,2),
    fixed_amount_ghs numeric(12,2),
    tier_rules jsonb,
    status text DEFAULT 'Draft'::text NOT NULL,
    proposed_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    effective_from date,
    effective_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT revenue_share_agreements_basis_check CHECK ((basis = ANY (ARRAY['SHARE_ON_LIST_PRICE'::text, 'SHARE_ON_NET_PRICE'::text, 'SHARE_ON_COLLECTED_AMOUNT'::text]))),
    CONSTRAINT revenue_share_agreements_model_check CHECK ((model = ANY (ARRAY['PERCENTAGE'::text, 'FIXED'::text, 'TIERED'::text, 'HYBRID'::text]))),
    CONSTRAINT revenue_share_agreements_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Pending approval'::text, 'Approved'::text, 'Active'::text, 'Suspended'::text, 'Expired'::text, 'Cancelled'::text]))),
    CONSTRAINT rsa_model_amount_ck CHECK ((((model = 'PERCENTAGE'::text) AND (percentage IS NOT NULL)) OR ((model = 'FIXED'::text) AND (fixed_amount_ghs IS NOT NULL)) OR ((model = ANY (ARRAY['TIERED'::text, 'HYBRID'::text])) AND ((tier_rules IS NOT NULL) OR (percentage IS NOT NULL) OR (fixed_amount_ghs IS NOT NULL)))))
);
--> statement-breakpoint


--
-- Name: revenue_share_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_share_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agreement_id uuid NOT NULL,
    allocatee_role text NOT NULL,
    professional_id uuid,
    percent_of_share numeric(5,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT revenue_share_allocations_allocatee_role_check CHECK ((allocatee_role = ANY (ARRAY['SAMAKOSE'::text, 'LEAD'::text, 'SPECIALIST'::text, 'COACH'::text, 'REVIEWER'::text]))),
    CONSTRAINT revenue_share_allocations_percent_of_share_check CHECK (((percent_of_share > (0)::numeric) AND (percent_of_share <= (100)::numeric))),
    CONSTRAINT rsal_professional_required_ck CHECK (((allocatee_role = 'SAMAKOSE'::text) OR (professional_id IS NOT NULL))),
    CONSTRAINT rsal_samakose_no_professional_ck CHECK (((allocatee_role <> 'SAMAKOSE'::text) OR (professional_id IS NULL)))
);
--> statement-breakpoint


--
-- Name: seq_rsc; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_rsc
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: revenue_share_calculations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_share_calculations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('RSC-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_rsc'::regclass))::text, 6, '0'::text)) NOT NULL,
    agreement_id uuid NOT NULL,
    invoice_id uuid,
    payment_id uuid,
    gross_amount_ghs numeric(12,2) NOT NULL,
    discount_amount_ghs numeric(12,2) DEFAULT 0 NOT NULL,
    net_amount_ghs numeric(12,2) NOT NULL,
    basis_used text NOT NULL,
    calculation_version integer DEFAULT 1 NOT NULL,
    professional_amount_ghs numeric(12,2) NOT NULL,
    samakose_amount_ghs numeric(12,2) NOT NULL,
    currency text DEFAULT 'GHS'::text NOT NULL,
    supersedes_id uuid,
    computed_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT revenue_share_calculations_basis_used_check CHECK ((basis_used = ANY (ARRAY['SHARE_ON_LIST_PRICE'::text, 'SHARE_ON_NET_PRICE'::text, 'SHARE_ON_COLLECTED_AMOUNT'::text])))
);
--> statement-breakpoint


--
-- Name: seq_risk; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_risk
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: risks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('RISK-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_risk'::regclass))::text, 6, '0'::text)) NOT NULL,
    case_id uuid NOT NULL,
    text text NOT NULL,
    severity text NOT NULL,
    status text DEFAULT 'Open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT risk_severity CHECK ((severity = ANY (ARRAY['High'::text, 'Medium'::text, 'Low'::text])))
);
--> statement-breakpoint


--
-- Name: role_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.role NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: role_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    framework_code text NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    data jsonb NOT NULL,
    note text,
    created_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT role_mapping_published_needs_approval CHECK (((status <> 'Published'::text) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL)))),
    CONSTRAINT role_mapping_status_valid CHECK ((status = ANY (ARRAY['Draft'::text, 'Published'::text, 'Retired'::text])))
);
--> statement-breakpoint


--
-- Name: rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rules (
    key text NOT NULL,
    value text NOT NULL,
    note text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: scout_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scout_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    sources integer DEFAULT 0 NOT NULL,
    candidates integer DEFAULT 0 NOT NULL,
    drafted integer DEFAULT 0 NOT NULL,
    skipped integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    searches integer DEFAULT 0 NOT NULL,
    note text
);
--> statement-breakpoint


--
-- Name: seq_usr; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_usr
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    user_id uuid NOT NULL,
    mfa_verified boolean DEFAULT false NOT NULL,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    active_role public.role
);
--> statement-breakpoint


--
-- Name: tax_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid,
    payout_id uuid,
    tax_rule_id uuid NOT NULL,
    base_amount_ghs numeric(12,2) NOT NULL,
    amount_ghs numeric(12,2) NOT NULL,
    rule_version integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tl_one_target_ck CHECK (((invoice_id IS NOT NULL) <> (payout_id IS NOT NULL)))
);
--> statement-breakpoint


--
-- Name: tax_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    rate numeric(5,2) NOT NULL,
    jurisdiction text NOT NULL,
    inclusive_of_price boolean DEFAULT false NOT NULL,
    rule_version integer DEFAULT 1 NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tax_rules_type_check CHECK ((type = ANY (ARRAY['VAT'::text, 'WITHHOLDING'::text, 'OTHER'::text]))),
    CONSTRAINT tr_dates_ck CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)))
);
--> statement-breakpoint


--
-- Name: user_programmes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_programmes (
    user_id uuid NOT NULL,
    programme_id uuid NOT NULL
);
--> statement-breakpoint


--
-- Name: user_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text DEFAULT ((('USR-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.seq_usr'::regclass))::text, 6, '0'::text)) NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    role public.role NOT NULL,
    org_id uuid,
    password_hash text,
    active boolean DEFAULT true NOT NULL,
    mfa_secret text,
    mfa_enabled boolean DEFAULT false NOT NULL,
    failed_logins integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    must_change_password boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    approval_status text DEFAULT 'approved'::text NOT NULL,
    email_verified boolean DEFAULT true NOT NULL,
    signup_org_name text,
    signup_note text,
    google_sub text,
    profile_required boolean DEFAULT false NOT NULL,
    mfa_recovery text[] DEFAULT '{}'::text[] NOT NULL,
    photo_key text,
    photo_mime text,
    photo_sha256 text,
    photo_updated_at timestamp with time zone,
    CONSTRAINT users_approval_status_chk CHECK ((approval_status = ANY (ARRAY['approved'::text, 'pending'::text, 'rejected'::text]))),
    CONSTRAINT users_owner_has_org CHECK (((role <> 'OWNER'::public.role) OR (org_id IS NOT NULL)))
);
--> statement-breakpoint


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_id text NOT NULL,
    type text,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);
--> statement-breakpoint


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);
--> statement-breakpoint


--
-- Name: financial_ledger_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_ledger_entries ALTER COLUMN id SET DEFAULT nextval('public.financial_ledger_entries_id_seq'::regclass);
--> statement-breakpoint


--
-- Name: actions actions_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: actions actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: ai_agent_versions ai_agent_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_versions
    ADD CONSTRAINT ai_agent_versions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: ai_agents ai_agents_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agents
    ADD CONSTRAINT ai_agents_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: ai_agents ai_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agents
    ADD CONSTRAINT ai_agents_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: ai_attempts ai_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_attempts
    ADD CONSTRAINT ai_attempts_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: ai_requests ai_requests_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_requests
    ADD CONSTRAINT ai_requests_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: ai_requests ai_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_requests
    ADD CONSTRAINT ai_requests_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: approval_decisions approval_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decisions
    ADD CONSTRAINT approval_decisions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: approvals approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: area_assignments area_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.area_assignments
    ADD CONSTRAINT area_assignments_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: assessment_rounds assessment_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_rounds
    ADD CONSTRAINT assessment_rounds_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: calendar_connections calendar_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: case_assignments case_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_assignments
    ADD CONSTRAINT case_assignments_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: case_escalations case_escalations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_escalations
    ADD CONSTRAINT case_escalations_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: case_message_reads case_message_reads_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_message_reads
    ADD CONSTRAINT case_message_reads_pk PRIMARY KEY (case_id, user_id);
--> statement-breakpoint


--
-- Name: case_messages case_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_messages
    ADD CONSTRAINT case_messages_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: cases cases_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: cases cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: certificates certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: chargebacks chargebacks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chargebacks
    ADD CONSTRAINT chargebacks_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: coaching_sessions coaching_sessions_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: coaching_sessions coaching_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: cohort_configurations cohort_configuration_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_configurations
    ADD CONSTRAINT cohort_configuration_uq UNIQUE (cohort_id, version);
--> statement-breakpoint


--
-- Name: cohort_configurations cohort_configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_configurations
    ADD CONSTRAINT cohort_configurations_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: cohorts cohorts_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohorts
    ADD CONSTRAINT cohorts_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: cohorts cohorts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohorts
    ADD CONSTRAINT cohorts_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: conflict_checks conflict_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conflict_checks
    ADD CONSTRAINT conflict_checks_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: consent_notices consent_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_notices
    ADD CONSTRAINT consent_notices_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: consents consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: content_docs content_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_docs
    ADD CONSTRAINT content_docs_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: content_versions content_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_versions
    ADD CONSTRAINT content_versions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: contract_amendments contract_amendments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_amendments
    ADD CONSTRAINT contract_amendments_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: contracts contracts_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: country_settings country_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country_settings
    ADD CONSTRAINT country_settings_pkey PRIMARY KEY (country_code);
--> statement-breakpoint


--
-- Name: delivery_activities delivery_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_activities
    ADD CONSTRAINT delivery_activities_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: delivery_attendance delivery_attendance_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_attendance
    ADD CONSTRAINT delivery_attendance_pk PRIMARY KEY (session_id, participant_id);
--> statement-breakpoint


--
-- Name: delivery_exceptions delivery_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exceptions
    ADD CONSTRAINT delivery_exceptions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: delivery_milestones delivery_milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_milestones
    ADD CONSTRAINT delivery_milestones_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: delivery_sessions delivery_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_sessions
    ADD CONSTRAINT delivery_sessions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: delivery_tasks delivery_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_tasks
    ADD CONSTRAINT delivery_tasks_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: demographic_profiles demographic_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demographic_profiles
    ADD CONSTRAINT demographic_profiles_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: diagnoses diagnoses_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnoses
    ADD CONSTRAINT diagnoses_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: diagnoses diagnoses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnoses
    ADD CONSTRAINT diagnoses_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: diagnostic_drafts diagnostic_drafts_case_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostic_drafts
    ADD CONSTRAINT diagnostic_drafts_case_id_key UNIQUE (case_id);
--> statement-breakpoint


--
-- Name: diagnostic_drafts diagnostic_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostic_drafts
    ADD CONSTRAINT diagnostic_drafts_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: diagnostics diagnostics_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostics
    ADD CONSTRAINT diagnostics_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: diagnostics diagnostics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostics
    ADD CONSTRAINT diagnostics_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: diagnostics diagnostics_submission_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostics
    ADD CONSTRAINT diagnostics_submission_uuid_unique UNIQUE (submission_uuid);
--> statement-breakpoint


--
-- Name: discount_rules discount_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_rules
    ADD CONSTRAINT discount_rules_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: documents documents_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (key);
--> statement-breakpoint


--
-- Name: engagement_ratings engagement_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_ratings
    ADD CONSTRAINT engagement_ratings_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: evidence evidence_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: evidence evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: financial_accounts financial_accounts_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_accounts
    ADD CONSTRAINT financial_accounts_code_key UNIQUE (code);
--> statement-breakpoint


--
-- Name: financial_accounts financial_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_accounts
    ADD CONSTRAINT financial_accounts_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: financial_ledger_entries financial_ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_ledger_entries
    ADD CONSTRAINT financial_ledger_entries_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: financial_periods financial_periods_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_periods
    ADD CONSTRAINT financial_periods_label_key UNIQUE (label);
--> statement-breakpoint


--
-- Name: financial_periods financial_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_periods
    ADD CONSTRAINT financial_periods_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: framework_dimensions framework_dimension_version_code_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_dimensions
    ADD CONSTRAINT framework_dimension_version_code_uq UNIQUE (framework_version_id, code);
--> statement-breakpoint


--
-- Name: framework_dimensions framework_dimensions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_dimensions
    ADD CONSTRAINT framework_dimensions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: framework_evidence_requirements framework_evidence_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_evidence_requirements
    ADD CONSTRAINT framework_evidence_requirements_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: framework_questions framework_question_version_code_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_questions
    ADD CONSTRAINT framework_question_version_code_uq UNIQUE (framework_version_id, code);
--> statement-breakpoint


--
-- Name: framework_questions framework_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_questions
    ADD CONSTRAINT framework_questions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: framework_readiness_rules framework_readiness_rule_version_code_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_readiness_rules
    ADD CONSTRAINT framework_readiness_rule_version_code_uq UNIQUE (framework_version_id, code);
--> statement-breakpoint


--
-- Name: framework_readiness_rules framework_readiness_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_readiness_rules
    ADD CONSTRAINT framework_readiness_rules_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: framework_scoring_rules framework_scoring_rule_version_code_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_scoring_rules
    ADD CONSTRAINT framework_scoring_rule_version_code_uq UNIQUE (framework_version_id, code);
--> statement-breakpoint


--
-- Name: framework_scoring_rules framework_scoring_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_scoring_rules
    ADD CONSTRAINT framework_scoring_rules_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: framework_source_records framework_source_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_source_records
    ADD CONSTRAINT framework_source_records_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: framework_sub_dimensions framework_sub_dimension_dimension_code_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_sub_dimensions
    ADD CONSTRAINT framework_sub_dimension_dimension_code_uq UNIQUE (dimension_id, code);
--> statement-breakpoint


--
-- Name: framework_sub_dimensions framework_sub_dimensions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_sub_dimensions
    ADD CONSTRAINT framework_sub_dimensions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: framework_versions framework_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_versions
    ADD CONSTRAINT framework_versions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: frameworks frameworks_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.frameworks
    ADD CONSTRAINT frameworks_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: frameworks frameworks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.frameworks
    ADD CONSTRAINT frameworks_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: free_assessment_owners free_assessment_owners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_assessment_owners
    ADD CONSTRAINT free_assessment_owners_pkey PRIMARY KEY (user_id);
--> statement-breakpoint


--
-- Name: free_assessment_results free_assessment_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_assessment_results
    ADD CONSTRAINT free_assessment_results_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: geo_units geo_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_units
    ADD CONSTRAINT geo_units_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: health_scores health_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_scores
    ADD CONSTRAINT health_scores_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: inquiries inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inquiries
    ADD CONSTRAINT inquiries_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: integration_credentials integration_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_credentials
    ADD CONSTRAINT integration_credentials_pkey PRIMARY KEY (integration, field);
--> statement-breakpoint


--
-- Name: interventions interventions_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interventions
    ADD CONSTRAINT interventions_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: interventions interventions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interventions
    ADD CONSTRAINT interventions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: invoices invoices_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: kpi_readings kpi_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_readings
    ADD CONSTRAINT kpi_readings_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: kpis kpis_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis
    ADD CONSTRAINT kpis_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: kpis kpis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis
    ADD CONSTRAINT kpis_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: library_authors library_authors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_authors
    ADD CONSTRAINT library_authors_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: library_items library_items_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_items
    ADD CONSTRAINT library_items_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: library_items library_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_items
    ADD CONSTRAINT library_items_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: library_resources library_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_resources
    ADD CONSTRAINT library_resources_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: library_resources library_resources_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_resources
    ADD CONSTRAINT library_resources_slug_key UNIQUE (slug);
--> statement-breakpoint


--
-- Name: media_assets media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: opportunities opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: opportunity_referral_events opportunity_referral_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_referral_events
    ADD CONSTRAINT opportunity_referral_events_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: opportunity_referrals opportunity_referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_referrals
    ADD CONSTRAINT opportunity_referrals_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: opportunity_sources opportunity_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_sources
    ADD CONSTRAINT opportunity_sources_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: org_members org_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_members
    ADD CONSTRAINT org_members_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: organisations organisations_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: organisations organisations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: outbox_emails outbox_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_emails
    ADD CONSTRAINT outbox_emails_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: outcome_definitions outcome_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_definitions
    ADD CONSTRAINT outcome_definitions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: outcome_records outcome_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_records
    ADD CONSTRAINT outcome_records_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: payments payments_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: payments payments_reference_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_reference_unique UNIQUE (reference);
--> statement-breakpoint


--
-- Name: payout_adjustments payout_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: payout_holds payout_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_holds
    ADD CONSTRAINT payout_holds_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: plans plans_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: promo_redemptions pr_code_customer_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_redemptions
    ADD CONSTRAINT pr_code_customer_uq UNIQUE (promo_code_id, customer_id);
--> statement-breakpoint


--
-- Name: practitioner_conflicts practitioner_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioner_conflicts
    ADD CONSTRAINT practitioner_conflicts_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: practitioner_profiles practitioner_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioner_profiles
    ADD CONSTRAINT practitioner_profiles_pkey PRIMARY KEY (user_id);
--> statement-breakpoint


--
-- Name: prescriptions prescriptions_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: prescriptions prescriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: professional_payouts professional_payouts_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_payouts
    ADD CONSTRAINT professional_payouts_code_key UNIQUE (code);
--> statement-breakpoint


--
-- Name: professional_payouts professional_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_payouts
    ADD CONSTRAINT professional_payouts_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: programme_budget_lines programme_budget_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_budget_lines
    ADD CONSTRAINT programme_budget_lines_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: programme_expenditures programme_expenditures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_expenditures
    ADD CONSTRAINT programme_expenditures_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: programme_indicators programme_indicators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_indicators
    ADD CONSTRAINT programme_indicators_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: programme_participant_people programme_participant_people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_participant_people
    ADD CONSTRAINT programme_participant_people_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: programme_participants programme_participant_programme_org_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_participants
    ADD CONSTRAINT programme_participant_programme_org_uq UNIQUE (programme_id, organisation_id);
--> statement-breakpoint


--
-- Name: programme_participants programme_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_participants
    ADD CONSTRAINT programme_participants_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: programme_tranches programme_tranches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_tranches
    ADD CONSTRAINT programme_tranches_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: programme_versions programme_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_versions
    ADD CONSTRAINT programme_versions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: programme_workspace_configurations programme_workspace_configuration_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspace_configurations
    ADD CONSTRAINT programme_workspace_configuration_uq UNIQUE (workspace_id, version);
--> statement-breakpoint


--
-- Name: programme_workspace_configurations programme_workspace_configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspace_configurations
    ADD CONSTRAINT programme_workspace_configurations_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: programme_workspace_members programme_workspace_member_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspace_members
    ADD CONSTRAINT programme_workspace_member_pk PRIMARY KEY (workspace_id, user_id, role);
--> statement-breakpoint


--
-- Name: programme_workspaces programme_workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspaces
    ADD CONSTRAINT programme_workspaces_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: programme_workspaces programme_workspaces_programme_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspaces
    ADD CONSTRAINT programme_workspaces_programme_id_key UNIQUE (programme_id);
--> statement-breakpoint


--
-- Name: programmes programmes_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programmes
    ADD CONSTRAINT programmes_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: programmes programmes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programmes
    ADD CONSTRAINT programmes_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: promo_campaigns promo_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_campaigns
    ADD CONSTRAINT promo_campaigns_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: promo_codes promo_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_codes
    ADD CONSTRAINT promo_codes_code_key UNIQUE (code);
--> statement-breakpoint


--
-- Name: promo_codes promo_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_codes
    ADD CONSTRAINT promo_codes_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: promo_redemptions promo_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_redemptions
    ADD CONSTRAINT promo_redemptions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: provider_assignments provider_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_assignments
    ADD CONSTRAINT provider_assignments_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: provider_capacities provider_capacities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_capacities
    ADD CONSTRAINT provider_capacities_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: provider_capacities provider_capacity_scope_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_capacities
    ADD CONSTRAINT provider_capacity_scope_uq UNIQUE (workspace_id, provider_user_id, provider_role);
--> statement-breakpoint


--
-- Name: public_assessments public_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_assessments
    ADD CONSTRAINT public_assessments_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: questions questions_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key);
--> statement-breakpoint


--
-- Name: refunds refunds_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_code_key UNIQUE (code);
--> statement-breakpoint


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: registration_answers registration_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registration_answers
    ADD CONSTRAINT registration_answers_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: registration_answers registration_answers_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registration_answers
    ADD CONSTRAINT registration_answers_user_id_unique UNIQUE (user_id);
--> statement-breakpoint


--
-- Name: reports reports_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: resource_entitlements resource_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_entitlements
    ADD CONSTRAINT resource_entitlements_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: resource_payments resource_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_payments
    ADD CONSTRAINT resource_payments_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: resource_payments resource_payments_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_payments
    ADD CONSTRAINT resource_payments_reference_key UNIQUE (reference);
--> statement-breakpoint


--
-- Name: response_drafts response_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_drafts
    ADD CONSTRAINT response_drafts_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: responses responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: revenue_share_agreements revenue_share_agreements_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_agreements
    ADD CONSTRAINT revenue_share_agreements_code_key UNIQUE (code);
--> statement-breakpoint


--
-- Name: revenue_share_agreements revenue_share_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_agreements
    ADD CONSTRAINT revenue_share_agreements_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: revenue_share_allocations revenue_share_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_allocations
    ADD CONSTRAINT revenue_share_allocations_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: revenue_share_calculations revenue_share_calculations_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_calculations
    ADD CONSTRAINT revenue_share_calculations_code_key UNIQUE (code);
--> statement-breakpoint


--
-- Name: revenue_share_calculations revenue_share_calculations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_calculations
    ADD CONSTRAINT revenue_share_calculations_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: risks risks_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risks
    ADD CONSTRAINT risks_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: risks risks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risks
    ADD CONSTRAINT risks_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: role_grants role_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_grants
    ADD CONSTRAINT role_grants_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: role_mappings role_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_mappings
    ADD CONSTRAINT role_mappings_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: rules rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rules
    ADD CONSTRAINT rules_pkey PRIMARY KEY (key);
--> statement-breakpoint


--
-- Name: scout_runs scout_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scout_runs
    ADD CONSTRAINT scout_runs_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: tax_lines tax_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_lines
    ADD CONSTRAINT tax_lines_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: tax_rules tax_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rules
    ADD CONSTRAINT tax_rules_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: user_programmes user_programmes_user_id_programme_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_programmes
    ADD CONSTRAINT user_programmes_user_id_programme_id_pk PRIMARY KEY (user_id, programme_id);
--> statement-breakpoint


--
-- Name: user_tokens user_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tokens
    ADD CONSTRAINT user_tokens_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: user_tokens user_tokens_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tokens
    ADD CONSTRAINT user_tokens_token_hash_unique UNIQUE (token_hash);
--> statement-breakpoint


--
-- Name: users users_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_code_unique UNIQUE (code);
--> statement-breakpoint


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);
--> statement-breakpoint


--
-- Name: act_assignee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX act_assignee_idx ON public.actions USING btree (assignee_id);
--> statement-breakpoint


--
-- Name: act_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX act_case_idx ON public.actions USING btree (case_id);
--> statement-breakpoint


--
-- Name: act_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX act_due_idx ON public.actions USING btree (due_date);
--> statement-breakpoint


--
-- Name: ad_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ad_request_idx ON public.approval_decisions USING btree (request_id);
--> statement-breakpoint


--
-- Name: ai_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_agent_idx ON public.ai_requests USING btree (agent_id, created_at);
--> statement-breakpoint


--
-- Name: ai_agent_version_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_agent_version_uq ON public.ai_agent_versions USING btree (agent_id, version);
--> statement-breakpoint


--
-- Name: ai_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_case_idx ON public.ai_requests USING btree (case_id);
--> statement-breakpoint


--
-- Name: amend_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amend_contract_idx ON public.contract_amendments USING btree (contract_id, created_at);
--> statement-breakpoint


--
-- Name: approvals_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_case_idx ON public.approvals USING btree (case_id);
--> statement-breakpoint


--
-- Name: apr_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX apr_record_idx ON public.approvals USING btree (record_type, record_id);
--> statement-breakpoint


--
-- Name: ar_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ar_action_idx ON public.approval_requests USING btree (action_type, reference_id);
--> statement-breakpoint


--
-- Name: ar_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ar_status_idx ON public.approval_requests USING btree (status);
--> statement-breakpoint


--
-- Name: area_assignment_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX area_assignment_uq ON public.area_assignments USING btree (org_id, platform, sub_dimension);
--> statement-breakpoint


--
-- Name: audit_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_actor_idx ON public.audit_log USING btree (actor_id);
--> statement-breakpoint


--
-- Name: audit_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_at_idx ON public.audit_log USING btree (at);
--> statement-breakpoint


--
-- Name: audit_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_case_idx ON public.audit_log USING btree (case_id);
--> statement-breakpoint


--
-- Name: audit_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_entity_idx ON public.audit_log USING btree (entity, entity_id);
--> statement-breakpoint


--
-- Name: ca_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ca_case_idx ON public.case_assignments USING btree (case_id);
--> statement-breakpoint


--
-- Name: ca_single_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ca_single_uq ON public.case_assignments USING btree (case_id, function) WHERE ((status = 'Active'::text) AND (function <> 'specialist'::text));
--> statement-breakpoint


--
-- Name: ca_specialist_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ca_specialist_uq ON public.case_assignments USING btree (case_id, user_id) WHERE ((status = 'Active'::text) AND (function = 'specialist'::text));
--> statement-breakpoint


--
-- Name: ca_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ca_user_idx ON public.case_assignments USING btree (user_id, status);
--> statement-breakpoint


--
-- Name: calendar_connection_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_connection_status_idx ON public.calendar_connections USING btree (status);
--> statement-breakpoint


--
-- Name: calendar_connection_user_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX calendar_connection_user_provider_idx ON public.calendar_connections USING btree (user_id, provider);
--> statement-breakpoint


--
-- Name: calendar_event_cohort_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_event_cohort_time_idx ON public.calendar_events USING btree (cohort_id, starts_at);
--> statement-breakpoint


--
-- Name: calendar_event_connection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_event_connection_idx ON public.calendar_events USING btree (connection_id);
--> statement-breakpoint


--
-- Name: calendar_event_external_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_event_external_idx ON public.calendar_events USING btree (provider, external_event_id);
--> statement-breakpoint


--
-- Name: calendar_event_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_event_session_idx ON public.calendar_events USING btree (session_id);
--> statement-breakpoint


--
-- Name: case_coach_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX case_coach_idx ON public.cases USING btree (coach_id);
--> statement-breakpoint


--
-- Name: case_consultant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX case_consultant_idx ON public.cases USING btree (consultant_id);
--> statement-breakpoint


--
-- Name: case_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX case_org_idx ON public.cases USING btree (org_id);
--> statement-breakpoint


--
-- Name: case_prog_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX case_prog_idx ON public.cases USING btree (programme_id);
--> statement-breakpoint


--
-- Name: case_reviewer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX case_reviewer_idx ON public.cases USING btree (reviewer_id);
--> statement-breakpoint


--
-- Name: case_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX case_status_idx ON public.cases USING btree (status);
--> statement-breakpoint


--
-- Name: cases_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cases_cohort_idx ON public.cases USING btree (cohort_id);
--> statement-breakpoint


--
-- Name: cb_payment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cb_payment_idx ON public.chargebacks USING btree (payment_id);
--> statement-breakpoint


--
-- Name: cc_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cc_reference_idx ON public.conflict_checks USING btree (context_type, reference_id);
--> statement-breakpoint


--
-- Name: cc_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cc_user_idx ON public.conflict_checks USING btree (user_id);
--> statement-breakpoint


--
-- Name: cert_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cert_case_idx ON public.certificates USING btree (case_id, proposed_at);
--> statement-breakpoint


--
-- Name: cert_one_open_per_case; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cert_one_open_per_case ON public.certificates USING btree (case_id) WHERE (status = 'Proposed'::text);
--> statement-breakpoint


--
-- Name: cert_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cert_org_idx ON public.certificates USING btree (org_id);
--> statement-breakpoint


--
-- Name: cohort_configuration_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cohort_configuration_cohort_idx ON public.cohort_configurations USING btree (cohort_id, version);
--> statement-breakpoint


--
-- Name: cohort_configuration_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cohort_configuration_status_idx ON public.cohort_configurations USING btree (cohort_id, status);
--> statement-breakpoint


--
-- Name: cohort_prog_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cohort_prog_idx ON public.cohorts USING btree (programme_id);
--> statement-breakpoint


--
-- Name: con_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX con_org_idx ON public.contracts USING btree (org_id);
--> statement-breakpoint


--
-- Name: con_renewal_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX con_renewal_uq ON public.contracts USING btree (renewal_of) WHERE (renewal_of IS NOT NULL);
--> statement-breakpoint


--
-- Name: consent_notice_one_published; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX consent_notice_one_published ON public.consent_notices USING btree (purpose, country_code) WHERE (status = 'Published'::text);
--> statement-breakpoint


--
-- Name: consent_notice_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX consent_notice_uq ON public.consent_notices USING btree (purpose, country_code, version);
--> statement-breakpoint


--
-- Name: consent_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_user_idx ON public.consents USING btree (user_id, at);
--> statement-breakpoint


--
-- Name: content_docs_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_docs_kind_idx ON public.content_docs USING btree (kind, status);
--> statement-breakpoint


--
-- Name: content_docs_kind_key_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX content_docs_kind_key_uq ON public.content_docs USING btree (kind, key);
--> statement-breakpoint


--
-- Name: content_versions_doc_ver_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX content_versions_doc_ver_uq ON public.content_versions USING btree (doc_id, version);
--> statement-breakpoint


--
-- Name: contracts_status_end_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contracts_status_end_idx ON public.contracts USING btree (status, end_date);
--> statement-breakpoint


--
-- Name: delivery_activity_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_activity_cohort_idx ON public.delivery_activities USING btree (cohort_id, sequence);
--> statement-breakpoint


--
-- Name: delivery_activity_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_activity_status_idx ON public.delivery_activities USING btree (status);
--> statement-breakpoint


--
-- Name: delivery_attendance_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_attendance_participant_idx ON public.delivery_attendance USING btree (participant_id);
--> statement-breakpoint


--
-- Name: delivery_exception_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_exception_cohort_idx ON public.delivery_exceptions USING btree (cohort_id, status, severity);
--> statement-breakpoint


--
-- Name: delivery_exception_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_exception_owner_idx ON public.delivery_exceptions USING btree (owner_user_id, status);
--> statement-breakpoint


--
-- Name: delivery_milestone_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_milestone_cohort_idx ON public.delivery_milestones USING btree (cohort_id, due_at);
--> statement-breakpoint


--
-- Name: delivery_session_activity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_session_activity_idx ON public.delivery_sessions USING btree (activity_id, starts_at);
--> statement-breakpoint


--
-- Name: delivery_session_facilitator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_session_facilitator_idx ON public.delivery_sessions USING btree (facilitator_user_id, starts_at);
--> statement-breakpoint


--
-- Name: delivery_task_assignee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_task_assignee_idx ON public.delivery_tasks USING btree (assigned_to, status);
--> statement-breakpoint


--
-- Name: delivery_task_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_task_cohort_idx ON public.delivery_tasks USING btree (cohort_id, status, due_at);
--> statement-breakpoint


--
-- Name: demographic_subject_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX demographic_subject_uq ON public.demographic_profiles USING btree (subject_type, subject_id, category);
--> statement-breakpoint


--
-- Name: dgn_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dgn_case_idx ON public.diagnoses USING btree (case_id);
--> statement-breakpoint


--
-- Name: diag_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX diag_case_idx ON public.diagnostics USING btree (case_id);
--> statement-breakpoint


--
-- Name: diagnoses_diagnostic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX diagnoses_diagnostic_idx ON public.diagnoses USING btree (diagnostic_id);
--> statement-breakpoint


--
-- Name: doc_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX doc_case_idx ON public.documents USING btree (case_id);
--> statement-breakpoint


--
-- Name: doc_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX doc_org_idx ON public.documents USING btree (org_id);
--> statement-breakpoint


--
-- Name: doc_uploader_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX doc_uploader_idx ON public.documents USING btree (org_id, uploaded_by);
--> statement-breakpoint


--
-- Name: draft_round_question_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX draft_round_question_uq ON public.response_drafts USING btree (round_id, question_code);
--> statement-breakpoint


--
-- Name: er_assignment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX er_assignment_idx ON public.engagement_ratings USING btree (assignment_id);
--> statement-breakpoint


--
-- Name: esc_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX esc_case_idx ON public.case_escalations USING btree (case_id);
--> statement-breakpoint


--
-- Name: esc_open_case_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX esc_open_case_uq ON public.case_escalations USING btree (kind, case_id) WHERE ((resolved_at IS NULL) AND (ref_id IS NULL));
--> statement-breakpoint


--
-- Name: esc_open_ref_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX esc_open_ref_uq ON public.case_escalations USING btree (kind, ref_id) WHERE ((resolved_at IS NULL) AND (ref_id IS NOT NULL));
--> statement-breakpoint


--
-- Name: ev_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ev_case_idx ON public.evidence USING btree (case_id);
--> statement-breakpoint


--
-- Name: evidence_response_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evidence_response_idx ON public.evidence USING btree (response_id);
--> statement-breakpoint


--
-- Name: evt_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evt_case_idx ON public.events USING btree (case_id);
--> statement-breakpoint


--
-- Name: evt_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evt_created_idx ON public.events USING btree (created_at);
--> statement-breakpoint


--
-- Name: evt_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evt_type_idx ON public.events USING btree (type);
--> statement-breakpoint


--
-- Name: feedback_result_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX feedback_result_uq ON public.feedback USING btree (user_id, health_score_id) WHERE (kind = 'result'::text);
--> statement-breakpoint


--
-- Name: feedback_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_status_idx ON public.feedback USING btree (status, created_at);
--> statement-breakpoint


--
-- Name: fle_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fle_account_idx ON public.financial_ledger_entries USING btree (account_id);
--> statement-breakpoint


--
-- Name: fle_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fle_period_idx ON public.financial_ledger_entries USING btree (period_id);
--> statement-breakpoint


--
-- Name: fle_reference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fle_reference_idx ON public.financial_ledger_entries USING btree (reference_type, reference_id);
--> statement-breakpoint


--
-- Name: framework_dimension_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX framework_dimension_version_idx ON public.framework_dimensions USING btree (framework_version_id, sort_order);
--> statement-breakpoint


--
-- Name: framework_evidence_question_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX framework_evidence_question_idx ON public.framework_evidence_requirements USING btree (question_id);
--> statement-breakpoint


--
-- Name: framework_question_dimension_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX framework_question_dimension_idx ON public.framework_questions USING btree (dimension_id, sort_order);
--> statement-breakpoint


--
-- Name: framework_question_sub_dimension_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX framework_question_sub_dimension_idx ON public.framework_questions USING btree (sub_dimension_id);
--> statement-breakpoint


--
-- Name: framework_readiness_rule_version_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX framework_readiness_rule_version_priority_idx ON public.framework_readiness_rules USING btree (framework_version_id, priority);
--> statement-breakpoint


--
-- Name: framework_scoring_rule_version_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX framework_scoring_rule_version_priority_idx ON public.framework_scoring_rules USING btree (framework_version_id, priority);
--> statement-breakpoint


--
-- Name: framework_source_component_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX framework_source_component_idx ON public.framework_source_records USING btree (component_type, component_code);
--> statement-breakpoint


--
-- Name: framework_source_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX framework_source_version_idx ON public.framework_source_records USING btree (framework_version_id);
--> statement-breakpoint


--
-- Name: framework_sub_dimension_dimension_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX framework_sub_dimension_dimension_idx ON public.framework_sub_dimensions USING btree (dimension_id, sort_order);
--> statement-breakpoint


--
-- Name: framework_version_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX framework_version_uq ON public.framework_versions USING btree (framework_id, version);
--> statement-breakpoint


--
-- Name: free_assessment_results_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX free_assessment_results_created_at_idx ON public.free_assessment_results USING btree (created_at);
--> statement-breakpoint


--
-- Name: free_assessment_results_email_platform_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX free_assessment_results_email_platform_uq ON public.free_assessment_results USING btree (lower(btrim(email)), platform);
--> statement-breakpoint


--
-- Name: free_assessment_results_matched_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX free_assessment_results_matched_org_idx ON public.free_assessment_results USING btree (matched_org_id) WHERE (matched_org_id IS NOT NULL);
--> statement-breakpoint


--
-- Name: geo_country_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX geo_country_level_idx ON public.geo_units USING btree (country_code, level);
--> statement-breakpoint


--
-- Name: geo_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX geo_parent_idx ON public.geo_units USING btree (parent_id);
--> statement-breakpoint


--
-- Name: geo_unique_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX geo_unique_name ON public.geo_units USING btree (country_code, level, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
--> statement-breakpoint


--
-- Name: health_scores_case_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX health_scores_case_created_idx ON public.health_scores USING btree (case_id, created_at);
--> statement-breakpoint


--
-- Name: ind_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ind_name_uq ON public.programme_indicators USING btree (programme_id, name);
--> statement-breakpoint


--
-- Name: inquiries_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inquiries_status_idx ON public.inquiries USING btree (status, created_at);
--> statement-breakpoint


--
-- Name: inv_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inv_org_idx ON public.invoices USING btree (org_id);
--> statement-breakpoint


--
-- Name: inv_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inv_status_idx ON public.invoices USING btree (status);
--> statement-breakpoint


--
-- Name: invoices_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_contract_idx ON public.invoices USING btree (contract_id);
--> statement-breakpoint


--
-- Name: iv_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX iv_case_idx ON public.interventions USING btree (case_id);
--> statement-breakpoint


--
-- Name: jobs_pick_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_pick_idx ON public.jobs USING btree (status, run_at);
--> statement-breakpoint


--
-- Name: kpi_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kpi_case_idx ON public.kpis USING btree (case_id);
--> statement-breakpoint


--
-- Name: kpi_readings_kpi_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kpi_readings_kpi_date_idx ON public.kpi_readings USING btree (kpi_id, reading_date);
--> statement-breakpoint


--
-- Name: kr_kpi_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kr_kpi_idx ON public.kpi_readings USING btree (kpi_id);
--> statement-breakpoint


--
-- Name: lib_res_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lib_res_author_idx ON public.library_resources USING btree (author_id);
--> statement-breakpoint


--
-- Name: lib_res_dimension_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lib_res_dimension_idx ON public.library_resources USING btree (dimension);
--> statement-breakpoint


--
-- Name: lib_res_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lib_res_status_idx ON public.library_resources USING btree (status);
--> statement-breakpoint


--
-- Name: media_assets_cat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_assets_cat_idx ON public.media_assets USING btree (category, created_at);
--> statement-breakpoint


--
-- Name: msg_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX msg_case_idx ON public.case_messages USING btree (case_id, created_at);
--> statement-breakpoint


--
-- Name: notif_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notif_user_idx ON public.notifications USING btree (user_id, read_at);
--> statement-breakpoint


--
-- Name: opp_source_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX opp_source_uq ON public.opportunities USING btree (source, source_ref) WHERE (source_ref IS NOT NULL);
--> statement-breakpoint


--
-- Name: opp_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opp_status_idx ON public.opportunities USING btree (status, deadline);
--> statement-breakpoint


--
-- Name: ops_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ops_due_idx ON public.opportunity_sources USING btree (active, last_run_at);
--> statement-breakpoint


--
-- Name: org_member_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX org_member_uq ON public.org_members USING btree (org_id, user_id);
--> statement-breakpoint


--
-- Name: org_member_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX org_member_user_idx ON public.org_members USING btree (user_id);
--> statement-breakpoint


--
-- Name: org_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX org_name_idx ON public.organisations USING btree (name);
--> statement-breakpoint


--
-- Name: org_name_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX org_name_lower_idx ON public.organisations USING btree (lower(name));
--> statement-breakpoint


--
-- Name: org_region_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX org_region_idx ON public.organisations USING btree (region);
--> statement-breakpoint


--
-- Name: org_tin_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX org_tin_uq ON public.organisations USING btree (lower(tin)) WHERE ((tin IS NOT NULL) AND (deleted_at IS NULL));
--> statement-breakpoint


--
-- Name: outcome_def_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outcome_def_name_uq ON public.outcome_definitions USING btree (programme_id, name);
--> statement-breakpoint


--
-- Name: outcome_rec_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outcome_rec_case_idx ON public.outcome_records USING btree (case_id);
--> statement-breakpoint


--
-- Name: outcome_rec_def_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outcome_rec_def_idx ON public.outcome_records USING btree (definition_id);
--> statement-breakpoint


--
-- Name: outcome_rec_supersedes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outcome_rec_supersedes_idx ON public.outcome_records USING btree (supersedes_id);
--> statement-breakpoint


--
-- Name: pa_payout_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pa_payout_idx ON public.payout_adjustments USING btree (payout_id);
--> statement-breakpoint


--
-- Name: participant_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participant_name_idx ON public.participants USING btree (full_name);
--> statement-breakpoint


--
-- Name: participant_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participant_phone_idx ON public.participants USING btree (phone);
--> statement-breakpoint


--
-- Name: pay_inv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pay_inv_idx ON public.payments USING btree (invoice_id);
--> statement-breakpoint


--
-- Name: payments_one_success_per_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payments_one_success_per_invoice ON public.payments USING btree (invoice_id) WHERE (status = 'Succeeded'::text);
--> statement-breakpoint


--
-- Name: pbl_cat_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pbl_cat_uq ON public.programme_budget_lines USING btree (programme_id, category);
--> statement-breakpoint


--
-- Name: pc_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pc_campaign_idx ON public.promo_codes USING btree (campaign_id);
--> statement-breakpoint


--
-- Name: pc_user_org_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pc_user_org_uq ON public.practitioner_conflicts USING btree (user_id, org_id);
--> statement-breakpoint


--
-- Name: ph_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ph_open_idx ON public.payout_holds USING btree (payout_id) WHERE (resolved_at IS NULL);
--> statement-breakpoint


--
-- Name: ph_payout_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ph_payout_idx ON public.payout_holds USING btree (payout_id);
--> statement-breakpoint


--
-- Name: pp_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pp_status_idx ON public.practitioner_profiles USING btree (vetting_status);
--> statement-breakpoint


--
-- Name: prog_exp_budget_line_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prog_exp_budget_line_idx ON public.programme_expenditures USING btree (budget_line_id);
--> statement-breakpoint


--
-- Name: prog_exp_programme_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prog_exp_programme_idx ON public.programme_expenditures USING btree (programme_id);
--> statement-breakpoint


--
-- Name: prog_exp_reference_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prog_exp_reference_uq ON public.programme_expenditures USING btree (programme_id, reference) WHERE (reference IS NOT NULL);
--> statement-breakpoint


--
-- Name: prog_exp_reversal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prog_exp_reversal_idx ON public.programme_expenditures USING btree (reversal_of_id);
--> statement-breakpoint


--
-- Name: prog_exp_settles_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prog_exp_settles_idx ON public.programme_expenditures USING btree (settles_commitment_id);
--> statement-breakpoint


--
-- Name: programme_participant_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX programme_participant_cohort_idx ON public.programme_participants USING btree (cohort_id);
--> statement-breakpoint


--
-- Name: programme_participant_people_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX programme_participant_people_participant_idx ON public.programme_participant_people USING btree (participant_id);
--> statement-breakpoint


--
-- Name: programme_participant_people_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX programme_participant_people_uq ON public.programme_participant_people USING btree (programme_participant_id, participant_id);
--> statement-breakpoint


--
-- Name: programme_participant_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX programme_participant_status_idx ON public.programme_participants USING btree (status);
--> statement-breakpoint


--
-- Name: programme_participant_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX programme_participant_workspace_idx ON public.programme_participants USING btree (workspace_id);
--> statement-breakpoint


--
-- Name: programme_version_programme_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX programme_version_programme_idx ON public.programme_versions USING btree (programme_id, status);
--> statement-breakpoint


--
-- Name: programme_version_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX programme_version_uq ON public.programme_versions USING btree (programme_id, version);
--> statement-breakpoint


--
-- Name: programme_workspace_configuration_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX programme_workspace_configuration_status_idx ON public.programme_workspace_configurations USING btree (workspace_id, status);
--> statement-breakpoint


--
-- Name: programme_workspace_configuration_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX programme_workspace_configuration_workspace_idx ON public.programme_workspace_configurations USING btree (workspace_id, version);
--> statement-breakpoint


--
-- Name: programme_workspace_member_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX programme_workspace_member_user_idx ON public.programme_workspace_members USING btree (user_id);
--> statement-breakpoint


--
-- Name: programme_workspace_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX programme_workspace_status_idx ON public.programme_workspaces USING btree (status);
--> statement-breakpoint


--
-- Name: provider_assignment_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_assignment_cohort_idx ON public.provider_assignments USING btree (cohort_id, status);
--> statement-breakpoint


--
-- Name: provider_assignment_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_assignment_provider_idx ON public.provider_assignments USING btree (provider_user_id, status);
--> statement-breakpoint


--
-- Name: provider_assignment_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_assignment_workspace_idx ON public.provider_assignments USING btree (workspace_id, status);
--> statement-breakpoint


--
-- Name: provider_capacity_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_capacity_provider_idx ON public.provider_capacities USING btree (provider_user_id, availability);
--> statement-breakpoint


--
-- Name: ptr_label_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ptr_label_uq ON public.programme_tranches USING btree (programme_id, label);
--> statement-breakpoint


--
-- Name: public_assessments_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_assessments_email_idx ON public.public_assessments USING btree (normalised_email, platform);
--> statement-breakpoint


--
-- Name: public_assessments_one_completed_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX public_assessments_one_completed_uq ON public.public_assessments USING btree (normalised_email, platform) WHERE (status = 'Completed'::text);
--> statement-breakpoint


--
-- Name: pyo_calculation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pyo_calculation_idx ON public.professional_payouts USING btree (calculation_id);
--> statement-breakpoint


--
-- Name: pyo_professional_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pyo_professional_idx ON public.professional_payouts USING btree (professional_id, status);
--> statement-breakpoint


--
-- Name: ref_live_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ref_live_uq ON public.opportunity_referrals USING btree (org_id, opportunity_id) WHERE (status <> ALL (ARRAY['Declined'::text, 'Withdrawn'::text]));
--> statement-breakpoint


--
-- Name: ref_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_org_idx ON public.opportunity_referrals USING btree (org_id);
--> statement-breakpoint


--
-- Name: ref_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ref_status_idx ON public.opportunity_referrals USING btree (status);
--> statement-breakpoint


--
-- Name: refev_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refev_idx ON public.opportunity_referral_events USING btree (referral_id, created_at);
--> statement-breakpoint


--
-- Name: rep_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rep_case_idx ON public.reports USING btree (case_id);
--> statement-breakpoint


--
-- Name: res_ent_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX res_ent_resource_idx ON public.resource_entitlements USING btree (resource_id);
--> statement-breakpoint


--
-- Name: res_ent_user_res_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX res_ent_user_res_uq ON public.resource_entitlements USING btree (user_id, resource_id);
--> statement-breakpoint


--
-- Name: res_pay_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX res_pay_resource_idx ON public.resource_payments USING btree (resource_id);
--> statement-breakpoint


--
-- Name: res_pay_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX res_pay_user_idx ON public.resource_payments USING btree (user_id);
--> statement-breakpoint


--
-- Name: resp_diag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resp_diag_idx ON public.responses USING btree (diagnostic_id);
--> statement-breakpoint


--
-- Name: rf_payment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rf_payment_idx ON public.refunds USING btree (payment_id);
--> statement-breakpoint


--
-- Name: risk_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX risk_case_idx ON public.risks USING btree (case_id);
--> statement-breakpoint


--
-- Name: role_grants_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_grants_status_idx ON public.role_grants USING btree (status);
--> statement-breakpoint


--
-- Name: role_grants_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX role_grants_user_idx ON public.role_grants USING btree (user_id);
--> statement-breakpoint


--
-- Name: role_grants_user_role_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX role_grants_user_role_uq ON public.role_grants USING btree (user_id, role);
--> statement-breakpoint


--
-- Name: role_mapping_one_published; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX role_mapping_one_published ON public.role_mappings USING btree (framework_code) WHERE (status = 'Published'::text);
--> statement-breakpoint


--
-- Name: role_mapping_version_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX role_mapping_version_uq ON public.role_mappings USING btree (framework_code, version);
--> statement-breakpoint


--
-- Name: round_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX round_case_idx ON public.assessment_rounds USING btree (case_id);
--> statement-breakpoint


--
-- Name: round_one_open_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX round_one_open_uq ON public.assessment_rounds USING btree (case_id) WHERE (status = 'Collecting'::text);
--> statement-breakpoint


--
-- Name: rsa_assignment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rsa_assignment_idx ON public.revenue_share_agreements USING btree (assignment_id);
--> statement-breakpoint


--
-- Name: rsa_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rsa_contract_idx ON public.revenue_share_agreements USING btree (contract_id);
--> statement-breakpoint


--
-- Name: rsa_professional_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rsa_professional_idx ON public.revenue_share_agreements USING btree (professional_id);
--> statement-breakpoint


--
-- Name: rsal_agreement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rsal_agreement_idx ON public.revenue_share_allocations USING btree (agreement_id);
--> statement-breakpoint


--
-- Name: rscalc_agreement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rscalc_agreement_idx ON public.revenue_share_calculations USING btree (agreement_id);
--> statement-breakpoint


--
-- Name: rscalc_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rscalc_invoice_idx ON public.revenue_share_calculations USING btree (invoice_id);
--> statement-breakpoint


--
-- Name: rx_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rx_case_idx ON public.prescriptions USING btree (case_id);
--> statement-breakpoint


--
-- Name: score_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX score_case_idx ON public.health_scores USING btree (case_id);
--> statement-breakpoint


--
-- Name: scout_runs_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scout_runs_started_idx ON public.scout_runs USING btree (started_at);
--> statement-breakpoint


--
-- Name: sess_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sess_case_idx ON public.coaching_sessions USING btree (case_id);
--> statement-breakpoint


--
-- Name: sess_reminder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sess_reminder_idx ON public.coaching_sessions USING btree (scheduled_at) WHERE ((status = 'Scheduled'::text) AND (reminder_sent_at IS NULL));
--> statement-breakpoint


--
-- Name: sessions_exp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_exp_idx ON public.sessions USING btree (expires_at);
--> statement-breakpoint


--
-- Name: sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id);
--> statement-breakpoint


--
-- Name: tl_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tl_invoice_idx ON public.tax_lines USING btree (invoice_id);
--> statement-breakpoint


--
-- Name: tl_payout_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tl_payout_idx ON public.tax_lines USING btree (payout_id);
--> statement-breakpoint


--
-- Name: tr_type_jurisdiction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tr_type_jurisdiction_idx ON public.tax_rules USING btree (type, jurisdiction);
--> statement-breakpoint


--
-- Name: users_email_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_uq ON public.users USING btree (lower(email));
--> statement-breakpoint


--
-- Name: users_google_sub_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_google_sub_uq ON public.users USING btree (google_sub);
--> statement-breakpoint


--
-- Name: users_name_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_name_lower_idx ON public.users USING btree (lower(name));
--> statement-breakpoint


--
-- Name: users_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_org_idx ON public.users USING btree (org_id);
--> statement-breakpoint


--
-- Name: users_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_role_idx ON public.users USING btree (role);
--> statement-breakpoint


--
-- Name: webhook_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX webhook_uq ON public.webhook_events USING btree (provider, event_id);
--> statement-breakpoint


--
-- Name: ai_agent_versions ai_agent_versions_frozen; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_agent_versions_frozen BEFORE UPDATE ON public.ai_agent_versions FOR EACH ROW EXECUTE FUNCTION public.ai_agent_versions_guard();
--> statement-breakpoint


--
-- Name: ai_agent_versions ai_agent_versions_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_agent_versions_no_delete BEFORE DELETE ON public.ai_agent_versions FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: ai_attempts ai_attempts_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ai_attempts_append_only BEFORE DELETE OR UPDATE ON public.ai_attempts FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: approval_decisions approval_decisions_four_eyes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER approval_decisions_four_eyes BEFORE INSERT ON public.approval_decisions FOR EACH ROW EXECUTE FUNCTION public.reject_self_approval();
--> statement-breakpoint


--
-- Name: approvals approvals_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER approvals_append_only BEFORE DELETE OR UPDATE ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: audit_log audit_log_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_log_append_only BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: case_messages case_messages_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER case_messages_immutable BEFORE UPDATE ON public.case_messages FOR EACH ROW EXECUTE FUNCTION public.case_messages_no_update();
--> statement-breakpoint


--
-- Name: certificates certificates_guard_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER certificates_guard_trg BEFORE UPDATE ON public.certificates FOR EACH ROW EXECUTE FUNCTION public.certificates_guard();
--> statement-breakpoint


--
-- Name: certificates certificates_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER certificates_no_delete BEFORE DELETE ON public.certificates FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: consents consents_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER consents_append_only BEFORE DELETE OR UPDATE ON public.consents FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: contract_amendments contract_amendments_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contract_amendments_immutable BEFORE DELETE OR UPDATE ON public.contract_amendments FOR EACH ROW EXECUTE FUNCTION public.contract_amendments_append_only();
--> statement-breakpoint


--
-- Name: demographic_profiles demographic_consent_guard_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER demographic_consent_guard_trg BEFORE INSERT OR UPDATE ON public.demographic_profiles FOR EACH ROW EXECUTE FUNCTION public.demographic_consent_guard();
--> statement-breakpoint


--
-- Name: diagnoses diagnoses_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER diagnoses_guard BEFORE DELETE OR UPDATE ON public.diagnoses FOR EACH ROW EXECUTE FUNCTION public.guard_workflow_row('status');
--> statement-breakpoint


--
-- Name: diagnostics diagnostics_versioned; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER diagnostics_versioned BEFORE DELETE OR UPDATE ON public.diagnostics FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: engagement_ratings engagement_ratings_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER engagement_ratings_guard BEFORE DELETE OR UPDATE ON public.engagement_ratings FOR EACH ROW EXECUTE FUNCTION public.engagement_ratings_immutable();
--> statement-breakpoint


--
-- Name: events events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_append_only BEFORE DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: financial_ledger_entries financial_ledger_entries_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER financial_ledger_entries_immutable BEFORE DELETE OR UPDATE ON public.financial_ledger_entries FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_change();
--> statement-breakpoint


--
-- Name: financial_ledger_entries financial_ledger_entries_period_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER financial_ledger_entries_period_guard BEFORE INSERT ON public.financial_ledger_entries FOR EACH ROW EXECUTE FUNCTION public.reject_entry_into_closed_period();
--> statement-breakpoint


--
-- Name: framework_dimensions framework_dimensions_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER framework_dimensions_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.framework_dimensions FOR EACH ROW EXECUTE FUNCTION public.reject_published_framework_change();
--> statement-breakpoint


--
-- Name: framework_evidence_requirements framework_evidence_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER framework_evidence_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.framework_evidence_requirements FOR EACH ROW EXECUTE FUNCTION public.reject_published_framework_change();
--> statement-breakpoint


--
-- Name: framework_questions framework_questions_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER framework_questions_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.framework_questions FOR EACH ROW EXECUTE FUNCTION public.reject_published_framework_change();
--> statement-breakpoint


--
-- Name: framework_readiness_rules framework_readiness_rules_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER framework_readiness_rules_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.framework_readiness_rules FOR EACH ROW EXECUTE FUNCTION public.reject_published_framework_change();
--> statement-breakpoint


--
-- Name: framework_scoring_rules framework_scoring_rules_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER framework_scoring_rules_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.framework_scoring_rules FOR EACH ROW EXECUTE FUNCTION public.reject_published_framework_change();
--> statement-breakpoint


--
-- Name: framework_source_records framework_sources_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER framework_sources_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.framework_source_records FOR EACH ROW EXECUTE FUNCTION public.reject_published_framework_change();
--> statement-breakpoint


--
-- Name: framework_sub_dimensions framework_sub_dimensions_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER framework_sub_dimensions_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.framework_sub_dimensions FOR EACH ROW EXECUTE FUNCTION public.reject_published_framework_change();
--> statement-breakpoint


--
-- Name: framework_versions framework_versions_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER framework_versions_guard BEFORE UPDATE ON public.framework_versions FOR EACH ROW EXECUTE FUNCTION public.framework_versions_guard();
--> statement-breakpoint


--
-- Name: framework_versions framework_versions_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER framework_versions_no_delete BEFORE DELETE ON public.framework_versions FOR EACH ROW EXECUTE FUNCTION public.framework_versions_no_delete();
--> statement-breakpoint


--
-- Name: health_scores health_scores_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER health_scores_append_only BEFORE DELETE OR UPDATE ON public.health_scores FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: kpi_readings kpi_readings_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER kpi_readings_append_only BEFORE DELETE OR UPDATE ON public.kpi_readings FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: prescriptions prescriptions_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prescriptions_guard BEFORE DELETE OR UPDATE ON public.prescriptions FOR EACH ROW EXECUTE FUNCTION public.guard_workflow_row('status', 'reviewer_note');
--> statement-breakpoint


--
-- Name: responses responses_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER responses_append_only BEFORE DELETE OR UPDATE ON public.responses FOR EACH ROW EXECUTE FUNCTION public.forbid_change();
--> statement-breakpoint


--
-- Name: revenue_share_calculations revenue_share_calculations_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER revenue_share_calculations_immutable BEFORE DELETE OR UPDATE ON public.revenue_share_calculations FOR EACH ROW EXECUTE FUNCTION public.reject_calculation_change();
--> statement-breakpoint


--
-- Name: revenue_share_allocations rsal_total_check; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER rsal_total_check AFTER INSERT OR DELETE OR UPDATE ON public.revenue_share_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_revenue_share_allocation_total();
--> statement-breakpoint


--
-- Name: actions actions_assignee_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_assignee_id_users_id_fk FOREIGN KEY (assignee_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: actions actions_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: actions actions_intervention_id_interventions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_intervention_id_interventions_id_fk FOREIGN KEY (intervention_id) REFERENCES public.interventions(id);
--> statement-breakpoint


--
-- Name: ai_agent_versions ai_agent_versions_agent_id_ai_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_versions
    ADD CONSTRAINT ai_agent_versions_agent_id_ai_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.ai_agents(id);
--> statement-breakpoint


--
-- Name: ai_agents ai_agents_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agents
    ADD CONSTRAINT ai_agents_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: ai_attempts ai_attempts_request_id_ai_requests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_attempts
    ADD CONSTRAINT ai_attempts_request_id_ai_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.ai_requests(id);
--> statement-breakpoint


--
-- Name: ai_requests ai_requests_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_requests
    ADD CONSTRAINT ai_requests_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: approval_decisions approval_decisions_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decisions
    ADD CONSTRAINT approval_decisions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: approval_decisions approval_decisions_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_decisions
    ADD CONSTRAINT approval_decisions_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.approval_requests(id);
--> statement-breakpoint


--
-- Name: approval_requests approval_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: area_assignments area_assignments_confirmed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.area_assignments
    ADD CONSTRAINT area_assignments_confirmed_by_users_id_fk FOREIGN KEY (confirmed_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: area_assignments area_assignments_member_id_org_members_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.area_assignments
    ADD CONSTRAINT area_assignments_member_id_org_members_id_fk FOREIGN KEY (member_id) REFERENCES public.org_members(id);
--> statement-breakpoint


--
-- Name: area_assignments area_assignments_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.area_assignments
    ADD CONSTRAINT area_assignments_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: assessment_rounds assessment_rounds_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_rounds
    ADD CONSTRAINT assessment_rounds_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: assessment_rounds assessment_rounds_diagnostic_id_diagnostics_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_rounds
    ADD CONSTRAINT assessment_rounds_diagnostic_id_diagnostics_id_fk FOREIGN KEY (diagnostic_id) REFERENCES public.diagnostics(id);
--> statement-breakpoint


--
-- Name: assessment_rounds assessment_rounds_framework_version_id_framework_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_rounds
    ADD CONSTRAINT assessment_rounds_framework_version_id_framework_versions_id_fk FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id);
--> statement-breakpoint


--
-- Name: assessment_rounds assessment_rounds_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_rounds
    ADD CONSTRAINT assessment_rounds_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: assessment_rounds assessment_rounds_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_rounds
    ADD CONSTRAINT assessment_rounds_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: calendar_connections calendar_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: calendar_events calendar_events_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: calendar_events calendar_events_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.calendar_connections(id) ON DELETE SET NULL;
--> statement-breakpoint


--
-- Name: calendar_events calendar_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: calendar_events calendar_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.delivery_sessions(id) ON DELETE SET NULL;
--> statement-breakpoint


--
-- Name: case_assignments case_assignments_assigned_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_assignments
    ADD CONSTRAINT case_assignments_assigned_by_users_id_fk FOREIGN KEY (assigned_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: case_assignments case_assignments_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_assignments
    ADD CONSTRAINT case_assignments_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: case_assignments case_assignments_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_assignments
    ADD CONSTRAINT case_assignments_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: case_escalations case_escalations_case_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_escalations
    ADD CONSTRAINT case_escalations_case_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: case_message_reads case_message_reads_case_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_message_reads
    ADD CONSTRAINT case_message_reads_case_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: case_message_reads case_message_reads_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_message_reads
    ADD CONSTRAINT case_message_reads_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: case_messages case_messages_case_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_messages
    ADD CONSTRAINT case_messages_case_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: case_messages case_messages_sender_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.case_messages
    ADD CONSTRAINT case_messages_sender_id_fk FOREIGN KEY (sender_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: cases cases_coach_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_coach_id_users_id_fk FOREIGN KEY (coach_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: cases cases_cohort_id_cohorts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_cohort_id_cohorts_id_fk FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id);
--> statement-breakpoint


--
-- Name: cases cases_consultant_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_consultant_id_users_id_fk FOREIGN KEY (consultant_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: cases cases_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: cases cases_programme_id_programmes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_programme_id_programmes_id_fk FOREIGN KEY (programme_id) REFERENCES public.programmes(id);
--> statement-breakpoint


--
-- Name: cases cases_reviewer_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cases
    ADD CONSTRAINT cases_reviewer_id_users_id_fk FOREIGN KEY (reviewer_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: certificates certificates_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: certificates certificates_decided_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_decided_by_users_id_fk FOREIGN KEY (decided_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: certificates certificates_framework_version_id_framework_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_framework_version_id_framework_versions_id_fk FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id);
--> statement-breakpoint


--
-- Name: certificates certificates_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: certificates certificates_proposed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_proposed_by_users_id_fk FOREIGN KEY (proposed_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: certificates certificates_revoked_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_revoked_by_users_id_fk FOREIGN KEY (revoked_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: certificates certificates_score_id_health_scores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_score_id_health_scores_id_fk FOREIGN KEY (score_id) REFERENCES public.health_scores(id);
--> statement-breakpoint


--
-- Name: chargebacks chargebacks_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chargebacks
    ADD CONSTRAINT chargebacks_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);
--> statement-breakpoint


--
-- Name: coaching_sessions coaching_sessions_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: coaching_sessions coaching_sessions_coach_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_coach_id_users_id_fk FOREIGN KEY (coach_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: cohort_configurations cohort_configurations_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_configurations
    ADD CONSTRAINT cohort_configurations_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: cohort_configurations cohort_configurations_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_configurations
    ADD CONSTRAINT cohort_configurations_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: cohort_configurations cohort_configurations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_configurations
    ADD CONSTRAINT cohort_configurations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: cohorts cohorts_programme_id_programmes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohorts
    ADD CONSTRAINT cohorts_programme_id_programmes_id_fk FOREIGN KEY (programme_id) REFERENCES public.programmes(id);
--> statement-breakpoint


--
-- Name: conflict_checks conflict_checks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conflict_checks
    ADD CONSTRAINT conflict_checks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: consent_notices consent_notices_country_code_country_settings_country_code_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_notices
    ADD CONSTRAINT consent_notices_country_code_country_settings_country_code_fk FOREIGN KEY (country_code) REFERENCES public.country_settings(country_code);
--> statement-breakpoint


--
-- Name: consent_notices consent_notices_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_notices
    ADD CONSTRAINT consent_notices_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: consents consents_notice_id_consent_notices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_notice_id_consent_notices_id_fk FOREIGN KEY (notice_id) REFERENCES public.consent_notices(id);
--> statement-breakpoint


--
-- Name: consents consents_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: consents consents_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: content_versions content_versions_doc_id_content_docs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_versions
    ADD CONSTRAINT content_versions_doc_id_content_docs_id_fk FOREIGN KEY (doc_id) REFERENCES public.content_docs(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: contract_amendments contract_amendments_contract_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_amendments
    ADD CONSTRAINT contract_amendments_contract_id_fk FOREIGN KEY (contract_id) REFERENCES public.contracts(id);
--> statement-breakpoint


--
-- Name: contract_amendments contract_amendments_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_amendments
    ADD CONSTRAINT contract_amendments_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: contracts contracts_accepted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_accepted_by_users_id_fk FOREIGN KEY (accepted_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: contracts contracts_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: contracts contracts_plan_id_plans_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_plan_id_plans_id_fk FOREIGN KEY (plan_id) REFERENCES public.plans(id);
--> statement-breakpoint


--
-- Name: contracts contracts_programme_id_programmes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_programme_id_programmes_id_fk FOREIGN KEY (programme_id) REFERENCES public.programmes(id);
--> statement-breakpoint


--
-- Name: contracts contracts_renewal_of_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_renewal_of_fk FOREIGN KEY (renewal_of) REFERENCES public.contracts(id);
--> statement-breakpoint


--
-- Name: delivery_activities delivery_activities_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_activities
    ADD CONSTRAINT delivery_activities_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: delivery_activities delivery_activities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_activities
    ADD CONSTRAINT delivery_activities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_activities delivery_activities_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_activities
    ADD CONSTRAINT delivery_activities_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_attendance delivery_attendance_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_attendance
    ADD CONSTRAINT delivery_attendance_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.programme_participants(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: delivery_attendance delivery_attendance_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_attendance
    ADD CONSTRAINT delivery_attendance_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_attendance delivery_attendance_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_attendance
    ADD CONSTRAINT delivery_attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.delivery_sessions(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: delivery_exceptions delivery_exceptions_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exceptions
    ADD CONSTRAINT delivery_exceptions_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.delivery_activities(id) ON DELETE SET NULL;
--> statement-breakpoint


--
-- Name: delivery_exceptions delivery_exceptions_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exceptions
    ADD CONSTRAINT delivery_exceptions_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: delivery_exceptions delivery_exceptions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exceptions
    ADD CONSTRAINT delivery_exceptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_exceptions delivery_exceptions_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exceptions
    ADD CONSTRAINT delivery_exceptions_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_exceptions delivery_exceptions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exceptions
    ADD CONSTRAINT delivery_exceptions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.delivery_sessions(id) ON DELETE SET NULL;
--> statement-breakpoint


--
-- Name: delivery_exceptions delivery_exceptions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_exceptions
    ADD CONSTRAINT delivery_exceptions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.delivery_tasks(id) ON DELETE SET NULL;
--> statement-breakpoint


--
-- Name: delivery_milestones delivery_milestones_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_milestones
    ADD CONSTRAINT delivery_milestones_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: delivery_milestones delivery_milestones_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_milestones
    ADD CONSTRAINT delivery_milestones_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_milestones delivery_milestones_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_milestones
    ADD CONSTRAINT delivery_milestones_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_sessions delivery_sessions_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_sessions
    ADD CONSTRAINT delivery_sessions_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.delivery_activities(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: delivery_sessions delivery_sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_sessions
    ADD CONSTRAINT delivery_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_sessions delivery_sessions_facilitator_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_sessions
    ADD CONSTRAINT delivery_sessions_facilitator_user_id_fkey FOREIGN KEY (facilitator_user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_tasks delivery_tasks_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_tasks
    ADD CONSTRAINT delivery_tasks_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.delivery_activities(id) ON DELETE SET NULL;
--> statement-breakpoint


--
-- Name: delivery_tasks delivery_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_tasks
    ADD CONSTRAINT delivery_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_tasks delivery_tasks_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_tasks
    ADD CONSTRAINT delivery_tasks_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: delivery_tasks delivery_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_tasks
    ADD CONSTRAINT delivery_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: delivery_tasks delivery_tasks_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_tasks
    ADD CONSTRAINT delivery_tasks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.delivery_sessions(id) ON DELETE SET NULL;
--> statement-breakpoint


--
-- Name: demographic_profiles demographic_profiles_consent_id_consents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demographic_profiles
    ADD CONSTRAINT demographic_profiles_consent_id_consents_id_fk FOREIGN KEY (consent_id) REFERENCES public.consents(id);
--> statement-breakpoint


--
-- Name: diagnoses diagnoses_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnoses
    ADD CONSTRAINT diagnoses_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: diagnoses diagnoses_diagnostic_id_diagnostics_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnoses
    ADD CONSTRAINT diagnoses_diagnostic_id_diagnostics_id_fk FOREIGN KEY (diagnostic_id) REFERENCES public.diagnostics(id);
--> statement-breakpoint


--
-- Name: diagnostic_drafts diagnostic_drafts_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostic_drafts
    ADD CONSTRAINT diagnostic_drafts_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: diagnostics diagnostics_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostics
    ADD CONSTRAINT diagnostics_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: diagnostics diagnostics_framework_version_id_framework_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostics
    ADD CONSTRAINT diagnostics_framework_version_id_framework_versions_id_fk FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id);
--> statement-breakpoint


--
-- Name: discount_rules discount_rules_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_rules
    ADD CONSTRAINT discount_rules_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: discount_rules discount_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_rules
    ADD CONSTRAINT discount_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: documents documents_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: documents documents_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: engagement_ratings engagement_ratings_assignment_id_case_assignments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_ratings
    ADD CONSTRAINT engagement_ratings_assignment_id_case_assignments_id_fk FOREIGN KEY (assignment_id) REFERENCES public.case_assignments(id);
--> statement-breakpoint


--
-- Name: engagement_ratings engagement_ratings_rater_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_ratings
    ADD CONSTRAINT engagement_ratings_rater_id_users_id_fk FOREIGN KEY (rater_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: evidence evidence_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: evidence evidence_document_id_documents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence
    ADD CONSTRAINT evidence_document_id_documents_id_fk FOREIGN KEY (document_id) REFERENCES public.documents(id);
--> statement-breakpoint


--
-- Name: feedback feedback_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: feedback feedback_handled_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_handled_by_users_id_fk FOREIGN KEY (handled_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: feedback feedback_health_score_id_health_scores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_health_score_id_health_scores_id_fk FOREIGN KEY (health_score_id) REFERENCES public.health_scores(id);
--> statement-breakpoint


--
-- Name: feedback feedback_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: feedback feedback_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: financial_ledger_entries financial_ledger_entries_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_ledger_entries
    ADD CONSTRAINT financial_ledger_entries_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.financial_accounts(id);
--> statement-breakpoint


--
-- Name: financial_ledger_entries financial_ledger_entries_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_ledger_entries
    ADD CONSTRAINT financial_ledger_entries_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.financial_periods(id);
--> statement-breakpoint


--
-- Name: financial_periods financial_periods_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_periods
    ADD CONSTRAINT financial_periods_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: framework_dimensions framework_dimensions_framework_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_dimensions
    ADD CONSTRAINT framework_dimensions_framework_version_id_fkey FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: framework_evidence_requirements framework_evidence_requirements_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_evidence_requirements
    ADD CONSTRAINT framework_evidence_requirements_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.framework_questions(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: framework_questions framework_questions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_questions
    ADD CONSTRAINT framework_questions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: framework_questions framework_questions_dimension_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_questions
    ADD CONSTRAINT framework_questions_dimension_id_fkey FOREIGN KEY (dimension_id) REFERENCES public.framework_dimensions(id);
--> statement-breakpoint


--
-- Name: framework_questions framework_questions_framework_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_questions
    ADD CONSTRAINT framework_questions_framework_version_id_fkey FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: framework_questions framework_questions_sub_dimension_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_questions
    ADD CONSTRAINT framework_questions_sub_dimension_id_fkey FOREIGN KEY (sub_dimension_id) REFERENCES public.framework_sub_dimensions(id);
--> statement-breakpoint


--
-- Name: framework_readiness_rules framework_readiness_rules_framework_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_readiness_rules
    ADD CONSTRAINT framework_readiness_rules_framework_version_id_fkey FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: framework_scoring_rules framework_scoring_rules_framework_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_scoring_rules
    ADD CONSTRAINT framework_scoring_rules_framework_version_id_fkey FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: framework_source_records framework_source_records_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_source_records
    ADD CONSTRAINT framework_source_records_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: framework_source_records framework_source_records_framework_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_source_records
    ADD CONSTRAINT framework_source_records_framework_version_id_fkey FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: framework_sub_dimensions framework_sub_dimensions_dimension_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_sub_dimensions
    ADD CONSTRAINT framework_sub_dimensions_dimension_id_fkey FOREIGN KEY (dimension_id) REFERENCES public.framework_dimensions(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: framework_versions framework_versions_framework_id_frameworks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.framework_versions
    ADD CONSTRAINT framework_versions_framework_id_frameworks_id_fk FOREIGN KEY (framework_id) REFERENCES public.frameworks(id);
--> statement-breakpoint


--
-- Name: free_assessment_owners free_assessment_owners_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_assessment_owners
    ADD CONSTRAINT free_assessment_owners_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: free_assessment_owners free_assessment_owners_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_assessment_owners
    ADD CONSTRAINT free_assessment_owners_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: free_assessment_results free_assessment_results_matched_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_assessment_results
    ADD CONSTRAINT free_assessment_results_matched_org_id_fkey FOREIGN KEY (matched_org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: geo_units geo_units_country_code_country_settings_country_code_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_units
    ADD CONSTRAINT geo_units_country_code_country_settings_country_code_fk FOREIGN KEY (country_code) REFERENCES public.country_settings(country_code);
--> statement-breakpoint


--
-- Name: geo_units geo_units_parent_id_geo_units_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_units
    ADD CONSTRAINT geo_units_parent_id_geo_units_id_fk FOREIGN KEY (parent_id) REFERENCES public.geo_units(id);
--> statement-breakpoint


--
-- Name: health_scores health_scores_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_scores
    ADD CONSTRAINT health_scores_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: health_scores health_scores_diagnostic_id_diagnostics_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_scores
    ADD CONSTRAINT health_scores_diagnostic_id_diagnostics_id_fk FOREIGN KEY (diagnostic_id) REFERENCES public.diagnostics(id);
--> statement-breakpoint


--
-- Name: health_scores health_scores_framework_version_id_framework_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_scores
    ADD CONSTRAINT health_scores_framework_version_id_framework_versions_id_fk FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id);
--> statement-breakpoint


--
-- Name: integration_credentials integration_credentials_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_credentials
    ADD CONSTRAINT integration_credentials_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: interventions interventions_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interventions
    ADD CONSTRAINT interventions_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: interventions interventions_prescription_id_prescriptions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interventions
    ADD CONSTRAINT interventions_prescription_id_prescriptions_id_fk FOREIGN KEY (prescription_id) REFERENCES public.prescriptions(id);
--> statement-breakpoint


--
-- Name: invoices invoices_contract_id_contracts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_contract_id_contracts_id_fk FOREIGN KEY (contract_id) REFERENCES public.contracts(id);
--> statement-breakpoint


--
-- Name: invoices invoices_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: kpi_readings kpi_readings_kpi_id_kpis_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_readings
    ADD CONSTRAINT kpi_readings_kpi_id_kpis_id_fk FOREIGN KEY (kpi_id) REFERENCES public.kpis(id);
--> statement-breakpoint


--
-- Name: kpis kpis_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpis
    ADD CONSTRAINT kpis_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: library_authors library_authors_photo_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_authors
    ADD CONSTRAINT library_authors_photo_media_id_fkey FOREIGN KEY (photo_media_id) REFERENCES public.media_assets(id);
--> statement-breakpoint


--
-- Name: library_authors library_authors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_authors
    ADD CONSTRAINT library_authors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: library_resources library_resources_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_resources
    ADD CONSTRAINT library_resources_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: library_resources library_resources_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_resources
    ADD CONSTRAINT library_resources_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.library_authors(id);
--> statement-breakpoint


--
-- Name: library_resources library_resources_cover_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_resources
    ADD CONSTRAINT library_resources_cover_media_id_fkey FOREIGN KEY (cover_media_id) REFERENCES public.media_assets(id);
--> statement-breakpoint


--
-- Name: library_resources library_resources_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_resources
    ADD CONSTRAINT library_resources_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: notifications notifications_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: opportunities opportunities_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: opportunities opportunities_published_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_published_by_users_id_fk FOREIGN KEY (published_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: opportunity_referral_events opportunity_referral_events_actor_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_referral_events
    ADD CONSTRAINT opportunity_referral_events_actor_id_users_id_fk FOREIGN KEY (actor_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: opportunity_referral_events opportunity_referral_events_referral_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_referral_events
    ADD CONSTRAINT opportunity_referral_events_referral_id_fk FOREIGN KEY (referral_id) REFERENCES public.opportunity_referrals(id);
--> statement-breakpoint


--
-- Name: opportunity_referrals opportunity_referrals_approved_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_referrals
    ADD CONSTRAINT opportunity_referrals_approved_by_users_id_fk FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: opportunity_referrals opportunity_referrals_consent_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_referrals
    ADD CONSTRAINT opportunity_referrals_consent_by_users_id_fk FOREIGN KEY (consent_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: opportunity_referrals opportunity_referrals_opportunity_id_opportunities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_referrals
    ADD CONSTRAINT opportunity_referrals_opportunity_id_opportunities_id_fk FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id);
--> statement-breakpoint


--
-- Name: opportunity_referrals opportunity_referrals_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_referrals
    ADD CONSTRAINT opportunity_referrals_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: opportunity_referrals opportunity_referrals_suggested_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_referrals
    ADD CONSTRAINT opportunity_referrals_suggested_by_users_id_fk FOREIGN KEY (suggested_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: opportunity_sources opportunity_sources_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_sources
    ADD CONSTRAINT opportunity_sources_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: org_members org_members_invited_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_members
    ADD CONSTRAINT org_members_invited_by_users_id_fk FOREIGN KEY (invited_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: org_members org_members_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_members
    ADD CONSTRAINT org_members_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: org_members org_members_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_members
    ADD CONSTRAINT org_members_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: organisations organisations_country_code_country_settings_country_code_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_country_code_country_settings_country_code_fk FOREIGN KEY (country_code) REFERENCES public.country_settings(country_code);
--> statement-breakpoint


--
-- Name: organisations organisations_geo_unit_id_geo_units_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_geo_unit_id_geo_units_id_fk FOREIGN KEY (geo_unit_id) REFERENCES public.geo_units(id);
--> statement-breakpoint


--
-- Name: organisations organisations_merged_into_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_merged_into_fk FOREIGN KEY (merged_into) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: outcome_definitions outcome_definitions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_definitions
    ADD CONSTRAINT outcome_definitions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: outcome_definitions outcome_definitions_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_definitions
    ADD CONSTRAINT outcome_definitions_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.programmes(id);
--> statement-breakpoint


--
-- Name: outcome_records outcome_records_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_records
    ADD CONSTRAINT outcome_records_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: outcome_records outcome_records_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_records
    ADD CONSTRAINT outcome_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: outcome_records outcome_records_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_records
    ADD CONSTRAINT outcome_records_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.outcome_definitions(id);
--> statement-breakpoint


--
-- Name: outcome_records outcome_records_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_records
    ADD CONSTRAINT outcome_records_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id);
--> statement-breakpoint


--
-- Name: outcome_records outcome_records_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_records
    ADD CONSTRAINT outcome_records_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: participants participants_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: participants participants_merged_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.participants(id);
--> statement-breakpoint


--
-- Name: payments payments_invoice_id_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);
--> statement-breakpoint


--
-- Name: payout_adjustments payout_adjustments_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: payout_adjustments payout_adjustments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: payout_adjustments payout_adjustments_ledger_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES public.financial_ledger_entries(id);
--> statement-breakpoint


--
-- Name: payout_adjustments payout_adjustments_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_adjustments
    ADD CONSTRAINT payout_adjustments_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.professional_payouts(id);
--> statement-breakpoint


--
-- Name: payout_holds payout_holds_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_holds
    ADD CONSTRAINT payout_holds_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: payout_holds payout_holds_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_holds
    ADD CONSTRAINT payout_holds_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.professional_payouts(id);
--> statement-breakpoint


--
-- Name: payout_holds payout_holds_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_holds
    ADD CONSTRAINT payout_holds_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: practitioner_conflicts practitioner_conflicts_declared_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioner_conflicts
    ADD CONSTRAINT practitioner_conflicts_declared_by_users_id_fk FOREIGN KEY (declared_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: practitioner_conflicts practitioner_conflicts_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioner_conflicts
    ADD CONSTRAINT practitioner_conflicts_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: practitioner_conflicts practitioner_conflicts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioner_conflicts
    ADD CONSTRAINT practitioner_conflicts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: practitioner_profiles practitioner_profiles_decided_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioner_profiles
    ADD CONSTRAINT practitioner_profiles_decided_by_users_id_fk FOREIGN KEY (decided_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: practitioner_profiles practitioner_profiles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practitioner_profiles
    ADD CONSTRAINT practitioner_profiles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: prescriptions prescriptions_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: prescriptions prescriptions_diagnosis_id_diagnoses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_diagnosis_id_diagnoses_id_fk FOREIGN KEY (diagnosis_id) REFERENCES public.diagnoses(id);
--> statement-breakpoint


--
-- Name: professional_payouts professional_payouts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_payouts
    ADD CONSTRAINT professional_payouts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: professional_payouts professional_payouts_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_payouts
    ADD CONSTRAINT professional_payouts_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.case_assignments(id);
--> statement-breakpoint


--
-- Name: professional_payouts professional_payouts_calculation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_payouts
    ADD CONSTRAINT professional_payouts_calculation_id_fkey FOREIGN KEY (calculation_id) REFERENCES public.revenue_share_calculations(id);
--> statement-breakpoint


--
-- Name: professional_payouts professional_payouts_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_payouts
    ADD CONSTRAINT professional_payouts_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id);
--> statement-breakpoint


--
-- Name: professional_payouts professional_payouts_professional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_payouts
    ADD CONSTRAINT professional_payouts_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: professional_payouts professional_payouts_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_payouts
    ADD CONSTRAINT professional_payouts_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: programme_budget_lines programme_budget_lines_created_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_budget_lines
    ADD CONSTRAINT programme_budget_lines_created_by_fk FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: programme_budget_lines programme_budget_lines_programme_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_budget_lines
    ADD CONSTRAINT programme_budget_lines_programme_id_fk FOREIGN KEY (programme_id) REFERENCES public.programmes(id);
--> statement-breakpoint


--
-- Name: programme_expenditures programme_expenditures_budget_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_expenditures
    ADD CONSTRAINT programme_expenditures_budget_line_id_fkey FOREIGN KEY (budget_line_id) REFERENCES public.programme_budget_lines(id);
--> statement-breakpoint


--
-- Name: programme_expenditures programme_expenditures_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_expenditures
    ADD CONSTRAINT programme_expenditures_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id);
--> statement-breakpoint


--
-- Name: programme_expenditures programme_expenditures_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_expenditures
    ADD CONSTRAINT programme_expenditures_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: programme_expenditures programme_expenditures_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_expenditures
    ADD CONSTRAINT programme_expenditures_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.programmes(id);
--> statement-breakpoint


--
-- Name: programme_indicators programme_indicators_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_indicators
    ADD CONSTRAINT programme_indicators_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: programme_indicators programme_indicators_parent_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_indicators
    ADD CONSTRAINT programme_indicators_parent_id_fk FOREIGN KEY (parent_id) REFERENCES public.programme_indicators(id);
--> statement-breakpoint


--
-- Name: programme_indicators programme_indicators_programme_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_indicators
    ADD CONSTRAINT programme_indicators_programme_id_fk FOREIGN KEY (programme_id) REFERENCES public.programmes(id);
--> statement-breakpoint


--
-- Name: programme_participant_people programme_participant_people_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_participant_people
    ADD CONSTRAINT programme_participant_people_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id);
--> statement-breakpoint


--
-- Name: programme_participant_people programme_participant_people_programme_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_participant_people
    ADD CONSTRAINT programme_participant_people_programme_participant_id_fkey FOREIGN KEY (programme_participant_id) REFERENCES public.programme_participants(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: programme_participants programme_participants_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_participants
    ADD CONSTRAINT programme_participants_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id);
--> statement-breakpoint


--
-- Name: programme_participants programme_participants_consent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_participants
    ADD CONSTRAINT programme_participants_consent_by_fkey FOREIGN KEY (consent_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: programme_participants programme_participants_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_participants
    ADD CONSTRAINT programme_participants_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: programme_participants programme_participants_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_participants
    ADD CONSTRAINT programme_participants_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.programmes(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: programme_participants programme_participants_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_participants
    ADD CONSTRAINT programme_participants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.programme_workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: programme_tranches programme_tranches_created_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_tranches
    ADD CONSTRAINT programme_tranches_created_by_fk FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: programme_tranches programme_tranches_programme_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_tranches
    ADD CONSTRAINT programme_tranches_programme_id_fk FOREIGN KEY (programme_id) REFERENCES public.programmes(id);
--> statement-breakpoint


--
-- Name: programme_versions programme_versions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_versions
    ADD CONSTRAINT programme_versions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: programme_versions programme_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_versions
    ADD CONSTRAINT programme_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: programme_versions programme_versions_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_versions
    ADD CONSTRAINT programme_versions_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.programmes(id);
--> statement-breakpoint


--
-- Name: programme_workspace_configurations programme_workspace_configurations_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspace_configurations
    ADD CONSTRAINT programme_workspace_configurations_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: programme_workspace_configurations programme_workspace_configurations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspace_configurations
    ADD CONSTRAINT programme_workspace_configurations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: programme_workspace_configurations programme_workspace_configurations_framework_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspace_configurations
    ADD CONSTRAINT programme_workspace_configurations_framework_version_id_fkey FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id);
--> statement-breakpoint


--
-- Name: programme_workspace_configurations programme_workspace_configurations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspace_configurations
    ADD CONSTRAINT programme_workspace_configurations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.programme_workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: programme_workspace_members programme_workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspace_members
    ADD CONSTRAINT programme_workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: programme_workspace_members programme_workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspace_members
    ADD CONSTRAINT programme_workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.programme_workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: programme_workspaces programme_workspaces_framework_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspaces
    ADD CONSTRAINT programme_workspaces_framework_version_id_fkey FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id);
--> statement-breakpoint


--
-- Name: programme_workspaces programme_workspaces_programme_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programme_workspaces
    ADD CONSTRAINT programme_workspaces_programme_id_fkey FOREIGN KEY (programme_id) REFERENCES public.programmes(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: promo_campaigns promo_campaigns_discount_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_campaigns
    ADD CONSTRAINT promo_campaigns_discount_rule_id_fkey FOREIGN KEY (discount_rule_id) REFERENCES public.discount_rules(id);
--> statement-breakpoint


--
-- Name: promo_codes promo_codes_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_codes
    ADD CONSTRAINT promo_codes_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.promo_campaigns(id);
--> statement-breakpoint


--
-- Name: promo_redemptions promo_redemptions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_redemptions
    ADD CONSTRAINT promo_redemptions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: promo_redemptions promo_redemptions_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_redemptions
    ADD CONSTRAINT promo_redemptions_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);
--> statement-breakpoint


--
-- Name: promo_redemptions promo_redemptions_promo_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo_redemptions
    ADD CONSTRAINT promo_redemptions_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES public.promo_codes(id);
--> statement-breakpoint


--
-- Name: provider_assignments provider_assignments_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_assignments
    ADD CONSTRAINT provider_assignments_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id) ON DELETE SET NULL;
--> statement-breakpoint


--
-- Name: provider_assignments provider_assignments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_assignments
    ADD CONSTRAINT provider_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: provider_assignments provider_assignments_provider_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_assignments
    ADD CONSTRAINT provider_assignments_provider_user_id_fkey FOREIGN KEY (provider_user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: provider_assignments provider_assignments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_assignments
    ADD CONSTRAINT provider_assignments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.programme_workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: provider_capacities provider_capacities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_capacities
    ADD CONSTRAINT provider_capacities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: provider_capacities provider_capacities_provider_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_capacities
    ADD CONSTRAINT provider_capacities_provider_user_id_fkey FOREIGN KEY (provider_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: provider_capacities provider_capacities_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_capacities
    ADD CONSTRAINT provider_capacities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.programme_workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: public_assessments public_assessments_framework_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_assessments
    ADD CONSTRAINT public_assessments_framework_version_id_fkey FOREIGN KEY (framework_version_id) REFERENCES public.framework_versions(id);
--> statement-breakpoint


--
-- Name: refunds refunds_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: refunds refunds_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);
--> statement-breakpoint


--
-- Name: refunds refunds_ledger_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES public.financial_ledger_entries(id);
--> statement-breakpoint


--
-- Name: refunds refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);
--> statement-breakpoint


--
-- Name: refunds refunds_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: registration_answers registration_answers_org_id_organisations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registration_answers
    ADD CONSTRAINT registration_answers_org_id_organisations_id_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: registration_answers registration_answers_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registration_answers
    ADD CONSTRAINT registration_answers_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: reports reports_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: resource_entitlements resource_entitlements_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_entitlements
    ADD CONSTRAINT resource_entitlements_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: resource_entitlements resource_entitlements_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_entitlements
    ADD CONSTRAINT resource_entitlements_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);
--> statement-breakpoint


--
-- Name: resource_entitlements resource_entitlements_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_entitlements
    ADD CONSTRAINT resource_entitlements_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.library_resources(id);
--> statement-breakpoint


--
-- Name: resource_entitlements resource_entitlements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_entitlements
    ADD CONSTRAINT resource_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: resource_payments resource_payments_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_payments
    ADD CONSTRAINT resource_payments_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.library_resources(id);
--> statement-breakpoint


--
-- Name: resource_payments resource_payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_payments
    ADD CONSTRAINT resource_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: response_drafts response_drafts_answered_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_drafts
    ADD CONSTRAINT response_drafts_answered_by_users_id_fk FOREIGN KEY (answered_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: response_drafts response_drafts_round_id_assessment_rounds_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_drafts
    ADD CONSTRAINT response_drafts_round_id_assessment_rounds_id_fk FOREIGN KEY (round_id) REFERENCES public.assessment_rounds(id);
--> statement-breakpoint


--
-- Name: responses responses_diagnostic_id_diagnostics_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_diagnostic_id_diagnostics_id_fk FOREIGN KEY (diagnostic_id) REFERENCES public.diagnostics(id);
--> statement-breakpoint


--
-- Name: revenue_share_agreements revenue_share_agreements_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_agreements
    ADD CONSTRAINT revenue_share_agreements_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: revenue_share_agreements revenue_share_agreements_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_agreements
    ADD CONSTRAINT revenue_share_agreements_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.case_assignments(id);
--> statement-breakpoint


--
-- Name: revenue_share_agreements revenue_share_agreements_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_agreements
    ADD CONSTRAINT revenue_share_agreements_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id);
--> statement-breakpoint


--
-- Name: revenue_share_agreements revenue_share_agreements_professional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_agreements
    ADD CONSTRAINT revenue_share_agreements_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: revenue_share_agreements revenue_share_agreements_proposed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_agreements
    ADD CONSTRAINT revenue_share_agreements_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: revenue_share_allocations revenue_share_allocations_agreement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_allocations
    ADD CONSTRAINT revenue_share_allocations_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES public.revenue_share_agreements(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: revenue_share_allocations revenue_share_allocations_professional_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_allocations
    ADD CONSTRAINT revenue_share_allocations_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: revenue_share_calculations revenue_share_calculations_agreement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_calculations
    ADD CONSTRAINT revenue_share_calculations_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES public.revenue_share_agreements(id);
--> statement-breakpoint


--
-- Name: revenue_share_calculations revenue_share_calculations_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_calculations
    ADD CONSTRAINT revenue_share_calculations_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: revenue_share_calculations revenue_share_calculations_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_calculations
    ADD CONSTRAINT revenue_share_calculations_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);
--> statement-breakpoint


--
-- Name: revenue_share_calculations revenue_share_calculations_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_calculations
    ADD CONSTRAINT revenue_share_calculations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);
--> statement-breakpoint


--
-- Name: revenue_share_calculations revenue_share_calculations_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_share_calculations
    ADD CONSTRAINT revenue_share_calculations_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES public.revenue_share_calculations(id);
--> statement-breakpoint


--
-- Name: risks risks_case_id_cases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risks
    ADD CONSTRAINT risks_case_id_cases_id_fk FOREIGN KEY (case_id) REFERENCES public.cases(id);
--> statement-breakpoint


--
-- Name: role_grants role_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_grants
    ADD CONSTRAINT role_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: role_mappings role_mappings_approved_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_mappings
    ADD CONSTRAINT role_mappings_approved_by_users_id_fk FOREIGN KEY (approved_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: role_mappings role_mappings_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_mappings
    ADD CONSTRAINT role_mappings_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint


--
-- Name: sessions sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: tax_lines tax_lines_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_lines
    ADD CONSTRAINT tax_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);
--> statement-breakpoint


--
-- Name: tax_lines tax_lines_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_lines
    ADD CONSTRAINT tax_lines_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.professional_payouts(id);
--> statement-breakpoint


--
-- Name: tax_lines tax_lines_tax_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_lines
    ADD CONSTRAINT tax_lines_tax_rule_id_fkey FOREIGN KEY (tax_rule_id) REFERENCES public.tax_rules(id);
--> statement-breakpoint


--
-- Name: user_programmes user_programmes_programme_id_programmes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_programmes
    ADD CONSTRAINT user_programmes_programme_id_programmes_id_fk FOREIGN KEY (programme_id) REFERENCES public.programmes(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: user_programmes user_programmes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_programmes
    ADD CONSTRAINT user_programmes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: user_tokens user_tokens_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tokens
    ADD CONSTRAINT user_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint


--
-- Name: users users_org_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_org_fk FOREIGN KEY (org_id) REFERENCES public.organisations(id);
--> statement-breakpoint


--
-- Name: actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: ai_agent_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_agent_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: ai_agents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: ai_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: ai_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: approval_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_decisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: approval_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: area_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.area_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: assessment_rounds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_rounds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: calendar_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: calendar_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: case_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.case_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: case_escalations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.case_escalations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: case_message_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.case_message_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: case_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.case_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: certificates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: chargebacks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chargebacks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: coaching_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coaching_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: cohort_configurations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cohort_configurations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: cohorts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cohorts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: conflict_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conflict_checks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: consent_notices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: consents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: content_docs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_docs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: content_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: contract_amendments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_amendments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: country_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.country_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: delivery_activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_activities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: delivery_attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_attendance ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: delivery_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_exceptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: delivery_milestones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_milestones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: delivery_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: delivery_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: demographic_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.demographic_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: diagnoses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: diagnostic_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.diagnostic_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: diagnostics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.diagnostics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: discount_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discount_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: email_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: engagement_ratings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_ratings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: evidence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: financial_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: financial_ledger_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_ledger_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: financial_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: framework_dimensions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.framework_dimensions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: framework_evidence_requirements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.framework_evidence_requirements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: framework_questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.framework_questions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: framework_readiness_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.framework_readiness_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: framework_scoring_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.framework_scoring_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: framework_source_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.framework_source_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: framework_sub_dimensions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.framework_sub_dimensions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: framework_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.framework_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: frameworks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.frameworks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: free_assessment_owners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.free_assessment_owners ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: free_assessment_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.free_assessment_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: geo_units; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.geo_units ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: health_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.health_scores ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: inquiries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: integration_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: interventions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interventions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: kpi_readings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpi_readings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: kpis; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpis ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: library_authors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.library_authors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: library_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: library_resources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.library_resources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: media_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: opportunity_referral_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunity_referral_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: opportunity_referrals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunity_referrals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: opportunity_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunity_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: org_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: organisations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: outbox_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outbox_emails ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: outcome_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outcome_definitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: outcome_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outcome_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: payout_adjustments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_adjustments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: payout_holds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_holds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: practitioner_conflicts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practitioner_conflicts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: practitioner_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practitioner_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: prescriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: professional_payouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.professional_payouts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programme_budget_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programme_budget_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programme_expenditures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programme_expenditures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programme_indicators; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programme_indicators ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programme_participant_people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programme_participant_people ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programme_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programme_participants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programme_tranches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programme_tranches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programme_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programme_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programme_workspace_configurations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programme_workspace_configurations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programme_workspace_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programme_workspace_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programme_workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programme_workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: programmes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programmes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: promo_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_campaigns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: promo_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: promo_redemptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: provider_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: provider_capacities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provider_capacities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: public_assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.public_assessments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: refunds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: registration_answers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.registration_answers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: resource_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resource_entitlements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: resource_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resource_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: response_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.response_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: responses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: revenue_share_agreements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.revenue_share_agreements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: revenue_share_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.revenue_share_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: revenue_share_calculations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.revenue_share_calculations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: risks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: role_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: role_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_mappings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: scout_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scout_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: tax_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: tax_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: user_programmes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_programmes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: user_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

--
--



-- Reference/seed data (static, inserted by migrations 0011, 0019, 0020, 0027 historically)
--> statement-breakpoint
INSERT INTO public.country_settings (country_code, name, currency, phone_code, default_language, level_labels, data_protection_regime, regulator_name, youth_max_age, active, created_at, updated_at) VALUES ('GH', 'Ghana', 'GHS', '+233', 'en', '["Region", "District", "Community"]', 'Data Protection Act, 2012 (Act 843)', 'Data Protection Commission', 35, true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e80a15c6-1499-4444-b210-415beffb35ff', 'GH', 1, NULL, NULL, 'Ahafo', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('d786b9c7-c028-4034-88e7-125f3a11eea3', 'GH', 1, NULL, NULL, 'Ashanti', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('332da826-5a16-4371-b309-95a5e0447587', 'GH', 1, NULL, NULL, 'Bono', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4f1f749f-1930-4797-8a75-4ff75ce19020', 'GH', 1, NULL, NULL, 'Bono East', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('734aa688-74f7-4f31-8a08-28802c63ee60', 'GH', 1, NULL, NULL, 'Central', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('290ca185-5016-4beb-9176-6e175c865983', 'GH', 1, NULL, NULL, 'Eastern', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('1496648e-d9a2-49a7-b42c-96465913858f', 'GH', 1, NULL, NULL, 'Greater Accra', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('fe7974b2-2db9-49c6-b577-27bd34577943', 'GH', 1, NULL, NULL, 'North East', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('fd14a12f-af8c-4045-b327-4182a89597ae', 'GH', 1, NULL, NULL, 'Northern', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6717880f-cfa4-4916-abb5-95db77b047b6', 'GH', 1, NULL, NULL, 'Oti', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('2cd4d316-d2cd-4dcc-9cc3-f386fe3a6629', 'GH', 1, NULL, NULL, 'Savannah', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', 'GH', 1, NULL, NULL, 'Upper East', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('a4ec10fe-dd87-4d06-ae51-3a8cb9067078', 'GH', 1, NULL, NULL, 'Upper West', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', 'GH', 1, NULL, NULL, 'Volta', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', 'GH', 1, NULL, NULL, 'Western', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('8054d8bb-4d6b-4a8b-88dd-97733b0b39d8', 'GH', 1, NULL, NULL, 'Western North', true, 'Regions of Ghana after the December 2018 referendum. Verify against the official list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('471835f8-f291-4634-8605-d9e2b1a57de1', 'GH', 2, 'e80a15c6-1499-4444-b210-415beffb35ff', NULL, 'Asunafo North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('994510d3-d092-401d-a7dc-a3b998b1c6cf', 'GH', 2, 'e80a15c6-1499-4444-b210-415beffb35ff', NULL, 'Asunafo South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('c01207f6-9ed1-4055-b4c0-453e5b155e53', 'GH', 2, 'e80a15c6-1499-4444-b210-415beffb35ff', NULL, 'Asutifi North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('73e47b0d-b704-4c80-8513-d55e50ec11e6', 'GH', 2, 'e80a15c6-1499-4444-b210-415beffb35ff', NULL, 'Asutifi South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('0a2e42be-f56c-4df4-b98a-c2ba802d3789', 'GH', 2, 'e80a15c6-1499-4444-b210-415beffb35ff', NULL, 'Tano North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('289fef1b-79ab-439c-a224-a97b033c917d', 'GH', 2, 'e80a15c6-1499-4444-b210-415beffb35ff', NULL, 'Tano South Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('38eec81a-3b19-4bce-9a98-8ca3050865e0', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Adansi Asokwa District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('543e926e-5b0e-46b4-82d3-ba7a2ed5e2f6', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Adansi North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('3155a354-415f-4578-a38c-3d91881656aa', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Adansi South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('495cc6e4-dd91-4dd2-a40b-8d57a2925439', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Afigya-Kwabre North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6b775de7-448c-4008-bd94-97a07bfb87df', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Afigya-Kwabre South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('5ed60a03-ea75-4d2e-879f-96aafe0e9e88', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Ahafo-Ano North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('5a69d4e1-42e9-4a2c-b467-dbcc5361dd0b', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Ahafo-Ano South East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('3b82602b-0586-4918-aa1c-0c05230e2aaa', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Ahafo-Ano South West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('961e0486-bca4-41b8-810f-0a677aa32e09', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Akrofuom District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('0eac3c64-f2b3-4368-a6a9-3a7cfd2cf2cc', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Amansie Central District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('96a3cfc7-3bed-4b73-9f61-b94ab8b6f6c4', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Amansie West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('82e3c2d5-c138-4f8e-82f7-f6b9f2d63f40', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Amansie South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('0875bb79-8f82-4db8-b393-25ab6d8a58cd', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Asante-Akim Central Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('bb6e6c5c-3d64-4143-b446-e25b2cbec170', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Asante-Akim North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('2e6998b8-f209-4a8d-bbf6-16d5a6e5607d', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Asante-Akim South Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('efe12826-db3e-442a-ae3d-2b2931659e01', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Asokore-Mampong Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('8a9060e5-4954-4c04-a903-7af83ca5b176', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Asokwa Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('5e5021a6-388d-4806-8cd7-f7d469b6d555', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Atwima-Kwanwoma District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('73708b98-c806-43ab-b921-681f72433217', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Atwima-Mponua District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('9a168470-3d9e-4a64-9475-6728fffaf71b', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Atwima-Nwabiagya Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('3894a2ec-9354-4d40-90d2-42aa119f97f0', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Atwima-Nwabiagya North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('098ca3cc-7170-4b6e-bed5-7602974e265f', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Bekwai Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('b1aaa64e-dafb-406d-ae00-db86c4c0ac4e', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Bosome Freho District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('994e3435-4dbb-46bf-a351-5c799c454158', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Bosomtwe District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('1507105e-1dee-47b5-afd2-66fd1034b68c', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Ejisu Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4819a9f5-a27a-497e-9014-60b9492d8da9', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Ejura/Sekyedumase Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f9f64f88-7942-424e-924b-35c2f167f306', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Juaben Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4e718ae5-fdaa-40df-b850-1e89b5f4a2ba', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Kumasi Metropolitan', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('832e8e33-f8f0-4435-a113-9f6fba109136', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Kwabre East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ba9d2a13-47d6-40b3-b833-b57df3966d37', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Kwadaso Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('33d6ce1a-dec1-4261-b184-348a676425d1', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Mampong Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('677bfed2-5ba8-49d1-a7b6-ca8aa0a8c2ed', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Obuasi East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('83cc9927-148b-4e27-a911-17628e3a87fe', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Obuasi Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('bd814dff-4454-4508-bf4a-c0e32dcbf64c', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Offinso Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e035a922-4c95-4e21-aa31-9d58e954b46d', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Offinso North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('51b75ac6-519d-4042-9fb5-550ec943b78d', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Oforikrom Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('dbf36e5b-9d55-4299-8f2b-c300850a8d2b', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Old Tafo Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6ff0c26d-3547-48b3-a52a-7b5173a05af5', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Sekyere Afram Plains District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('34d33fdc-6ab1-45e0-a35a-4a0a5da131cd', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Sekyere Central District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f501039e-b496-4da0-941e-2bd81b6e1df0', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Sekyere East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('b84fc24c-f489-4e2d-abc0-57cb0f67742a', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Sekyere Kumawu District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('3853b965-af01-485e-ba8c-9fa7502bd9e3', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Sekyere South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('31804b3b-86d7-46d0-b645-8972f1001d35', 'GH', 2, 'd786b9c7-c028-4034-88e7-125f3a11eea3', NULL, 'Suame Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('93261dc2-be2f-4ce3-81c9-77e8408de0eb', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Banda District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('12d7243a-d47d-4f27-8485-9796e22628c4', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Berekum East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ad6de187-59c2-4f63-8ca5-6cccce6adaeb', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Berekum West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('d39109fd-5608-464b-a912-6556677339d4', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Dormaa Central Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('7e48dbdb-3302-4123-8634-1c363477d007', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Dormaa East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ed684427-77c2-4e8e-9580-23ed7e2953a6', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Dormaa West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('06e0e8d5-c7bf-4e9f-9ce1-2fc04c21547f', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Jaman North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('9de1ab6f-4007-439c-9ffc-a556fadca97c', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Jaman South Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('808c693b-024a-4733-b4b2-88a08fc2aaae', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Sunyani Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('35e5a09b-cbca-4869-96e6-1dd0275f2bb5', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Sunyani West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('1b705537-8bee-4909-901c-8f7db46db324', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Tain District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('d5091076-7292-460d-ae45-fc93e4a5bdbc', 'GH', 2, '332da826-5a16-4371-b309-95a5e0447587', NULL, 'Wenchi Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('c867f78d-2e6e-4aeb-8b9a-aed3f088c006', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Atebubu-Amantin Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('b384d3d9-1e6a-485e-b34e-d031406ca2c3', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Kintampo North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('27829bf7-6bc6-447b-98fb-cf3531d20cfd', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Kintampo South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('61f367fc-0ee8-4d48-a4fc-4e9dbf8d9a9a', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Nkoranza North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('2e46f2dd-0055-454a-85e7-c74f4acb313d', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Nkoranza South Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('1009c392-2176-4d8f-b835-c321652a3366', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Pru East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e0a48893-1404-439e-8dff-b57316f3acfb', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Pru West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('336f1080-dce8-4fd0-ad47-8ab42d218ea8', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Sene East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('3bd96398-4185-49a5-a8fa-75d4ca434ad6', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Sene West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('53801105-07fc-46cb-9a47-31f72e5b8b2c', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Techiman Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('de1df06d-9ecd-4156-9e20-10fb4454a767', 'GH', 2, '4f1f749f-1930-4797-8a75-4ff75ce19020', NULL, 'Techiman North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6af91f72-1bdf-429c-ad26-617a34463d1e', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Abura/Asebu/Kwamankese District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('99f97dfa-9726-480c-a465-5ec7f310bbba', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Agona East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('27b369b5-85cd-40af-bf14-d50caf1f26b7', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Agona West Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f47c6c47-cf4d-4527-af6f-c8b763c1dae1', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Ajumako/Enyan/Essiam District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('1293fb3a-ce35-4265-a8a4-6a00e07e4dbe', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Asikuma Odoben Brakwa District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('a23d629d-77b7-4185-95fc-97c6990881f6', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Assin Central Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('727f21ea-3a0e-4954-b7e4-49ce43d54444', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Assin North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('66d7c187-f0f4-4fb9-90a5-40a807662587', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Assin South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('d5e41c04-7439-4a58-a9a3-a315f06e2c2a', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Awutu Senya East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('dd059ed8-0588-4cf9-80d9-65c2705ad998', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Awutu Senya West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('7949eb1c-7252-4e0c-8028-ae8c6704161c', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Cape Coast Metropolitan', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4363880b-8aca-44c8-8b7f-1c9b186a46af', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Effutu Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('09024190-76f1-447a-8f3a-1cf45db698dc', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Ekumfi District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('77ba45a4-f47f-4900-b4c1-84ee9edcf625', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Gomoa East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('7585e6aa-446b-4885-82dc-50d0d54ba4b3', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Gomoa Central District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6008a0b8-1169-4502-b431-f86007bd6151', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Gomoa West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('126ca060-87e3-4c7c-9f2f-5baab8314582', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Komenda/Edina/Eguafo/Abirem Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('592a9e95-d175-4c8e-a5dc-051c08715dfa', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Mfantsiman Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('b74cef18-ff5f-4536-85e1-b55662bd4a3e', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Twifo Atti Morkwa District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('0f86669e-7b1c-4f37-b8c7-36ae30f660e7', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Twifo/Hemang/Lower Denkyira District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('89f2dc78-df2b-4e2b-9dba-bd2ff1554c19', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Upper Denkyira East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('dd78cb09-f10e-44b5-a7cb-31ccd66da48a', 'GH', 2, '734aa688-74f7-4f31-8a08-28802c63ee60', NULL, 'Upper Denkyira West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('b96eb3dc-2615-4671-9b34-67c969095e30', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Abuakwa North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('0a7a0467-0a63-4faa-b77c-df5e7f833e4f', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Abuakwa South Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('37fe787c-9c2c-4e6e-a366-1f4967b0018a', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Achiase District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('03c0391c-5e35-4bad-bff1-96bcdd369e31', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Akuapim North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('a561878f-0e91-4c75-914c-be349ab2220f', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Akuapim South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('833881c3-374f-44db-a750-2ccc10949d7e', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Akyemansa District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ad678d31-9e4d-4b91-8701-9489dd474580', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Asene Manso Akroso District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('709bace6-496f-4789-902e-e4ec162eec79', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Asuogyaman District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f47c9938-bb3d-4c5e-b6ee-1f83ffe6d548', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Atiwa East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4c7fb64e-c6a2-4084-a537-8a3f7e4c0e93', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Atiwa West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('2915457d-6c7f-45a6-b5c8-d0181f8807e2', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Ayensuano District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('558ad915-b244-463b-8ed0-1748ce917bb1', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Birim Central Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('87dea2a7-a048-44ab-b83b-614c164d1e8f', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Birim North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('7d623d64-6dd1-4c81-b5f4-dde5fa173088', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Birim South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('7ffab313-05d6-4a83-a726-e44f8459b155', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Denkyembour District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('9317e034-ba77-42e7-aae8-c487bfafe519', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Fanteakwa North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6d056c11-46a5-45c2-92f7-6ff330aab7c1', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Fanteakwa South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('431ed78d-a6c0-4bd4-833c-57f842722bff', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Kwaebibirem Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('5bc8bb7b-9c49-4529-a5b3-714b2918b8f1', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Kwahu Afram Plains North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e808766f-09d4-40dc-bf1a-ab79977067b1', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Kwahu Afram Plains South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('3f355f19-45a6-4b54-9f5d-2421d9127388', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Kwahu East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('c12d989a-9b0c-4a2d-a16b-34bfabac4270', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Kwahu South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('092d5d88-f2e6-4343-a05d-c27de9e4185e', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Kwahu West Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('3af357a2-9756-4ed3-a45f-4af3a374a9e5', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Lower Manya Krobo Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('eb193bbe-4135-48ab-9977-74ee219452ff', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'New Juaben North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('2a9d1386-be98-4f37-9092-dc41993c3013', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'New Juaben South Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('2b9c5db6-7b2d-4617-8158-3477ea074989', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Nsawam Adoagyire Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('142b6b12-1126-48d8-8cd0-cab9494ef13a', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Okere District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('40f91783-e990-47eb-8e3e-ee8c5c429aa8', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Suhum Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('06828e19-0429-4250-994c-7b966b6c3eb8', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Upper Manya Krobo District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e2d8a629-aac9-4842-82c0-ff3fccf68324', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Upper West Akim District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ba7e4b03-87f4-426d-b13b-1b6fc8e6ee6e', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'West Akim Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('748cade5-c817-4397-aadb-51edaeaaddec', 'GH', 2, '290ca185-5016-4beb-9176-6e175c865983', NULL, 'Yilo-Krobo Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('99ff5aa8-7fe4-4600-a25d-40f49ba2446b', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ablekuma Central Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ee1097d9-3fa6-4d21-bc72-13b4d8b199f9', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ablekuma North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6ef57dbf-c269-427d-8d90-5fd5c5c6c43a', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ablekuma West Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4a1281c2-53d1-4ef8-9a17-24b938250595', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Accra Metropolitan', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('fa1e3691-7350-4e48-9a50-1632ea3707bb', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ada East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('16885207-2145-4701-808c-c6b01766542f', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ada West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('543e5411-89dc-463b-baab-99c472e6dca0', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Adenta Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4dbfd922-7ea3-464a-bf41-5d1b6cefcf29', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ashaiman Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f53c5677-55b1-488c-9be0-62ac8b7caa27', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ayawaso Central Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('abcf6e89-74d6-44f1-88b5-658d998eddc0', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ayawaso East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('571abc62-aee0-4ca2-ba62-b00e5b8f66a2', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ayawaso North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('1e764294-63f9-4cc3-8ced-caa4d2527145', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ayawaso West Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('12e2f7fa-b27b-4d92-9b4c-8d4a69fe9ca0', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ga Central Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('3b0600f0-ece3-4178-a246-7304e785e76d', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ga East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('d68bc8a0-9f44-4d22-9401-00330fc64e0b', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ga North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('9796df74-2cac-4831-9387-94ef944ceb06', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ga South Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('a50a72de-82f4-47fb-b012-e9f6cd356854', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ga West Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('94356c78-6854-423f-806f-5dcc2904215d', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Korle-Klottey Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('1fb9d00c-2a5c-4f2d-9675-836587670584', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Kpone-Katamanso Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('c617877f-0bb9-4583-b103-4a643edb0f33', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Krowor Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('443c2a46-3213-4eec-ac9d-2bcd4898b043', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'La-Dade-Kotopon Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('18b4d4c6-6461-4504-9a35-317f63f97447', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'La-Nkwantanang-Madina Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e073e496-c931-4426-a9f7-c1cf1c352cab', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ledzokuku Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4a740ba0-c9c7-4c03-baff-2733d4ccf353', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Ningo-Prampram District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('c9569c82-8229-4c2e-ab34-c2239815fc12', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Okaikwei North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('bf61f839-4caf-4ca7-8cfc-e0bed2e3210b', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Shai-Osudoku District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('cda20a2d-6f0c-4ecd-b685-09743fc9e9e5', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Tema Metropolitan', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('d7448ef2-763c-4a2c-a682-924d6f68b182', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Tema West Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('cf07eaa2-30f2-4c7f-a2b9-0b6ce81fe1cf', 'GH', 2, '1496648e-d9a2-49a7-b42c-96465913858f', NULL, 'Weija Gbawe Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f6ca223d-36c9-4528-adb0-a33c476745bc', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Gushegu Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('109bd14b-cfeb-4147-a169-7451355d2b3e', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Karaga District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('038b9e92-7e9e-427b-950d-d5a49733f3d3', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Kpandai District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('7248faf3-2762-4582-a2a2-50634343877b', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Kumbungu District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('c0562e1f-2be5-4a69-9069-64a780d56ed5', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Mion District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('dac85d46-41d8-4452-9d24-e8d564f759bc', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Nanton District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f228de9a-ff48-49f3-9f50-d836694be7c1', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Nanumba North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('97928a40-dd2f-40cd-b6b2-1798a0fa6e7d', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Nanumba South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('808faba8-7f8b-483e-b79c-52103aa08f1b', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Saboba District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('df88b8f3-1480-4edd-a94a-602c3a26812d', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Sagnarigu Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('5285e6cc-2b52-446b-86aa-f14938dfe664', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Savelugu Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('001e8258-d10d-43cc-8d47-c83aa5bddb54', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Tamale Metropolitan', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e9651359-1875-4ac6-9989-e082a095e116', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Tatale Sanguli District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('32a2d060-1c45-41b4-97ed-6a84a37b6a81', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Tolon District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('18ecd36e-2977-440a-ac0a-e9892081d159', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Yendi Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('52c0f1fb-4e07-4221-9566-63171e1fbc12', 'GH', 2, 'fd14a12f-af8c-4045-b327-4182a89597ae', NULL, 'Zabzugu District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f8b4e4f4-ae1f-4149-8838-ef7693c83c37', 'GH', 2, 'fe7974b2-2db9-49c6-b577-27bd34577943', NULL, 'Bunkpurugu Nyankpanduri District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('0bc67b44-35e8-41ca-9969-85bbcdef60b8', 'GH', 2, 'fe7974b2-2db9-49c6-b577-27bd34577943', NULL, 'Chereponi District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('98e71f84-f8cd-48c4-9e3c-5b6010560abf', 'GH', 2, 'fe7974b2-2db9-49c6-b577-27bd34577943', NULL, 'East Mamprusi Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('48f8293f-8fe2-42e6-bb11-63adca3bde63', 'GH', 2, 'fe7974b2-2db9-49c6-b577-27bd34577943', NULL, 'Mamprugu Moagduri District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('83559aaa-dcca-480a-a88b-586f04be40ed', 'GH', 2, 'fe7974b2-2db9-49c6-b577-27bd34577943', NULL, 'West Mamprusi Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('83d2278c-25d3-4598-956d-6f655ba14a99', 'GH', 2, 'fe7974b2-2db9-49c6-b577-27bd34577943', NULL, 'Yunyoo-Nasuan District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('fb6cea6a-5af2-4e43-9b4d-512960529da1', 'GH', 2, '6717880f-cfa4-4916-abb5-95db77b047b6', NULL, 'Biakoye District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ff4f2055-6b85-4cff-be93-bb647c5bf851', 'GH', 2, '6717880f-cfa4-4916-abb5-95db77b047b6', NULL, 'Guan District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('b27c7c19-2b15-4f0f-940d-439c5f0bfc45', 'GH', 2, '6717880f-cfa4-4916-abb5-95db77b047b6', NULL, 'Jasikan Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('5e068e77-3024-46cd-ae7e-ada3a59e3334', 'GH', 2, '6717880f-cfa4-4916-abb5-95db77b047b6', NULL, 'Kadjebi District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('44ca6c05-e761-45a9-a4f6-1812ff67d2a5', 'GH', 2, '6717880f-cfa4-4916-abb5-95db77b047b6', NULL, 'Krachi East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('609dc646-90f9-4c96-bdd9-38b0758bbe00', 'GH', 2, '6717880f-cfa4-4916-abb5-95db77b047b6', NULL, 'Krachi Nchumuru District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('182462fd-c700-4637-8d28-2d00d48bec9d', 'GH', 2, '6717880f-cfa4-4916-abb5-95db77b047b6', NULL, 'Krachi West Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6dff730c-ec12-471f-a50c-69e66afd751a', 'GH', 2, '6717880f-cfa4-4916-abb5-95db77b047b6', NULL, 'Nkwanta North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('d159db35-4296-4ef7-9eed-44f35a3b5134', 'GH', 2, '6717880f-cfa4-4916-abb5-95db77b047b6', NULL, 'Nkwanta South Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('29bac7ac-3442-47f9-bb24-b540d8bce12d', 'GH', 2, '2cd4d316-d2cd-4dcc-9cc3-f386fe3a6629', NULL, 'Bole District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('d9a306b7-510d-417c-8ce4-e0f3847c2b53', 'GH', 2, '2cd4d316-d2cd-4dcc-9cc3-f386fe3a6629', NULL, 'Central Gonja District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('90decf3e-c147-43d4-8f00-8bd553ecbb52', 'GH', 2, '2cd4d316-d2cd-4dcc-9cc3-f386fe3a6629', NULL, 'East Gonja Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6ad62030-e605-4517-9d68-2fa09493c65a', 'GH', 2, '2cd4d316-d2cd-4dcc-9cc3-f386fe3a6629', NULL, 'North Gonja District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('c53da48f-be22-400e-9689-f8e9a27e8e8f', 'GH', 2, '2cd4d316-d2cd-4dcc-9cc3-f386fe3a6629', NULL, 'North East Gonja District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e8972088-57a1-4ec3-a3ec-4b1d986c53da', 'GH', 2, '2cd4d316-d2cd-4dcc-9cc3-f386fe3a6629', NULL, 'Sawla-Tuna-Kalba District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('5a91ae3e-b93d-476f-9f0d-72654984f7ac', 'GH', 2, '2cd4d316-d2cd-4dcc-9cc3-f386fe3a6629', NULL, 'West Gonja Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f237d87d-4119-447f-98c3-5c58fef9e86f', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Bawku Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('2ec7c0a0-b436-403f-87a7-651a6ce224ed', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Bawku West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('3915d4a7-5925-443d-b4ef-f40be447bc2b', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Binduri District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('63c8fd16-d01b-435e-b78c-829a2217f7d8', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Bolgatanga East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4d4e0a1c-c890-4392-8dc5-3d8ef06d7e68', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Bolgatanga Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ce951cbb-c101-46f9-bcfa-58463d72f60a', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Bongo District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('904ec670-05ed-4335-bb2c-4d221dd43287', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Builsa North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4d1d6c43-e85e-4d53-861f-7f8d03999c93', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Builsa South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e19df1e1-91d1-42c1-9a62-97e91d31738a', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Garu District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('37fd61a1-6f50-4fcd-bf80-a1399ceab2b7', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Kassena-Nankana Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4a9ab47a-fd15-4ab9-8c45-7d392354f6de', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Kassena-Nankana West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('43fb7df7-2b97-43c5-80af-e902a61def65', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Nabdam District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ff40c82d-05bd-4ac6-8370-9aa5a3a6cbf4', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Pusiga District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6635ed86-f93d-426d-b2fc-7c2b3994475d', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Talensi District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('adc80a09-b4bb-42c1-ae5d-1c767ee90fe0', 'GH', 2, 'bc7bf2fb-03bb-4f54-85f8-be07fa2889f1', NULL, 'Tempane District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('1e2e4f8d-9626-4799-bfc2-491c220ba724', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Daffiama Bussie Issa District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f1935969-57ae-4969-95a2-62c137d3ab2c', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Jirapa Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f103b7a5-f607-4f53-bab7-b4490da26979', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Lambussie Karni District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('8ab78dc4-0461-4365-bbaf-6b0dc864ab00', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Lawra Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('d1beedd8-f2a5-4292-b0d3-adca5f131342', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Nadowli-Kaleo District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('8f1aef41-755b-4ccc-a34b-5467a751833e', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Nandom Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('1015ab7f-f7f2-495f-ba37-5d51a18e42d6', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Sissala East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('bd63155c-96b3-4786-80de-75ff0653e085', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Sissala West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('47e79c7a-7b64-469f-a941-bdd9a022c6c8', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Wa East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('9eb4a70a-fa3c-4abf-a9dd-adb6b921826f', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Wa Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('9bca91b1-8a48-4984-99dc-d59d2dda2d0f', 'GH', 2, 'a4ec10fe-dd87-4d06-ae51-3a8cb9067078', NULL, 'Wa West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('c2e27c42-7038-4ef8-853d-4b67b37041f4', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Adaklu District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('c920d09e-eeb2-4a08-8ec1-181511fe0c3f', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Afadzato South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('5063e76c-8624-41c9-be3e-2d1ad4cd83c5', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Agotime Ziope District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('67282351-75f2-439f-b994-99e93b620e45', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Akatsi North District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('f689eaf0-317f-4196-b530-80a33edec446', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Akatsi South District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('62e55564-e89b-47f1-8dc9-6e7f72981f45', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Anloga District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('85fd0200-de1e-4331-bccf-8700f1fd8839', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Central Tongu District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('6e43366b-1daa-452e-99e4-fb4e6e08e812', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Ho Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4ee480ce-7b67-4df7-8752-8231a85bde21', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Ho West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ebd6000e-a581-4df7-a9c3-7afaa6ffcc7d', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Hohoe Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e940c57f-a668-409d-951b-f15065fea2e9', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Keta Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ae65d2dc-944d-4031-b05c-ef81408a475d', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Ketu North Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ab715579-799a-414e-a508-41e1e66b8420', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Ketu South Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('461ca0ef-5112-46b7-bd1d-36a5ec5b31ce', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'Kpando Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('405eb499-13b9-40cf-9d66-d8199c561435', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'North Dayi District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('d89328d2-cbc1-40a2-9bc4-221e8298907e', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'North Tongu District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('0e203ae0-7b6d-4830-9fff-38373626f420', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'South Dayi District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('00d881fb-5b51-4512-a662-27cbc2e5ed50', 'GH', 2, 'fb32996b-cfc3-4794-abd6-1ae5b5fb41a4', NULL, 'South Tongu District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('96b026f2-758f-4013-92c3-1dbdaec6776b', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Ahanta West Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('23320aed-cc5e-4a47-a999-2b10ed366c0d', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Amenfi Central District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4c3c1af4-e05c-4b83-8a30-433e807e70e3', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Amenfi West Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('489903b5-b304-4f7a-9c7a-d1834f7234a0', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Effia Kwesimintsim Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ec8cfe16-f0e9-4132-a1f1-a7c009ec9738', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Ellembelle District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('a149f51e-fd89-4722-a7b4-29eab610775a', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Jomoro Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('cb3788da-e65b-4eeb-8957-8fa238863a7a', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Mpohor District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e239343e-7df4-4852-a7f4-331b7cb5e0ac', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Nzema East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4f4d238f-ec71-4a12-ad3a-909e4b6cf5e8', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Prestea-Huni Valley Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('8977cfc3-1209-4c49-b087-fc9e1fe178e9', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Sekondi Takoradi Metropolitan', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('778e5192-48e3-4975-8c7b-80f85e327ce3', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Shama District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ddfbd343-73a8-40c1-8e99-a5f2e0e78665', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Tarkwa-Nsuaem Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('03f271e3-c5d9-4d03-8552-876bedccc2a9', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Wassa Amenfi East Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('af9300d0-f3b0-4eaa-ace9-128796dae1cd', 'GH', 2, 'b9c7db0a-eff0-4aee-99ba-8f462b7a9be9', NULL, 'Wassa East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('33041362-bd9d-45a2-ba96-dfc42938be15', 'GH', 2, '8054d8bb-4d6b-4a8b-88dd-97733b0b39d8', NULL, 'Aowin Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('b4d0bb25-f006-43d2-8f43-183de423bc19', 'GH', 2, '8054d8bb-4d6b-4a8b-88dd-97733b0b39d8', NULL, 'Bia East District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('dd08606c-f7c5-42e0-a0d9-d3765a4ea1e6', 'GH', 2, '8054d8bb-4d6b-4a8b-88dd-97733b0b39d8', NULL, 'Bia West District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('5ed5f5b0-6fb1-4a6b-9fbe-80f8f8224e4b', 'GH', 2, '8054d8bb-4d6b-4a8b-88dd-97733b0b39d8', NULL, 'Bibiani Anhwiaso Bekwai Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('e37f73e1-d31c-4051-a8ea-f06f5d2e193f', 'GH', 2, '8054d8bb-4d6b-4a8b-88dd-97733b0b39d8', NULL, 'Bodi District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('007ed60e-88e0-4f5d-9daf-b0a0130a4088', 'GH', 2, '8054d8bb-4d6b-4a8b-88dd-97733b0b39d8', NULL, 'Juaboso District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('90b75868-76b2-4cad-9364-1138019107cf', 'GH', 2, '8054d8bb-4d6b-4a8b-88dd-97733b0b39d8', NULL, 'Sefwi Akontombra District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('ac7690e8-2598-4136-98e8-8c9565518dc7', 'GH', 2, '8054d8bb-4d6b-4a8b-88dd-97733b0b39d8', NULL, 'Sefwi-Wiawso Municipal', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.geo_units (id, country_code, level, parent_id, code, name, active, source, source_date, created_at) VALUES ('4d562918-cd20-4eb0-9746-ba0dd3419658', 'GH', 2, '8054d8bb-4d6b-4a8b-88dd-97733b0b39d8', NULL, 'Suaman District', true, 'Districts of Ghana, Wikipedia (261 MMDAs, as at October 2021). Verify against the Local Government Service list.', NULL, '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.frameworks (id, code, name, org_type, description, is_default, created_at, updated_at, purpose) VALUES ('0717e94d-7759-467a-8e35-2da6b46928a7', 'SME360', 'SME360 Business Health', 'SME', 'Baseline framework. Used for every organisation type until a specialised framework has an approved version.', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00', 'full');
--> statement-breakpoint
INSERT INTO public.frameworks (id, code, name, org_type, description, is_default, created_at, updated_at, purpose) VALUES ('f5af043a-ca40-40f9-8ce3-d690244cc61b', 'AGRIFOOD360', 'AgriFood360 Business Health', 'AGRIFOOD', 'Specialised agrifood framework. No approved version yet.', false, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00', 'full');
--> statement-breakpoint
INSERT INTO public.frameworks (id, code, name, org_type, description, is_default, created_at, updated_at, purpose) VALUES ('bf094d5c-6796-4ce5-aa17-2249fc90c315', 'ESO360', 'ESO360 Business Health', 'ESO', 'Specialised framework for ecosystem support organisations. No approved version yet.', false, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00', 'full');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('76032b37-e363-4c8f-b129-96ab076378bb', 'IVL-001', 'Weekly cash review routine', 'Financial Management and Performance', 'Set a weekly cash review with a simple cash book.', 30, 'Cash cover in weeks', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('e10f2810-f314-4c19-aeb3-42bc454f2299', 'IVL-002', 'Debtor collection routine', 'Financial Management and Performance', 'Agree terms, follow up late payers on a fixed rhythm.', 45, 'Debtor days', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('0c2ce87c-a0fd-4195-ace4-5eb7f899a73c', 'IVL-003', 'Costing and pricing sheet', 'Strategy, Market and Customers', 'Cost every product line and set prices from cost plus market.', 30, 'Gross margin percent', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('1a1597bb-9bde-436d-9c3a-5e6cbb0a1ac3', 'IVL-004', 'Buyer diversification plan', 'Strategy, Market and Customers', 'Identify and approach five new buyers.', 60, 'Top buyer share of sales', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('09684c38-b1a9-45a8-88d1-e6b7bccadd6c', 'IVL-005', 'Loss measurement and reduction', 'Operations and Value Delivery', 'Measure losses at each stage and fix the largest.', 60, 'Loss percent', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('797a7bf2-d60c-43ba-8c44-2b79a9fa3152', 'IVL-006', 'Monthly stock count', 'Operations and Value Delivery', 'Count and reconcile stock monthly.', 30, 'Stock variance percent', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('ed316500-1e6b-476a-a474-4fafd75053fc', 'IVL-007', 'Roles and monthly review', 'People, Leadership and Governance', 'Write roles and hold a monthly review.', 45, 'Reviews held', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('2681a798-fa31-4223-8459-436ba2591f02', 'IVL-008', 'Simple ledger and records', 'Records, Data and Systems', 'Set up a ledger for sales and purchases.', 30, 'Months with complete records', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('cdfbed9f-829b-4094-be27-384540e5390b', 'IVL-009', 'Registration and compliance', 'Legal, Regulatory and Risk', 'Complete registration and tax filings.', 90, 'Compliance items complete', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('fbc18e2a-d8d1-43d4-94b2-019b372ca2f4', 'IVL-010', 'Investment readiness pack', 'Funding and Capital Readiness', 'Prepare records and a summary for lenders.', 90, 'Pack complete', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('5548c3da-b9ab-4ef9-9d47-aa27b3bccd36', 'IVL-011', 'Working capital facility preparation', 'Funding and Capital Readiness', 'Prepare a financing request, secure a facility and agree a repayment plan.', 180, 'Facility secured in GHS', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('667e0c56-7613-472d-ab70-fe88c10ce2f5', 'IVL-012', 'Second market development', 'Strategy, Market and Customers', 'Open and serve a second market zone or buyer group.', 180, 'Share of sales from new buyers', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('ec625346-a0b3-4c74-8c9d-3a4e545ac2a1', 'IVL-013', 'Storage and handling upgrade', 'Operations and Value Delivery', 'Improve storage or handling to cut losses and hold stock for better prices.', 180, 'Loss percent', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('e1e4030d-26d6-4c2e-9436-98b4dae1b08c', 'IVL-014', 'Annual plan and budget cycle', 'People, Leadership and Governance', 'Set a yearly plan and budget with a quarterly review calendar.', 360, 'Quarterly reviews held', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('069c56b5-a642-44b8-a058-19b805222589', 'IVL-015', 'Governance and accountability structure', 'People, Leadership and Governance', 'Set up an advisory group and written policies for the business.', 360, 'Policies in force', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('4059ea15-5823-4c96-8b4f-a409238465b2', 'IVL-016', 'Reviewed annual accounts', 'Funding and Capital Readiness', 'Produce a full year of management accounts and prepare for external review.', 360, 'Months of reviewed accounts', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('7f3bb72c-d9f7-4f3b-94e9-667741961f07', 'IVL-017', 'Customer and sales record', 'Records, Data and Systems', 'Record every sale and customer in one book or sheet so repeat buyers and trends are visible.', 30, 'Months with sales records kept', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('a76488e8-abb5-47ca-9fdb-d0c648a59abc', 'IVL-018', 'Document filing and backup routine', 'Records, Data and Systems', 'File key documents in one place, keep a copy off site, and name a person responsible.', 45, 'Key documents filed and backed up', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('b195d628-775c-4c59-a202-601ccaab49ba', 'IVL-019', 'Risk register and mitigation plan', 'Legal, Regulatory and Risk', 'List the main risks to the business, rate them, and agree an owner and action for each of the top five.', 60, 'Top risks with an owner and action', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('e08e9bb2-55cc-4226-8e29-f7e5c1647691', 'IVL-020', 'Key contracts and agreements file', 'Legal, Regulatory and Risk', 'Put the main buyer, supplier, lease and employment agreements in writing, signed and filed.', 60, 'Key agreements written and signed', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('6381de47-d13b-4800-acdf-7c40225b5db4', 'IVL-021', 'Seasonal and climate risk plan', 'Resilience, Inclusion and Sustainability', 'Map the seasonal and weather risks to supply, production and sales, and agree a response for each.', 90, 'Risks with a response plan', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('aa8c1100-236c-4db5-ad99-9d657f07e5e2', 'IVL-022', 'Women and youth inclusion practice', 'Resilience, Inclusion and Sustainability', 'Review who works in, supplies and buys from the business, and set two practical steps to widen access for women and youth.', 90, 'Share of women and youth in roles and sales', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('61f7f344-5fd6-4af5-aa09-04c97d281460', 'IVL-023', 'Waste and environmental practice', 'Resilience, Inclusion and Sustainability', 'Identify the main waste and environmental impacts and put simple handling practices in place.', 90, 'Waste managed per agreed practice', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('b27776b1-404a-49bf-9b64-845467ecc9af', 'IVL-024', 'Monthly budget versus actual', 'Financial Management and Performance', 'Compare actual income and costs with the budget every month and act on the largest gaps.', 45, 'Months reviewed against budget', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('014e7bb8-fe6a-4d56-9628-d2e9a197c69a', 'IVL-025', 'Twelve-month business plan', 'Strategy, Market and Customers', 'Write a twelve-month plan with sales and profit targets in cedis and the steps to reach them.', 60, 'Plan with targets in cedis', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('8e1c6a6a-9d6f-4241-a5c2-4661227d4950', 'IVL-026', 'Staff pay and basic HR records', 'People, Leadership and Governance', 'Give every worker written terms, keep pay records, and agree a simple leave and conduct rule.', 45, 'Staff with written terms and pay records', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('64b12beb-1548-4716-a657-fe415c64e16b', 'IVL-027', 'Lender and funder mapping', 'Funding and Capital Readiness', 'List suitable lenders and funders, match each to the business, and approach the best three.', 45, 'Funders matched and approached', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
INSERT INTO public.library_items (id, code, title, dimension, description, typical_days, kpi_hint, active, created_at, updated_at) VALUES ('f38c3a40-7aa0-44cc-8bdd-496462b3ce24', 'IVL-028', 'Process mapping and standard routines', 'Operations and Value Delivery', 'Write down the core production and delivery steps and agree who does what, then follow them for a month.', 60, 'Core routines written and followed', true, '2026-10-23 21:35:16.86469+00', '2026-10-23 21:35:16.86469+00');
--> statement-breakpoint
