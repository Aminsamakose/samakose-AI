-- 0063: Add a retention timestamp to browser-scored assessment results.
-- Backfill existing results from the linked inquiry creation time. If any result lacks a
-- matching inquiry, SET NOT NULL below fails instead of assigning a misleading migration date.
alter table public.free_assessment_results
  add column if not exists created_at timestamptz;

update public.free_assessment_results as result
set created_at = inquiry.created_at
from (
  select public_assessment_id, min(created_at) as created_at
  from public.inquiries
  where public_assessment_id is not null
  group by public_assessment_id
) as inquiry
where result.id = inquiry.public_assessment_id
  and result.created_at is null;

alter table public.free_assessment_results
  alter column created_at set default now(),
  alter column created_at set not null;

create index if not exists free_assessment_results_created_at_idx
  on public.free_assessment_results (created_at);
