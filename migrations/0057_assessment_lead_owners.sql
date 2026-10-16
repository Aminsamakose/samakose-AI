-- 0057: Admin-configurable owner(s) for free-assessment lead triage (#129).
-- An administrator assigns one or more existing users as the people who own newly completed free
-- assessment leads (kind='assessment' inquiries). No per-lead assignment yet -- that is a bigger
-- change (needs a UI for reassigning individual leads) and wasn't asked for; this is "who owns new
-- leads", answered once for the team, editable at any time by an admin.

create table if not exists public.free_assessment_owners (
  user_id uuid primary key references public.users(id) on delete cascade,
  added_by uuid references public.users(id),
  added_at timestamptz not null default now()
);

alter table public.free_assessment_owners enable row level security;
