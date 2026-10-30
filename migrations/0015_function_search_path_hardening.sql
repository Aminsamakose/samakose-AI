-- §13 architecture review: Supabase's security advisor flagged these three functions for a mutable
-- search_path. All three already fully qualify every table reference with `public.`, and none runs
-- as SECURITY DEFINER, so there is no live privilege-escalation path today -- but an unqualified
-- reference added later would resolve against whatever search_path the calling session happens to
-- have, which is exactly the class of bug this lint exists to catch early. Pinning search_path on the
-- function itself costs nothing and removes the risk permanently. Logic is unchanged; only the
-- function-level `SET search_path = public` clause is added.
CREATE OR REPLACE FUNCTION public.framework_version_is_published(p_version uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
  select exists (
    select 1 from public.framework_versions v
    where v.id = p_version and v.status in ('Published', 'Retired')
  );
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.match_public_assessments_to_organisations()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
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
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_published_framework_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
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
end $function$;
