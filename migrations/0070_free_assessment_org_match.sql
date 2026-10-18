-- #128: a join key between free_assessment_results (the free preliminary assessment) and
-- organisations/cases (the paid diagnostic), so the same business's free-assessment classification can be
-- compared against its own full diagnostic outcome once both exist -- the convergent-validity check #127
-- needs this.
--
-- public_assessments has a claimed_by_user_id column for exactly this kind of join, but that table is no
-- longer written to for free-assessment completions: completeFreeAssessment (src/services/publicAssessments.ts)
-- writes free_assessment_results instead (migration 0062 moved scoring into the browser; public_assessments
-- is only read for legacy pre-migration eligibility checks). The matched_org_id column therefore goes on
-- free_assessment_results, the table every current and future free-assessment row actually lands in.
--
-- Matching is done on normalised email rather than any explicit "claim" step, since no claim flow exists
-- in the product today: match_public_assessments_to_organisations() below finds, for each
-- free_assessment_results row with no match yet, the organisations row of the same platform/orgType whose
-- trimmed, lower-cased contact email equals the result's own trimmed, lower-cased email. Ambiguous matches
-- (more than one organisation with that email) are left unmatched for manual review rather than guessed at.
alter table public.free_assessment_results add column if not exists matched_org_id uuid references public.organisations(id);
create index if not exists free_assessment_results_matched_org_idx on public.free_assessment_results (matched_org_id) where matched_org_id is not null;

create or replace function public.match_public_assessments_to_organisations() returns integer as $$
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
$$ language plpgsql;
